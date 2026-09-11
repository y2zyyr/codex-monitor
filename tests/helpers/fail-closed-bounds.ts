import { expect } from 'vitest';

/**
 * Shared fail-open assertions for bounded numeric configuration.
 *
 * THE DEFECT CLASS (Phase 1.5 §3, T3)
 * ----------------------------------
 * A bound that silently resolves to "no bound" is worse than a bound that is
 * too small, because nothing reports it:
 *
 *   usage + n > undefined   // always false  -> UNBOUNDED
 *   attempt < NaN           // always false  -> ZERO ATTEMPTS
 *   usage + n > Infinity    // always false  -> UNBOUNDED
 *
 * `tsconfig` typechecks `src` only, so a test file, a stale object literal or a
 * JS caller can omit a field with no compile error. Phase 1 fixed one instance
 * (`gambit_translation`); Phase 1.5 found a second (`retryLimit`, which produced
 * zero network calls). This helper exists so the next namespace does not need a
 * third bespoke audit: point it at the resolver and the documented default and
 * it pins the whole class.
 *
 * WHY IT IS NOT A SINGLE "invalid -> default" ASSERTION
 * ----------------------------------------------------
 * The two producer shapes in this repository differ, and conflating them would
 * produce a test that is either wrong or vacuous:
 *
 *   `positiveLimit`/`boundedNumber`  non-finite -> documented default
 *                                    finite out of range -> clamped to [min,max]
 *   `bounded`                        non-finite -> documented default
 *                                    '' -> 0 -> clamped up to min (NOT default)
 *
 * So the helper asserts the invariant that actually matters for every invalid
 * input (finite, non-negative, and above the minimum when a quota must be
 * positive), and pins the documented default only where the contract says the
 * fallback applies: genuinely non-finite inputs.
 */

/**
 * Inputs that make every audited resolver fall back to its documented default.
 *
 * `null` and `[]` are deliberately NOT here even though they look like absences:
 * `Number(null)` and `Number([])` are both `0`, which is FINITE, so a clamping
 * resolver lifts them into range instead of falling back. Asserting the default
 * for them would encode a contract the code does not have.
 */
const NON_FINITE_INPUTS: readonly unknown[] = [
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  'abc',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e999',
  {},
];

/** Inputs that coerce to a finite but out-of-range value (0, null and [] included). */
const OUT_OF_RANGE_INPUTS: readonly unknown[] = [0, -1, '', '0', '-5', null, []];

/**
 * The subset of the default-input matrix that survives a JSON round-trip.
 *
 * `JSON.stringify` encodes `NaN`/`Infinity` as `null`, and the string forms carry
 * the same meaning through the parser. A resolver reached through
 * `GAMBIT_MODEL_ROLES_JSON` therefore sees these, not the numeric originals.
 * Exported so a call site never has to re-derive this trap.
 */
export const JSON_SAFE_DEFAULT_INPUTS: readonly unknown[] = [
  undefined,
  'abc',
  'NaN',
  'Infinity',
  '-Infinity',
  '1e999',
  {},
];

/** Inputs that coerce to a finite, out-of-range value while surviving JSON. */
export const JSON_SAFE_RANGE_INPUTS: readonly unknown[] = [0, -1, '', '0', '-5', null, []];

export interface FailClosedBoundOptions {
  /**
   * The documented code default this bound must fall back to when the input is
   * absent or non-finite. Omit when the resolver has no documented default.
   */
  documentedDefault?: number;
  /**
   * Set true when `0` is a legitimate configured value (for example a daily
   * limit of 0 means "feature disabled") rather than a fail-open defect.
   * When false (the default) a zero result is a failure: a quota whose bound is
   * zero is indistinguishable from one that was never configured.
   */
  zeroIsValid?: boolean;
  /**
   * Override the inputs asserted to resolve to `documentedDefault`.
   *
   * Needed when the resolver's input must survive JSON serialisation: `JSON` has
   * no `NaN` or `Infinity`, so `JSON.stringify({ tokenBudget: NaN })` becomes
   * `{"tokenBudget":null}`, which coerces to a FINITE 0 and is clamped rather
   * than defaulted. Asserting the default there would encode a contract the
   * code does not have. Pass `JSON_SAFE_DEFAULT_INPUTS` in that case.
   */
  defaultInputs?: readonly unknown[];
  /** Override the inputs asserted only to resolve to a usable bound. */
  rangeInputs?: readonly unknown[];
  /**
   * Set true when the resolver's contract is a `string | undefined`
   * environment variable.
   *
   * `numberFromEnv`/`integerFromEnv` call `value.trim()`, so a non-string input
   * throws `TypeError: value.trim is not a function` instead of falling back.
   * That is not a fail-open defect — Cloudflare deployment variables are always
   * strings, so the case is unreachable in production — but feeding an object to
   * it would fail this audit for the wrong reason. Filtering keeps the audit
   * meaningful: it still exercises every string form the parser can receive.
   */
  stringInputsOnly?: boolean;
}

/**
 * Pin one bounded numeric field as fail-closed.
 *
 * @param label    Human-readable field name, used in every failure message.
 * @param resolve  Resolver under test: raw input -> resolved bound.
 */
export function expectFailClosedBound(
  label: string,
  resolve: (raw: unknown) => number,
  options: FailClosedBoundOptions = {},
): void {
  const {
    documentedDefault,
    zeroIsValid = false,
    stringInputsOnly = false,
    defaultInputs: rawDefaultInputs = NON_FINITE_INPUTS,
    rangeInputs: rawRangeInputs = OUT_OF_RANGE_INPUTS,
  } = options;

  const asStrings = (inputs: readonly unknown[]) =>
    stringInputsOnly ? inputs.filter(input => input === undefined || typeof input === 'string') : inputs;
  const defaultInputs = asStrings(rawDefaultInputs);
  const rangeInputs = asStrings(rawRangeInputs);

  const assertUsable = (result: number, input: unknown) => {
    expect(Number.isFinite(result), `${label}: input ${describe(input)} resolved to ${result}, which is not finite`).toBe(true);
    if (!zeroIsValid) {
      expect(result, `${label}: input ${describe(input)} resolved to ${result}; a bound must stay positive`).toBeGreaterThan(0);
    } else {
      expect(result, `${label}: input ${describe(input)} resolved to ${result}; a bound must not be negative`).toBeGreaterThanOrEqual(0);
    }
  };

  for (const input of defaultInputs) {
    const result = resolve(input);
    assertUsable(result, input);
    if (documentedDefault !== undefined) {
      expect(result, `${label}: input ${describe(input)} must fall back to the documented default`).toBe(documentedDefault);
    }
  }

  for (const input of rangeInputs) {
    assertUsable(resolve(input), input);
  }

  if (documentedDefault !== undefined) {
    assertUsable(documentedDefault, 'documentedDefault');
    // A string-valued resolver must receive the default as the string an
    // environment variable would actually carry.
    const defaultProbe = stringInputsOnly ? String(documentedDefault) : documentedDefault;
    expect(resolve(defaultProbe), `${label}: the documented default must survive its own resolver`).toBe(documentedDefault);
  }
}

/**
 * Pin a bounded numeric that is allowed to be legitimately zero (a disabled
 * quota). Kept separate so a caller cannot accidentally relax the positive
 * requirement by passing a flag it does not need.
 */
export function expectFailClosedZeroableBound(
  label: string,
  resolve: (raw: unknown) => number,
  options: Omit<FailClosedBoundOptions, 'zeroIsValid'> = {},
): void {
  expectFailClosedBound(label, resolve, { ...options, zeroIsValid: true });
}

function describe(input: unknown): string {
  if (typeof input === 'string') return JSON.stringify(input);
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  if (typeof input === 'number') return String(input);
  if (Array.isArray(input)) return '[]';
  return '{}';
}
