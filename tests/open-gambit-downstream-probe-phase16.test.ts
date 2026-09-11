/**
 * Open Gambit Phase 1.6 — N6 VERIFICATION (task T1).
 *
 * OPT-IN ONLY. Real network calls to the configured provider. Skipped unless
 * GAMBIT_PHASE16_PROBE=1, so `npm test` never spends provider quota:
 *
 *   set -a && . ./.env && set +a
 *   GAMBIT_PHASE16_PROBE=1 npx vitest run tests/open-gambit-downstream-probe-phase16.test.ts
 *
 * WHAT THIS PROBE ANSWERS
 * -----------------------
 * Phase 1.5 measured N6: on `deepseek-flash` the `gambit_analysis` role burns
 * its entire 4,000-token budget on reasoning and emits no parseable JSON
 * (`finish_reason=length`, content 0 bytes or a truncated prefix). triage and
 * critic were unaffected, so N6 is a model<->`GAMBIT_MODEL_ROLES_JSON` budget
 * mismatch, not a code regression.
 *
 * This probe raises ONLY the analysis role budget to 8,000 (triage stays 2,400,
 * critic stays 3,000) and asks whether the downstream stages then run
 * end-to-end and produce `AUTO_PUBLISH_ELIGIBLE`.
 *
 * SCOPE, DELIBERATELY NARROW
 * --------------------------
 *  - MATRIX B ONLY (forced admission). Admission is not this phase's subject:
 *    Phase 1 already repaired it (4/98 admitted, 0/12 negatives) and Phase 1.5
 *    re-confirmed the 4 positives are admitted at least twice out of three.
 *    Re-running the real gate here would let an eligibility change confound the
 *    N6 measurement. The real triage call is still made and recorded; only the
 *    verdict handed BACK to the pipeline is synthesized. Results from matrix B
 *    must NEVER be quoted as a pass rate.
 *  - 4 candidates (Phase 1 T6's admitted positives) x 3 replicates = 12 runs.
 *
 * HOW REASONING TOKENS ARE OBSERVED (why a fetch tee is needed)
 * ------------------------------------------------------------
 * The production client CORRECTLY stops reading an SSE body as soon as a
 * complete structured JSON object has arrived (`parseStreamingCompletion` ->
 * `reader.cancel()`), because some gateways hold the socket open after the
 * payload. The `usage` frame -- the only carrier of
 * `completion_tokens_details.reasoning_tokens` -- arrives AFTER that point, so
 * the client structurally cannot report reasoning tokens on a successful call.
 *
 * The probe therefore injects an observing `fetchImpl` that `tee()`s the
 * response body: one branch goes to the unmodified production client with
 * chunk timing preserved, the other is drained to completion independently so
 * the trailing usage frame is captured even after the client cancels. This
 * observes the transport; it does not replace the client, the streaming reader,
 * or any pipeline stage.
 *
 * READ-ONLY with respect to production:
 *  - `dependencies.repository` is never supplied, so `recordLLMAttempt` is
 *    never called and nothing is persisted to D1/R2;
 *  - only `runGambitStages()` runs, which returns an in-memory draft and never
 *    touches the publication path;
 *  - no Workflow is started and no budget env is read from production.
 */
import { describe, expect, it, vi } from 'vitest';
import corpus from './fixtures/open-gambit/real-corpus-2026-09-11.json';

const ENABLED = process.env.GAMBIT_PHASE16_PROBE === '1';
const REPLICATES = Number(process.env.GAMBIT_PHASE16_REPLICATES ?? 3);
const BASE_URL = process.env.GAMBIT_PHASE16_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.GAMBIT_PHASE16_MODEL ?? 'deepseek-flash';

/**
 * N6 candidate fix (option A): analysis 4,000 -> 8,000. Overridable so the same
 * probe can re-measure a different value without editing code — 8,000 is also
 * the hard clamp ceiling in `getGambitModelRoleConfig`.
 */
const ANALYSIS_BUDGET = Number(process.env.GAMBIT_PHASE16_ANALYSIS_BUDGET ?? 8_000);
const TRIAGE_BUDGET = Number(process.env.GAMBIT_PHASE16_TRIAGE_BUDGET ?? 2_400);
const CRITIC_BUDGET = Number(process.env.GAMBIT_PHASE16_CRITIC_BUDGET ?? 3_000);

/**
 * Bypass deterministic admission ONLY, exactly as Phase 1.5's matrix B did. The
 * 4 samples are Phase 1's T6-admitted candidates, but re-running the real gate
 * here would let an eligibility change confound the N6 measurement. Political
 * detection, evidence sufficiency and the whole publication path stay real.
 */
vi.mock('../src/open-gambit/policy', async importOriginal => {
  const original = await importOriginal<typeof import('../src/open-gambit/policy')>();
  return {
    ...original,
    qualificationGate: (input: Parameters<typeof original.qualificationGate>[0]) => ({
      ...original.qualificationGate(input),
      qualified: true,
      reason: null,
    }),
  };
});

interface CorpusEntry {
  sourceId: string; title: string; url: string; publishedAt: string | null;
  quote: string; summary: string; sourceTier: string;
}

/** The 4 candidates Phase 1's T6 admitted — the only positives in the frozen corpus. */
const POSITIVE_TARGETS = [
  'AI Scan for pull request APIs in public preview',
  'Enterprise managed permissions for GitHub Copilot agent operations',
  'GitHub Advanced Security expands trial availability',
  'MAI-Code-1-Flash deprecated',
];

const TARGETS = process.env.GAMBIT_PHASE16_TARGETS
  ? process.env.GAMBIT_PHASE16_TARGETS.split('|')
  : POSITIVE_TARGETS;

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
  error: string | null;
  /** Client-reported usage. `outputTokens` is expected to be undefined on a
   *  successful call because the client cancels before the usage frame. */
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  transport: TransportRecord | null;
  /** Diagnostic-only: shape of a FAILED response, never persisted. */
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
  triage: {
    shouldDeepAnalysisRun?: boolean; aiTechRelevance?: boolean;
    eventImportance?: number; evidenceSufficient?: boolean;
    politicsExcluded?: boolean; strategicMechanism?: string | null; reason?: string;
  };
  analysisDecision?: string;
  analysisTrajectories?: number;
  critic: {
    accepted?: boolean; motiveConcern?: boolean; causalConcern?: boolean;
    sensationalismConcern?: boolean; falsifiabilityConcern?: boolean;
    politicalFraming?: boolean; rejectionReasons?: string[];
  };
  calls: number;
}

const rawCalls: RawCall[] = [];
const traces: RunTrace[] = [];
/**
 * How many times the matrix-B triage override actually fired. Pinned against
 * the number of triage calls at the end of the run: an override that leaks into
 * another role would silently corrupt the very stage this probe measures.
 */
let forcedTriageOverrides = 0;

function entryFor(title: string): CorpusEntry {
  const entries = corpus.entries as unknown as CorpusEntry[];
  const found = entries.find(
    candidate => candidate.title.toLowerCase() === title.toLowerCase(),
  ) ?? entries.find(candidate => candidate.title.toLowerCase().includes(title.toLowerCase()));
  if (!found) throw new Error(`fixture candidate not found: ${title}`);
  return found;
}

/** Parse every captured SSE frame: content, finish_reason and usage. */
function summarizeSse(text: string): Omit<TransportRecord, 'httpStatus' | 'contentType' | 'streamEnded' | 'error'> {
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
 * complete. The client's branch keeps the original chunk timing.
 */
function createObserver(): { fetchImpl: typeof fetch; records: TransportRecord[] } {
  const records: TransportRecord[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    const response = await globalThis.fetch(input, init);
    const record: TransportRecord = {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      rawBytes: 0, frames: 0, contentChars: 0, reasoningChars: 0,
      finishReasons: [],
      promptTokens: null, completionTokens: null, reasoningTokens: null,
      parsedOk: false, keys: [], streamEnded: false,
    };
    records.push(record);

    if (!response.body) {
      record.streamEnded = true;
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
        reader.releaseLock();
      }
    })();

    const headers = new Headers(response.headers);
    // `content-length`/`content-encoding` describe the network body, not the
    // already-decoded stream handed to the client.
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(forClient, { status: response.status, statusText: response.statusText, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, records };
}

/**
 * DIAGNOSTIC ONLY. Re-issues the identical request and records the SHAPE of the
 * provider's response. It never records prompt text or the model's prose, and it
 * is never persisted.
 *
 * Dedup key includes `replicate` and `seq`: Phase 1.5's key
 * (`matrix|candidate|role`) collapsed every replicate after the first into
 * `{note:'already-captured'}`, which silently made most captures useless.
 * It also only fires when the tee captured NOTHING, so it can never be a second
 * copy of facts already in hand.
 */
async function captureFailureShape(
  candidate: string,
  replicate: number,
  callRole: string,
  seq: number,
  apiKey: string,
  request: any,
): Promise<Record<string, unknown>> {
  const key = `${candidate}|${replicate}|${callRole}|${seq}`;
  if (capturedFailures.has(key)) return { candidate, role: callRole, seq, replicate, note: 'already-captured' };
  capturedFailures.add(key);

  const outcome: Record<string, unknown> = { candidate, role: callRole, seq, replicate, tokenBudget: request.tokenBudget };
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-opencode-session': 'gambit-phase16-diagnostic',
      },
      // Mirrors the production payload byte-for-byte in every field that can
      // change what the model emits.
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
    outcome.transport = summarizeSse(raw);
    return outcome;
  } catch (error) {
    outcome.threw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    return outcome;
  }
}

const capturedFailures = new Set<string>();

describe.skipIf(!ENABLED)('Open Gambit Phase 1.6 — N6 verification (matrix B, analysis 8000)', () => {
  it('runs analysis/critic on the 4 T6 positives x 3 replicates', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GAMBIT_LLM_API_KEY;
    expect(apiKey, 'DEEPSEEK_API_KEY must be set').toBeTruthy();

    const { runGambitStages } = await import('../src/open-gambit/pipeline');
    const actualPolicy = await vi.importActual<typeof import('../src/open-gambit/policy')>('../src/open-gambit/policy');
    const { getGambitModelRoleConfig, providerForRole } = await import('../src/open-gambit/llm');
    const { GambitRunBudget } = await import('../src/open-gambit/budget');

    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({
        triage: { timeoutMs: 60_000, tokenBudget: TRIAGE_BUDGET },
        gambit_analysis: { timeoutMs: 120_000, tokenBudget: ANALYSIS_BUDGET },
        critic: { timeoutMs: 60_000, tokenBudget: CRITIC_BUDGET },
      }),
      GAMBIT_LLM_MODEL: MODEL,
      GAMBIT_LLM_PROVIDER: 'deepseek',
    });

    const analysisRole = roles.find(role => role.role === 'gambit_analysis')!;
    console.log(`\n===== PHASE 1.6 PROBE CONFIG =====`);
    console.log(`baseUrl=${BASE_URL} model=${MODEL} replicates=${REPLICATES} targets=${TARGETS.length}`);
    console.log(`role budgets: triage=${roles.find(r => r.role === 'triage')!.tokenBudget} analysis=${analysisRole.tokenBudget} critic=${roles.find(r => r.role === 'critic')!.tokenBudget}`);
    // N6 verification depends on the requested budget actually reaching the
    // provider; the clamp ceiling is 8,000, so an over-ask would silently be
    // measured as 8,000 and reported as something else.
    expect(analysisRole.tokenBudget).toBe(ANALYSIS_BUDGET);

    const providerDiagnostics: Array<Record<string, unknown>> = [];

    function wrap(role: 'triage' | 'gambit_analysis' | 'critic', candidate: string, replicate: number) {
      const config = roles.find(item => item.role === role)!;
      const observer = createObserver();
      const inner = providerForRole(config, {
        GAMBIT_LLM_API_KEY: apiKey,
        GAMBIT_LLM_BASE_URL: BASE_URL,
      }, observer.fetchImpl, diagnostic => {
        providerDiagnostics.push({
          role, candidate, replicate,
          phase: diagnostic.phase, code: diagnostic.errorCode,
          status: diagnostic.status, latencyMs: diagnostic.latencyMs,
          chunks: diagnostic.streamChunks, contentBytes: diagnostic.contentBytes,
          jsonComplete: diagnostic.structuredJsonComplete,
        });
      });
      if (!inner) throw new Error(`provider missing for role ${role}`);
      let seq = 0;
      return {
        name: inner.name,
        async complete<T>(request: any) {
          seq += 1;
          const attemptIndex = seq;
          // The provider retries transport failures internally, so a single
          // `complete()` can make more than one request. The LAST request is the
          // one that decided the outcome.
          const transportBefore = observer.records.length;
          const base: Omit<RawCall, 'value' | 'error'> = {
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
              inputTokens: out.inputTokens,
              outputTokens: out.outputTokens,
              latencyMs: out.latencyMs,
              transport: observer.records[observer.records.length - 1] ?? null,
            });
            // MATRIX B: the real triage call has already been made and recorded
            // above; only the value handed back to the pipeline is synthesized.
            //
            // The override MUST be scoped to `role === 'triage'`. Applying it to
            // every role hands the analysis stage a synthesized triage object,
            // `normalizeAnalysis` rejects it for a missing `facts` array, and the
            // run reports `PROVIDER_SCHEMA_INVALID` -- an artifact that looks
            // exactly like a model defect. Observed and corrected during T1.
            if (role !== 'triage') return out;
            const real = (out.value ?? {}) as Record<string, unknown>;
            const forced = {
              shouldDeepAnalysisRun: true,
              aiTechRelevance: true,
              eventImportance: 0.7,
              strategicMechanism: typeof real.strategicMechanism === 'string' && real.strategicMechanism
                ? real.strategicMechanism
                : 'PHASE16_FORCED_ADMISSION',
              evidenceSufficient: true,
              politicsExcluded: false,
              political: { excluded: false, reasons: [], confidence: null },
              reason: 'PHASE16_MATRIX_B_FORCED_ADMISSION',
            };
            forcedTriageOverrides += 1;
            return { ...out, value: forced as unknown as T };
          } catch (error) {
            const transport = observer.records[observer.records.length - 1] ?? null;
            const noTransport = observer.records.length === transportBefore;
            rawCalls.push({
              ...base,
              value: null,
              error: error instanceof Error ? `${(error as any).code ?? error.name}:${error.message}` : String(error),
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
        fingerprint: `phase16-b-${entry.sourceId}-${entry.title.slice(0, 40)}`,
        headline: entry.title, summary: entry.summary, canonicalUrl: entry.url,
        snapshotIds: [1], sourceIds: [entry.sourceId], decision,
        discoveredAt: new Date().toISOString(),
      });

      const trace: RunTrace = {
        candidate: entry.title, replicate,
        finalStatus: 'UNKNOWN', triage: {}, critic: {}, calls: 0,
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
        trace.triage = {
          shouldDeepAnalysisRun: result.triage?.shouldDeepAnalysisRun,
          aiTechRelevance: result.triage?.aiTechRelevance,
          eventImportance: result.triage?.eventImportance,
          evidenceSufficient: result.triage?.evidenceSufficient,
          politicsExcluded: result.triage?.politicsExcluded,
          strategicMechanism: result.triage?.strategicMechanism ?? null,
          reason: result.triage?.reason,
        };
        trace.analysisDecision = (result as any).analysis?.decision;
        trace.analysisTrajectories = Array.isArray((result as any).analysis?.trajectories)
          ? (result as any).analysis.trajectories.length : undefined;
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
      trace.calls = rawCalls.filter(call => call.candidate === entry.title && call.replicate === replicate).length - before;
      return trace;
    }

    for (const title of TARGETS) {
      for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
        const trace = await runOne(title, replicate);
        traces.push(trace);
        const analysis = rawCalls.find(call => call.candidate === title && call.replicate === replicate && call.role === 'gambit_analysis');
        const r = analysis?.transport?.reasoningTokens ?? null;
        const c = analysis?.transport?.completionTokens ?? null;
        const fr = analysis?.transport?.finishReasons.join(',') ?? '-';
        console.log(`[B] r${replicate} ${trace.finalStatus.padEnd(22)} analysis=${String(trace.analysisDecision).padEnd(26)} reason=${String(r).padEnd(6)} comp=${String(c).padEnd(6)} finish=${String(fr).padEnd(7)} critic=${String(trace.critic.accepted)} fail=${trace.reason ?? '-'} ${title.slice(0, 42)}`);
      }
    }

    // ---------- reporting ----------
    const analysisCalls = rawCalls.filter(call => call.role === 'gambit_analysis');
    const criticCalls = rawCalls.filter(call => call.role === 'critic');
    const triageCalls = rawCalls.filter(call => call.role === 'triage');

    console.log('\n===== SUMMARY =====');
    const counts: Record<string, number> = {};
    for (const trace of traces) counts[trace.finalStatus] = (counts[trace.finalStatus] ?? 0) + 1;
    console.log(`runs=${traces.length}`);
    console.log(`final statuses: ${JSON.stringify(counts)}`);
    console.log(`AUTO_PUBLISH_ELIGIBLE=${counts.AUTO_PUBLISH_ELIGIBLE ?? 0}/${traces.length}`);
    console.log(`calls: total=${rawCalls.length} triage=${triageCalls.length} analysis=${analysisCalls.length} critic=${criticCalls.length}`);
    console.log(`analysis errors=${analysisCalls.filter(call => call.error).length}/${analysisCalls.length}`);
    console.log(`critic executed=${criticCalls.length} accepted=${criticCalls.filter(call => call.value?.accepted === true).length} rejected=${criticCalls.filter(call => call.value && call.value.accepted !== true).length}`);
    const totalIn = rawCalls.reduce((sum, call) => sum + (call.transport?.promptTokens ?? 0), 0);
    const totalOut = rawCalls.reduce((sum, call) => sum + (call.transport?.completionTokens ?? 0), 0);
    console.log(`transport usage: promptTokens=${totalIn} completionTokens=${totalOut} total=${totalIn + totalOut}`);

    console.log('\n===== ANALYSIS REASONING DISTRIBUTION =====');
    const usable = analysisCalls.filter(call => !call.error);
    const bucket = (n: number | null) => n === null ? 'unknown' : n < 4_000 ? 'lt_4000' : n <= 6_000 ? '4000_6000' : 'gt_6000';
    const distribution: Record<string, number> = { lt_4000: 0, '4000_6000': 0, gt_6000: 0, unknown: 0 };
    for (const call of analysisCalls) distribution[bucket(call.transport?.reasoningTokens ?? null)] += 1;
    console.log(`analysis calls=${analysisCalls.length} parseable=${usable.length}`);
    console.log(`reasoning token buckets: ${JSON.stringify(distribution)}`);
    console.log('per-call (role=call|replicate|reasoning|completion|finish|contentChars|parsedOk|error):');
    for (const call of rawCalls) {
      const t = call.transport;
      console.log([
        call.role, `r${call.replicate}`, `#${call.attemptIndex}`,
        `budget=${call.tokenBudget}`,
        `reasoning=${t?.reasoningTokens ?? 'null'}`,
        `completion=${t?.completionTokens ?? 'null'}`,
        `finish=${t?.finishReasons.join('/') || 'none'}`,
        `contentChars=${t?.contentChars ?? 'null'}`,
        `frames=${t?.frames ?? 'null'}`,
        `parsedOk=${t?.parsedOk ?? 'null'}`,
        `clientOut=${call.outputTokens ?? 'null'}`,
        `err=${call.error ?? 'none'}`,
      ].join(' '));
    }

    console.log('\n===== PROVIDER DIAGNOSTICS =====');
    for (const diagnostic of providerDiagnostics) console.log(JSON.stringify(diagnostic));

    console.log('\n===== MACHINE READABLE =====');
    console.log('<<<TRACES16>>>' + JSON.stringify(traces));
    console.log('<<<RAW16>>>' + JSON.stringify(rawCalls.map(call => ({
      c: call.candidate, r: call.replicate, i: call.attemptIndex, role: call.role,
      budget: call.tokenBudget, err: call.error,
      t: call.transport ? {
        rt: call.transport.reasoningTokens, ct: call.transport.completionTokens,
        pt: call.transport.promptTokens, fr: call.transport.finishReasons,
        cc: call.transport.contentChars, rc: call.transport.reasoningChars,
        f: call.transport.frames, ok: call.transport.parsedOk, keys: call.transport.keys.length,
        ended: call.transport.streamEnded, status: call.transport.httpStatus,
      } : null,
      v: call.value,
    }))));
    console.log('<<<FAILSHAPE16>>>' + JSON.stringify(rawCalls.filter(call => call.debug).map(call => ({
      c: call.candidate, r: call.replicate, role: call.role, i: call.attemptIndex, d: call.debug,
    }))));

    const successes = analysisCalls.filter(call => !call.error && call.transport?.parsedOk).length;
    expect(traces.length).toBe(TARGETS.length * REPLICATES);
    // The forced-admission override must fire exactly once per real triage call
    // and nowhere else; see the scoping note inside `wrap`.
    expect(forcedTriageOverrides, 'triage override leaked outside the triage role')
      .toBe(triageCalls.filter(call => !call.error).length);
    // The probe's own claim is only meaningful if analysis actually became
    // usable; a future regression should fail loudly rather than print a
    // quietly-degraded table.
    expect(successes, 'no analysis call produced parseable JSON').toBeGreaterThan(0);
  }, 3_600_000);
});
