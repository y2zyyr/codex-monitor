/**
 * Open Gambit Phase 1.6 T2 — the documented production LLM shape.
 *
 * WHY THIS SUITE EXISTS
 * --------------------
 * N6 was not a code regression. It was a MODEL <-> CONFIGURATION mismatch: on a
 * reasoning-emitting model the `gambit_analysis` role burned its entire 4,000
 * token budget on `reasoning_content`, so `finish_reason` was `length` and no
 * JSON was ever emitted. Phase 1.6 measured the same failure on `critic` at
 * 3,000 (8 of 11 calls) and once on `triage` at 2,400.
 *
 * Because the mismatch lives in a DEPLOYMENT VARIABLE, no unit test of `src`
 * alone can catch it: the code is correct, the numbers were wrong. This suite
 * therefore pins the tracked template as the documented production shape and
 * checks it against the code's own clamp ceiling, so a budget that silently
 * cannot reach the provider is a test failure rather than a 100%-failure run in
 * production.
 *
 * `wrangler.jsonc` is gitignored (deployment-specific) and is verified only when
 * it happens to be present locally; `wrangler.example.jsonc` is tracked and is
 * always verified.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getGambitModelRoleConfig } from '../src/open-gambit/llm';

const EXAMPLE_PATH = fileURLToPath(new URL('../wrangler.example.jsonc', import.meta.url));
const LOCAL_PATH = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));

interface ProductionShape {
  label: string;
  maxAnalysisCandidates: number;
  roles: Array<{ role: string; tokenBudget: number; timeoutMs: number }>;
  maxLlmCalls: number;
  maxLlmTokens: number;
  translationCalls: number;
  translationTokens: number;
  /** Whether the deployment file states the translation quota itself. */
  translationQuotaDeclared: boolean;
}

/**
 * Read one flat `"NAME": "value"` deployment variable out of a JSONC file.
 * The variables section is a flat block of escaped JSON strings, so a targeted
 * regex is both sufficient and immune to the file's comments.
 */
function jsoncStringVariable(source: string, name: string): string {
  const pattern = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u');
  const match = pattern.exec(source);
  if (!match) throw new Error(`deployment variable ${name} not found`);
  return JSON.parse(`"${match[1]}"`) as string;
}

/**
 * Documented code defaults for the translation namespace, mirroring
 * `gambitBudgetFromEnv()`. The audited production deployment config does NOT
 * declare these two variables, so the effective quota comes from these defaults
 * rather than from the file -- which is why the effective value is what gets
 * asserted here. Declaring them explicitly is the Phase 1.6 T4 follow-up; until
 * then the fallback is the honest reading.
 */
const CODE_DEFAULT_TRANSLATION_CALLS = 8;
const CODE_DEFAULT_TRANSLATION_TOKENS = 16_000;

function optionalNumberVariable(source: string, name: string, fallback: number): number {
  const pattern = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'u');
  const match = pattern.exec(source);
  if (!match) return fallback;
  const raw = JSON.parse(`"${match[1]}"`) as string;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readShape(path: string, label: string): ProductionShape {
  const source = readFileSync(path, 'utf8');
  const roles = getGambitModelRoleConfig({
    GAMBIT_MODEL_ROLES_JSON: jsoncStringVariable(source, 'GAMBIT_MODEL_ROLES_JSON'),
    GAMBIT_LLM_MODEL: jsoncStringVariable(source, 'GAMBIT_LLM_MODEL'),
    GAMBIT_LLM_PROVIDER: jsoncStringVariable(source, 'GAMBIT_LLM_PROVIDER'),
  });
  return {
    label,
    maxAnalysisCandidates: Number(jsoncStringVariable(source, 'GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN')),
    roles: roles.map(role => ({ role: role.role, tokenBudget: role.tokenBudget, timeoutMs: role.timeoutMs })),
    maxLlmCalls: Number(jsoncStringVariable(source, 'GAMBIT_MAX_LLM_CALLS_PER_RUN')),
    maxLlmTokens: Number(jsoncStringVariable(source, 'GAMBIT_MAX_LLM_TOKENS_PER_RUN')),
    translationCalls: optionalNumberVariable(source, 'GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN', CODE_DEFAULT_TRANSLATION_CALLS),
    translationTokens: optionalNumberVariable(source, 'GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN', CODE_DEFAULT_TRANSLATION_TOKENS),
    translationQuotaDeclared: /"GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN"/u.test(source),
  };
}

/**
 * Bounded re-samples, mirroring `GAMBIT_ANALYSIS_RETRY_LIMIT` and
 * `GAMBIT_TRIAGE_RETRY_LIMIT` in `pipeline.ts`. `budget.consume()` charges the
 * role's DECLARED `tokenBudget` before each attempt, so the worst case must be
 * computed from the bounds, not from measured usage.
 */
const TRIAGE_RETRY_LIMIT = 1;
const ANALYSIS_RETRY_LIMIT = 1;

/** Locales that must pass translation validation, with the existing corrective retry. */
const TRANSLATION_LOCALES = 4;
const TRANSLATION_ATTEMPTS_PER_LOCALE = 2;

function roleBudget(shape: ProductionShape, role: string): number {
  const found = shape.roles.find(item => item.role === role);
  if (!found) throw new Error(`role ${role} missing from the deployment config`);
  return found.tokenBudget;
}

/** Every attempt a single candidate can spend, retries included. */
function worstCaseTokens(shape: ProductionShape): number {
  return roleBudget(shape, 'triage') * (1 + TRIAGE_RETRY_LIMIT)
    + roleBudget(shape, 'gambit_analysis') * (1 + ANALYSIS_RETRY_LIMIT)
    + roleBudget(shape, 'critic');
}

function worstCaseCalls(shape: ProductionShape): number {
  return (1 + TRIAGE_RETRY_LIMIT) + (1 + ANALYSIS_RETRY_LIMIT) + 1;
}

/** The cheapest path that can still reach a publication decision. */
function bestCaseTokens(shape: ProductionShape): number {
  return roleBudget(shape, 'triage') + roleBudget(shape, 'gambit_analysis') + roleBudget(shape, 'critic');
}

const SHAPES: ProductionShape[] = [
  readShape(EXAMPLE_PATH, 'wrangler.example.jsonc'),
  ...(existsSync(LOCAL_PATH) ? [readShape(LOCAL_PATH, 'wrangler.jsonc')] : []),
];

describe('Phase 1.6 T2: the documented production LLM shape is reasoning-budget-safe', () => {
  it('found every deployment config under its own label', () => {
    expect(SHAPES.length).toBeGreaterThan(0);
    expect(SHAPES[0].label).toBe('wrangler.example.jsonc');
  });

  it('gives the analysis role the 8,000-token budget N6 requires', () => {
    for (const shape of SHAPES) {
      // Measured Phase 1.6 (12 runs, deepseek-flash): analysis reasoning peaked
      // at 4,667 tokens with `finish_reason=stop` in 12/12 calls; 4,000 truncated
      // it in 26 of 33 Phase 1.5 calls. 8,000 is also the hard clamp ceiling in
      // `getGambitModelRoleConfig`, so it is the largest value reachable by
      // configuration alone.
      expect(roleBudget(shape, 'gambit_analysis'), `${shape.label} analysis tokenBudget`)
        .toBe(8_000);
    }
  });

  it('gives the critic role 6,000 tokens, not the 3,000 that truncated 8 of 11 calls', () => {
    for (const shape of SHAPES) {
      // Measured Phase 1.6: at 3,000 the critic returned reasoning = completion =
      // 3,000, `finish_reason=length` and 0 bytes of content on 8 of 11
      // executions -> PROVIDER_EMPTY_RESPONSE. The three that completed used
      // 1,840 / 2,276 / 2,545.
      expect(roleBudget(shape, 'critic'), `${shape.label} critic tokenBudget`).toBe(6_000);
    }
  });

  it('never lets a configured role budget exceed the code clamp', () => {
    for (const shape of SHAPES) {
      for (const role of shape.roles) {
        // `boundedNumber(record.tokenBudget, role.tokenBudget, 100, 8_000)` lowers
        // an over-ask silently. A config asking for more than the ceiling would
        // otherwise look applied while measuring something else.
        expect(role.tokenBudget, `${shape.label} ${role.role} exceeds the 8,000 clamp`)
          .toBeLessThanOrEqual(8_000);
        expect(role.tokenBudget, `${shape.label} ${role.role} must be a usable budget`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('keeps one candidate inside the per-Workflow token ceiling on every path', () => {
    for (const shape of SHAPES) {
      expect(
        worstCaseTokens(shape),
        `${shape.label}: worst case ${worstCaseTokens(shape)} tokens must fit GAMBIT_MAX_LLM_TOKENS_PER_RUN=${shape.maxLlmTokens}`,
      ).toBeLessThanOrEqual(shape.maxLlmTokens);
      expect(
        bestCaseTokens(shape),
        `${shape.label}: best case must also fit`,
      ).toBeLessThanOrEqual(shape.maxLlmTokens);
    }
  });

  it('keeps the per-candidate call count inside the call ceiling', () => {
    for (const shape of SHAPES) {
      expect(worstCaseCalls(shape), `${shape.label}: worst-case calls must fit the call ceiling`)
        .toBeLessThanOrEqual(shape.maxLlmCalls);
    }
  });

  it('keeps translation inside its own independent fail-closed quota', () => {
    for (const shape of SHAPES) {
      const translation = roleBudget(shape, 'translation');
      // 4 locales x 2 attempts x the translation role budget.
      expect(
        TRANSLATION_LOCALES * TRANSLATION_ATTEMPTS_PER_LOCALE,
        `${shape.label}: the translation call quota must cover the measured worst case`,
      ).toBeLessThanOrEqual(shape.translationCalls);
      expect(
        TRANSLATION_LOCALES * TRANSLATION_ATTEMPTS_PER_LOCALE * translation,
        `${shape.label}: the translation token quota must cover the measured worst case`,
      ).toBeLessThanOrEqual(shape.translationTokens);
    }
  });

  it('states the translation quota explicitly in the tracked template', () => {
    // Phase 1.5 §8.4 item 3: the quota must not silently depend on a code
    // default, because a future change to that default would move the bound
    // without touching any deployment file. The template is the tracked
    // authority, so it is asserted; the gitignored production file is reported
    // rather than asserted, and is the remaining Phase 1.6 T4 follow-up.
    const example = SHAPES.find(shape => shape.label === 'wrangler.example.jsonc')!;
    expect(example.translationQuotaDeclared, 'wrangler.example.jsonc must declare GAMBIT_MAX_TRANSLATION_LLM_*').toBe(true);
    for (const shape of SHAPES) {
      expect(shape.translationCalls, `${shape.label}: effective translation call quota`).toBe(CODE_DEFAULT_TRANSLATION_CALLS);
      expect(shape.translationTokens, `${shape.label}: effective translation token quota`).toBe(CODE_DEFAULT_TRANSLATION_TOKENS);
    }
  });

  it('keeps every non-translation role deadline inside the code clamp', () => {
    for (const shape of SHAPES) {
      for (const role of shape.roles) {
        // `boundedNumber(record.timeoutMs, role.timeoutMs, 500, translation ? 60_000 : 30_000)`.
        // This is the SECOND ceiling N6 collides with: at 6,000 reasoning tokens
        // the provider needs ~29s, and a successful Phase 1.6 critic call was
        // measured at 29.4s. A deadline cannot be raised past the clamp by
        // configuration, so a role that needs more time than this is a code
        // change, not a variable change.
        const clamp = role.role === 'translation' ? 60_000 : 30_000;
        expect(role.timeoutMs, `${shape.label} ${role.role} deadline exceeds the code clamp`).toBeLessThanOrEqual(clamp);
        expect(role.timeoutMs, `${shape.label} ${role.role} deadline must be usable`).toBeGreaterThanOrEqual(500);
      }
    }
  });

  it('reports the per-candidate envelope the AGENTS.md table documents', () => {
    // Not an assertion about intent -- a guard that the documented numbers and
    // the configuration still agree. Update both together.
    for (const shape of SHAPES) {
      // The ceiling is per fresh Workflow budget; the global run-wide bound is
      // the number of dispatched candidates, never a per-source Top-K.
      expect(shape.maxAnalysisCandidates, `${shape.label}: global analysis bound`).toBe(3);
      expect({
        label: shape.label,
        worstCaseTokens: worstCaseTokens(shape),
        bestCaseTokens: bestCaseTokens(shape),
        worstCaseCalls: worstCaseCalls(shape),
        maxLlmTokens: shape.maxLlmTokens,
        maxLlmCalls: shape.maxLlmCalls,
      }).toMatchObject({
        worstCaseTokens: 26_800,
        bestCaseTokens: 16_400,
        worstCaseCalls: 5,
        maxLlmTokens: 28_000,
      });
    }
  });
});
