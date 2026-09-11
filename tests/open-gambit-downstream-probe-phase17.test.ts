/**
 * Open Gambit Phase 1.7 — N7 DIAGNOSIS (task T1).
 *
 * OPT-IN ONLY. Real network calls to the configured provider. Skipped unless
 * GAMBIT_PHASE17_PROBE=1, so `npm test` never spends provider quota.
 *
 * WHAT THIS PROBE ANSWERS
 * -----------------------
 * Phase 1.6 established N7: two limits that configuration cannot raise.
 *
 *   1. `getGambitModelRoleConfig` clamps `tokenBudget` at 8,000.
 *   2. The same function clamps non-translation `timeoutMs` at 30,000 ms.
 *
 * At critic 6,000 the residual failure shape changed from a pure token
 * truncation (~15 s at 3,000) into a 28.5-30.3 s DEADLINE collision, including
 * one hard `timeout`. Phase 1.6 measured 4/12 truncated in one round. Those two
 * readings are consistent with two very different root causes:
 *
 *   (a) still token-bound -- the model needs > 6,000 but is stopped by
 *       `finish_reason=length` before the deadline; raising the deadline would
 *       merely convert `length` into `timeout`;
 *   (b) now deadline-bound -- the model would have finished, but the 30,000 ms
 *       clamp kills the socket first (`timeout`, or a truncated stream).
 *
 * They demand OPPOSITE fixes. (a) is only solvable by re-sampling or a larger
 * budget; (b) is solvable by raising the clamp. This probe separates them by
 * counting, for every failed critic call, whether the transport shows a
 * `length` finish (token wall) or a deadline kill, and by histogramming the
 * latency of SUCCESSFUL calls - which is the only honest closeness-to-deadline
 * measurement available, since a killed call reports the deadline, not the
 * latency the model would have needed.
 *
 * SCOPE, DELIBERATELY NARROW
 * --------------------------
 *  - One matrix per block, selected by `GAMBIT_PHASE17_MATRIX`. T1's diagnosis
 *    runs `B` (forced admission) so an eligibility change cannot confound the
 *    critic measurement; Phase 1.6's warning stands that B results are NEVER a
 *    pass rate. T3's post-fix baseline runs `A`, which exercises the real
 *    qualification gate and is the only honest `AUTO_PUBLISH_ELIGIBLE` figure.
 *  - critic budget = 6,000 (Phase 1.6 T2's configured value), analysis 8,000,
 *    triage 2,400 -- the production-shaped combination.
 *  - 4 candidates x 5 replicates = 20 runs, versus Phase 1.6's 3 replicates,
 *    because a ~1/3 tail needs more than 3 samples to characterise.
 *
 * CHUNKING (N8)
 * -------------
 * Phase 1.6 recorded N8: a single process degrades to 100% timeout after
 * roughly 25-35 cumulative streaming calls, and a fresh process recovers. The
 * mechanism is UNDETERMINED and this probe does not assert one. It therefore
 * runs in blocks of at most 10 replicates (`GAMBIT_PHASE17_BLOCK_SIZE`) and
 * writes each block to disk immediately, so a later block degrading cannot
 * destroy an earlier block's evidence:
 *
 *   set -a && . ./.env && set +a
 *   for OFFSET in 0 10; do
 *     GAMBIT_PHASE17_PROBE=1 GAMBIT_PHASE17_BLOCK_OFFSET=$OFFSET \
 *       npx vitest run tests/open-gambit-downstream-probe-phase17.test.ts
 *   done
 *
 * READ-ONLY with respect to production:
 *  - `dependencies.repository` is never supplied, so `recordLLMAttempt` is never
 *    called and nothing is persisted to D1/R2;
 *  - only `runGambitStages()` runs, which returns an in-memory draft and never
 *    touches the publication path;
 *  - no Workflow is started and no budget env is read from production config.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import corpus from './fixtures/open-gambit/real-corpus-2026-09-11.json';

const ENABLED = process.env.GAMBIT_PHASE17_PROBE === '1';
const BASE_URL = process.env.GAMBIT_PHASE17_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.GAMBIT_PHASE17_MODEL ?? 'deepseek-flash';

/** Phase 1.6 T2's production-shaped role budgets. Overridable for re-measurement. */
const ANALYSIS_BUDGET = Number(process.env.GAMBIT_PHASE17_ANALYSIS_BUDGET ?? 8_000);
const TRIAGE_BUDGET = Number(process.env.GAMBIT_PHASE17_TRIAGE_BUDGET ?? 2_400);
const CRITIC_BUDGET = Number(process.env.GAMBIT_PHASE17_CRITIC_BUDGET ?? 6_000);

/**
 * The unconfigurable clamp this phase is about. Read from the module under test
 * rather than re-declared, so a future change to the clamp is measured, not
 * assumed: the probe reports the epoch as "died at the clamp" only if the
 * observed latency actually sits at THIS value.
 */
const ROLE_TIMEOUT_MS = Number(process.env.GAMBIT_PHASE17_ROLE_TIMEOUT_MS ?? 30_000);

/** Total replicates across all blocks; block size bounds one process (N8). */
const REPLICATES = Number(process.env.GAMBIT_PHASE17_REPLICATES ?? 20);
const BLOCK_SIZE = Number(process.env.GAMBIT_PHASE17_BLOCK_SIZE ?? 10);
const BLOCK_OFFSET = Number(process.env.GAMBIT_PHASE17_BLOCK_OFFSET ?? 0);
/**
 * Per-process request ceiling. N8 is a COUNT effect, so the block must stop on
 * observed requests, not on completed replicates -- one replicate issues 2-4
 * requests and the provider retries transport failures internally.
 */
const MAX_REQUESTS_PER_PROCESS = Number(process.env.GAMBIT_PHASE17_MAX_REQUESTS ?? 24);
const OUT_DIR = process.env.GAMBIT_PHASE17_OUT ?? 'probe-results';

/**
 * Bypass deterministic admission ONLY, and ONLY for matrix B, exactly as Phase
 * 1.5/1.6 matrix B did. Matrix A must see the real gate, so the override is
 * neutralised there: a free pass through admission would make the honest-path
 * pass rate meaningless.
 */
vi.mock('../src/open-gambit/policy', async importActual => {
  const original = await importActual<typeof import('../src/open-gambit/policy')>();
  const MATRIX_IS_A = (process.env.GAMBIT_PHASE17_MATRIX ?? 'B').toUpperCase() === 'A';
  return {
    ...original,
    qualificationGate: (input: Parameters<typeof original.qualificationGate>[0]) => MATRIX_IS_A
      ? original.qualificationGate(input)
      : {
        ...original.qualificationGate(input),
        qualified: true,
        reason: null,
      },
  };
});

interface CorpusEntry {
  sourceId: string; title: string; url: string; publishedAt: string | null;
  quote: string; summary: string; sourceTier: string;
}

/** The 4 candidates Phase 1's T6 admitted - the only positives in the frozen corpus. */
const POSITIVE_TARGETS = [
  'AI Scan for pull request APIs in public preview',
  'Enterprise managed permissions for GitHub Copilot agent operations',
  'GitHub Advanced Security expands trial availability',
  'MAI-Code-1-Flash deprecated',
];

const TARGETS = process.env.GAMBIT_PHASE17_TARGETS
  ? process.env.GAMBIT_PHASE17_TARGETS.split('|')
  : POSITIVE_TARGETS;

/**
 * Which matrix this block runs.
 *
 *  - `B` forces deterministic admission ONLY (the real gate's verdict is
 *    discarded for the value handed back to the pipeline). T1's N7 diagnosis
 *    uses B so an eligibility change cannot confound the critic measurement.
 *    B results are NEVER a pass rate.
 *  - `A` runs the REAL qualification gate end to end: triage, analysis, critic
 *    and the deterministic publication gate, with no override anywhere. This is
 *    the only honest `AUTO_PUBLISH_ELIGIBLE` measurement, and it is what T3
 *    re-runs after the N7 fix.
 */
const MATRIX = (process.env.GAMBIT_PHASE17_MATRIX ?? 'B').toUpperCase() === 'A' ? 'A' as const : 'B' as const;

/** Transport facts read from the tee'd SSE branch, independent of the client. */
interface TransportRecord {
  httpStatus: number;
  contentType: string | null;
  rawBytes: number;
  frames: number;
  contentChars: number;
  reasoningChars: number;
  finishReasons: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  parsedOk: boolean;
  keys: string[];
  streamEnded: boolean;
  /** Wall-clock from request dispatch to the observer branch ending. */
  observedMs: number;
  error?: string;
}

interface RawCall {
  candidate: string;
  replicate: number;
  seq: number;
  role: string;
  attemptIndex: number;
  tokenBudget: number;
  value: Record<string, unknown> | null;
  /** Raw provider error code, e.g. `timeout`, `empty_response`, `http_402`. */
  errorCode: string | null;
  error: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  transport: TransportRecord | null;
  debug?: Record<string, unknown>;
}

interface RunTrace {
  candidate: string;
  replicate: number;
  finalStatus: string;
  reason?: string;
  publicationDecision?: string;
  analysisAttempts?: number;
  triageAttempts?: number;
  analysisDecision?: string;
  critic: {
    accepted?: boolean;
    motiveConcern?: boolean;
    causalConcern?: boolean;
    sensationalismConcern?: boolean;
    falsifiabilityConcern?: boolean;
    politicalFraming?: boolean;
    rejectionReasons?: string[];
  };
  /** Calls made inside this replicate. */
  calls: number;
  /** Critic role calls made inside this replicate (1 or 2 once N7 lands). */
  criticCalls: number;
  node: string;
}

const rawCalls: RawCall[] = [];
const traces: RunTrace[] = [];
let forcedTriageOverrides = 0;
let observedRequests = 0;

function entryFor(title: string): CorpusEntry {
  const entries = corpus.entries as unknown as CorpusEntry[];
  const found = entries.find(
    candidate => candidate.title.toLowerCase() === title.toLowerCase(),
  ) ?? entries.find(candidate => candidate.title.toLowerCase().includes(title.toLowerCase()));
  if (!found) throw new Error(`fixture candidate not found: ${title}`);
  return found;
}

/** Parse every captured SSE frame: content, finish_reason and usage. */
function summarizeSse(text: string): Omit<TransportRecord, 'httpStatus' | 'contentType' | 'streamEnded' | 'observedMs' | 'error'> {
  let content = '';
  let reasoningChars = 0;
  let frames = 0;
  const finishReasons: string[] = [];
  let usage: any = null;

  for (const line of text.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    frames += 1;
    try {
      const parsed = JSON.parse(payload) as any;
      const choice = parsed.choices?.[0];
      content += choice?.delta?.content ?? choice?.message?.content ?? '';
      reasoningChars += (choice?.delta?.reasoning_content ?? '').length;
      if (choice?.finish_reason) finishReasons.push(String(choice.finish_reason));
      if (parsed.usage) usage = parsed.usage;
    } catch { /* partial or metadata frame */ }
  }

  const trimmed = content.trim();
  let parsedOk = false;
  let keys: string[] = [];
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    parsedOk = true;
    keys = Object.keys(value);
  } catch { /* not valid JSON */ }

  return {
    rawBytes: text.length,
    frames,
    contentChars: content.length,
    reasoningChars,
    finishReasons,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    parsedOk,
    keys,
  };
}

/**
 * `tee()` the transport so the trailing `usage` frame is captured even though
 * the production client cancels its branch as soon as the structured JSON is
 * complete. Each record additionally carries `observedMs`, the observer
 * branch's own wall-clock: on a deadline kill this is the only place the
 * DEADLINE (as opposed to the reported latency) can be seen.
 */
function createObserver(): { fetchImpl: typeof fetch; records: TransportRecord[] } {
  const records: TransportRecord[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    const startedAt = Date.now();
    observedRequests += 1;
    const response = await globalThis.fetch(input, init);
    const record: TransportRecord = {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      rawBytes: 0, frames: 0, contentChars: 0, reasoningChars: 0,
      finishReasons: [],
      promptTokens: null, completionTokens: null, reasoningTokens: null,
      parsedOk: false, keys: [], streamEnded: false,
      observedMs: 0,
    };
    records.push(record);

    if (!response.body) {
      record.streamEnded = true;
      record.observedMs = Date.now() - startedAt;
      return response;
    }

    const [forClient, forObserver] = response.body.tee();

    // The observer branch is drained independently and to completion. Cancelling
    // the client branch does NOT cancel the source until both branches are gone,
    // which is exactly why the trailing usage frame survives.
    void (async () => {
      const reader = forObserver.getReader();
      const decoder = new TextDecoder();
      let text = '';
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
        record.streamEnded = true;
        Object.assign(record, summarizeSse(text));
      } catch (error) {
        record.error = error instanceof Error ? `${error.name}:${error.message}` : String(error);
        Object.assign(record, summarizeSse(text));
      } finally {
        record.observedMs = Date.now() - startedAt;
        reader.releaseLock();
      }
    })();

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(forClient, { status: response.status, statusText: response.statusText, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, records };
}

/**
 * DIAGNOSTIC ONLY. Re-issues the identical request and records the SHAPE of the
 * provider's response. Never records prompt text or the model's prose, and is
 * never persisted. Dedup key includes replicate and seq.
 */
const capturedFailures = new Set<string>();

async function captureFailureShape(
  candidate: string, replicate: number, callRole: string, seq: number,
  apiKey: string, request: any,
): Promise<Record<string, unknown>> {
  const key = `${candidate}|${replicate}|${callRole}|${seq}`;
  if (capturedFailures.has(key)) return { candidate, role: callRole, seq, replicate, note: 'already-captured' };
  capturedFailures.add(key);

  const outcome: Record<string, unknown> = { candidate, role: callRole, seq, replicate, tokenBudget: request.tokenBudget };
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-opencode-session': 'gambit-phase17-diagnostic',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        response_format: { type: 'json_object' },
        temperature: request.role === 'translation' ? 0 : 0.1,
        max_tokens: request.tokenBudget,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    outcome.httpStatus = response.status;
    const raw = await response.text();
    outcome.elapsedMs = Date.now() - startedAt;
    outcome.transport = summarizeSse(raw);
    return outcome;
  } catch (error) {
    outcome.threw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    outcome.elapsedMs = Date.now() - startedAt;
    return outcome;
  }
}

const NODE_ID = `${MATRIX}-${process.pid}-${BLOCK_OFFSET}`;

describe.skipIf(!ENABLED)('Open Gambit Phase 1.7 - N7 critic diagnosis and post-fix baseline', () => {
  it('runs critic at 6,000 over the 4 T6 positives, in a bounded block', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GAMBIT_LLM_API_KEY;
    expect(apiKey, 'DEEPSEEK_API_KEY must be set').toBeTruthy();

    const { runGambitStages } = await import('../src/open-gambit/pipeline');
    const actualPolicy = await vi.importActual<typeof import('../src/open-gambit/policy')>('../src/open-gambit/policy');
    const { getGambitModelRoleConfig, providerForRole } = await import('../src/open-gambit/llm');
    const { GambitRunBudget } = await import('../src/open-gambit/budget');

    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({
        triage: { timeoutMs: ROLE_TIMEOUT_MS, tokenBudget: TRIAGE_BUDGET },
        gambit_analysis: { timeoutMs: ROLE_TIMEOUT_MS, tokenBudget: ANALYSIS_BUDGET },
        critic: { timeoutMs: ROLE_TIMEOUT_MS, tokenBudget: CRITIC_BUDGET },
      }),
      GAMBIT_LLM_MODEL: MODEL,
      GAMBIT_LLM_PROVIDER: 'deepseek',
    });

    const criticRole = roles.find(role => role.role === 'critic')!;
    const analysisRole = roles.find(role => role.role === 'gambit_analysis')!;

    // The diagnosis is only meaningful if the requested budgets actually
    // reached the provider: an over-ask is silently clamped and would be
    // reported as something else. Critic must also NOT be clamped, or the
    // probe would measure 8,000 while claiming 6,000.
    expect(analysisRole.tokenBudget).toBe(ANALYSIS_BUDGET);
    expect(criticRole.tokenBudget).toBe(CRITIC_BUDGET);
    // N7's premise: the clamp cannot express a longer deadline. Assert the
    // clamp itself rather than assume it, so this probe fails loudly if the
    // ceiling moves under it.
    expect(criticRole.timeoutMs, 'critic timeoutMs was expected to equal the clamp').toBe(ROLE_TIMEOUT_MS);

    // Blocks partition replicates [0, REPLICATES). BLOCK_OFFSET is the first
    // replicate this process owns, BLOCK_SIZE how many it may run -- this keeps
    // a block independent of the total, so the total can change between rounds
    // without renumbering blocks that already ran.
    const blockReplicates = Array.from({ length: REPLICATES }, (_, index) => index + 1)
      .filter(replicate => replicate > BLOCK_OFFSET && replicate <= BLOCK_OFFSET + BLOCK_SIZE);

    console.log(`\n===== PHASE 1.7 PROBE CONFIG =====`);
    console.log(`node=${NODE_ID} baseUrl=${BASE_URL} model=${MODEL} matrix=${MATRIX}`);
    console.log(`replicates=${blockReplicates.join(',')} (of ${REPLICATES}; blockSize=${BLOCK_SIZE} offset=${BLOCK_OFFSET})`);
    console.log(`role budgets: triage=${roles.find(r => r.role === 'triage')!.tokenBudget} analysis=${analysisRole.tokenBudget} critic=${criticRole.tokenBudget}`);
    console.log(`role timeoutMs: triage=${roles.find(r => r.role === 'triage')!.timeoutMs} analysis=${analysisRole.timeoutMs} critic=${criticRole.timeoutMs}`);
    console.log(`maxRequestsPerProcess=${MAX_REQUESTS_PER_PROCESS}`);
    // An empty block would otherwise run zero candidates and look like a clean
    // measurement of nothing.
    expect(blockReplicates.length, 'block selected no replicates').toBeGreaterThan(0);

    const providerDiagnostics: Array<Record<string, unknown>> = [];
    /**
     * The provider's own transport attempts, per role, so latency is counted per
     * REQUEST rather than per `complete()` call. `phase` is the provider's own
     * outcome classification (`PARSE`/`TIMEOUT`/`NETWORK`/`SCHEMA` mean the
     * request did not yield a usable value, even when HTTP itself was fine).
     */
    interface RequestRecord {
      role: string; replicate: number; phase: string;
      httpStatus: number | null; latencyMs: number;
      errorCode: string | null; structuredJsonComplete: boolean | null;
    }
    const requestLatencies: RequestRecord[] = [];

    function wrap(role: 'triage' | 'gambit_analysis' | 'critic', candidate: string, replicate: number) {
      const config = roles.find(item => item.role === role)!;
      const observer = createObserver();
      const inner = providerForRole(config, {
        GAMBIT_LLM_API_KEY: apiKey,
        GAMBIT_LLM_BASE_URL: BASE_URL,
      }, observer.fetchImpl, diagnostic => {
        providerDiagnostics.push({
          role, candidate: candidate.slice(0, 40), replicate,
          phase: diagnostic.phase, code: diagnostic.errorCode,
          status: diagnostic.status, latencyMs: diagnostic.latencyMs,
          chunks: diagnostic.streamChunks, contentBytes: diagnostic.contentBytes,
          jsonComplete: diagnostic.structuredJsonComplete,
        });
        // EVERY provider transport attempt is recorded here, including the
        // provider's own internal retries -- this is the only per-REQUEST
        // latency series, and the deadline question is a per-request question.
        requestLatencies.push({
          role, replicate,
          phase: diagnostic.phase,
          httpStatus: diagnostic.status ?? null,
          latencyMs: diagnostic.latencyMs ?? 0,
          errorCode: diagnostic.errorCode ?? null,
          structuredJsonComplete: diagnostic.structuredJsonComplete ?? null,
        });
      });
      if (!inner) throw new Error(`provider missing for role ${role}`);
      let seq = 0;
      return {
        name: inner.name,
        async complete<T>(request: any) {
          seq += 1;
          const attemptIndex = seq;
          const transportBefore = observer.records.length;
          const base: Omit<RawCall, 'value' | 'error' | 'errorCode'> = {
            candidate, replicate, seq, role, attemptIndex,
            tokenBudget: request.tokenBudget,
            transport: null,
          };
          try {
            const out = await inner.complete<T>(request);
            rawCalls.push({
              ...base,
              value: out.value as Record<string, unknown>,
              error: null,
              errorCode: null,
              inputTokens: out.inputTokens,
              outputTokens: out.outputTokens,
              latencyMs: out.latencyMs,
              transport: observer.records[observer.records.length - 1] ?? null,
            });
            // MATRIX B: the real triage call has already been made and recorded;
            // only the value handed BACK to the pipeline is synthesized, and only
            // for the triage role (Phase 1.6 observed that a leak into analysis
            // produces a `PROVIDER_SCHEMA_INVALID` artifact that mimics a model
            // defect).
            if (MATRIX !== 'B' || role !== 'triage') return out;
            const real = (out.value ?? {}) as Record<string, unknown>;
            const forced = {
              shouldDeepAnalysisRun: true,
              aiTechRelevance: true,
              eventImportance: 0.7,
              strategicMechanism: typeof real.strategicMechanism === 'string' && real.strategicMechanism
                ? real.strategicMechanism
                : 'PHASE17_FORCED_ADMISSION',
              evidenceSufficient: true,
              politicsExcluded: false,
              political: { excluded: false, reasons: [], confidence: null },
              reason: 'PHASE17_MATRIX_B_FORCED_ADMISSION',
            };
            forcedTriageOverrides += 1;
            return { ...out, value: forced as unknown as T };
          } catch (error) {
            const transport = observer.records[observer.records.length - 1] ?? null;
            const noTransport = observer.records.length === transportBefore;
            const message = error instanceof Error ? `${(error as any).code ?? error.name}:${error.message}` : String(error);
            rawCalls.push({
              ...base,
              value: null,
              error: message,
              // `GambitProviderError.message` IS the code; splitting on `:` keeps
              // the raw provider vocabulary (`timeout`, `empty_response`,
              // `invalid_structured_json`, `http_402`, ...) instead of a guess.
              errorCode: (error as any)?.code ?? (error as any)?.name ?? 'unknown',
              transport,
              debug: noTransport
                ? await captureFailureShape(candidate, replicate, role, seq, apiKey, request)
                : { note: 'tee-captured' },
            });
            throw error;
          }
        },
      };
    }

    async function runOne(title: string, replicate: number): Promise<RunTrace> {
      const entry = entryFor(title);
      const evidence = {
        snapshotId: 1, sourceId: entry.sourceId, sourceTier: entry.sourceTier as 'PRIMARY_OFFICIAL',
        canonicalUrl: entry.url, title: entry.title, publisher: entry.sourceId,
        publishedAt: entry.publishedAt, quote: entry.quote, role: 'FACT' as const,
        contentHash: 'a'.repeat(64),
      };
      const decision = actualPolicy.qualificationGate({
        headline: entry.title, summary: entry.summary, content: entry.summary, evidence: [evidence],
      });
      const candidate = actualPolicy.makeCandidateFromDecision({
        fingerprint: `phase17-${MATRIX.toLowerCase()}-${entry.sourceId}-${entry.title.slice(0, 40)}`,
        headline: entry.title, summary: entry.summary, canonicalUrl: entry.url,
        snapshotIds: [1], sourceIds: [entry.sourceId], decision,
        discoveredAt: new Date().toISOString(),
      });

      const trace: RunTrace = {
        candidate: entry.title, replicate,
        finalStatus: 'UNKNOWN', critic: {}, calls: 0, criticCalls: 0, node: NODE_ID,
      };
      const before = rawCalls.filter(call => call.candidate === entry.title && call.replicate === replicate).length;
      try {
        const result = await runGambitStages(candidate, [evidence], {
          providers: {
            triage: wrap('triage', entry.title, replicate) as any,
            gambit_analysis: wrap('gambit_analysis', entry.title, replicate) as any,
            critic: wrap('critic', entry.title, replicate) as any,
          },
          roles,
          // 40,000 rather than production's 28,000: this probe measures the
          // critic's DEADLINE behaviour. A budget-exceeded short-circuit would
          // be recorded as a critic failure and would masquerade as the very
          // tail being measured.
          budget: new GambitRunBudget({
            maxLlmCalls: 12, maxLlmTokens: 40_000,
            maxTranslationLlmCalls: 8, maxTranslationLlmTokens: 16_000,
            maxSearchRequests: 6, maxXRequests: 6, maxGithubRequests: 6, maxHttpRequests: 20,
          }),
          now: new Date(),
        } as any);
        trace.finalStatus = result.status;
        trace.reason = result.reason;
        trace.publicationDecision = result.publicationDecision;
        trace.analysisAttempts = result.analysisAttempts;
        trace.triageAttempts = result.triageAttempts;
        trace.analysisDecision = (result as any).analysis?.decision;
        const critic = (result as any).critic;
        if (critic) {
          trace.critic = {
            accepted: critic.accepted, motiveConcern: critic.motiveConcern,
            causalConcern: critic.causalConcern, sensationalismConcern: critic.sensationalismConcern,
            falsifiabilityConcern: critic.falsifiabilityConcern, politicalFraming: critic.politicalFraming,
            rejectionReasons: critic.rejectionReasons,
          };
        }
      } catch (error) {
        trace.finalStatus = 'THREW';
        trace.reason = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      }
      const mine = rawCalls.filter(call => call.candidate === entry.title && call.replicate === replicate);
      trace.calls = mine.length - before;
      trace.criticCalls = mine.filter(call => call.role === 'critic').length;
      return trace;
    }

    const plans: Array<{ title: string; replicate: number }> = [];
    for (const replicate of blockReplicates) {
      for (const title of TARGETS) plans.push({ title, replicate });
    }

    let stoppedEarly = false;
    for (const plan of plans) {
      if (observedRequests >= MAX_REQUESTS_PER_PROCESS) {
        stoppedEarly = true;
        console.log(`\n!! stopping block at ${observedRequests} requests (bound=${MAX_REQUESTS_PER_PROCESS}) to avoid N8`);
        break;
      }
      const trace = await runOne(plan.title, plan.replicate);
      traces.push(trace);
      // Report EVERY critic attempt in the run, not just the first: once the
      // bounded re-sample exists a run can make two calls, and reporting only
      // the first would show a rescue as a failure.
      const criticCalls = rawCalls.filter(call => call.candidate === plan.title && call.replicate === plan.replicate && call.role === 'critic');
      const last = criticCalls[criticCalls.length - 1];
      const attempts = criticCalls.map((call, index) => {
        const t = call.transport;
        return `#${index + 1}:${call.errorCode ?? 'ok'}/${t?.finishReasons.join('/') || 'none'}/rt=${t?.reasoningTokens ?? '-'}/ct=${t?.completionTokens ?? '-'}/lat=${call.latencyMs ?? '-'}`;
      }).join(' | ');
      console.log(`[${MATRIX}] r${plan.replicate} ${trace.finalStatus.padEnd(22)} critic=${String(trace.critic.accepted).padEnd(5)} retries=${trace.criticAttempts ?? 0} last=${String(last?.errorCode ?? 'none').padEnd(20)} obs=${String(last?.transport?.observedMs ?? 'null').padEnd(7)} reason=${String(trace.reason ?? '-').slice(0, 30).padEnd(30)} ${plan.title.slice(0, 34)}`);
      console.log(`      critic attempts: ${attempts}`);

      // Persist after EVERY replicate: N8 can kill a block mid-flight, and the
      // completed replicates must survive the process that produced them.
      writeBlock();
    }

    // ---------- reporting ----------
    const criticCalls = rawCalls.filter(call => call.role === 'critic');
    const analysisCalls = rawCalls.filter(call => call.role === 'gambit_analysis');
    const triageCalls = rawCalls.filter(call => call.role === 'triage');

    console.log('\n===== CRITIC BOUNDED RE-SAMPLE (N7) =====');
    const runsWithRetry = traces.filter(trace => (trace.criticAttempts ?? 0) > 0).length;
    const runsRescued = traces.filter(trace => (trace.criticAttempts ?? 0) > 0 && trace.critic.accepted !== undefined).length;
    console.log(`runs=${traces.length} runs that spent a re-sample=${runsWithRetry} of which reached a verdict=${runsRescued}`);

    console.log('\n===== CRITIC OUTCOME =====');
    const failed = criticCalls.filter(call => call.error);
    const succeeded = criticCalls.filter(call => !call.error);
    const judgements = succeeded.filter(call => call.value && typeof call.value === 'object');
    console.log(`critic calls=${criticCalls.length} succeeded=${succeeded.length} failed=${failed.length} (${(failed.length / Math.max(1, criticCalls.length) * 100).toFixed(1)}%)`);
    console.log(`of succeeded: accepted=${judgements.filter(call => call.value?.accepted === true).length} rejected=${judgements.filter(call => call.value?.accepted !== true).length}`);

    console.log('\n===== CRITIC FAILURE TYPE (token wall vs deadline wall) =====');
    const failureTypes: Record<string, number> = {};
    for (const call of failed) {
      const code = call.errorCode ?? 'unknown';
      const t = call.transport;
      const finish = t?.finishReasons.join('/') || 'none';
      // A `length` finish means the model was CUT BY max_tokens. A timeout means
      // it was CUT BY the deadline. These are the two competing hypotheses.
      const kind = code === 'timeout' ? 'timeout(DEADLINE)'
        : finish.includes('length') ? 'length(TOKEN WALL)'
        : code === 'empty_response' ? `empty_response(finish=${finish})`
        : code === 'invalid_structured_json' ? `invalid_structured_json(finish=${finish})`
        : code.startsWith('http_') ? `${code}`
        : `${code}(finish=${finish})`;
      failureTypes[kind] = (failureTypes[kind] ?? 0) + 1;
    }
    console.log(`failure types: ${JSON.stringify(failureTypes, null, 2)}`);

    console.log('\n===== CRITIC SUCCESS LATENCY (closeness to the deadline) =====');
    const successLatencies = succeeded.map(call => call.latencyMs ?? 0).sort((a, b) => a - b);
    const pct = (p: number) => successLatencies.length ? successLatencies[Math.min(successLatencies.length - 1, Math.floor(p * successLatencies.length))] : null;
    console.log(`n=${successLatencies.length} min=${successLatencies[0] ?? null} p50=${pct(0.5)} p90=${pct(0.9)} max=${successLatencies[successLatencies.length - 1] ?? null} clamp=${ROLE_TIMEOUT_MS}`);
    const latencyBuckets: Record<string, number> = {
      lt_5000: 0, '5000_15000': 0, '15000_25000': 0,
      '25000_clamp': 0, 'gte_clamp': 0,
    };
    for (const latency of successLatencies) {
      if (latency < 5_000) latencyBuckets.lt_5000 += 1;
      else if (latency < 15_000) latencyBuckets['5000_15000'] += 1;
      else if (latency < 25_000) latencyBuckets['15000_25000'] += 1;
      else if (latency < ROLE_TIMEOUT_MS) latencyBuckets['25000_clamp'] += 1;
      else latencyBuckets.gte_clamp += 1;
    }
    console.log(`success latency buckets: ${JSON.stringify(latencyBuckets)}`);
    const nearDeadline = successLatencies.filter(value => value >= ROLE_TIMEOUT_MS * 0.8).length;
    console.log(`successful critic calls within 20% of the deadline: ${nearDeadline}/${successLatencies.length}`);

    console.log('\n===== PER-REQUEST LATENCY (provider transport attempts included) =====');
    for (const role of ['triage', 'gambit_analysis', 'critic']) {
      const series = requestLatencies.filter(item => item.role === role);
      const values = series.map(item => item.latencyMs).sort((a, b) => a - b);
      const atDeadline = values.filter(v => v >= ROLE_TIMEOUT_MS * 0.9).length;
      const notRequestPhase = series.filter(item => item.phase !== 'REQUEST').length;
      console.log(`${role}: attempts=${series.length} notResolvedAtRequestPhase=${notRequestPhase} max=${values[values.length - 1] ?? null}ms at_or_near_deadline(>=${Math.round(ROLE_TIMEOUT_MS * 0.9)}ms)=${atDeadline}`);
      for (const item of series) {
        console.log(`  ${role} r${item.replicate} ${item.phase.padEnd(8)} http=${String(item.httpStatus).padEnd(5)} ${String(item.latencyMs).padStart(6)}ms jsonComplete=${item.structuredJsonComplete} ${item.errorCode ?? ''}`);
      }
    }

    console.log('\n===== RUN OUTCOME =====');
    const counts: Record<string, number> = {};
    for (const trace of traces) counts[trace.finalStatus] = (counts[trace.finalStatus] ?? 0) + 1;
    console.log(`runs=${traces.length} (matrix ${MATRIX}${MATRIX === 'B' ? ' - forced admission, NEVER a pass rate' : ' - honest path'})`);
    console.log(`final statuses: ${JSON.stringify(counts)}`);
    const totalIn = rawCalls.reduce((sum, call) => sum + (call.transport?.promptTokens ?? 0), 0);
    const totalOut = rawCalls.reduce((sum, call) => sum + (call.transport?.completionTokens ?? 0), 0);
    console.log(`calls: total=${rawCalls.length} triage=${triageCalls.length} analysis=${analysisCalls.length} critic=${criticCalls.length}`);
    console.log(`transport usage: promptTokens=${totalIn} completionTokens=${totalOut} total=${totalIn + totalOut}`);
    console.log(`observed http requests this process=${observedRequests} stoppedEarly=${stoppedEarly}`);

    console.log('\n===== MACHINE READABLE =====');
    console.log('<<<TRACES17>>>' + JSON.stringify(traces));
    console.log('<<<RAW17>>>' + JSON.stringify(rawCalls.map(call => ({
      c: call.candidate, r: call.replicate, i: call.attemptIndex, role: call.role,
      budget: call.tokenBudget, lat: call.latencyMs ?? null, err: call.error, code: call.errorCode,
      t: call.transport ? {
        rt: call.transport.reasoningTokens, ct: call.transport.completionTokens,
        pt: call.transport.promptTokens, fr: call.transport.finishReasons,
        cc: call.transport.contentChars, rc: call.transport.reasoningChars,
        f: call.transport.frames, ok: call.transport.parsedOk, keys: call.transport.keys.length,
        ended: call.transport.streamEnded, status: call.transport.httpStatus,
        obs: call.transport.observedMs,
      } : null,
      v: call.value,
    }))));
    console.log('<<<FAILSHAPE17>>>' + JSON.stringify(rawCalls.filter(call => call.debug).map(call => ({
      c: call.candidate, r: call.replicate, role: call.role, i: call.attemptIndex, d: call.debug,
    }))));

    if (MATRIX === 'B') {
      // The forced-admission override must fire exactly once per real triage call
      // and nowhere else. In matrix A it must never fire at all.
      expect(forcedTriageOverrides, 'triage override leaked outside the triage role')
        .toBe(triageCalls.filter(call => !call.error).length);
    } else {
      expect(forcedTriageOverrides, 'matrix A must never force admission').toBe(0);
    }
    expect(traces.length).toBeGreaterThan(0);
  }, 3_600_000);
});

function blockPath(): string {
  return `${OUT_DIR}/phase17-${MATRIX}-block-${BLOCK_OFFSET}-${process.pid}.json`;
}

/**
 * Written after every replicate. N8 is a per-process degradation, so the
 * evidence must outlive the process that gathered it.
 */
function writeBlock(): void {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(blockPath(), JSON.stringify({
      node: NODE_ID, matrix: MATRIX, blockOffset: BLOCK_OFFSET, blockSize: BLOCK_SIZE,
      replicates: REPLICATES, model: MODEL, baseUrl: BASE_URL,      budgets: { triage: TRIAGE_BUDGET, analysis: ANALYSIS_BUDGET, critic: CRITIC_BUDGET },
      roleTimeoutMs: ROLE_TIMEOUT_MS,
      observedRequests,
      traces,
      rawCalls: rawCalls.map(call => ({
        candidate: call.candidate, replicate: call.replicate, role: call.role,
        attemptIndex: call.attemptIndex, tokenBudget: call.tokenBudget,
        errorCode: call.errorCode, error: call.error, latencyMs: call.latencyMs ?? null,
        transport: call.transport, value: call.value, debug: call.debug ?? null,
      })),
    }, null, 2));
  } catch (error) {
    console.log(`!! could not persist block: ${error instanceof Error ? error.message : String(error)}`);
  }
}
