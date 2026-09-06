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

export const GAMBIT_PROMPT_VERSION = 'gambit-prompts-v2';
/** Compatibility export; these are presentation identities, not model IDs. */
export const GAMBIT_PUBLIC_MODEL_NAMES = GAMBIT_PUBLIC_AI_IDENTITIES;

const DEFAULT_ROLE_CONFIG: Array<GambitModelRoleConfig> = [
  { role: 'triage', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 8_000, retryLimit: 1, tokenBudget: 900 },
  { role: 'fact_extraction', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 8_000, retryLimit: 1, tokenBudget: 1_200 },
  { role: 'gambit_analysis', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 18_000, retryLimit: 1, tokenBudget: 2_400 },
  { role: 'critic', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'Claude Fable 5', timeoutMs: 18_000, retryLimit: 1, tokenBudget: 1_800 },
  { role: 'trajectory', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 14_000, retryLimit: 1, tokenBudget: 1_600 },
  // Translation responses contain multiple localized prose fields plus up to
  // three forecasts. The 2,000-token bound is the smallest measured bound
  // that completes the real staging fixture; the 60-second deadline is still
  // bounded and keeps the existing per-run token ceiling unchanged.
  { role: 'translation', runtimeProvider: 'configured-compatible', runtimeModelId: null, publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 60_000, retryLimit: 1, tokenBudget: 2_000 },
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
        timeoutMs: boundedNumber(record.timeoutMs, role.timeoutMs, 500, role.role === 'translation' ? 60_000 : 30_000),
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
  onDiagnostic?: (diagnostic: GambitProviderDiagnostic) => void;
}

export interface GambitProviderDiagnostic {
  phase: 'REQUEST' | 'HTTP' | 'PARSE' | 'SCHEMA' | 'TIMEOUT' | 'NETWORK';
  endpointHost: string;
  role: string;
  provider: string;
  modelId: string;
  attempt: number;
  latencyMs: number;
  status?: number;
  errorCode?: string;
  retryable: boolean;
  /** Privacy-safe request/transport metadata; never a prompt or response body. */
  startedAt: string;
  responseReceived: boolean;
  timeoutMs: number;
  requestBytes: number;
  systemBytes: number;
  userBytes: number;
  schemaBytes: number;
  stream: boolean;
  contentType?: string;
  errorClass?: string;
  responseBytes?: number;
  streamChunks?: number;
  contentBytes?: number;
  bodyReadCompleted?: boolean;
  structuredJsonComplete?: boolean;
  contentShape?: StructuredContentShape;
}

interface CompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
  }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

interface ParsedCompletion {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface ResponseReadMetrics {
  responseBytes: number;
  streamChunks: number;
  contentBytes: number;
  bodyReadCompleted: boolean;
  structuredJsonComplete: boolean;
  contentShape?: StructuredContentShape;
}

interface StructuredContentShape {
  firstToken: 'empty' | 'object_start' | 'array_start' | 'text';
  lastToken: 'empty' | 'object_end' | 'array_end' | 'text';
  jsonValueType: 'object' | 'array' | 'invalid' | 'empty';
  balancedObject: boolean;
  markdownFence: boolean;
  thinkingWrapper: boolean;
}

export class OpenAICompatibleGambitProvider implements GambitLLMProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GambitProviderOptions) {
    this.name = options.providerName || 'compatible-llm';
    // Cloudflare's global fetch is receiver-sensitive. Calling the bare
    // function later as `this.fetchImpl(...)` can fail before DNS/TLS, while
    // the Workflow wrapper's `globalThis.fetch(...)` succeeds. Bind only the
    // default global implementation; injected test/custom fetchers retain
    // their own calling convention.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async complete<T>(request: GambitLLMRequest): Promise<GambitLLMResponse<T>> {
    const endpoint = `${this.options.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
    const endpointHost = safeEndpointHost(endpoint);
    // A single bounded retry is enough for a transient transport failure.
    // Repeated retries amplify cost and can hide a deterministic provider
    // incompatibility behind an apparently flaky workflow.
    const maxAttempts = Math.min(2, Math.max(1, request.retryLimit + 1));
    const requestHash = await sha256Hex(canonicalJson({ role: request.role, system: request.system, user: request.user, schemaName: request.schemaName }));
    const stream = request.stream !== false;
    const requestPayload: Record<string, unknown> = {
      model: this.options.modelId,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: request.tokenBudget,
      // The configured OpenAI-compatible gateway reliably returns SSE for
      // analysis roles; translation can opt into a normal JSON response when
      // a long streaming body is not terminated by the gateway.
      stream,
    };
    if (stream) requestPayload.stream_options = { include_usage: true };
    const requestBody = JSON.stringify(requestPayload);
    const requestMetadata = requestDiagnosticMetadata(request, requestBody);
    let lastError = 'provider_error';
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const started = Date.now();
      const startedAt = new Date(started).toISOString();
      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let responseReceived = false;
      const responseMetrics: ResponseReadMetrics = {
        responseBytes: 0,
        streamChunks: 0,
        contentBytes: 0,
        bodyReadCompleted: false,
        structuredJsonComplete: false,
      };
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          const timeout = new Error('provider request timed out');
          timeout.name = 'TimeoutError';
          reject(timeout);
        }, Math.max(1, request.timeoutMs));
      });
      // If fetch fails before the deadline, the timeout promise remains
      // pending. Attach a quiet rejection handler so it cannot become an
      // unhandled rejection after the attempt has already finished.
      void timeoutPromise.catch(() => undefined);
      try {
        this.emitDiagnostic({
          phase: 'REQUEST',
          endpointHost,
          role: request.role,
          provider: this.name,
          modelId: this.options.modelId,
          attempt: attempt + 1,
          latencyMs: 0,
          retryable: false,
          startedAt,
          responseReceived: false,
          timeoutMs: request.timeoutMs,
          ...requestMetadata,
        });
        const response = await Promise.race([
          // The Cloudflare Worker runtime/provider combination rejects a
          // cross-runtime AbortSignal before DNS/TLS, while the same request
          // succeeds through the Workflow fetch wrapper that strips it. The
          // Promise deadline above is therefore the authoritative timeout;
          // the controller is still aborted for runtimes that honor it.
          this.fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.options.apiKey}`,
              'X-Tibo-Gambit-Request': requestHash.slice(0, 16),
            },
            body: requestBody,
          }),
          timeoutPromise,
        ]);
        responseReceived = true;
        if (!response.ok) {
          lastError = `http_${response.status}`;
          const retryable = response.status === 429 || response.status >= 500;
          this.emitDiagnostic({
            phase: 'HTTP',
            endpointHost,
            role: request.role,
            provider: this.name,
            modelId: this.options.modelId,
            attempt: attempt + 1,
            latencyMs: Date.now() - started,
            status: response.status,
            errorCode: lastError,
            retryable,
            startedAt,
            responseReceived,
            timeoutMs: request.timeoutMs,
            contentType: response.headers.get('content-type') ?? undefined,
            ...requestMetadata,
          });
          // 4xx validation/authentication errors are not made better by retry.
          if (!retryable || attempt + 1 >= maxAttempts) break;
          await boundedBackoff(attempt);
          continue;
        }
        const data = await Promise.race([parseCompletionResponse(response, responseMetrics), timeoutPromise]);
        const content = data.content;
        if (typeof content !== 'string' || !content.trim()) {
          lastError = 'empty_response';
          this.emitDiagnostic({
            phase: 'PARSE',
            endpointHost,
            role: request.role,
            provider: this.name,
            modelId: this.options.modelId,
            attempt: attempt + 1,
            latencyMs: Date.now() - started,
            errorCode: lastError,
            retryable: false,
            startedAt,
            responseReceived,
            timeoutMs: request.timeoutMs,
            contentType: response.headers.get('content-type') ?? undefined,
            ...responseMetrics,
            ...requestMetadata,
          });
          break;
        }
        let value: T;
        try {
          value = JSON.parse(content) as T;
        } catch {
          lastError = 'invalid_structured_json';
          this.emitDiagnostic({
            phase: 'SCHEMA',
            endpointHost,
            role: request.role,
            provider: this.name,
            modelId: this.options.modelId,
            attempt: attempt + 1,
            latencyMs: Date.now() - started,
            errorCode: lastError,
            retryable: false,
            startedAt,
            responseReceived,
            timeoutMs: request.timeoutMs,
            contentType: response.headers.get('content-type') ?? undefined,
            ...responseMetrics,
            ...requestMetadata,
          });
          break;
        }
        return {
          value,
          provider: this.name,
          modelId: this.options.modelId,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        if (isTimeoutError(error)) {
          lastError = 'timeout';
        } else if (responseReceived) {
          // Fetch completed but consuming the response body failed. This is a
          // different layer from DNS/TLS/connectivity and is useful when a
          // streaming gateway closes the body before a complete JSON object.
          lastError = 'stream_read_error';
        } else {
          lastError = 'network_error';
        }
        const phase = lastError === 'timeout' ? 'TIMEOUT' : lastError === 'stream_read_error' ? 'PARSE' : 'NETWORK';
        const retryable = ['timeout', 'stream_read_error', 'network_error'].includes(lastError) && attempt + 1 < maxAttempts;
        this.emitDiagnostic({
          phase,
          endpointHost,
          role: request.role,
          provider: this.name,
          modelId: this.options.modelId,
          attempt: attempt + 1,
          latencyMs: Date.now() - started,
          errorCode: lastError,
          retryable,
          startedAt,
          responseReceived,
          timeoutMs: request.timeoutMs,
          errorClass: lastError === 'stream_read_error' ? 'response_body_read' : lastError,
          ...responseMetrics,
          ...requestMetadata,
        });
        if (retryable) await boundedBackoff(attempt);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    }
    throw new GambitProviderError(lastError);
  }

  private emitDiagnostic(diagnostic: GambitProviderDiagnostic): void {
    try {
      this.options.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics must never change provider behavior.
    }
  }
}

async function parseCompletionResponse(response: Response, metrics: ResponseReadMetrics): Promise<ParsedCompletion> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/event-stream') && response.body) {
    return parseStreamingCompletion(response.body, metrics);
  }
  const body = await response.text();
  metrics.responseBytes = utf8Bytes(body);
  metrics.bodyReadCompleted = true;
  const parsed = parseCompletionBody(body);
  metrics.contentBytes = utf8Bytes(parsed.content);
  metrics.structuredJsonComplete = structuredJsonComplete(parsed.content);
  metrics.contentShape = safeStructuredContentShape(parsed.content);
  return parsed;
}

function parseCompletionBody(body: string): ParsedCompletion {
  try {
    return normalizeStructuredCompletion(completionFromPayload(JSON.parse(body) as CompletionPayload));
  } catch {
    // OpenAI-compatible streaming responses are newline-delimited SSE events.
    let content = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const line of body.split(/\r?\n/u)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = completionFromPayload(JSON.parse(payload) as CompletionPayload);
        content += parsed.content;
        inputTokens ??= parsed.inputTokens;
        outputTokens ??= parsed.outputTokens;
      } catch {
        // Ignore non-JSON SSE metadata and let the empty/invalid response
        // handling below fail closed if no usable content was delivered.
      }
    }
    return normalizeStructuredCompletion({ content, inputTokens, outputTokens });
  }
}

/**
 * Consume SSE incrementally and stop once a complete structured JSON object
 * has arrived. Some compatible gateways keep the connection open after the
 * JSON payload (or delay the final DONE/usage event), which previously made a
 * valid translation look like a network failure at the request deadline.
 */
async function parseStreamingCompletion(body: ReadableStream<Uint8Array>, metrics: ResponseReadMetrics): Promise<ParsedCompletion> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      metrics.streamChunks += 1;
      metrics.responseBytes += part.value.byteLength;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parseSseCompletionLine(line);
        if (!parsed) continue;
        content = mergeStreamContent(content, parsed.content);
        metrics.contentBytes = utf8Bytes(content);
        metrics.contentShape = safeStructuredContentShape(content);
        inputTokens ??= parsed.inputTokens;
        outputTokens ??= parsed.outputTokens;
      }
      if (structuredJsonComplete(content)) {
        metrics.structuredJsonComplete = true;
        return { content: extractStructuredJsonText(content) ?? content, inputTokens, outputTokens };
      }
    }
    metrics.bodyReadCompleted = true;
    buffer += decoder.decode();
    const parsed = parseSseCompletionLine(buffer);
    if (parsed) {
      content = mergeStreamContent(content, parsed.content);
      metrics.contentBytes = utf8Bytes(content);
      metrics.contentShape = safeStructuredContentShape(content);
      inputTokens ??= parsed.inputTokens;
      outputTokens ??= parsed.outputTokens;
    }
    metrics.structuredJsonComplete = structuredJsonComplete(content);
    metrics.contentShape = safeStructuredContentShape(content);
    return normalizeStructuredCompletion({ content, inputTokens, outputTokens });
  } finally {
    // We intentionally stop reading once the structured object is complete;
    // canceling the remaining stream prevents a gateway from holding the
    // Worker open just to send optional usage/DONE metadata.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseSseCompletionLine(line: string): ParsedCompletion | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    return completionFromPayload(JSON.parse(payload) as CompletionPayload);
  } catch {
    // Ignore non-JSON SSE metadata; the caller fails closed if no complete
    // structured object is ever delivered.
    return null;
  }
}

function mergeStreamContent(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  // Some compatible gateways emit cumulative message.content values rather
  // than delta fragments. Avoid duplicating those values into an invalid JSON
  // string while retaining normal OpenAI delta behavior.
  if (incoming === existing || incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return existing + incoming;
}

function structuredJsonComplete(content: string): boolean {
  const extracted = extractStructuredJsonText(content);
  if (!extracted) return false;
  try {
    const value = JSON.parse(extracted) as unknown;
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
  } catch {
    return false;
  }
}

function normalizeStructuredCompletion(completion: ParsedCompletion): ParsedCompletion {
  return {
    ...completion,
    content: extractStructuredJsonText(completion.content) ?? completion.content,
  };
}

/**
 * Gateways occasionally prepend a short markdown/explanatory wrapper around a
 * JSON-mode response. Extract only a balanced object, preserving the rest of
 * the provider response as an internal failure signal if no object exists.
 */
function extractStructuredJsonText(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return trimmed;
  } catch {
    // Continue with a balanced-object scan below.
  }
  let searchFrom = 0;
  while (searchFrom < trimmed.length) {
    const start = trimmed.indexOf('{', searchFrom);
    if (start < 0) return null;
    const end = balancedObjectEnd(trimmed, start);
    // Do not treat a nested object (for example a trajectory) as the whole
    // response while the outer translation object is still streaming.
    if (end === null) {
      // A bounded provider may emit every complete field and omit only the
      // final JSON delimiters at its output ceiling. Closing delimiters is a
      // safe local adapter operation; it never invents a field or text, and
      // the caller still performs the full semantic/schema validation.
      const repaired = repairTruncatedStructuredObject(trimmed, start);
      if (repaired) return repaired;
      return null;
    }
    const candidate = trimmed.slice(start, end + 1);
    try {
      const value = JSON.parse(candidate) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) return candidate;
    } catch {
      // Search for the next top-level-looking object only after this complete
      // balanced candidate has been rejected.
    }
    searchFrom = end + 1;
  }
  return null;
}

function repairTruncatedStructuredObject(value: string, start: number): string | null {
  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.at(-1) !== expected) return null;
      stack.pop();
    }
  }
  // Never close a string or repair a malformed/mismatched response.
  if (inString || stack.length === 0) return null;
  const suffix = stack.reverse().map(character => character === '{' ? '}' : ']').join('');
  const candidate = value.slice(start) + suffix;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? candidate : null;
  } catch {
    return null;
  }
}

function balancedObjectEnd(value: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function safeStructuredContentShape(content: string): StructuredContentShape {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      firstToken: 'empty',
      lastToken: 'empty',
      jsonValueType: 'empty',
      balancedObject: false,
      markdownFence: false,
      thinkingWrapper: false,
    };
  }
  let jsonValueType: StructuredContentShape['jsonValueType'] = 'invalid';
  try {
    const value = JSON.parse(trimmed) as unknown;
    jsonValueType = Array.isArray(value) ? 'array' : value && typeof value === 'object' ? 'object' : 'invalid';
  } catch {
    // The diagnostic deliberately reports only the value class, never content.
  }
  const firstCharacter = trimmed[0];
  const lastCharacter = trimmed[trimmed.length - 1];
  const firstToken: StructuredContentShape['firstToken'] = firstCharacter === '{'
    ? 'object_start' : firstCharacter === '[' ? 'array_start' : 'text';
  const lastToken: StructuredContentShape['lastToken'] = lastCharacter === '}'
    ? 'object_end' : lastCharacter === ']' ? 'array_end' : 'text';
  const objectStart = trimmed.indexOf('{');
  return {
    firstToken,
    lastToken,
    jsonValueType,
    balancedObject: objectStart >= 0 && (balancedObjectEnd(trimmed, objectStart) !== null || repairTruncatedStructuredObject(trimmed, objectStart) !== null),
    markdownFence: trimmed.includes('```'),
    thinkingWrapper: /<think(?:ing)?>/iu.test(trimmed),
  };
}

function completionFromPayload(payload: CompletionPayload): ParsedCompletion {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content;
  return {
    content: typeof content === 'string' ? content : '',
    inputTokens: finiteOptional(payload.usage?.prompt_tokens),
    outputTokens: finiteOptional(payload.usage?.completion_tokens),
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) return false;
  const name = String(error.name);
  return name === 'AbortError' || name === 'TimeoutError';
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
  onDiagnostic?: (diagnostic: GambitProviderDiagnostic) => void,
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
    onDiagnostic,
  });
}

function safeEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.slice(0, 120);
  } catch {
    return 'invalid-endpoint';
  }
}

function requestDiagnosticMetadata(request: GambitLLMRequest, requestBody: string): Pick<
  GambitProviderDiagnostic,
  'requestBytes' | 'systemBytes' | 'userBytes' | 'schemaBytes' | 'stream'
> {
  return {
    requestBytes: utf8Bytes(requestBody),
    systemBytes: utf8Bytes(request.system),
    userBytes: utf8Bytes(request.user),
    schemaBytes: utf8Bytes(JSON.stringify({ type: 'json_object', schemaName: request.schemaName })),
    stream: request.stream !== false,
  };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
