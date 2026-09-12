/**
 * Open Gambit Phase 1.7B — multi-article translation-quality RCA harness.
 *
 * OPT-IN ONLY. Requires GAMBIT_RCA_PROBE=1; `npm test` spends zero provider quota.
 *
 *   set -a && . ./.env && set +a
 *   GAMBIT_RCA_PROBE=1 npx vitest run tests/open-gambit-translation-quality-rca.test.ts
 *
 * WHAT IT DOES
 * ------------
 * Runs DISTINCT real articles through the REAL production translation contract:
 * real provider, real prompt, real validator, reasoning disabled, 4000-token role
 * budget, at most 2 attempts per locale (initial + corrective), no canonical
 * fallback. Every verdict is expanded into sentence-level evidence by
 * `helpers/translation-quality-diagnostics`, so a failure names the field, the
 * sentence, the rule branch and the numbers that branch compared.
 *
 * WHY ARTICLES ARE BUILT FROM THE FROZEN CORPUS
 * ---------------------------------------------
 * The corpus (`fixtures/open-gambit/real-corpus-2026-09-11.json`) holds 98 real
 * published source entries. Each harness article uses one entry's real headline,
 * real summary and real quoted evidence; facts/beneficiaries/pressuredActors/
 * trajectories are derived DETERMINISTICALLY from that real text so the suite can
 * span structural shapes (facts 1/2/3+, short and long headlines, acronym-dense
 * and proper-noun-dense prose, one and multiple trajectories). No news is
 * invented and no provider output is hand-edited.
 *
 * The article shape is built directly rather than via `runGambitStages` so the
 * corpus can be swept cheaply and reproducibly; the TRANSLATION path under test
 * (prompt, provider, validator, retry, locale readiness) is entirely real. This
 * is the same approach as `open-gambit-translation-probe.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import corpus from './fixtures/open-gambit/real-corpus-2026-09-11.json';
import { diagnose, validatorSourceHash, shadowLanguageQuality } from './helpers/translation-quality-diagnostics';

const ENABLED = process.env.GAMBIT_RCA_PROBE === '1';
const BASE_URL = process.env.GAMBIT_RCA_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.GAMBIT_RCA_MODEL ?? 'deepseek-flash';
const BUDGET = Number(process.env.GAMBIT_RCA_BUDGET ?? 4_000);
const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS_PER_LOCALE = 2;
const LOCALES = ['zh', 'ja', 'fr', 'es'] as const;
const LOCALE_FILTER = process.env.GAMBIT_RCA_LOCALES
  ? process.env.GAMBIT_RCA_LOCALES.split(',').map(v => v.trim())
  : [...LOCALES];
const ARTICLE_FILTER = process.env.GAMBIT_RCA_ARTICLES
  ? Number(process.env.GAMBIT_RCA_ARTICLES)
  : 0; // 0 = all selected
const SETS = Number(process.env.GAMBIT_RCA_SETS ?? 1);
const INCLUDE_TEXT = process.env.GAMBIT_RCA_TEXT === '1';

interface CorpusEntry {
  sourceId: string; title: string; url: string; publishedAt: string | null;
  quote: string; summary: string; sourceTier: string;
}

/** Deterministic, structure-aware article derived from one real corpus entry. */
function buildArticle(entry: CorpusEntry, arity: { facts: number; trajectories: number }) {
  const sentences = entry.quote.split(/(?<=[.!?])\s+/u).map(s => s.trim()).filter(s => s.length > 24);
  const facts: string[] = [];
  for (let i = 0; i < arity.facts; i += 1) facts.push(sentences[i] ?? entry.summary);
  const trajectories = Array.from({ length: arity.trajectories }, (_, i) => ({
    id: `T${i + 1}`,
    targetEntity: entry.sourceId,
    probability: (5 + i) * 10,
    deadline: '2027-06-30',
    status: 'WATCHING' as const,
    predictionStatement: `${entry.title} leads to a documented follow-up.</p>`.replace(/<\/p>/u, ''),
    reasoning: entry.summary.slice(0, 400),
    evidenceCriteria: `A primary source from ${entry.sourceId} documents the follow-up.`,
    falsifier: `No primary source from ${entry.sourceId} documents the follow-up.`,
  }));
  // CANDIDATE A (experiment): feed boilerplate is stripped from the canonical
  // record. WordPress-appended trailers ("The post X appeared first on Y") are
  // source artifacts, not editorial prose, and the model faithfully preserves the
  // English they contain. This mirrors a source-normalization fix.
  const stripFeedBoilerplate = (text: string) => text
    .replace(/\s*The post .*? appeared first on [^.]+\.[\s\S]*$/u, '')
    .replace(/\s*\n?\s*The post .*/u, '')
    .trim();
  const NORMALIZE_SOURCE = process.env.GAMBIT_RCA_NORMALIZE === '1';
  const surfaceEvent = NORMALIZE_SOURCE ? stripFeedBoilerplate(entry.summary) : entry.summary;
  return {
    articleId: 1, candidateId: 1, slug: `rca-${entry.sourceId}`,
    headline: entry.title,
    surfaceEvent,
    facts,
    obviousLogic: 'Lower friction and broader distribution change how the capability reaches developers.',
    thesis: `${entry.title} is a distribution and capability move rather than a single feature release.`,
    mechanism: NORMALIZE_SOURCE ? stripFeedBoilerplate(entry.quote).slice(0, 600) : entry.quote.slice(0, 600),
    beneficiaries: [entry.sourceId, 'Enterprise platform engineering teams'],
    pressuredActors: ['Standalone vendors in the same segment'],
    countercase: 'The change may remain scoped to a subset of customers for an extended period.',
    trajectories,
    falsifier: `No primary source from ${entry.sourceId} documents the follow-up.`,
    evidence: [],
    uncertainty: 'The source excerpt is truncated and does not disclose roadmap or adoption data.',
    politicalTopic: false,
    critic: {
      accepted: true, rejectionReasons: [], simplerExplanation: '', motiveConcern: false,
      causalConcern: false, politicalFraming: false, sensationalismConcern: false,
      falsifiabilityConcern: false, notes: '',
    },
    modelRoleProvenance: {}, modelPromptVersion: 'rca', aiDisclosureVersion: 'v1',
    draftVersion: 1, createdAt: '2026-09-12T00:00:00.000Z', status: 'DRAFT',
    modifiedAt: '2026-09-12T00:00:00.000Z', translations: {},
  } as any;
}

interface AttemptRecord {
  attempt: number;
  corrective: boolean;
  httpStatus: number;
  contentChars: number;
  parseOk: boolean;
  validationErrors: string[];
  errorClass: string;
  /** A/B: verdict under the candidate segmentation on the SAME provider output. */
  shadowErrors: string[];
  shadowErrorClass: string;
  completionTokens: number | null;
  reasoningTokens: number | null;
  latencyMs: number;
  diagnostics: ReturnType<typeof diagnose> | null;
}

interface LocaleOutcome {
  locale: string;
  attempts: AttemptRecord[];
  finalState: 'PASS_FIRST' | 'PASS_RETRY' | 'FAIL_LANGUAGE' | 'FAIL_SCHEMA' | 'FAIL_PROVIDER' | 'FAIL_BUDGET' | 'OTHER';
}

const TIMING: Array<{ calls: number; retries: number }> = [];

describe.skipIf(!ENABLED)('Phase 1.7B multi-article translation-quality RCA', () => {
  it('runs distinct real articles x locales under the production contract', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.GAMBIT_LLM_API_KEY;
    expect(apiKey, 'DEEPSEEK_API_KEY must be set').toBeTruthy();

    const P = await import('../src/open-gambit/publication');
    const { getGambitModelRoleConfig, providerForRole } = await import('../src/open-gambit/llm');

    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({ translation: { timeoutMs: TIMEOUT_MS, tokenBudget: BUDGET } }),
      GAMBIT_LLM_MODEL: MODEL,
      GAMBIT_LLM_PROVIDER: 'deepseek',
    });
    const translationRole = roles.find(r => r.role === 'translation')!;
    expect(translationRole.tokenBudget, 'role budget must not be silently clamped').toBe(BUDGET);
    expect(translationRole.retryLimit, 'retry bound must stay at the production value').toBe(1);

    const hash = validatorSourceHash();
    console.log('\n===== VALIDATOR BASELINE =====');
    console.log(`VALIDATOR_BASELINE_HASH=${hash.combined}`);
    console.log(`publication.ts sha256=${hash.file}`);

    // ---- corpus selection: structural diversity, rationale recorded ----
    const q = process.env.DEEPSEEK_API_KEY ? '' : '';
    void q;
    const entries = corpus.entries as unknown as CorpusEntry[];
    const withCounts = entries.map(entry => {
      const acronyms = (entry.quote.match(/\b[A-Z]{2,}\b/gu) ?? []).length;
      const proper = (entry.quote.match(/\b[A-Z][a-zA-Z0-9]+/gu) ?? []).length;
      return { entry, acronyms, proper, quoteChars: entry.quote.length, titleChars: entry.title.length };
    });
    // Buckets guarantee coverage rather than convenience: short/long headlines,
    // short/long quotes, low/high acronym density, low/high proper-noun density.
    const pick = <T,>(arr: T[], n: number, key: (t: T) => number, dir: 'min' | 'max') =>
      [...arr].sort((a, b) => dir === 'min' ? key(a) - key(b) : key(b) - key(a)).slice(0, n);
    const selected: typeof withCounts = [];
    const add = (list: typeof withCounts) => { for (const c of list) if (!selected.includes(c)) { selected.push(c); if (selected.length >= 12) return; } };
    add(pick(withCounts, 2, w => w.titleChars, 'min'));
    add(pick(withCounts, 2, w => w.titleChars, 'max'));
    add(pick(withCounts, 2, w => w.quoteChars, 'min'));
    add(pick(withCounts, 2, w => w.quoteChars, 'max'));
    add(pick(withCounts, 2, w => w.acronyms, 'max'));
    add(pick(withCounts, 2, w => w.proper, 'max'));
    // Always include the article whose staging translation failed, if present.
    const stagingFail = withCounts.find(w => /Enterprise managed permissions for GitHub Copilot/iu.test(w.entry.title));
    if (stagingFail && !selected.includes(stagingFail)) selected.unshift(stagingFail);
    const finalSelection = ARTICLE_FILTER ? selected.slice(0, ARTICLE_FILTER) : selected;

    console.log('\n===== CORPUS SELECTION =====');
    console.log('selected articles: ' + finalSelection.length + ' of ' + entries.length + ' corpus entries');
    for (const w of finalSelection) {
      console.log(`  ${w.entry.title.slice(0, 58).padEnd(60)} quoteChars=${String(w.quoteChars).padEnd(5)} titleChars=${String(w.titleChars).padEnd(4)} acronyms=${String(w.acronyms).padEnd(3)} proper=${w.proper}`);
    }

    const results: Array<{ article: string; characteristics: Record<string, number>; locales: LocaleOutcome[] }> = [];

    for (const [aIndex, w] of finalSelection.entries()) {
      // Vary arity across the corpus so the sweep covers the structural shapes.
      const arity = { facts: 1 + (aIndex % 3), trajectories: 1 + (aIndex % 2) };
      const article = buildArticle(w.entry, arity);
      const locales: LocaleOutcome[] = [];

      for (const locale of LOCALE_FILTER.filter(l => (LOCALES as readonly string[]).includes(l))) {
        const attempts: AttemptRecord[] = [];
        let passed = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_LOCALE && !passed; attempt += 1) {
          const corrective = attempt === 1;
          const request = P.translationRequest(article, locale as never, translationRole, { corrective });
          const started = Date.now();
          let httpStatus = 0; let content = ''; let completionTokens: number | null = null; let reasoningTokens: number | null = null;
          try {
            const response = await fetch(`${BASE_URL}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'x-opencode-session': 'gambit-rca-translation',
              },
              body: JSON.stringify({
                model: MODEL,
                messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }],
                response_format: { type: 'json_object' },
                temperature: 0,
                max_tokens: request.tokenBudget,
                stream: false,
                thinking: { type: 'disabled' },
              }),
              signal: AbortSignal.timeout(180_000),
            });
            httpStatus = response.status;
            const envelope: any = await response.json().catch(() => null);
            content = envelope?.choices?.[0]?.message?.content ?? '';
            completionTokens = envelope?.usage?.completion_tokens ?? null;
            reasoningTokens = envelope?.usage?.completion_tokens_details?.reasoning_tokens ?? null;
          } catch (error) {
            attempts.push({
              attempt, corrective, httpStatus: 0, contentChars: 0, parseOk: false,
              validationErrors: [], errorClass: 'FAIL_PROVIDER', shadowErrors: [], shadowErrorClass: 'FAIL_PROVIDER',
              completionTokens: null, reasoningTokens: null, latencyMs: Date.now() - started, diagnostics: null,
            });
            continue;
          }
          let value: any = null; let parseOk = false;
          try { value = JSON.parse(content); parseOk = true; } catch { /* not JSON */ }

          let verdict = { errors: ['UNPARSEABLE'], targetLanguageDominance: 'FAIL', crossLanguageSentenceContamination: 'FAIL', naturalness: 'FAIL', canonicalEntityPreservation: 'FAIL' } as any;
          let diag: ReturnType<typeof diagnose> | null = null;
          let shadowErrors: string[] = [];
          if (parseOk) {
            const structuralErrors = P.gambitTranslationValidationErrors(value, locale as never, article);
            const quality = P.evaluateGambitTranslationLanguageQuality(value, locale as never, article);
            verdict = { errors: structuralErrors.concat(quality.errors), ...quality };
            diag = diagnose(value, locale, article, verdict, { includeText: INCLUDE_TEXT });
            // A/B on the SAME output: structural errors are identical by
            // construction (the candidate touches only language quality), so the
            // candidate verdict is structural errors + the shadow quality verdict.
            shadowErrors = structuralErrors.concat(shadowLanguageQuality(value, locale, article).errors);
          }
          const errors: string[] = verdict.errors ?? [];
          const languageOnly = errors.length > 0 && errors.every(e => /^(ZH|JA|FR|ES)_(TARGET_LANGUAGE_DOMINANCE|CROSS_LANGUAGE_SENTENCE_CONTAMINATION|NATURALNESS)$/u.test(e));
          const classify = (list: string[], parsed: boolean) => {
            if (list.length === 0) return 'PASS';
            const qualityOnly = list.every((e: string) => /^(ZH|JA|FR|ES)_(TARGET_LANGUAGE_DOMINANCE|CROSS_LANGUAGE_SENTENCE_CONTAMINATION|NATURALNESS)$/u.test(e));
            return qualityOnly ? 'FAIL_LANGUAGE' : (parsed ? 'FAIL_SCHEMA' : 'FAIL_PROVIDER');
          };
          const errorClass = classify(errors, parseOk);
          const shadowErrorClass = classify(shadowErrors, parseOk);
          attempts.push({
            attempt, corrective, httpStatus, contentChars: content.length, parseOk,
            validationErrors: errors, errorClass, shadowErrors, shadowErrorClass,
            completionTokens, reasoningTokens, latencyMs: Date.now() - started, diagnostics: diag,
          });
          if (errors.length === 0) passed = true;
        }
        const firstOk = attempts[0]?.errorClass === 'PASS';
        const last = attempts[attempts.length - 1];
        const finalState: LocaleOutcome['finalState'] = firstOk ? 'PASS_FIRST'
          : passed ? 'PASS_RETRY'
          : (last?.errorClass as LocaleOutcome['finalState']) ?? 'OTHER';
        locales.push({ locale, attempts, finalState });
        TIMING.push({ calls: attempts.length, retries: attempts.length - 1 });
        const first = attempts[0];
        console.log(`[${aIndex}] ${locale} ${finalState.padEnd(11)} attempts=${attempts.length} first=${first?.errorClass ?? '-'} err=${JSON.stringify(first?.validationErrors ?? [])} comp=${first?.completionTokens ?? '-'} reas=${first?.reasoningTokens ?? '-'} ms=${first?.latencyMs ?? '-'} ${w.entry.title.slice(0, 34)}`);
        if (first?.diagnostics?.findings.length) {
          for (const f of first.diagnostics.findings.slice(0, 6)) {
            console.log(`      FIELD ${f.field}#${f.sentenceIndex} target=${f.targetChars} foreign=${f.foreignChars} words=${f.asciiWordCount} ratio=${f.targetScriptRatio} rule=${f.firedRule}`);
            if (INCLUDE_TEXT && f.text) console.log(`        SENTENCE: ${f.text}`);
            if (INCLUDE_TEXT && f.canonical) console.log(`        CANONICAL: ${f.canonical}`);
          }
        }
      }
      results.push({
        article: w.entry.title,
        characteristics: { quoteChars: w.quoteChars, titleChars: w.titleChars, acronyms: w.acronyms, proper: w.proper, facts: arity.facts, trajectories: arity.trajectories },
        locales,
      });
    }

    // ---------------- aggregate ----------------
    const byLocale: Record<string, { first: number; pass: number; total: number; classes: Record<string, number> }> = {};
    for (const r of results) for (const l of r.locales) {
      byLocale[l.locale] ??= { first: 0, pass: 0, total: 0, classes: {} };
      const b = byLocale[l.locale];
      b.total += 1;
      if (l.finalState === 'PASS_FIRST') { b.first += 1; b.pass += 1; }
      else if (l.finalState === 'PASS_RETRY') b.pass += 1;
      b.classes[l.finalState] = (b.classes[l.finalState] ?? 0) + 1;
    }

    console.log('\n===== RATES =====');
    for (const [locale, b] of Object.entries(byLocale)) {
      console.log(`${locale}: first-pass ${b.first}/${b.total}  final-pass ${b.pass}/${b.total}  retry-rescued ${b.pass - b.first}  fail ${b.total - b.pass}  ${JSON.stringify(b.classes)}`);
    }

    console.log('\n===== FAILURE FIELD DISTRIBUTION (first-attempt findings) =====');
    const fieldCounts: Record<string, number> = {};
    const ruleCounts: Record<string, number> = {};
    for (const r of results) for (const l of r.locales) {
      const d = l.attempts[0]?.diagnostics;
      if (!d) continue;
      for (const f of d.findings) {
        fieldCounts[f.field] = (fieldCounts[f.field] ?? 0) + 1;
        if (f.firedRule) ruleCounts[f.firedRule.split(':')[0]] = (ruleCounts[f.firedRule.split(':')[0]] ?? 0) + 1;
      }
    }
    console.log('by field: ' + JSON.stringify(fieldCounts, null, 1));
    console.log('by rule: ' + JSON.stringify(ruleCounts));

    console.log('\n===== ARTICLE x LOCALE MATRIX =====');
    for (const r of results) {
      console.log(`${r.article.slice(0, 46).padEnd(48)} ${r.locales.map(l => `${l.locale}=${l.finalState}`).join(' ')}`);
    }

    console.log('\n===== COST =====');
    const calls = TIMING.reduce((n, t) => n + t.calls, 0);
    const retries = TIMING.reduce((n, t) => n + t.retries, 0);
    const tokens = results.flatMap(r => r.locales).flatMap(l => l.attempts).reduce((n, a) => n + (a.completionTokens ?? 0), 0);
    console.log(`calls=${calls} retries=${retries} completionTokens=${tokens}`);

    // ---------------- A/B: baseline vs candidate segmentation ----------------
    const ab: Record<string, { baseFirst: number; baseFinal: number; candFirst: number; candFinal: number; total: number; baseFailFindings: number; candFailFindings: number }> = {};
    for (const r of results) for (const l of r.locales) {
      const b = (ab[l.locale] ??= { baseFirst: 0, baseFinal: 0, candFirst: 0, candFinal: 0, total: 0, baseFailFindings: 0, candFailFindings: 0 });
      b.total += 1;
      const baseFirst = l.attempts[0]?.errorClass === 'PASS';
      const baseFinal = l.attempts.some(a => a.errorClass === 'PASS');
      const candFirst = l.attempts[0]?.shadowErrorClass === 'PASS';
      const candFinal = l.attempts.some(a => a.shadowErrorClass === 'PASS');
      if (baseFirst) b.baseFirst += 1;
      if (baseFinal) b.baseFinal += 1;
      if (candFirst) b.candFirst += 1;
      if (candFinal) b.candFinal += 1;
      for (const a of l.attempts) {
        if (a.errorClass === 'FAIL_LANGUAGE') b.baseFailFindings += 1;
        if (a.shadowErrorClass === 'FAIL_LANGUAGE') b.candFailFindings += 1;
      }
    }
    console.log('\n===== A/B: BASELINE vs CANDIDATE SEGMENTATION (same provider output) =====');
    for (const [locale, b] of Object.entries(ab)) {
      console.log(`${locale}: first-pass ${b.baseFirst}/${b.total} -> ${b.candFirst}/${b.total}   final-pass ${b.baseFinal}/${b.total} -> ${b.candFinal}/${b.total}   language-fail attempts ${b.baseFailFindings} -> ${b.candFailFindings}`);
    }

    console.log('\n===== DIAGNOSTIC FAITHFULNESS (reproduction must match the validator) =====');
    let reproOk = 0; let reproBad = 0;
    for (const r of results) for (const l of r.locales) {
      const a = l.attempts[0]; const d = a?.diagnostics; if (!d || !a.parseOk) continue;
      const validatorSays = a.validationErrors.some(e => /CROSS_LANGUAGE_SENTENCE_CONTAMINATION$/u.test(e));
      const diagSays = d.findings.length > 0;
      if (validatorSays === diagSays) reproOk += 1; else { reproBad += 1;
        console.log(`  MISMATCH ${r.article.slice(0,30)} ${l.locale} validator=${validatorSays} diagnostics=${diagSays}`);
      }
    }
    console.log(`attribution matches the validator on ${reproOk}/${reproOk + reproBad} first attempts`);
    expect(reproBad, 'the sentence-level attribution must reproduce the validator verdict').toBe(0);

    console.log('\n===== TRUE-POSITIVE PRESERVATION (negative control) =====');
    // Every first-attempt finding that is GENUINE prose (contains target script
    // AND >= 4 ascii words at ratio<0.5) must still fire under the candidate.
    let genuineProseFindings = 0; let genuineStillFires = 0;
    for (const r of results) for (const l of r.locales) {
      const d = l.attempts[0]?.diagnostics; if (!d) continue;
      for (const f of d.findings) {
        const cjk = /[\u3040-\u30ff\u3400-\u9fff]/u.test(f.text ?? '');
        const genuine = cjk && f.asciiWordCount >= 4 && f.targetScriptRatio < 0.5;
        if (genuine) { genuineProseFindings += 1; if (f.candidateStillFires) genuineStillFires += 1; }
      }
    }
    console.log(`genuine-prose findings (target script + >=4 ascii words + ratio<0.5): ${genuineProseFindings}`);
    console.log(`of those, the candidate rule still fires on: ${genuineStillFires} (must equal ${genuineProseFindings} for the gate to be unweakened)`);

    console.log('\n===== MACHINE READABLE =====');
    console.log('<<<RCA>>>' + JSON.stringify({
      validatorBaselineHash: hash.combined,
      config: { baseUrl: BASE_URL, model: MODEL, budget: BUDGET, maxAttemptsPerLocale: MAX_ATTEMPTS_PER_LOCALE },
      corpusSize: finalSelection.length,
      results,
      rates: byLocale,
      ab,
      fieldCounts,
      ruleCounts,
    }));

    expect(calls).toBeGreaterThan(0);
  }, 3_600_000);
});
