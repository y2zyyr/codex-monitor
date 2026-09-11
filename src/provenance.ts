import { AI_OPERATION_DISCLOSURE_VERSION } from './open-gambit/disclosure';
// Family marker for the per-role prompt revision scheme. Per-role versions
// (revision + prompt-text fingerprint) are recorded per LLM attempt and on each
// draft; see `open-gambit/prompts.ts`.
import { GAMBIT_PROMPT_VERSION } from './open-gambit/prompts';

export const GAMBIT_SCHEMA_VERSION = '0021_open_gambit';

export interface BuildProvenance {
  service: 'tibo-codex-monitor';
  environment: string;
  buildVersion: string;
  commitSha: string | null;
  generatedAt: string;
  schemaVersion: string;
  gambitPromptVersion: string;
  aiDisclosureVersion: string;
}

export interface ProvenanceEnvironment {
  BUILD_ENVIRONMENT?: string;
  BUILD_VERSION?: string;
  BUILD_SHA?: string;
  BUILD_TIMESTAMP?: string;
  GAMBIT_CONFIG_VERSION?: string;
}

/**
 * Returns release metadata without inspecting or serializing any credential.
 * CI/build tooling can provide the BUILD_* values; local development gets a
 * deterministic schema/prompt/disclosure fingerprint instead.
 */
export function buildProvenance(env: ProvenanceEnvironment, now = new Date()): BuildProvenance {
  return {
    service: 'tibo-codex-monitor',
    environment: boundedValue(env.BUILD_ENVIRONMENT, 'local', 40),
    buildVersion: boundedValue(env.BUILD_VERSION, '0.1.0', 80),
    commitSha: boundedSha(env.BUILD_SHA),
    generatedAt: boundedIso(env.BUILD_TIMESTAMP, now),
    schemaVersion: boundedValue(env.GAMBIT_CONFIG_VERSION, GAMBIT_SCHEMA_VERSION, 80),
    gambitPromptVersion: GAMBIT_PROMPT_VERSION,
    aiDisclosureVersion: AI_OPERATION_DISCLOSURE_VERSION,
  };
}

function boundedValue(value: string | undefined, fallback: string, maxLength: number): string {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function boundedSha(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^[a-f0-9]{7,64}$/iu.test(normalized) ? normalized.slice(0, 64) : null;
}

function boundedIso(value: string | undefined, fallback: Date): string {
  if (value) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return fallback.toISOString();
}
