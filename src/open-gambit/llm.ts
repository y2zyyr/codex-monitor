import type { Env } from '../types';
import { boundedCompletionOptions } from '../utils/llm-request';
import { canonicalJson, sha256Hex } from './canonical';
import type {
  GambitLLMProvider,
  GambitLLMRequest,
  GambitLLMResponse,
  GambitModelRoleConfig,
  GambitPublicAiIdentity,
} from './types';
import { GAMBIT_PUBLIC_AI_IDENTITIES } from './types';

/**
 * Prompt provenance now lives in `prompts.ts`, where each role has its own
 * revision bound to a fingerprint of its exact prompt text. Previously a single
 * `gambit-prompts-v2` constant covered four different prompt texts, so a stored
 * version could not identify the text that produced a published article.
 * Re-exported here only so existing importers of this module keep working; new
 * code should import from `./prompts`.
 */
export { GAMBIT_PROMPT_VERSION, GAMBIT_PROMPT_REVISIONS, GAMBIT_LEGACY_PROMPT_VERSION, gambitPromptVersion, parseGambitPromptVersion } from './prompts';
export type { GambitPromptRole } from './prompts';

/** Compatibility export; these are presentation identities, not model IDs. */
export const GAMBIT_PUBLIC_MODEL_NAMES = GAMBIT_PUBLIC_AI_IDENTITIES;

/**
 * Stable operational session label sent as `x-opencode-session`.
 *
 * The configured gateway (`opencode.ai/zen/go`) rejects a completion without
 * this header with HTTP 400 `MissingSessionID` -- "Request is missing
 * x-opencode-session and cannot be routed efficiently." The value is an
 * operations/routing label, never a credential: it carries no part of the API
 * key, is not a per-request secret, and is safe to record in diagnostics.
 *
 * A single fixed identifier is deliberate. Per-run random values would defeat
 * the gateway's routing affinity and make one production deployment
 * indistinguishable from another in gateway-side logs. Deployments that share
 * a gateway account can disambiguate themselves with `GAMBIT_LLM_SESSION_ID`
 * (for example staging), which is why the header is configurable.
 */
export const GAMBIT_DEFAULT_LLM_SESSION_ID = 'gambit-open-gambit';

/**
 * Normalised provider error code meaning "the request never reached a model
 * because the gateway could not route it". Recorded as its own bounded code so
 * this failure is never reported as a generic `http_400`.
 */
export const GAMBIT_MISSING_SESSION_CODE = 'MISSING_SESSION_ID';

/**
 * Documented default transport retry bound, shared by every role below.
 * See `boundedAttemptCount()` for why an absent per-request value must resolve to
 * this number rather than to zero attempts.
 */
const DEFAULT_ROLE_RETRY_LIMIT = 1;

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
  /**
   * Stable operational session label for the `x-opencode-session` header.
   * Defaults to `GAMBIT_DEFAULT_LLM_SESSION_ID`.
   */
  sessionId?: string;
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
  /**
   * Bounded provider-issued machine-readable error code (for example
   * `MISSING_SESSION_ID`), extracted from the error envelope's `type`/`code`
   * field only. Never the provider's human-readable message, a prompt, or a
   * response body.
   */
  providerErrorCode?: string;
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
  private readonly sessionId: string;

  constructor(private readonly options: GambitProviderOptions) {
    this.name = options.providerName || 'compatible-llm';
    this.sessionId = boundedSessionId(options.sessionId) ?? GAMBIT_DEFAULT_LLM_SESSION_ID;
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
    //
    // `retryLimit` must be normalised before it reaches the loop below.
    // `Math.min(2, Math.max(1, undefined + 1))` is NaN, and `for (attempt = 0;
    // attempt < NaN; ...)` never runs its body -- and the body is the ONLY place
    // that emits diagnostics and calls fetch. An omitted `retryLimit` therefore
    // performed ZERO network calls, emitted ZERO diagnostics, and surfaced as a
    // bare `provider_error`, which reads as a provider fault rather than as a
    // missing field. This is the same fail-open class as the budget namespace
    // defect fixed in Phase 1: an absent bound must degrade to the documented
    // default (one retry), never to no attempt at all.
    const maxAttempts = boundedAttemptCount(request.retryLimit);
    const requestHash = await sha256Hex(canonicalJson({ role: request.role, system: request.system, user: request.user, schemaName: request.schemaName }));
    const stream = request.stream !== false;
    const requestPayload: Record<string, unknown> = {
      model: this.options.modelId,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
      // Native-language publication must be reproducible at the validation
      // boundary; keep the translation response deterministic while leaving
      // the broader analysis roles at the existing low temperature.
      temperature: request.role === 'translation' ? 0 : 0.1,
      max_tokens: request.tokenBudget,
      // The configured OpenAI-compatible gateway reliably returns SSE for
      // analysis roles; translation can opt into a normal JSON response when
      // a long streaming body is not terminated by the gateway.
      stream,
    };
    if (stream) requestPayload.stream_options = { include_usage: true };
    // TRANSLATION DISABLES REASONING ON DEEPSEEK (Phase 1.7, measured).
    //
    // Translation is prose rewriting, not judgement, so the reasoning channel
    // buys nothing -- but on a reasoning-emitting model it consumes the budget
    // BEFORE any content is emitted, which is the same failure class as N6:
    //
    //   budget 2,000 -> reasoning 1,736, content "" , finish_reason "stop"
    //                   (NOT "length", which is why it looked like a schema
    //                    problem) -> pipeline records `empty_response` and the
    //                   whole publication fails on EVERY locale.
    //   budget 6,000 -> reasoning still 1,310-3,878, leaving too little room for
    //                   the 12-key translation schema -> `invalid_structured_json`.
    //
    // Measured with reasoning disabled (same article, same prompts):
    //   completion 448-718 tokens (7-10x smaller), latency 2.3-4.2s
    //   (vs 9.2-21.4s), all 4 locales parsed with all 12 keys.
    //
    // `boundedCompletionOptions` is a NO-OP for any base URL that is not
    // `https://api.deepseek.com`, so this cannot affect another provider. It is
    // the same helper the Tibo classifier and Community translation already use
    // for exactly this reason. Analysis/critic/review roles keep their reasoning.
    if (request.role === 'translation') {
      Object.assign(requestPayload, boundedCompletionOptions(this.options.baseUrl));
    }
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
              // Required by the configured gateway: without it the request is
              // rejected with HTTP 400 MissingSessionID before any model work
              // happens. Unknown headers are ignored by plain OpenAI-compatible
              // endpoints, so this is safe for every configured provider.
              'x-opencode-session': this.sessionId,
              'X-Tibo-Gambit-Request': requestHash.slice(0, 16),
            },
            body: requestBody,
          }),
          timeoutPromise,
        ]);
        responseReceived = true;
        if (!response.ok) {
          lastError = `http_${response.status}`;
          const providerErrorCode = await providerErrorCodeFromResponse(response);
          // 4xx stays non-retryable: it is a deterministic client/provider
          // fault, and retrying it only burns budget. The one case that must
          // not disappear into a bare status code is a rejected gateway
          // session, because that is an operational configuration fault that
          // silently produces "zero publication". It is annotated here and
          // carried into the durable attempt code below.
          if (providerErrorCode === GAMBIT_MISSING_SESSION_CODE) {
            lastError = `http_${response.status}_missing_session_id`;
            console.warn('[Open Gambit] provider_missing_session_header', {
              endpointHost,
              role: request.role,
              status: response.status,
              header: 'x-opencode-session',
            });
          }
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
            errorCode: `http_${response.status}`,
            providerErrorCode,
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
      // Early stop requires a COMPLETE top-level object, not a repairable
      // prefix. See `structuredJsonFullyReceived`.
      if (structuredJsonFullyReceived(content)) {
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
  // Some compatible gateways emit cumulative message.content values rather than
  // delta fragments. A cumulative resend is strictly longer and starts with what
  // we already accumulated.
  //
  // The reverse comparison is deliberately NOT treated as cumulative. No gateway
  // moves backwards, while a short delta can legitimately coincide with the
  // opening characters of the accumulated content -- the nested `{` of a streamed
  // JSON object does exactly that -- and treating it as a resend silently dropped
  // the character, turning a valid response into `invalid_structured_json`.
  // Found by the N3 streaming regression test.
  if (incoming.length > existing.length && incoming.startsWith(existing)) return incoming;
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

/**
 * Whether a streamed response has FULLY delivered its top-level object.
 *
 * STRICT on purpose, and the difference from `structuredJsonComplete` is a real
 * production defect that was measured live on 2026-09-11:
 *
 * `structuredJsonComplete` tolerates a truncated object by closing its missing
 * delimiters (`repairTruncatedStructuredObject`). That tolerance is correct for
 * a response the provider actually finished -- a bounded provider can emit every
 * field and omit only the final braces -- but using it as the streaming EARLY-STOP
 * test made the reader stop at the first incomplete-but-repairable prefix. A
 * nested object plus a couple of scalar fields was enough to look "complete", so
 * every longer streaming response was silently truncated at that point, with
 * HTTP 200, a valid JSON body, and no error diagnostic.
 *
 * Measured effect: the triage stage requires seven fields; the live gateway
 * streamed the first two, the object was closed by repair, and the pipeline saw
 * `shouldDeepAnalysisRun: undefined` -- which `normalizeTriage` maps to false, so
 * `triageAllowsDeepAnalysis()` rejected every candidate before analysis. The same
 * request with `stream: false` returned all seven fields and passed the gate.
 *
 * Conditions: the content must begin with the object, the object must be
 * genuinely balanced, and it must consume the whole content. Content with a
 * markdown/prose wrapper simply reads to the end of the stream, where the
 * existing extraction and repair still apply.
 */
function structuredJsonFullyReceived(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  const end = balancedObjectEnd(trimmed, 0);
  if (end === null || end !== trimmed.length - 1) return false;
  try {
    const value = JSON.parse(trimmed) as unknown;
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
  env: Pick<Env, 'GAMBIT_LLM_API_KEY' | 'GAMBIT_LLM_BASE_URL'> & { GAMBIT_LLM_SESSION_ID?: string },
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
    sessionId: env.GAMBIT_LLM_SESSION_ID,
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

const PROVIDER_ERROR_BODY_BYTES = 2_048;
const PROVIDER_ERROR_BODY_TIMEOUT_MS = 1_000;

/**
 * Read only the machine-readable error code from a provider error envelope.
 *
 * The configured gateway answers a rejected request with a structured body
 * such as `{"type":"MissingSessionID","message":"..."}`. Only the structured
 * `type`/`code` fields are read, and only for the client-error statuses that
 * can mean a configuration fault. The human-readable message is never
 * captured, logged, persisted, or returned -- the returned value is a bounded
 * token, so no provider free text can travel further than this function.
 */
async function providerErrorCodeFromResponse(response: Response): Promise<string | undefined> {
  if (response.status !== 400 && response.status !== 401 && response.status !== 403) return undefined;
  let body: string;
  try {
    body = await boundedProviderErrorBody(response);
  } catch {
    return undefined;
  }
  if (!body) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    // A non-JSON error body carries no machine-readable code; the HTTP status
    // remains the only recorded classification.
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const envelope = parsed as Record<string, unknown>;
  const nested = envelope.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error)
    ? envelope.error as Record<string, unknown>
    : null;
  // Field order matters, and was verified against the live gateway: the real
  // 400 body is
  //   {"type":"error","error":{"type":"MissingSessionID","message":"..."}}
  // so the generic outer `type` must never win over the specific inner code.
  // Some gateways instead answer with a flat {"type":"MissingSessionID"}.
  for (const candidate of [nested?.type, nested?.code, envelope.type, envelope.code]) {
    const code = boundedProviderErrorCode(candidate);
    if (code && !GENERIC_PROVIDER_ERROR_CODES.has(code)) return code;
  }
  return undefined;
}

/** Placeholder codes that carry no diagnostic value on their own. */
const GENERIC_PROVIDER_ERROR_CODES = new Set(['ERROR', 'ERRORS', 'FAILURE', 'FAILED', 'UNKNOWN']);

/** Bounded, deadline-guarded read so a stalled gateway cannot extend a failure. */
async function boundedProviderErrorBody(response: Response): Promise<string> {
  const body = response.text();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string>(resolve => {
    timer = setTimeout(() => resolve(''), PROVIDER_ERROR_BODY_TIMEOUT_MS);
  });
  try {
    const text = await Promise.race([body, deadline]);
    return text.slice(0, PROVIDER_ERROR_BODY_BYTES);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** `MissingSessionID` -> `MISSING_SESSION_ID`; free text is rejected outright. */
function boundedProviderErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(trimmed)) return null;
  const normalized = trimmed
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase()
    .slice(0, 48);
  return normalized || null;
}

/** Operational session label: bounded, single-line, and never a credential. */
function boundedSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim().replace(/[\r\n]/gu, '');
  return label ? label.slice(0, 80) : null;
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

/**
 * Normalise the transport attempt budget, derived from a RETRY limit.
 *
 * Returns the total number of attempts, not the retry count: `retryLimit = 1`
 * means "one retry", which is TWO attempts. The distinction is load-bearing --
 * a bound that degrades by one silently removes the retry the role config asks
 * for, which is how an earlier revision of this fix broke the 429 retry path.
 *
 * The role configuration always supplies a bounded `retryLimit`, so this only
 * matters for callers that bypass `getGambitModelRoleConfig`: a JS caller, a
 * stale object literal, or a cast. Because `tsconfig` typechecks `src` only,
 * such a caller cannot be caught at compile time. An absent value resolves to
 * the documented default of one retry; it must never resolve to zero attempts,
 * which would make the whole request a silent no-op.
 */
function boundedAttemptCount(value: unknown): number {
  const retries = boundedNumber(value, DEFAULT_ROLE_RETRY_LIMIT, 0, 2);
  return Math.min(2, Math.max(1, retries + 1));
}

async function boundedBackoff(attempt: number): Promise<void> {
  const delayMs = Math.min(800, 100 * 2 ** attempt);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
