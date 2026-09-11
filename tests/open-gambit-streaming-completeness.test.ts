import { describe, expect, it } from 'vitest';
import { OpenAICompatibleGambitProvider, type GambitProviderDiagnostic } from '../src/open-gambit/llm';

/**
 * Open Gambit — N3 regression: silent truncation of streamed structured responses.
 *
 * Found live on 2026-09-11 while verifying the Phase 1 fixes. The streaming
 * reader stopped as soon as the accumulated content could be turned into a valid
 * object by CLOSING its missing delimiters, so a response that was still
 * arriving was accepted as complete:
 *
 *   mid-stream: {"eventImportance":0.6,"aiTechRelevance":true,"political":{...}}
 *                -> unbalanced, repaired by appending "}", accepted as COMPLETE
 *                -> reader stops, remaining fields never arrive
 *
 * The triage stage requires seven fields. The live gateway streamed the first
 * two, and `normalizeTriage` maps a missing `shouldDeepAnalysisRun` to false, so
 * `triageAllowsDeepAnalysis()` rejected every candidate before analysis -- with
 * HTTP 200, valid JSON, no error diagnostic, and a SUCCESS attempt row. The same
 * request with `stream: false` returned all seven fields and passed.
 *
 * The delimiter-repair tolerance is still correct for a response the provider
 * genuinely finished; it must simply never be the early-stop condition.
 */

/** Build an SSE stream whose chunks are delivered one read() at a time. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const payload = JSON.stringify({ choices: [{ delta: { content: chunks[index] } }] });
      index += 1;
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    },
  });
}

function providerFor(body: ReadableStream<Uint8Array>, diagnostics: GambitProviderDiagnostic[] = []) {
  return new OpenAICompatibleGambitProvider({
    apiKey: 'TEST_ONLY_KEY',
    baseUrl: 'https://llm.example/v1',
    modelId: 'TEST_ONLY_MODEL',
    fetchImpl: (async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
  });
}

const REQUEST = {
  role: 'triage',
  system: 'TEST_ONLY system',
  user: 'TEST_ONLY user',
  schemaName: 'GambitTriageV1',
  tokenBudget: 900,
  timeoutMs: 5_000,
  retryLimit: 0,
} as const;

/** A seven-field triage object, split so an early prefix looks repairable. */
const FULL_TRIAGE = JSON.stringify({
  eventImportance: 0.6,
  aiTechRelevance: true,
  political: { excluded: false, reasons: [], confidence: null },
  evidenceSufficient: true,
  strategicMechanism: 'Platform expansion of AI-powered security tooling via new API endpoints.',
  shouldDeepAnalysisRun: true,
  reason: 'A concrete public preview feature release for an AI-driven security tool on a major developer platform.',
});

function splitIntoTailChunks(value: string, firstChunkChars: number): string[] {
  const head = value.slice(0, firstChunkChars);
  const tail = value.slice(firstChunkChars);
  const chunks = [head];
  for (let index = 0; index < tail.length; index += 40) chunks.push(tail.slice(index, index + 40));
  return chunks;
}

describe('Open Gambit streaming structured response completeness (N3)', () => {
  it('reads past a repairable prefix until the object is genuinely complete', async () => {
    // The first chunk ends just after the nested `political` object, which is
    // exactly the shape that used to be closed by repair and accepted.
    const firstChunk = FULL_TRIAGE.slice(0, FULL_TRIAGE.indexOf('"evidenceSufficient"'));
    expect(firstChunk).toContain('"political"');
    expect(firstChunk).not.toContain('shouldDeepAnalysisRun');

    const provider = providerFor(sseStream(splitIntoTailChunks(FULL_TRIAGE, firstChunk.length)));
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });

    expect(Object.keys(result.value)).toEqual([
      'eventImportance', 'aiTechRelevance', 'political', 'evidenceSufficient',
      'strategicMechanism', 'shouldDeepAnalysisRun', 'reason',
    ]);
    expect(result.value.shouldDeepAnalysisRun).toBe(true);
    // The pre-fix behaviour: only the first two fields survived.
    expect(result.value.eventImportance).toBe(0.6);
  });

  it('never stops while the top-level object is still open', async () => {
    // One character per read, so every intermediate prefix is unbalanced. The
    // provider must return the complete object regardless of chunking.
    const chunks = [...FULL_TRIAGE];
    const provider = providerFor(sseStream(chunks));
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });
    expect(Object.keys(result.value)).toHaveLength(7);
  });

  it('still repairs a response the provider genuinely truncated', async () => {
    // The tolerance is preserved for a finished-but-truncated response: the
    // stream ENDS mid-object, so the final extraction path may close delimiters.
    const truncated = FULL_TRIAGE.slice(0, FULL_TRIAGE.indexOf('"shouldDeepAnalysisRun"')).replace(/,\s*$/u, '');
    const provider = providerFor(sseStream([truncated]));
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });
    expect(result.value.evidenceSufficient).toBe(true);
    expect(result.value.shouldDeepAnalysisRun).toBeUndefined();
  });

  it('does not treat a nested object as the whole response', async () => {
    // Content that BALANCES early and then continues must not be accepted early:
    // the balanced object has to consume the entire content.
    const nestedFirst = `{"political":{"excluded":false},${FULL_TRIAGE.slice(1)}`;
    const provider = providerFor(sseStream(splitIntoTailChunks(nestedFirst, 24)));
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });
    expect(result.value.shouldDeepAnalysisRun).toBe(true);
  });

  it('reads a markdown-wrapped stream to the end and still extracts the object', async () => {
    const wrapped = `Here is the result:\n\`\`\`json\n${FULL_TRIAGE}\n\`\`\``;
    const provider = providerFor(sseStream(splitIntoTailChunks(wrapped, 30)));
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });
    expect(result.value.shouldDeepAnalysisRun).toBe(true);
  });

  it('reports completion only for a fully received object', async () => {
    const diagnostics: GambitProviderDiagnostic[] = [];
    const provider = providerFor(sseStream(splitIntoTailChunks(FULL_TRIAGE, 30)), diagnostics);
    await provider.complete({ ...REQUEST });
    const request = diagnostics.find(diagnostic => diagnostic.phase === 'REQUEST');
    expect(request?.stream).toBe(true);
  });

  it('keeps the non-streaming path unchanged', async () => {
    const provider = new OpenAICompatibleGambitProvider({
      apiKey: 'TEST_ONLY_KEY',
      baseUrl: 'https://llm.example/v1',
      modelId: 'TEST_ONLY_MODEL',
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: FULL_TRIAGE } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
    });
    const result = await provider.complete<Record<string, unknown>>({ ...REQUEST });
    expect(Object.keys(result.value)).toHaveLength(7);
  });
});
