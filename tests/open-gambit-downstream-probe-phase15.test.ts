/**
 * Open Gambit Phase 1.5 — REDO of the downstream baseline (task T1).
 *
 * OPT-IN ONLY. Real network calls to the configured provider. Skipped unless
 * GAMBIT_PHASE15_PROBE=1, so `npm test` never spends provider quota:
 *
 *   set -a && . ./.env && set +a
 *   GAMBIT_PHASE15_PROBE=1 npx vitest run tests/open-gambit-downstream-probe-phase15.test.ts
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE PHASE 0 PROBE
 * -----------------------------------------------------
 * `tests/open-gambit-downstream-probe.test.ts` (Phase 0, untracked) has three
 * properties that make its results unusable as a POST-N3 baseline:
 *
 *  1. It never exercises the N3 code path. It builds its own provider with
 *     `fetch(..., { stream: false })`, while the N3 defect lived in
 *     `parseStreamingCompletion()` in `src/open-gambit/llm.ts`. A probe that
 *     bypasses the production client cannot measure a fix to that client.
 *     This file uses the REAL `providerForRole()` client and therefore the real
 *     streaming reader.
 *  2. It measures only 4 candidates and does not repeat any of them, so it
 *     cannot separate genuine model flipping from transport truncation.
 *  3. It hand-injects `x-opencode-session`, which Phase 1 (T1) has since moved
 *     into production `llm.ts`. Injecting it again would mask a regression.
 *
 * MEASUREMENT SEMANTICS (read before comparing to Phase 0)
 * --------------------------------------------------------
 * Phase 0 measured `mimo-v2.5` through the `opencode.ai/zen/go` gateway. This
 * probe measures `deepseek-flash` through `https://api.deepseek.com`, because
 * that is the credential the operator supplied for this phase. A comparison
 * against Phase 0 therefore changes provider AND model AND transport at once,
 * and MUST NOT be reported as "the size of the N3 fix". §2 matrix B exists to
 * isolate transport from verdict.
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

const ENABLED = process.env.GAMBIT_PHASE15_PROBE === '1';
const REPLICATES = Number(process.env.GAMBIT_PHASE15_REPLICATES ?? 3);
const BASE_URL = process.env.GAMBIT_PHASE15_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.GAMBIT_PHASE15_MODEL ?? 'deepseek-flash';

/**
 * Bypass deterministic admission ONLY, exactly as Phase 0 did and as the task
 * instructs: the 4 positive samples are Phase 1's T6-admitted candidates, but
 * re-running the *real* gate here would let an eligibility change confound the
 * downstream measurement. Political detection, evidence sufficiency and the
 * whole publication path stay real.
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

/** The 4 candidates Phase 1's T6 admitted. */
const POSITIVE_TARGETS = [
  'AI Scan for pull request APIs in public preview',
  'Enterprise managed permissions for GitHub Copilot agent operations',
  'GitHub Advanced Security expands trial availability',
  'MAI-Code-1-Flash deprecated',
];

/** The 4 negatives Phase 0 used as controls. */
const NEGATIVE_TARGETS = [
  'Refreshed repository pull requests page in public preview',
  'CodeQL 2.27.0 adds support for Linux ARM64',
  '[v1.31.0] Custom labels for Sandboxes',
  'Xcode 27 runner image now runs on macOS 27',
];

const ALL_TARGETS = process.env.GAMBIT_PHASE15_TARGETS
  ? process.env.GAMBIT_PHASE15_TARGETS.split('|')
  : [...POSITIVE_TARGETS, ...NEGATIVE_TARGETS];

interface RawCall {
  candidate: string;
  replicate: number;
  matrix: 'A' | 'B';
  seq: number;
  role: string;
  attemptIndex: number;
  value: Record<string, unknown> | null;
  error: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  /** Diagnostic-only: shape of a FAILED response, never persisted. */
  debug?: Record<string, unknown>;
}

interface RunTrace {
  candidate: string;
  replicate: number;
  matrix: 'A' | 'B';
  finalStatus: string;
  reason?: string;
  publicationDecision?: string;
  triage: {
    shouldDeepAnalysisRun?: boolean; aiTechRelevance?: boolean;
    eventImportance?: number; evidenceSufficient?: boolean;
    politicsExcluded?: boolean; strategicMechanism?: string | null; reason?: string;
  };
  analysisDecision?: string;
  critic: {
    accepted?: boolean; motiveConcern?: boolean; causalConcern?: boolean;
    sensationalismConcern?: boolean; falsifiabilityConcern?: boolean;
    politicalFraming?: boolean; rejectionReasons?: string[];
  };
  calls: number;
}

const rawCalls: RawCall[] = [];
const traces: RunTrace[] = [];

function entryFor(title: string): CorpusEntry {
  const entries = corpus.entries as unknown as CorpusEntry[];
  const found = entries.find(
    candidate => candidate.title.toLowerCase() === title.toLowerCase(),
  ) ?? entries.find(candidate => candidate.title.toLowerCase().includes(title.toLowerCase()));
  if (!found) throw new Error(`fixture candidate not found: ${title}`);
  return found;
}

/**
 * DIAGNOSTIC ONLY. Re-issues the identical request that just failed and records
 * the SHAPE of the provider's response -- byte count, whether it looks like
 * JSON, first/last characters, finish_reason and usage. It deliberately does NOT
 * record prompt text or the model's full output, and it is never persisted.
 *
 * Bounded to one capture per (candidate, matrix, role) so a systemic failure
 * cannot multiply cost.
 */
const capturedFailures = new Set<string>();

/**
 * DIAGNOSTIC ONLY. Re-issues the identical request that just failed and records
 * the SHAPE of the provider's response: byte counts, frame counts, whether the
 * accumulated content looks like a complete JSON object, finish_reason and
 * usage. It never records prompt text, model prose or the full output, and it is
 * never persisted.
 *
 * Bounded to one capture per (candidate, matrix, role) so a systemic failure
 * cannot multiply cost.
 */
async function captureFailureShape(
  candidate: string,
  replicate: number,
  matrix: 'A' | 'B',
  callRole: string,
  seq: number,
  apiKey: string,
  request: any,
): Promise<Record<string, unknown>> {
  const key = `${matrix}|${candidate}|${callRole}`;
  if (capturedFailures.has(key)) {
    return { matrix, role: callRole, seq, note: 'already-captured' };
  }
  capturedFailures.add(key);

  const outcome: Record<string, unknown> = {
    matrix, role: callRole, seq, replicate,
    tokenBudget: request.tokenBudget,
  };

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-opencode-session': 'gambit-phase15-diagnostic',
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
    outcome.rawBytes = raw.length;

    let content = '';
    let frames = 0;
    let finishReason: string | null = null;
    let usage: any = null;
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      frames += 1;
      try {
        const parsed = JSON.parse(payload) as any;
        content += parsed.choices?.[0]?.delta?.content ?? '';
        if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
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

    outcome.frames = frames;
    outcome.contentChars = content.length;
    outcome.finishReason = finishReason;
    outcome.reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? null;
    outcome.completionTokens = usage?.completion_tokens ?? null;
    outcome.promptTokens = usage?.prompt_tokens ?? null;
    outcome.startsWithBrace = trimmed.startsWith('{');
    outcome.endsWithBrace = trimmed.endsWith('}');
    outcome.parsedOk = parsedOk;
    outcome.keys = keys;
    // Shape only: the first 120 characters are enough to tell JSON from prose
    // and are not the model's analytical output.
    outcome.head = trimmed.slice(0, 120);
    return outcome;
  } catch (error) {
    outcome.threw = error instanceof Error ? `${error.name}:${error.message}` : String(error);
    return outcome;
  }
}

describe.skipIf(!ENABLED)('Open Gambit Phase 1.5 — downstream baseline redo', () => {
  it('measures triage / analysis / critic on 8 candidates across two matrices', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GAMBIT_LLM_API_KEY || process.env.OPENCODE_GO_API_KEY;
    expect(apiKey, 'DEEPSEEK_API_KEY must be set').toBeTruthy();

    const { runGambitStages } = await import('../src/open-gambit/pipeline');
    const actualPolicy = await vi.importActual<typeof import('../src/open-gambit/policy')>('../src/open-gambit/policy');
    const { getGambitModelRoleConfig, providerForRole } = await import('../src/open-gambit/llm');
    const { GambitRunBudget } = await import('../src/open-gambit/budget');

    // Production-shaped role budgets, mirroring the live binding.
    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({
        triage: { timeoutMs: 60_000, tokenBudget: 2_400 },
        gambit_analysis: { timeoutMs: 90_000, tokenBudget: 4_000 },
        critic: { timeoutMs: 60_000, tokenBudget: 3_000 },
      }),
      GAMBIT_LLM_MODEL: MODEL,
      GAMBIT_LLM_PROVIDER: 'deepseek',
    });

    /**
     * Diagnostics from the production client, kept per call, so a bare
     * `timeout` can be distinguished from "the request never left the process".
     */
    const providerDiagnostics: Array<Record<string, unknown>> = [];

    /**
     * Wrap the REAL production provider so every call is recorded with its
     * raw parsed value. This is observation only: the request is forwarded
     * byte-for-byte.
     *
     * In matrix B the wrapped TRIAGE provider additionally replaces the
     * returned verdict with a synthesized approval AFTER the real call has been
     * made and recorded. This is the only way to admit a candidate: the
     * pipeline imports `triageAllowsDeepAnalysis` directly from
     * `src/open-gambit/policy.ts`, so a module-level mock cannot intercept it.
     * The real request still costs a call and is still recorded, and
     * `value` in the raw log is the model's REAL triage output -- only the
     * value handed back to the pipeline is overridden.
     */
    function wrap(role: 'triage' | 'gambit_analysis' | 'critic', matrix: 'A' | 'B', candidate: string, replicate: number) {
      const config = roles.find(item => item.role === role)!;
      const inner = providerForRole(config, {
        GAMBIT_LLM_API_KEY: apiKey,
        GAMBIT_LLM_BASE_URL: BASE_URL,
      }, undefined, diagnostic => {
        providerDiagnostics.push({
          matrix, role, candidate,
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
          try {
            const out = await inner.complete<T>(request);
            rawCalls.push({
              candidate, replicate, matrix, seq, role,
              attemptIndex,
              value: out.value as Record<string, unknown>,
              error: null,
              inputTokens: out.inputTokens,
              outputTokens: out.outputTokens,
              latencyMs: out.latencyMs,
            });
            if (matrix === 'B' && role === 'triage') {
              const real = (out.value ?? {}) as Record<string, unknown>;
              const forced = {
                shouldDeepAnalysisRun: true,
                aiTechRelevance: true,
                eventImportance: 0.7,
                strategicMechanism: typeof real.strategicMechanism === 'string' && real.strategicMechanism
                  ? real.strategicMechanism
                  : 'PHASE15_FORCED_ADMISSION',
                evidenceSufficient: true,
                politicsExcluded: false,
                political: { excluded: false, reasons: [], confidence: null },
                reason: 'PHASE15_MATRIX_B_FORCED_ADMISSION',
              };
              return { ...out, value: forced as unknown as T };
            }
            return out;
          } catch (error) {
            rawCalls.push({
              candidate, replicate, matrix, seq, role, attemptIndex,
              value: null,
              error: error instanceof Error ? `${(error as any).code ?? error.name}:${error.message}` : String(error),
              debug: captureFailureShape(candidate, replicate, matrix, role, seq, apiKey, request),
            });
            throw error;
          }
        },
      };
    }

    async function runOne(title: string, matrix: 'A' | 'B', replicate: number): Promise<RunTrace> {
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
        fingerprint: `phase15-${matrix}-${entry.sourceId}-${entry.title.slice(0, 40)}`,
        headline: entry.title, summary: entry.summary, canonicalUrl: entry.url,
        snapshotIds: [1], sourceIds: [entry.sourceId], decision,
        discoveredAt: new Date().toISOString(),
      });

      const trace: RunTrace = {
        candidate: entry.title, replicate, matrix,
        finalStatus: 'UNKNOWN', triage: {}, critic: {}, calls: 0,
      };
      const before = rawCalls.filter(call => call.candidate === entry.title && call.replicate === replicate && call.matrix === matrix).length;
      try {
        const result = await runGambitStages(candidate, [evidence], {
          providers: {
            triage: wrap('triage', matrix, entry.title, replicate) as any,
            gambit_analysis: wrap('gambit_analysis', matrix, entry.title, replicate) as any,
            critic: wrap('critic', matrix, entry.title, replicate) as any,
          },
          roles,
          // A fresh fail-closed budget per run, using the documented code
          // defaults. Sized so that a bounded re-sample cannot be mistaken for
          // a provider failure.
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
      trace.calls = rawCalls.filter(call => call.candidate === entry.title && call.replicate === replicate && call.matrix === matrix).length - before;
      return trace;
    }

    /**
     * MATRIX A — the honest pipeline. Triage decides. This is the matrix that
     * answers "what is the real triage pass rate?", which is N4 and the T2
     * justification.
     */
    for (const title of ALL_TARGETS) {
      for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
        const trace = await runOne(title, 'A', replicate);
        traces.push(trace);
        console.log(`[A] r${replicate} ${trace.finalStatus.padEnd(20)} imp=${String(trace.triage.eventImportance).padEnd(5)} deep=${String(trace.triage.shouldDeepAnalysisRun).padEnd(5)} evid=${String(trace.triage.evidenceSufficient).padEnd(5)} ${title.slice(0, 46)}`);
      }
    }

    /**
     * MATRIX B — triage verdict ignored, analysis and critic still real.
     *
     * WHY: after N3 the triage stage is the bottleneck, so matrix A yields at
     * most one or two analysis samples across 8 candidates. Analysis and critic
     * flipping cannot be measured at n=1. Matrix B therefore runs the analysis
     * and critic stages on all 8 candidates by short-circuiting ONLY the triage
     * predicate. It answers "given admission, how stable are analysis and
     * critic?" -- it does NOT claim triage would have admitted these
     * candidates, and its results must never be quoted as a pass rate.
     */
    for (const title of ALL_TARGETS) {
      for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
        const trace = await runOne(title, 'B', replicate);
        traces.push(trace);
        console.log(`[B] r${replicate} ${trace.finalStatus.padEnd(20)} analysis=${String(trace.analysisDecision).padEnd(28)} critic=${String(trace.critic.accepted)} ${title.slice(0, 46)}`);
      }
    }

    console.log('\n===== RAW CALL SUMMARY =====');
    console.log(`total calls=${rawCalls.length} errors=${rawCalls.filter(call => call.error).length}`);
    const byMatrixRole: Record<string, number> = {};
    for (const call of rawCalls) {
      const key = `${call.matrix}:${call.role}`;
      byMatrixRole[key] = (byMatrixRole[key] ?? 0) + 1;
    }
    console.log(JSON.stringify(byMatrixRole, null, 0));
    console.log(`usage present=${rawCalls.filter(call => call.outputTokens !== undefined).length}/${rawCalls.length}`);
    console.log('\n===== PROVIDER DIAGNOSTICS =====');
    for (const diagnostic of providerDiagnostics) console.log(JSON.stringify(diagnostic));

    console.log('\n===== MACHINE READABLE =====');
    console.log('<<<TRACES>>>' + JSON.stringify(traces));
    console.log('<<<RAW>>>' + JSON.stringify(rawCalls.map(call => ({
      m: call.matrix, c: call.candidate, r: call.replicate, i: call.attemptIndex,
      role: call.role, err: call.error, v: call.value,
    }))));
    console.log('<<<FAILSHAPE>>>' + JSON.stringify(rawCalls.filter(call => call.debug).map(call => call.debug)));

    expect(traces.length).toBe(ALL_TARGETS.length * REPLICATES * 2);
  }, 3_600_000);
});
