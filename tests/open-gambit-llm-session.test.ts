import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GAMBIT_DEFAULT_LLM_SESSION_ID,
  OpenAICompatibleGambitProvider,
  providerForRole,
  type GambitProviderDiagnostic,
} from '../src/open-gambit/llm';

/**
 * Open Gambit — T1 regression: the `x-opencode-session` gateway header.
 *
 * The configured gateway (`opencode.ai/zen/go/v1`) rejects a completion that
 * has no `x-opencode-session` header with HTTP 400 `MissingSessionID`, before
 * any model work happens:
 *
 *   {"type":"MissingSessionID","message":"Error from provider (Console Go):
 *    Request is missing x-opencode-session and cannot be routed efficiently."}
 *
 * Because the deterministic admission gate admitted zero candidates, no real
 * run ever reached this call, so the fault stayed dormant. These tests pin the
 * header, the 400 classification and the non-retryable budget behaviour so the
 * defect cannot silently return once admission is repaired.
 */

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(
  handler: (attempt: number) => { status: number; body: string },
  captured: CapturedRequest[],
): typeof fetch {
  let attempt = 0;
  return (async (input: unknown, init?: RequestInit) => {
    attempt += 1;
    captured.push({
      url: String(input),
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const { status, body } = handler(attempt);
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

function makeProvider(
  fetchImpl: typeof fetch,
  diagnostics: GambitProviderDiagnostic[] = [],
  sessionId?: string,
): OpenAICompatibleGambitProvider {
  return new OpenAICompatibleGambitProvider({
    apiKey: 'TEST_ONLY_KEY',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    modelId: 'mimo-v2.5',
    providerName: 'opencode-go',
    sessionId,
    fetchImpl,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
  });
}

const COMPLETION = JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] });

/**
 * The EXACT live 400 body captured from `POST https://opencode.ai/zen/go/v1/chat/completions`
 * without the header (Phase 0 / T1 verification, 2026-09-11). The generic outer
 * `type:"error"` must never win over the specific inner `error.type`, otherwise
 * the annotation degrades to a useless `ERROR`.
 */
const REAL_MISSING_SESSION_BODY = JSON.stringify({
  type: 'error',
  error: {
    type: 'MissingSessionID',
    message: 'Error from provider (Console Go): Request is missing x-opencode-session and cannot be routed efficiently. Please see https://opencode.ai/docs/go/#where-can-i-use-it',
  },
});

const REQUEST = {
  role: 'triage',
  system: 'TEST_ONLY system',
  user: 'TEST_ONLY user',
  schemaName: 'GambitTriageV1',
  tokenBudget: 900,
  timeoutMs: 5_000,
  retryLimit: 1,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Open Gambit provider gateway session header', () => {
  it('sends a stable x-opencode-session header on every completion request', async () => {
    const captured: CapturedRequest[] = [];
    const provider = makeProvider(makeFetch(() => ({ status: 200, body: COMPLETION }), captured));

    const result = await provider.complete<{ ok: boolean }>({ ...REQUEST });

    expect(result.value).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers['x-opencode-session']).toBe(GAMBIT_DEFAULT_LLM_SESSION_ID);
    // The header is an operations label, never a credential.
    expect(captured[0]!.headers['x-opencode-session']).not.toContain('TEST_ONLY_KEY');
    expect(captured[0]!.headers.Authorization).toBe('Bearer TEST_ONLY_KEY');
  });

  it('bounds the session label to a single line and honours an explicit override', async () => {
    const captured: CapturedRequest[] = [];
    const provider = makeProvider(makeFetch(() => ({ status: 200, body: COMPLETION }), captured), [], 'gambit-open-gambit-staging\nspoofed: 1');
    await provider.complete({ ...REQUEST });
    expect(captured[0]!.headers['x-opencode-session']).toBe('gambit-open-gambit-stagingspoofed: 1');
    expect(captured[0]!.headers['x-opencode-session']).not.toContain('\n');
  });

  it('annotates a MissingSessionID rejection and keeps HTTP 400 non-retryable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const captured: CapturedRequest[] = [];
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = makeProvider(
      makeFetch(() => ({ status: 400, body: REAL_MISSING_SESSION_BODY }), captured),
      diagnostics,
    );

    await expect(provider.complete({ ...REQUEST })).rejects.toMatchObject({ code: 'http_400_missing_session_id' });

    // The request that was actually sent still carried the header, so the
    // rejection can only come from a routing/session fault, not a missing header.
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers['x-opencode-session']).toBe(GAMBIT_DEFAULT_LLM_SESSION_ID);

    const httpDiagnostic = diagnostics.find(diagnostic => diagnostic.phase === 'HTTP');
    expect(httpDiagnostic).toMatchObject({
      status: 400,
      errorCode: 'http_400',
      providerErrorCode: 'MISSING_SESSION_ID',
      retryable: false,
      attempt: 1,
    });
    // No second attempt: a deterministic client error must not burn budget.
    expect(captured).toHaveLength(1);
    // The operator-visible annotation names the missing header explicitly.
    expect(warn).toHaveBeenCalledWith(
      '[Open Gambit] provider_missing_session_header',
      expect.objectContaining({ header: 'x-opencode-session', status: 400, role: 'triage' }),
    );
    // The provider's human-readable message never leaves the client.
    expect(JSON.stringify(diagnostics)).not.toContain('cannot be routed efficiently');
    expect(JSON.stringify(diagnostics)).not.toContain('opencode.ai/docs/go');
  });

  it('recognises the flat error envelope shape as well as the nested one', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = makeProvider(
      makeFetch(() => ({ status: 400, body: JSON.stringify({ type: 'MissingSessionID', message: 'TEST_ONLY' }) }), []),
      diagnostics,
    );
    await expect(provider.complete({ ...REQUEST })).rejects.toMatchObject({ code: 'http_400_missing_session_id' });
    expect(diagnostics.find(diagnostic => diagnostic.phase === 'HTTP')?.providerErrorCode).toBe('MISSING_SESSION_ID');
    expect(warn).toHaveBeenCalled();
  });

  it('does not treat a generic placeholder error type as a diagnostic code', async () => {
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = makeProvider(
      makeFetch(() => ({ status: 400, body: JSON.stringify({ type: 'error', message: 'TEST_ONLY' }) }), []),
      diagnostics,
    );
    await expect(provider.complete({ ...REQUEST })).rejects.toMatchObject({ code: 'http_400' });
    expect(diagnostics.find(diagnostic => diagnostic.phase === 'HTTP')?.providerErrorCode).toBeUndefined();
  });

  it('classifies any other 400 as a plain non-retryable http_400 without leaking the provider message', async () => {
    const diagnostics: GambitProviderDiagnostic[] = [];
    const captured: CapturedRequest[] = [];
    const provider = makeProvider(
      makeFetch(() => ({
        status: 400,
        body: JSON.stringify({ error: { code: 'invalid_request_error', message: 'TEST_ONLY_UPSTREAM_SECRET_TEXT' } }),
      }), captured),
      diagnostics,
    );

    await expect(provider.complete({ ...REQUEST })).rejects.toMatchObject({ code: 'http_400' });
    const httpDiagnostic = diagnostics.find(diagnostic => diagnostic.phase === 'HTTP');
    expect(httpDiagnostic).toMatchObject({ errorCode: 'http_400', providerErrorCode: 'INVALID_REQUEST_ERROR', retryable: false });
    expect(JSON.stringify(diagnostics)).not.toContain('TEST_ONLY_UPSTREAM_SECRET_TEXT');
    expect(captured).toHaveLength(1);
  });

  it('keeps 429 retryable and re-sends the session header on the retry', async () => {
    const captured: CapturedRequest[] = [];
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = makeProvider(
      makeFetch(attempt => (attempt === 1 ? { status: 429, body: JSON.stringify({ type: 'rate_limit_exceeded' }) } : { status: 200, body: COMPLETION }), captured),
      diagnostics,
    );

    const result = await provider.complete<{ ok: boolean }>({ ...REQUEST });
    expect(result.value).toEqual({ ok: true });
    expect(captured).toHaveLength(2);
    expect(captured.every(request => request.headers['x-opencode-session'] === GAMBIT_DEFAULT_LLM_SESSION_ID)).toBe(true);
    expect(diagnostics.some(diagnostic => diagnostic.status === 429 && diagnostic.retryable)).toBe(true);
  });

  it('survives a non-JSON error body without inventing a provider error code', async () => {
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = makeProvider(makeFetch(() => ({ status: 400, body: 'not json at all' }), []), diagnostics);
    await expect(provider.complete({ ...REQUEST })).rejects.toMatchObject({ code: 'http_400' });
    const httpDiagnostic = diagnostics.find(diagnostic => diagnostic.phase === 'HTTP');
    expect(httpDiagnostic?.errorCode).toBe('http_400');
    expect(httpDiagnostic?.providerErrorCode).toBeUndefined();
  });

  it('resolves the session label from the environment, defaulting to the fixed operations identifier', async () => {
    const role = {
      role: 'triage',
      runtimeProvider: 'opencode-go',
      runtimeModelId: 'mimo-v2.5',
      publicAiIdentity: 'DeepSeek V4 Pro' as const,
      timeoutMs: 8_000,
      retryLimit: 1,
      tokenBudget: 900,
    };
    const captured: CapturedRequest[] = [];
    const overridden = providerForRole(
      role,
      { GAMBIT_LLM_API_KEY: 'TEST_ONLY_KEY', GAMBIT_LLM_BASE_URL: 'https://opencode.ai/zen/go/v1', GAMBIT_LLM_SESSION_ID: 'gambit-open-gambit-staging' },
      makeFetch(() => ({ status: 200, body: COMPLETION }), captured),
    );
    const fallback = providerForRole(
      role,
      { GAMBIT_LLM_API_KEY: 'TEST_ONLY_KEY', GAMBIT_LLM_BASE_URL: 'https://opencode.ai/zen/go/v1' },
      makeFetch(() => ({ status: 200, body: COMPLETION }), captured),
    );
    expect(overridden).not.toBeNull();
    expect(fallback).not.toBeNull();

    await overridden!.complete({ ...REQUEST });
    await fallback!.complete({ ...REQUEST });

    expect(captured).toHaveLength(2);
    expect(captured[0]!.headers['x-opencode-session']).toBe('gambit-open-gambit-staging');
    // An unset variable must never reproduce the missing-session rejection.
    expect(captured[1]!.headers['x-opencode-session']).toBe(GAMBIT_DEFAULT_LLM_SESSION_ID);
  });
});
