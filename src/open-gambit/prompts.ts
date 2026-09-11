import { sha256Hex } from './canonical';

/**
 * Open Gambit prompt provenance (T5).
 *
 * DEFECT THIS REPLACES: one constant, `gambit-prompts-v2`, was recorded as
 * `promptVersion` for every LLM call and stamped onto every published draft,
 * while the triage, analysis, critic and translation prompts are four DIFFERENT
 * texts. The Phase 0 audit confirmed the `v2` bump was carried by a triage-only
 * text change, so a stored `gambit-prompts-v2` could not be resolved to the
 * prompt text that actually produced an article -- publication provenance was
 * not auditable.
 *
 * FIX: each role has its own revision, and the recorded version is the revision
 * PLUS a short fingerprint of the exact system text that ran:
 *
 *     gambit-analysis-v1@1a2b3c4d
 *     └── human-bumped revision    └── machine truth about the text
 *
 * The fingerprint is derived from the prompt string itself, so it cannot drift:
 * a text edit that forgets to bump the revision is still visible in every new
 * attempt row rather than silently masquerading as the reviewed revision. The
 * accompanying test freezes revision -> fingerprint for the current texts so a
 * text change must be an explicit, reviewed commit.
 */

export const GAMBIT_PROMPT_ROLES = ['triage', 'gambit_analysis', 'critic', 'translation'] as const;
export type GambitPromptRole = typeof GAMBIT_PROMPT_ROLES[number];

/**
 * Per-role prompt revisions. Bump the entry for a role whenever that role's
 * prompt text changes, and update the frozen fingerprint table in
 * `tests/open-gambit-prompt-provenance.test.ts` in the same commit.
 *
 * These are the first per-role revisions. Rows written before Phase 1 recorded
 * the ambiguous family version `gambit-prompts-v2` for all four roles and
 * cannot be resolved to an exact text; they are historical and are not
 * rewritten (Gambit history is append-only).
 */
export const GAMBIT_PROMPT_REVISIONS: Record<GambitPromptRole, string> = {
  triage: 'gambit-triage-v1',
  gambit_analysis: 'gambit-analysis-v1',
  critic: 'gambit-critic-v1',
  translation: 'gambit-translation-v1',
};

/**
 * Family marker for the per-role revision scheme. This is the value that may
 * appear in release/health provenance where a single string is required; it
 * describes the SCHEME, not a prompt text, and must never be used to claim which
 * prompt text ran. Use `gambitPromptVersion()` for that.
 */
export const GAMBIT_PROMPT_VERSION = 'gambit-prompts-per-role-v1';

/** The pre-Phase-1 family version, kept only so old rows stay explainable. */
export const GAMBIT_LEGACY_PROMPT_VERSION = 'gambit-prompts-v2';

/** Bound so a provenance field can never carry an unbounded prompt. */
const MAX_PROMPT_VERSION_LENGTH = 96;

/**
 * `gambit-analysis-v1@1a2b3c4d` for the exact `system` text supplied.
 * Pass the same string that is sent to the provider: the fingerprint is only
 * meaningful if it is computed from the text that actually ran.
 */
export async function gambitPromptVersion(role: GambitPromptRole, system: string): Promise<string> {
  const revision = GAMBIT_PROMPT_REVISIONS[role];
  const fingerprint = (await sha256Hex(system)).slice(0, 8);
  return `${revision}@${fingerprint}`.slice(0, MAX_PROMPT_VERSION_LENGTH);
}

/** Narrow an arbitrary role string to a prompt role without fabricating one. */
export function isGambitPromptRole(value: string): value is GambitPromptRole {
  return (GAMBIT_PROMPT_ROLES as readonly string[]).includes(value);
}

/** Parse a recorded version back into its revision and fingerprint. */
export function parseGambitPromptVersion(value: string): { revision: string; fingerprint: string | null } {
  const separator = value.lastIndexOf('@');
  if (separator <= 0) return { revision: value, fingerprint: null };
  const fingerprint = value.slice(separator + 1);
  return /^[a-f0-9]{8}$/u.test(fingerprint)
    ? { revision: value.slice(0, separator), fingerprint }
    : { revision: value, fingerprint: null };
}
