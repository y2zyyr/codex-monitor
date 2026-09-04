import type { Env } from '../types';
import { canonicalJson, sha256Hex } from './canonical';
import type {
  GambitLLMProvider,
  GambitLLMRequest,
  GambitLLMResponse,
  GambitModelRoleConfig,
  GambitPublicAiIdentity,
} from './types';
import { GAMBIT_PUBLIC_AI_IDENTITIES } from './types';

export const GAMBIT_PROMPT_VERSION = 'gambit-prompts-v1';
/** Compatibility export; these are presentation identities, not model IDs. */
export const GAMBIT_PUBLIC_MODEL_NAMES = GAMBIT_PUBLIC_AI_IDENTITIES;

const DEFAULT_ROLE_CONFIG: Array<GambitModelRoleConfig> = [
  { role: 'triage', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 8_000, retryLimit: 1, tokenBudget: 900 },
  { role: 'fact_extraction', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 8_000, retryLimit: 1, tokenBudget: 1_200 },
  { role: 'gambit_analysis', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 18_000, retryLimit: 1, tokenBudget: 2_400 },
  { role: 'critic', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'Claude Fable 5', timeoutMs: 18_000, retryLimit: 1, tokenBudget: 1_800 },
  { role: 'trajectory', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 14_000, retryLimit: 1, tokenBudget: 1_600 },
  { role: 'translation', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 12_000, retryLimit: 1, tokenBudget: 1_600 },
  { role: 'resolution', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'Claude Fable 5', timeoutMs: 12_000, retryLimit: 1, tokenBudget: 1_200 },
];

export function getGambitModelRoleConfig(env: Pick<Env, 'GAMBIT_MODEL_ROLES_JSON' | 'GAMBIT_LLM_MODEL' | 'GAMBIT_LLM_PROVIDER'>): GambitModelRoleConfig[] {
  // Gambit must not silently spend the existing Tibo monitor's provider
  // quota. Runtime provider/model values come only from the Gambit namespace;
  // public AI identities never participate in routing.
  const fallbackModelId = env.GAMBIT_LLM_MODEL?.trim() || null;
  const fallbackProvider = boundedLabel(env.GAMBIT_LLM_PROVIDER, 'configured-compatible');
  const defaults = DEFAULT_ROLE_CONFIG.map(role => ({ ...role, runtimeProvider: fallbackProvider, runtimeModelId: fallbackModelId }));
  const raw = env.GAMBIT_MODEL_ROLES_JSON?.trim();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    const overrides = parsed as Record<string, unknown>;
    return defaults.map(role => {
      const value = overrides[role.role];
      if (!value || typeof value !== 'object') return role;
      const record = value as Record<string, unknown>;
      const runtimeProvider = boundedLabel(record.runtimeProvider ?? record.provider, role.runtimeProvider);
      const publicAiIdentity = publicIdentity(record.publicAiIdentity ?? record.displayName, role.publicAiIdentity);
      return {
        ...role,
        runtimeProvider,
        publicAiIdentity,
        runtimeModelId: typeof (record.runtimeModelId ?? record.modelId) === 'string' && String(record.runtimeModelId ?? record.modelId).trim()
          ? String(record.runtimeModelId ?? record.modelId).trim() : role.runtimeModelId,
        timeoutMs: boundedNumber(record.timeoutMs, role.timeoutMs, 500, 30_000),
        retryLimit: boundedNumber(record.retryLimit, role.retryLimit, 0, 2),
        tokenBudget: boundedNumber(record.tokenBudget, role.tokenBudget, 100, 8_000),
        fallbackRole: typeof record.fallbackRole === 'string' ? record.fallbackRole.trim() : role.fallbackRole,
      };
    });
  } catch {
    return defaults;
  }
}

export interface GambitProviderOptions {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  providerName?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleGambitProvider implements GambitLLMProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GambitProviderOptions) {
    this.name = options.providerName || 'compatible-llm';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete<T>(request: GambitLLMRequest): Promise<GambitLLMResponse<T>> {
    const endpoint = `${this.options.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
    const maxAttempts = Math.min(3, Math.max(1, request.retryLimit + 1));
    const requestHash = await sha256Hex(canonicalJson({ role: request.role, system: request.system, user: request.user, schemaName: request.schemaName }));
    let lastError = 'provider_error';
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
      const started = Date.now();
      try {
        const response = await this.fetchImpl(endpoint, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
            'X-Tibo-Gambit-Request': requestHash.slice(0, 16),
          },
          body: JSON.stringify({
            model: this.options.modelId,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: request.tokenBudget,
          }),
        });
        if (!response.ok) {
          lastError = `http_${response.status}`;
          // 4xx validation/authentication errors are not made better by retry.
          if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
          await boundedBackoff(attempt);
          continue;
        }
        const data = await response.json() as {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastError = 'empty_response';
          await boundedBackoff(attempt);
          continue;
        }
        let value: T;
        try {
          value = JSON.parse(content) as T;
        } catch {
          lastError = 'invalid_structured_json';
          // Malformed strategic output is not retried indefinitely.
          if (attempt + 1 >= maxAttempts) break;
          await boundedBackoff(attempt);
          continue;
        }
        return {
          value,
          provider: this.name,
          modelId: this.options.modelId,
          inputTokens: finiteOptional(data.usage?.prompt_tokens),
          outputTokens: finiteOptional(data.usage?.completion_tokens),
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        lastError = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error';
        if (attempt + 1 < maxAttempts) await boundedBackoff(attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new GambitProviderError(lastError);
  }
}

export class GambitProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'GambitProviderError';
    this.code = code;
  }
}

export type MockGambitHandler = <T>(request: GambitLLMRequest) => Promise<GambitLLMResponse<T>> | GambitLLMResponse<T>;

export class MockGambitProvider implements GambitLLMProvider {
  readonly name = 'mock';
  readonly requests: GambitLLMRequest[] = [];

  constructor(private readonly handler: MockGambitHandler) {}

  async complete<T>(request: GambitLLMRequest): Promise<GambitLLMResponse<T>> {
    this.requests.push(request);
    return this.handler<T>(request);
  }
}

export function providerForRole(
  role: GambitModelRoleConfig,
  env: Pick<Env, 'GAMBIT_LLM_API_KEY' | 'GAMBIT_LLM_BASE_URL'>,
  fetchImpl?: typeof fetch,
): GambitLLMProvider | null {
  const key = env.GAMBIT_LLM_API_KEY?.trim();
  const modelId = role.runtimeModelId?.trim();
  if (!key || !modelId || role.runtimeProvider === 'mock') return null;
  return new OpenAICompatibleGambitProvider({
    apiKey: key,
    modelId,
    baseUrl: env.GAMBIT_LLM_BASE_URL?.trim() || 'https://api.openai.com/v1',
    providerName: role.runtimeProvider,
    fetchImpl,
  });
}

function publicIdentity(value: unknown, fallback: GambitPublicAiIdentity): GambitPublicAiIdentity {
  return typeof value === 'string' && (GAMBIT_PUBLIC_AI_IDENTITIES as readonly string[]).includes(value)
    ? value as GambitPublicAiIdentity
    : fallback;
}

function boundedLabel(value: unknown, fallback: string): string {
  const label = typeof value === 'string' ? value.trim().replace(/[\r\n]/gu, '') : '';
  return label ? label.slice(0, 80) : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function finiteOptional(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

async function boundedBackoff(attempt: number): Promise<void> {
  const delayMs = Math.min(800, 100 * 2 ** attempt);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
