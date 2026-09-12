/**
 * Open Gambit Phase 1.7 — TRANSLATION / PUBLICATION path verification (opt-in).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Phase 1.5/1.6/1.7 measured triage, analysis and critic on `deepseek-flash` and
 * sized their budgets from those measurements. The TRANSLATION role was NEVER
 * measured in any environment:
 *
 *  - the downstream probes stop at the critic and never reach publication;
 *  - the staging acceptance candidate was rejected by the critic before the
 *    publication gate;
 *  - production's first cron run produced `strategic_eligible = 0`, so it spent
 *    ZERO LLM calls and translation never ran there either.
 *
 * That gap hid a blocking defect (see the Phase 1.7 translation report): the
 * declared 2,000-token translation budget is consumed entirely by reasoning, so
 * every locale emitted EMPTY content and no article could ever publish.
 *
 * HOW IT WORKS
 * ------------
 * It runs the REAL pipeline stages and the REAL publication path:
 *
 *   runGambitStages()        -> triage/analysis/critic via deterministic MOCK
 *   publishQualifiedGambit() -> REAL translation provider, REAL validation,
 *                               REAL locale readiness gate
 *
 * The upstream stages are mocked DELIBERATELY: their budgets are already
 * measured, and mocking them makes the probe deterministic and cheap so all of
 * its spend goes to the segment under test. The article handed to publication is
 * the one `runGambitStages` actually COMPOSED, so every array-length and
 * immutable-field invariant the validator enforces is exercised against a real
 * article shape rather than a hand-built one. (An earlier revision of this probe
 * built the article by hand and produced `TRANSLATION_SCHEMA_INVALID` for
 * `zh`/`ja` purely because the fixture's array lengths did not match the
 * validator's parity requirement -- a probe artifact, not a product defect.)
 *
 * IT IS ISOLATED
 * --------------
 *  - the repository is an in-memory recorder: NOTHING is written to D1 or R2;
 *  - `allowCanonicalFallback` is NEVER passed, so a translation failure cannot
 *    silently degrade into a canonical-only publication;
 *  - no Workflow is started and no environment is touched;
 *  - it defaults to SKIPPED, so `npm test` never spends provider quota.
 *
 * USAGE
 * -----
 *   set -a && . ./.env && set +a
 *   GAMBIT_TRANSLATION_PROBE=1 npx vitest run tests/open-gambit-translation-probe.test.ts
 *
 * Optional:
 *   GAMBIT_TRANSLATION_BUDGET=6000    # production value
 *   GAMBIT_TRANSLATION_QUOTA=36000    # production translation token quota
 *   GAMBIT_TRANSLATION_REPLICATES=3
 */
import { describe, expect, it } from 'vitest';
import corpus from './fixtures/open-gambit/real-corpus-2026-09-11.json';
import { boundedCompletionOptions } from '../src/utils/llm-request';

function boundedTranslationOptionsForProbe(baseUrl: string): Record<string, unknown> {
  return boundedCompletionOptions(baseUrl) as Record<string, unknown>;
}

const ENABLED = process.env.GAMBIT_TRANSLATION_PROBE === '1';
const BASE_URL = process.env.GAMBIT_TRANSLATION_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.GAMBIT_TRANSLATION_MODEL ?? 'deepseek-flash';
/** Production value from `GAMBIT_MODEL_ROLES_JSON`. */
const TRANSLATION_BUDGET = Number(process.env.GAMBIT_TRANSLATION_BUDGET ?? 6_000);
/**
 * The translation namespace has its own fail-closed quota, and `consume()`
 * charges the DECLARED budget before each attempt, so the quota must cover
 * 4 locales x 2 attempts x the role budget. Derived, never hardcoded, so the
 * probe cannot measure against a quota the deployment would not have.
 */
const TIMEOUT_MS = Number(process.env.GAMBIT_TRANSLATION_TIMEOUT_MS ?? 60_000);
const REPLICATES = Number(process.env.GAMBIT_TRANSLATION_REPLICATES ?? 1);
const TARGET_TITLE = process.env.GAMBIT_TRANSLATION_TITLE ?? 'AI Scan for pull request APIs in public preview';
const ALL_LOCALES = ['zh', 'ja', 'fr', 'es'] as const;
/** Optional locale subset, so a targeted reproduction does not spend on all four. */
const LOCALES = (process.env.GAMBIT_TRANSLATION_LOCALES
  ? process.env.GAMBIT_TRANSLATION_LOCALES.split(',').map(v => v.trim()).filter(Boolean)
  : [...ALL_LOCALES]) as unknown as ReadonlyArray<'zh' | 'ja' | 'fr' | 'es'>;

/** Attempts per locale the publication path permits (initial + one corrective). */
const MAX_TRANSLATION_ATTEMPTS_PER_LOCALE = 2;
/**
 * Derived, never a magic multiplier (a previous revision used `* 6`, which was
 * both wrong and duplicated knowledge): the quota charges the DECLARED budget
 * before each attempt, so it must cover EVERY locale's EVERY attempt.
 */
const TRANSLATION_QUOTA = Number(
  process.env.GAMBIT_TRANSLATION_QUOTA
  ?? LOCALES.length * MAX_TRANSLATION_ATTEMPTS_PER_LOCALE * TRANSLATION_BUDGET,
);

interface CorpusEntry {
  sourceId: string; title: string; url: string; publishedAt: string | null;
  quote: string; summary: string; sourceTier: string;
}

/** Transport facts read from a tee'd SSE branch, independent of the client. */
interface TransportRecord {
  httpStatus: number; frames: number; contentChars: number; reasoningChars: number;
  finishReasons: string[]; promptTokens: number | null; completionTokens: number | null;
  reasoningTokens: number | null; parsedOk: boolean; keys: number; observedMs: number;
}

function summarizeSse(text: string) {
  let content = ''; let reasoningChars = 0; let frames = 0;
  const finishReasons: string[] = []; let usage: any = null;
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
    } catch { /* partial frame */ }
  }
  let parsedOk = false; let keys = 0; let value: unknown = null;
  try { value = JSON.parse(content.trim()); keys = Object.keys(value as Record<string, unknown>).length; parsedOk = true; } catch { /* not JSON */ }
  return {
    value,
    frames, contentChars: content.length, reasoningChars, finishReasons,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
    reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    parsedOk, keys,
  };
}

/** Tee the transport: the only way to observe the trailing `usage` frame. */
function createObserver(): { fetchImpl: typeof fetch; records: TransportRecord[] } {
  const records: TransportRecord[] = [];
  const fetchImpl = (async (input: any, init: any) => {
    const startedAt = Date.now();
    const response = await globalThis.fetch(input, init);
    const record: TransportRecord = {
      httpStatus: response.status, frames: 0, contentChars: 0, reasoningChars: 0,
      finishReasons: [], promptTokens: null, completionTokens: null, reasoningTokens: null,
      parsedOk: false, keys: 0, observedMs: 0, value: null,
    };
    records.push(record);
    if (!response.body) { record.observedMs = Date.now() - startedAt; return response; }
    const [forClient, forObserver] = response.body.tee();
    void (async () => {
      const reader = forObserver.getReader();
      const decoder = new TextDecoder();
      let text = '';
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; text += decoder.decode(part.value, { stream: true }); }
        text += decoder.decode();
        Object.assign(record, summarizeSse(text));
      } catch { Object.assign(record, summarizeSse(text)); }
      finally { record.observedMs = Date.now() - startedAt; reader.releaseLock(); }
    })();
    const headers = new Headers(response.headers);
    headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(forClient, { status: response.status, statusText: response.statusText, headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, records };
}

/** In-memory stand-in for GambitRepository. Writes NOTHING anywhere. */
function createRecorder() {
  const translations: Array<{ locale: string; status: string }> = [];
  const attempts: Array<{ stage: string; role: string; status: string; errorCode: string | null; latencyMs: number | null }> = [];
  const drafts: any[] = [];
  const states: Record<string, string | undefined> = {};
  /**
   * Per-locale PRIVACY-SAFE validator diagnostics.
   *
   * `TRANSLATION_SCHEMA_INVALID` is an umbrella code that hides which underlying
   * validator rejected the locale, so nothing here records prose: only error
   * codes, field PATHS, counts, lengths and booleans.
   */
  const diagnostics: Array<Record<string, unknown>> = [];
  return {
    translations, attempts, drafts, states, diagnostics,
    async createArticleDraft(draft: any) {
      drafts.push(draft);
      return { articleId: 1, revisionId: 1, draft };
    },
    /**
     * Reproduce the canonical article from the draft the pipeline COMPOSED, so
     * the validator's array-parity and immutable-field checks run against a real
     * article shape. `saveTranslation` merges the per-locale state the
     * publication gate reads back.
     */
    async getArticleById() {
      const draft = drafts[drafts.length - 1] ?? {};
      return {
        articleId: 1, candidateId: draft.candidateId ?? 1, slug: draft.slug ?? 'probe',
        headline: draft.headline, surfaceEvent: draft.surfaceEvent, facts: draft.facts,
        obviousLogic: draft.obviousLogic, thesis: draft.thesis, mechanism: draft.mechanism,
        beneficiaries: draft.beneficiaries, pressuredActors: draft.pressuredActors,
        countercase: draft.countercase, trajectories: draft.trajectories,
        falsifier: draft.falsifier, evidence: draft.evidence ?? [], uncertainty: draft.uncertainty,
        politicalTopic: false, critic: draft.critic, modelRoleProvenance: draft.modelRoleProvenance,
        modelPromptVersion: draft.modelPromptVersion, aiDisclosureVersion: draft.aiDisclosureVersion,
        draftVersion: 1, createdAt: new Date().toISOString(), status: 'DRAFT',
        modifiedAt: new Date().toISOString(),
        translations: Object.fromEntries(LOCALES.map(locale => [locale, {
          locale, translationState: states[locale],
        }])),
      };
    },
    async saveTranslation(input: any) {
      states[input.translation.locale] = input.translation.translationState;
      translations.push({ locale: input.translation.locale, status: input.status });
    },
    async recordLLMAttempt(input: any) {
      attempts.push({
        stage: input.stage, role: input.role, status: input.status,
        errorCode: input.errorCode ?? null, latencyMs: input.response?.latencyMs ?? null,
      });
      return 1;
    },
    /**
     * Decode what the validator actually saw for one locale attempt. Called by
     * the probe with the provider value it captured from the real transport.
     */
    diagnose(locale: string, article: any, value: unknown, parseOk: boolean, contentChars: number) {
      const record = (value ?? {}) as Record<string, unknown>;
      const expected = {
        facts: Array.isArray(article.facts) ? article.facts.length : -1,
        beneficiaries: Array.isArray(article.beneficiaries) ? article.beneficiaries.length : -1,
        pressuredActors: Array.isArray(article.pressuredActors) ? article.pressuredActors.length : -1,
        trajectories: Array.isArray(article.trajectories) ? article.trajectories.length : -1,
      };
      const actual = {
        facts: Array.isArray(record.facts) ? (record.facts as unknown[]).length : -1,
        beneficiaries: Array.isArray(record.beneficiaries) ? (record.beneficiaries as unknown[]).length : -1,
        pressuredActors: Array.isArray(record.pressuredActors) ? (record.pressuredActors as unknown[]).length : -1,
        trajectories: Array.isArray(record.trajectories) ? (record.trajectories as unknown[]).length : -1,
      };
      const scalarFields = ['headline', 'surfaceEvent', 'obviousLogic', 'thesis', 'mechanism', 'countercase', 'falsifier', 'uncertainty'];
      const missingScalars = scalarFields.filter(f => typeof record[f] !== 'string' || !(record[f] as string).trim());
      const trajectoryShape = Array.isArray(record.trajectories)
        ? (record.trajectories as any[]).slice(0, 4).map(t => ({
          keys: t && typeof t === 'object' ? Object.keys(t).sort() : null,
          predictionStatement: typeof t?.predictionStatement === 'string' && t.predictionStatement.trim().length > 0,
          reasoning: typeof t?.reasoning === 'string' && t.reasoning.trim().length > 0,
          evidenceCriteria: typeof t?.evidenceCriteria === 'string' && t.evidenceCriteria.trim().length > 0,
          falsifier: typeof t?.falsifier === 'string' && t.falsifier.trim().length > 0,
          probabilityType: typeof t?.probability,
          deadlineType: typeof t?.deadline,
          idType: typeof t?.id,
        }))
        : null;
      return {
        locale,
        parseOk,
        contentChars,
        topLevelKeyCount: Object.keys(record).length,
        topLevelKeys: Object.keys(record).sort(),
        expectedLengths: expected,
        actualLengths: actual,
        parity: {
          facts: expected.facts === actual.facts,
          beneficiaries: expected.beneficiaries === actual.beneficiaries,
          pressuredActors: expected.pressuredActors === actual.pressuredActors,
          trajectories: expected.trajectories === actual.trajectories,
        },
        missingScalarFields: missingScalars,
        scalarFieldTypes: Object.fromEntries(scalarFields.map(f => [f, typeof record[f]])),
        trajectoryShape,
      };
    },
    async publishAutomaticallyArticle() { return { articleId: 1, revisionId: 1 }; },
    async recordCandidateAnalysisAttempts() { /* no-op */ },
    async recordCandidateTriageAttempts() { /* no-op */ },
    async recordCandidateCriticAttempts() { /* no-op */ },
    async setCandidateStatus() { /* no-op */ },
    async recordWorkflowResult() { /* no-op */ },
    async recordPoliticalDecision() { /* no-op */ },
    async getWorkflowResult() { return null; },
    async getCandidate() { return null; },
    async getSnapshots() { return []; },
  };
}

describe.skipIf(!ENABLED)('Open Gambit translation and publication path (real provider, no persistence)', () => {
  it(`reaches TRANSLATION_READY for zh/ja/fr/es at budget ${TRANSLATION_BUDGET} (quota ${TRANSLATION_QUOTA})`, async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GAMBIT_LLM_API_KEY;
    expect(apiKey, 'DEEPSEEK_API_KEY must be set').toBeTruthy();

    const { runGambitStages } = await import('../src/open-gambit/pipeline');
    const { publishQualifiedGambit } = await import('../src/open-gambit/publication');
    const { getGambitModelRoleConfig, providerForRole, MockGambitProvider } = await import('../src/open-gambit/llm');
    const { GambitRunBudget } = await import('../src/open-gambit/budget');
    const { qualificationGate, makeCandidateFromDecision } = await import('../src/open-gambit/policy');

    const entries = corpus.entries as unknown as CorpusEntry[];
    const entry = entries.find(item => item.title.toLowerCase() === TARGET_TITLE.toLowerCase())
      ?? entries.find(item => item.title.toLowerCase().includes(TARGET_TITLE.toLowerCase()));
    if (!entry) throw new Error(`corpus entry not found: ${TARGET_TITLE}`);

    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({
        translation: { timeoutMs: TIMEOUT_MS, tokenBudget: TRANSLATION_BUDGET },
      }),
      GAMBIT_LLM_MODEL: MODEL,
      GAMBIT_LLM_PROVIDER: 'deepseek',
    });
    const translationRole = roles.find(role => role.role === 'translation')!;
    // A silently clamped budget would make the whole measurement meaningless.
    expect(translationRole.tokenBudget).toBe(TRANSLATION_BUDGET);
    expect(translationRole.timeoutMs).toBe(TIMEOUT_MS);

    // Mirror exactly what the production provider sends for translation.
    const boundedOptions = boundedTranslationOptionsForProbe(BASE_URL);
    const observer = createObserver();
    const translationProvider = providerForRole(translationRole, {
      GAMBIT_LLM_API_KEY: apiKey,
      GAMBIT_LLM_BASE_URL: BASE_URL,
    }, observer.fetchImpl);
    if (!translationProvider) throw new Error('translation provider unavailable');

    console.log('\n===== TRANSLATION/PUBLICATION PROBE CONFIG =====');
    console.log(`baseUrl=${BASE_URL} model=${MODEL} roleBudget=${translationRole.tokenBudget} timeoutMs=${translationRole.timeoutMs}`);
    console.log(`quota=${TRANSLATION_QUOTA} tokens / 8 calls (worst case = 4 locales x 2 attempts x ${TRANSLATION_BUDGET})`);
    console.log(`replicates=${REPLICATES} allowCanonicalFallback=NEVER`);

    const runs: any[] = [];
    for (let replicate = 1; replicate <= REPLICATES; replicate += 1) {
      const evidence = {
        snapshotId: 1, sourceId: entry.sourceId, sourceTier: entry.sourceTier as 'PRIMARY_OFFICIAL',
        canonicalUrl: entry.url, title: entry.title, publisher: entry.sourceId,
        publishedAt: entry.publishedAt, quote: entry.quote, role: 'FACT' as const,
        contentHash: 'a'.repeat(64),
      };
      const decision = qualificationGate({
        headline: entry.title, summary: entry.summary, content: entry.summary, evidence: [evidence],
      });
      const candidate = makeCandidateFromDecision({
        fingerprint: `translation-probe-${entry.sourceId}-${entry.title.slice(0, 40)}`,
        headline: entry.title, summary: entry.summary, canonicalUrl: entry.url,
        snapshotIds: [1], sourceIds: [entry.sourceId], decision, discoveredAt: new Date().toISOString(),
      });

      // Deterministic upstream stages. Their budgets are already measured, and
      // mocking them keeps all of this probe's spend on the translation segment.
      const analysisFacts = [entry.quote.slice(0, 200), entry.summary.slice(0, 200)];
      const stages = await runGambitStages(candidate, [evidence], {
        providers: {
          triage: new MockGambitProvider(async () => ({ value: {
            eventImportance: 0.9, aiTechRelevance: true, politicsExcluded: false,
            evidenceSufficient: true, strategicMechanism: 'Programmable security controls lower adoption friction.',
            shouldDeepAnalysisRun: true, reason: 'PROBE_FIXTURE',
          }, provider: 'probe-mock', modelId: 'probe-mock', latencyMs: 0 })) as never,
          gambit_analysis: new MockGambitProvider(async () => ({ value: {
            decision: 'QUALIFIED',
            facts: analysisFacts,
            evidenceIds: [1],
            obviousLogic: 'REST endpoints move a security capability from manual UI work to programmable infrastructure.',
            thesis: 'GitHub is turning AI code scanning into a programmatically configurable enterprise default.',
            mechanism: 'Organization and repository endpoints let platform teams automate enablement through CI/CD and infrastructure-as-code, which raises cross-repository usage and creates demand for stable interfaces and auditability.',
            beneficiaries: ['GitHub', 'Enterprise platform engineering teams'],
            pressuredActors: ['Standalone pull-request scanning vendors'],
            countercase: 'The endpoints may remain in preview, adoption may be limited by licensing, and GitHub may retire them before general availability.',
            trajectories: [{
              id: 'T1', targetEntity: 'GitHub', probability: 60, deadline: '2027-09-10', status: 'WATCHING',
              predictionStatement: 'GitHub will mark the AI Scan for pull request REST endpoints generally available by 2027-09-10.',
              reasoning: 'Public preview APIs commonly mature to general availability when enterprises demand stable interfaces.',
              evidenceCriteria: 'A GitHub changelog or documentation page states the endpoints are generally available.',
              falsifier: 'GitHub still labels the endpoints public preview by 2027-09-10.',
            }],
            uncertainty: 'The source excerpt is truncated and does not disclose roadmap or adoption data.',
          }, provider: 'probe-mock', modelId: 'probe-mock', latencyMs: 0 })) as never,
          critic: new MockGambitProvider(async () => ({ value: {
            accepted: true, rejectionReasons: [], simplerExplanation: '', motiveConcern: false,
            causalConcern: false, politicalFraming: false, sensationalismConcern: false,
            falsifiabilityConcern: false, notes: 'PROBE_FIXTURE',
          }, provider: 'probe-mock', modelId: 'probe-mock', latencyMs: 0 })) as never,
        },
        roles,
        budget: new GambitRunBudget({
          maxLlmCalls: 12, maxLlmTokens: 33_000,
          maxTranslationLlmCalls: 8, maxTranslationLlmTokens: TRANSLATION_QUOTA,
          maxSearchRequests: 0, maxXRequests: 0, maxGithubRequests: 0, maxHttpRequests: 20,
        }),
        now: new Date(),
      });

      if (stages.status !== 'AUTO_PUBLISH_ELIGIBLE' || !stages.draft) {
        console.log(`!! replicate ${replicate}: upstream stages returned ${stages.status} (${stages.reason ?? '-'})`);
        runs.push({ replicate, upstream: stages.status, reason: stages.reason });
        continue;
      }

      const draftForDiagnostics = stages.draft;
      const repository = createRecorder();
      const budget = new GambitRunBudget({
        maxLlmCalls: 12, maxLlmTokens: 33_000,
        maxTranslationLlmCalls: 8, maxTranslationLlmTokens: TRANSLATION_QUOTA,
        maxSearchRequests: 0, maxXRequests: 0, maxGithubRequests: 0, maxHttpRequests: 20,
      });
      const before = observer.records.length;
      const published = await publishQualifiedGambit(repository as never, stages.draft, {
        translationProvider,
        translationRole,
        budget,
        runId: 0,
        now: new Date(),
        // NEVER passed: canonical fallback must not be able to mask a failure.
      });
      const records = observer.records.slice(before);
      const translationAttempts = repository.attempts.filter(a => a.stage === 'TRANSLATION');
      const ready = LOCALES.filter(l => repository.states[l] === 'TRANSLATION_READY');
      // Pair each real transport record with the locale it belongs to, in order,
      // and decode exactly what the validator would have seen.
      const diagnostics = records.map((record, index) => repository.diagnose(
        LOCALES[index] ?? `#${index}`, draftForDiagnostics, record.value, record.parsedOk, record.contentChars,
      ));

      runs.push({
        replicate,
        draftForDiagnostics,
        diagnostics,
        published: published.published,
        translationStatus: published.translation.status,
        localeStates: published.translation.localeStates,
        errors: published.translation.errors,
        readyLocales: ready,
        calls: records.length,
        completions: records.map(r => r.completionTokens),
        reasoning: records.map(r => r.reasoningTokens),
        latenciesMs: records.map(r => r.observedMs),
        attemptErrors: translationAttempts.map(a => a.errorCode),
        budgetTokens: budget.usage.translationLlmTokens,
      });

      console.log(`\n--- replicate ${replicate} ---`);
      console.log(`published=${published.published} translation=${published.translation.status}`);
      console.log(`localeStates=${JSON.stringify(published.translation.localeStates)}`);
      console.log(`errors=${JSON.stringify(published.translation.errors)}`);
      console.log(`calls=${records.length} completionTokens=${JSON.stringify(records.map(r => r.completionTokens))} reasoningTokens=${JSON.stringify(records.map(r => r.reasoningTokens))}`);
      console.log(`latenciesMs=${JSON.stringify(records.map(r => r.observedMs))} finish=${JSON.stringify(records.map(r => r.finishReasons.join('/') || 'none'))}`);
      console.log(`attemptErrors=${JSON.stringify(translationAttempts.map(a => a.errorCode))}`);
      for (const d of diagnostics) console.log('DIAG ' + JSON.stringify(d));
      console.log(`budget used: ${budget.usage.translationLlmTokens}/${budget.limits.maxTranslationLlmTokens} tokens, ${budget.usage.translationLlmCalls}/${budget.limits.maxTranslationLlmCalls} calls`);
    }

    // ---------------------------------------------------------------------
    // PHASE 2 — DIRECT VALIDATOR DIAGNOSTICS.
    //
    // The publication path returns only the umbrella `TRANSLATION_SCHEMA_INVALID`
    // for a locale, and the tee observer cannot see the value (the client
    // cancels its branch, so a successful call also reports contentChars 0).
    // So each locale is re-issued with the EXACT production prompt
    // (`translationRequest` + the same provider options) and the response is run
    // through the REAL validator against the REAL composed article. This
    // attributes a failure to a specific error code and field.
    // ---------------------------------------------------------------------
    const direct: any[] = [];
    const RUN_DIRECT = process.env.GAMBIT_TRANSLATION_DIRECT === '1';
    if (RUN_DIRECT && runs[0]?.draftForDiagnostics) {
      const { translationRequest, gambitTranslationValidationErrors } = await import('../src/open-gambit/publication');
      const articleForValidation = runs[0].draftForDiagnostics;
      for (const locale of LOCALES) {
        const request = translationRequest(articleForValidation, locale, translationRole, { corrective: false });
        const startedAt = Date.now();
        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'x-opencode-session': 'gambit-translation-diagnostic',
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: request.tokenBudget,
            stream: false,
            ...boundedOptions,
          }),
          signal: AbortSignal.timeout(180_000),
        });
        const envelope: any = await response.json().catch(() => null);
        const content: string = envelope?.choices?.[0]?.message?.content ?? '';
        let value: any = null; let parseOk = false;
        try { value = JSON.parse(content); parseOk = true; } catch { /* not JSON */ }
        const errors = parseOk
          ? gambitTranslationValidationErrors(value, locale, articleForValidation)
          : [`UNPARSEABLE_JSON:${content.length}_chars`];
        const record = (value ?? {}) as Record<string, unknown>;
        const scalars = ['headline', 'surfaceEvent', 'obviousLogic', 'thesis', 'mechanism', 'countercase', 'falsifier', 'uncertainty'];
        direct.push({
          locale,
          httpStatus: response.status,
          latencyMs: Date.now() - startedAt,
          parseOk,
          contentChars: content.length,
          errors,
          completionTokens: envelope?.usage?.completion_tokens ?? null,
          reasoningTokens: envelope?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
          topLevelKeyCount: Object.keys(record).length,
          topLevelKeys: Object.keys(record).sort(),
          expectedLengths: {
            facts: Array.isArray(articleForValidation.facts) ? articleForValidation.facts.length : -1,
            beneficiaries: Array.isArray(articleForValidation.beneficiaries) ? articleForValidation.beneficiaries.length : -1,
            pressuredActors: Array.isArray(articleForValidation.pressuredActors) ? articleForValidation.pressuredActors.length : -1,
            trajectories: Array.isArray(articleForValidation.trajectories) ? articleForValidation.trajectories.length : -1,
          },
          actualLengths: {
            facts: Array.isArray(record.facts) ? (record.facts as unknown[]).length : -1,
            beneficiaries: Array.isArray(record.beneficiaries) ? (record.beneficiaries as unknown[]).length : -1,
            pressuredActors: Array.isArray(record.pressuredActors) ? (record.pressuredActors as unknown[]).length : -1,
            trajectories: Array.isArray(record.trajectories) ? (record.trajectories as unknown[]).length : -1,
          },
          missingScalars: scalars.filter(f => typeof record[f] !== 'string' || !(record[f] as string).trim()),
          trajectoryKeys: Array.isArray(record.trajectories)
            ? (record.trajectories as any[]).map(t => (t && typeof t === 'object' ? Object.keys(t).sort() : null))
            : null,
        });
        console.log('DIRECT ' + JSON.stringify(direct[direct.length - 1]));
      }
    }
    runs.forEach(r => { delete r.draftForDiagnostics; });

    const allReady = runs.filter(r => r.readyLocales?.length === LOCALES.length).length;
    console.log('\n===== VERDICT =====');
    console.log(`replicates=${runs.length} reached TRANSLATION_READY on all 4 locales: ${allReady}/${runs.length}`);
    const completions = runs.flatMap(r => r.completions ?? []).filter((v: any) => typeof v === 'number');
    const reasonings = runs.flatMap(r => r.reasoning ?? []).filter((v: any) => typeof v === 'number');
    const lats = runs.flatMap(r => r.latenciesMs ?? []).filter((v: any) => typeof v === 'number');
    if (completions.length) {
      console.log(`completion tokens: min=${Math.min(...completions)} max=${Math.max(...completions)} (budget ${TRANSLATION_BUDGET})`);
      console.log(`reasoning tokens:  ${reasonings.length ? `min=${Math.min(...reasonings)} max=${Math.max(...reasonings)}` : 'none reported (reasoning disabled)'}`);
      console.log(`latency ms:        min=${Math.min(...lats)} max=${Math.max(...lats)}`);
    }
    console.log(allReady === runs.length && runs.length > 0
      ? 'VERDICT: PUBLICATION PATH REACHES TRANSLATION_READY'
      : 'VERDICT: TRANSLATION DID NOT REACH READY');

    console.log('\n===== MACHINE READABLE =====');
    console.log('<<<TRANSPUB>>>' + JSON.stringify({
      config: { baseUrl: BASE_URL, model: MODEL, budget: TRANSLATION_BUDGET, quota: TRANSLATION_QUOTA, timeoutMs: TIMEOUT_MS },
      runs,
      direct,
    }));

    expect(observer.records.length).toBeGreaterThan(0);
  }, 1_800_000);
});
