import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ClassificationProvider, Env } from '../types';
import { classifyAndCreateEvent } from '../cron';
import { LLMClassifier } from '../classifier/llm';
import { hmacSha256Hex, isAllowedCommunityOrigin, isCommunityAdminRequest } from '../community/security';
import { Repository } from '../db/repository';
import { GambitRepository } from '../open-gambit/repository';
import { appendResolution } from '../open-gambit/resolution';
import { publishApprovedGambit, runGambitDiscovery } from '../open-gambit/service';
import { GambitProviderError, providerForRole, type GambitProviderDiagnostic, getGambitModelRoleConfig } from '../open-gambit/llm';
import { gambitTranslationValidationErrors, translationRequest } from '../open-gambit/publication';
import { createConfiguredProviders, dispatchQualifiedGambit, workflowIdForCandidate } from '../open-gambit/workflow';
import {
  GAMBIT_APPROVAL_ACTIONS,
  GAMBIT_RESOLUTION_STATES,
  type GambitApprovalAction,
  type GambitLLMProvider,
  type GambitLLMRequest,
  type GambitResolutionInput,
  type GambitResolutionState,
} from '../open-gambit/types';

const openGambitApi = new Hono<{ Bindings: Env }>();

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `gambit-${Date.now().toString(36)}`;
  }
}

function adminToken(env: Env): string | null {
  return env.GAMBIT_ADMIN_TOKEN?.trim() || null;
}

function errorResponse(c: { json: (data: unknown, status?: number) => Response }, status: number, code: string, message: string, id: string): Response {
  const response = c.json({ error: code, message, requestId: id }, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const id = requestId();
  const token = adminToken(c.env as Env);
  if (!isAllowedCommunityOrigin(c.req.raw, c.env.SITE_URL || 'https://tibo.modelyard.dev')) {
    return errorResponse(c, 403, 'ORIGIN_NOT_ALLOWED', 'This operator endpoint is not available from this origin.', id);
  }
  if (!await isCommunityAdminRequest(c.req.raw, token)) {
    return errorResponse(c, 401, 'UNAUTHORIZED', 'Administrator authentication is required.', id);
  }
  c.header('Cache-Control', 'no-store');
  return null;
}

openGambitApi.get('/articles', async (c) => {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? Number(rawLimit) : 10;
  if (!Number.isInteger(limit) || limit < 1) return c.json({ error: 'limit must be a positive integer' }, 400);
  try {
    const articles = await new GambitRepository(c.env.DB).listPublished(Math.min(50, limit));
    return c.json({ data: articles, total: articles.length });
  } catch (error) {
    console.error('[Open Gambit] public_articles_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return c.json({ error: 'Open Gambit is not available yet.', data: [], total: 0 }, 503);
  }
});

openGambitApi.get('/articles/:slug', async (c) => {
  const slug = c.req.param('slug').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/u.test(slug)) return c.json({ error: 'Invalid article slug' }, 400);
  try {
    const article = await new GambitRepository(c.env.DB).getArticleBySlug(slug);
    if (!article || article.status !== 'PUBLISHED' || article.politicalTopic) return c.json({ error: 'Article not found' }, 404);
    return c.json({ data: article });
  } catch (error) {
    console.error('[Open Gambit] public_article_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return c.json({ error: 'Open Gambit is not available yet.' }, 503);
  }
});

/**
 * Replay one already-ingested authoritative monitor post through the normal
 * classifier/event path. This is intentionally narrow and authenticated so
 * an operator can reconcile a missed historical post without broad
 * rediscovery or direct SQL event insertion.
 */
openGambitApi.post('/replay/source/:sourcePostId', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const sourcePostId = c.req.param('sourcePostId').trim();
  if (!/^\d{5,30}$/u.test(sourcePostId)) {
    return errorResponse(c, 400, 'INVALID_SOURCE_POST_ID', 'Invalid X source post id.', id);
  }
  try {
    const repository = new Repository(c.env.DB);
    const post = await repository.getSourcePostBySourceId('x_api', sourcePostId);
    if (!post) return errorResponse(c, 404, 'SOURCE_POST_NOT_FOUND', 'Source post not found.', id);
    if (post.canonical_platform !== 'x' || post.source_quality === 'INDEXED' || post.verification_status === 'INDEXED_ONLY') {
      return errorResponse(c, 409, 'SOURCE_POST_NOT_AUTHORITATIVE', 'Only an authoritative X source post can be replayed.', id);
    }
    const result = await classifyAndCreateEvent(repository, replayClassifier(c.env), post);
    const classification = result.outcome.status === 'SUCCESS'
      ? {
        label: result.outcome.result.category,
        relevant: result.outcome.result.relevant,
        productScope: result.outcome.result.product_scope,
        statementNature: result.outcome.result.statement_nature,
        confidence: result.outcome.result.confidence,
      }
      : { label: 'ERROR', relevant: false, productScope: null, statementNature: null, confidence: null };
    return c.json({
      data: {
        sourcePostId,
        sourceRowId: post.id,
        created: result.created,
        classification,
        status: result.outcome.status,
      },
      requestId: id,
    }, result.outcome.status === 'SUCCESS' ? 200 : 503);
  } catch (error) {
    console.error('[Open Gambit] source_replay_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'SOURCE_REPLAY_FAILED', 'The source post replay failed safely.', id);
  }
});

function replayClassifier(env: Env): ClassificationProvider {
  if (env.LLM_API_KEY?.trim()) return new LLMClassifier(env);
  // Staging deliberately has no legacy monitor LLM credential. Keep this
  // replay-only fallback bounded and conservative: contextual deterministic
  // reset rules may still admit a trusted strong reset, while ordinary posts
  // remain non-events without sharing Gambit's separate credential namespace.
  return {
    classify: async () => ({
      status: 'SUCCESS' as const,
      result: {
        relevant: false,
        category: 'IRRELEVANT' as const,
        product_scope: 'OTHER' as const,
        statement_nature: 'FACT' as const,
        confidence: 0,
        title_en: '',
        title_zh: '',
        summary_en: '',
        summary_zh: '',
        effective_time: null,
        reset_time: null,
        reason: 'Replay-only conservative fallback; no classifier credential is configured.',
      },
    }),
  };
}

openGambitApi.get('/review', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    return c.json({ data: await new GambitRepository(c.env.DB).listReviewQueue(50) });
  } catch {
    return errorResponse(c, 503, 'REVIEW_UNAVAILABLE', 'Review data is not available yet.', requestId());
  }
});

openGambitApi.post('/discovery/run', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const parsedBody = await boundedJsonBody(c, 8_000, id, 'Please submit a valid discovery request.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const windowKey = typeof body.windowKey === 'string' && /^[A-Za-z0-9:_-]{1,80}$/u.test(body.windowKey) ? body.windowKey : undefined;
  try {
    const result = await runGambitDiscovery(c.env, {
      windowKey,
      startWorkflows: body.startWorkflows !== false,
    });
    return c.json({ data: result, requestId: id }, 200);
  } catch (error) {
    console.error('[Open Gambit] discovery_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'DISCOVERY_FAILED', 'The bounded discovery run failed safely.', id);
  }
});

/**
 * Bounded staging-only provider probe. It exercises the same configured
 * compatible endpoint with a minimal request, a triage-shaped request, and
 * the exact translation request for one supplied TEST_ONLY article. Only
 * transport metadata is returned; prompts, responses, and credentials never
 * leave the Worker.
 */
openGambitApi.post('/provider-diagnostic', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  if (c.env.BUILD_ENVIRONMENT !== 'staging') return errorResponse(c, 404, 'NOT_AVAILABLE', 'This diagnostic is staging-only.', id);
  const parsedBody = await boundedJsonBody(c, 4_000, id, 'Please submit a valid provider diagnostic request.');
  if (parsedBody instanceof Response) return parsedBody;
  const articleId = positiveInteger(String(parsedBody.articleId ?? ''));
  if (!articleId) return errorResponse(c, 400, 'INVALID_ARTICLE_ID', 'A staging article id is required.', id);
  const transport = parsedBody.transport === 'workflow' ? 'workflow' : 'worker';
  const diagnosticLocale = ['zh', 'ja', 'fr', 'es'].includes(String(parsedBody.locale))
    ? String(parsedBody.locale) as 'zh' | 'ja' | 'fr' | 'es'
    : 'ja';
  // Staging-only model override for the bounded capability benchmark. The
  // value is an actual runtime model identifier and never a public AI
  // identity; it only affects the provider built for this probe.
  const diagnosticModelId = typeof parsedBody.modelId === 'string' && /^[A-Za-z0-9._-]{1,80}$/u.test(parsedBody.modelId)
    ? parsedBody.modelId
    : undefined;
  // Staging-only prose sampling for the fixed TEST_ONLY fixture so the audit
  // can evaluate native editorial quality. Never enabled outside staging.
  const includeProse = c.env.BUILD_ENVIRONMENT === 'staging' && parsedBody.prose === true;
  const diagnosticTranslationTimeoutMs = boundedDiagnosticNumber(parsedBody.translationTimeoutMs, 60_000, 5_000, 60_000);
  const diagnosticTranslationRetryLimit = boundedDiagnosticNumber(parsedBody.translationRetryLimit, 0, 0, 1);
  const diagnosticTranslationTokenBudget = boundedDiagnosticNumber(parsedBody.translationTokenBudget, 2_000, 400, 5_000);
  try {
    const repository = new GambitRepository(c.env.DB);
    const article = await repository.getArticleById(articleId);
    if (!article) return errorResponse(c, 404, 'ARTICLE_NOT_FOUND', 'The staging article was not found.', id);
    const roles = getGambitModelRoleConfig(c.env);
    const translationRole = roles.find(role => role.role === 'translation');
    const translationProbeRole = translationRole
      ? {
        ...translationRole,
        ...(diagnosticModelId ? { runtimeModelId: diagnosticModelId } : {}),
        timeoutMs: diagnosticTranslationTimeoutMs,
        retryLimit: diagnosticTranslationRetryLimit,
        tokenBudget: diagnosticTranslationTokenBudget,
      }
      : undefined;
    const translationProbeRequest = {
      ...translationRequest(article, diagnosticLocale, translationProbeRole),
    };
    if (Object.prototype.hasOwnProperty.call(parsedBody, 'translationStream')) {
      translationProbeRequest.stream = parsedBody.translationStream !== false;
    }
    if (parsedBody.translationFixture === 'minimal') {
      translationProbeRequest.user = JSON.stringify({
        locale: 'ja',
        sourceIds: ['staging-diagnostic-source'],
        evidenceIds: [1],
        headline: 'An SDK adds a compatibility API',
        surfaceEvent: 'An official release adds a bounded developer API.',
        facts: ['The release adds a compatibility API.'],
        obviousLogic: 'The API lowers integration friction.',
        thesis: 'A compatibility layer can influence developer defaults.',
        mechanism: 'Lower switching costs make adoption easier.',
        beneficiaries: ['Developers'],
        pressuredActors: ['Incumbent platforms'],
        countercase: 'Adoption may remain limited.',
        trajectories: [{
          id: 'diagnostic-trajectory',
          predictionStatement: 'The API will receive a documented integration by the deadline.',
          targetEntity: 'The compatibility API',
          probability: 70,
          deadline: '2026-12-31',
          reasoning: 'The interface is available to developers.',
          evidenceCriteria: 'An official integration is documented.',
          falsifier: 'No integration is documented by the deadline.',
          status: 'WATCHING',
        }],
        falsifier: 'No integration is documented by the deadline.',
        uncertainty: 'Adoption remains uncertain.',
      });
    }
    if (parsedBody.translationFixture === 'tiny') {
      translationProbeRequest.user = JSON.stringify({ locale: 'ja', headline: 'An API update', facts: ['The release adds an API.'] });
    }
    const triageRole = roles.find(role => role.role === 'triage');
    const diagnostics: GambitProviderDiagnostic[] = [];
    const workflowFetch: typeof fetch = (input, init) => globalThis.fetch(input, init ? { ...init, signal: undefined } : init);
    const providers = createConfiguredProviders(c.env, transport === 'workflow' ? workflowFetch : undefined, diagnostic => diagnostics.push(diagnostic));
    // When a benchmark model override is present, build a dedicated probe
    // provider for the translation request so the same contract is exercised
    // against the candidate model without touching the configured role.
    const translationProbeProvider = diagnosticModelId && translationProbeRole
      ? providerForRole(translationProbeRole, c.env, transport === 'workflow' ? workflowFetch : undefined, diagnostic => diagnostics.push(diagnostic))
      : providers.translation;
    const provider = translationProbeProvider ?? providers.translation ?? providers.triage;
    if (!provider) return errorResponse(c, 503, 'PROVIDER_UNAVAILABLE', 'No staged Gambit provider is configured.', id);

    const probes: Array<{ name: string; request: GambitLLMRequest }> = [
      {
        name: 'minimal_structured',
        request: {
          role: 'provider_diagnostic',
          schemaName: 'ProviderDiagnosticV1',
          system: 'Return exactly one JSON object with the boolean field ok set to true.',
          user: '{"ok":true}',
          tokenBudget: 64,
          timeoutMs: 8_000,
          retryLimit: 0,
        },
      },
      {
        name: 'triage_shaped',
        request: {
          role: 'triage',
          schemaName: 'GambitTriageV1',
          system: 'Return one JSON object with eventImportance, aiTechRelevance, political, evidenceSufficient, strategicMechanism, shouldDeepAnalysisRun, and reason. The supplied item is a non-political official SDK release.',
          user: JSON.stringify({
            headline: 'Official SDK adds a bounded file-download API',
            summary: 'The release adds a developer-facing API capability and a dated version identifier.',
            evidence: 'Primary release notes from the official repository. No political or government subject is present.',
          }),
          tokenBudget: triageRole?.tokenBudget ?? 900,
          timeoutMs: triageRole?.timeoutMs ?? 8_000,
          retryLimit: 0,
        },
      },
      {
        name: 'translation_shaped',
        request: translationProbeRequest,
      },
    ];
    const results = [];
    for (const probe of probes) {
      results.push(await runProviderDiagnosticProbe(
        probe.name === 'translation_shaped' ? (translationProbeProvider ?? provider) : provider,
        probe.name,
        probe.request,
        diagnostics,
        probe.name === 'translation_shaped' ? value => gambitTranslationValidationErrors(value, diagnosticLocale, article) : undefined,
        includeProse,
      ));
    }
    return c.json({
      data: {
        articleId,
        transport,
        locale: diagnosticLocale,
        provider: provider.name,
        modelId: translationProbeRole?.runtimeModelId ?? translationRole?.runtimeModelId ?? triageRole?.runtimeModelId ?? null,
        probes: results,
        diagnostics: diagnostics.map(safeProviderDiagnostic),
      },
      requestId: id,
    }, 200);
  } catch (error) {
    console.error('[Open Gambit] provider_diagnostic_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'PROVIDER_DIAGNOSTIC_FAILED', 'The bounded provider diagnostic failed safely.', id);
  }
});

openGambitApi.post('/candidates/:id/workflow', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const parsedBody = await boundedJsonBody(c, 8_000, id, 'Please submit a valid workflow request.');
  if (parsedBody instanceof Response) return parsedBody;
  const candidateId = positiveInteger(c.req.param('id'));
  if (!candidateId) return errorResponse(c, 400, 'INVALID_CANDIDATE_ID', 'Invalid candidate id.', id);
  try {
    const repository = new GambitRepository(c.env.DB);
    const candidate = await repository.getCandidate(candidateId);
    if (!candidate) return errorResponse(c, 404, 'CANDIDATE_NOT_FOUND', 'Candidate not found.', id);
    if (candidate.status !== 'QUALIFIED') return errorResponse(c, 409, 'CANDIDATE_NOT_QUALIFIED', 'Only a qualified candidate can start analysis.', id);
    const result = await dispatchQualifiedGambit({ workflowId: workflowIdForCandidate(candidateId), candidateId, snapshotIds: candidate.snapshotIds }, c.env, {
      repository,
      binding: c.env.GAMBIT_ANALYSIS_WORKFLOW as unknown as import('../open-gambit/workflow').WorkflowBindingLike | undefined,
      providers: createConfiguredProviders(c.env),
    });
    return c.json({ data: result, requestId: id }, 202);
  } catch (error) {
    console.error('[Open Gambit] workflow_dispatch_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'WORKFLOW_DISPATCH_FAILED', 'The analysis workflow could not be started.', id);
  }
});

openGambitApi.post('/review/:revisionId', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const revisionId = positiveInteger(c.req.param('revisionId'));
  if (!revisionId) return errorResponse(c, 400, 'INVALID_REVISION_ID', 'Invalid revision id.', id);
  const parsedBody = await boundedJsonBody(c, 16_000, id, 'Please submit a valid review action.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!GAMBIT_APPROVAL_ACTIONS.includes(action as GambitApprovalAction)) return errorResponse(c, 400, 'INVALID_ACTION', 'Action must be APPROVE, REJECT, or RETURN_FOR_REANALYSIS.', id);
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '');
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) return errorResponse(c, 400, 'IDEMPOTENCY_REQUIRED', 'Provide a bounded Idempotency-Key.', id);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  try {
    const token = adminToken(c.env)!;
    const adminSubjectHash = await hmacSha256Hex(token, 'open-gambit-admin');
    const repository = new GambitRepository(c.env.DB);
    const approval = await repository.approveRevision({
      revisionId,
      action: action as GambitApprovalAction,
      adminSubjectHash,
      idempotencyKey,
      staleAcknowledged: body.staleAcknowledged === true,
      note,
    });
    const publication = approval.approved && !approval.idempotent
      ? await publishApprovedGambit(c.env, approval.articleId, approval.revisionId, { repository, translationProvider: createConfiguredProviders(c.env).translation })
      : null;
    return c.json({ data: { approval, publication }, requestId: id }, 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'STALE_REVISION') return errorResponse(c, 409, 'STALE_REVISION', 'A newer draft revision exists; acknowledge it explicitly before approving.', id);
    if (code === 'REVISION_NOT_FOUND' || code === 'ARTICLE_NOT_FOUND') return errorResponse(c, 404, 'REVISION_NOT_FOUND', 'Draft revision not found.', id);
    console.error('[Open Gambit] review_failed', { requestId: id, error: code.slice(0, 160) || 'unknown' });
    return errorResponse(c, 500, 'REVIEW_FAILED', 'The review action failed safely.', id);
  }
});

openGambitApi.post('/predictions/:id/resolve', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const predictionId = positiveInteger(c.req.param('id'));
  if (!predictionId) return errorResponse(c, 400, 'INVALID_PREDICTION_ID', 'Invalid prediction id.', id);
  const parsedBody = await boundedJsonBody(c, 12_000, id, 'Please submit a valid resolution event.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const state = typeof body.state === 'string' ? body.state.toUpperCase() : '';
  const evaluatorResult = typeof body.evaluatorResult === 'string' ? body.evaluatorResult.toUpperCase() : 'HUMAN_REVIEW';
  const reviewState = typeof body.reviewState === 'string' ? body.reviewState.toUpperCase() : 'APPROVED';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim().slice(0, 2_000) : '';
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((value): value is number => Number.isInteger(value) && value > 0).slice(0, 20) : [];
  if (!GAMBIT_RESOLUTION_STATES.includes(state as GambitResolutionState) || !explanation) return errorResponse(c, 400, 'INVALID_RESOLUTION', 'A valid state and explanation are required.', id);
  if (!['DETERMINISTIC', 'PRIMARY_SOURCE', 'SECONDARY_CORROBORATION', 'LLM_INTERPRETATION', 'HUMAN_REVIEW'].includes(evaluatorResult)) return errorResponse(c, 400, 'INVALID_EVALUATOR', 'Unknown evaluator result.', id);
  if (!['NOT_REQUIRED', 'WAITING_FOR_REVIEW', 'APPROVED'].includes(reviewState)) return errorResponse(c, 400, 'INVALID_REVIEW_STATE', 'Unknown review state.', id);
  try {
    const event = await appendResolution(new GambitRepository(c.env.DB), predictionId, {
      state: state as GambitResolutionState,
      evaluatorResult: evaluatorResult as GambitResolutionInput['evaluatorResult'],
      reviewState: reviewState as GambitResolutionInput['reviewState'],
      explanation,
      evidenceIds,
      supersededReason: typeof body.supersededReason === 'string' ? body.supersededReason.trim().slice(0, 500) : null,
    });
    return c.json({ data: event, requestId: id }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SUPERSEDED_REQUIRES_REASON_EVIDENCE_AND_APPROVAL') return errorResponse(c, 400, 'SUPERSEDED_REQUIRES_REVIEW', 'SUPERSEDED requires evidence, an explanation, and approved human review.', id);
    console.error('[Open Gambit] resolution_failed', { requestId: id, error: code.slice(0, 160) || 'unknown' });
    return errorResponse(c, 500, 'RESOLUTION_FAILED', 'The append-only resolution event could not be recorded.', id);
  }
});

openGambitApi.post('/articles/:id/corrections', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const request = requestId();
  const articleId = positiveInteger(c.req.param('id'));
  if (!articleId) return errorResponse(c, 400, 'INVALID_ARTICLE_ID', 'Invalid article id.', request);
  const parsedBody = await boundedJsonBody(c, 12_000, request, 'Please submit a valid correction.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const correctionType = typeof body.correctionType === 'string' ? body.correctionType.toUpperCase() : '';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim().slice(0, 2_000) : '';
  const predictionId = positiveInteger(String(body.predictionId ?? ''));
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((value): value is number => Number.isInteger(value) && value > 0).slice(0, 20) : [];
  if (!['CORRECTION', 'RETRACTION', 'SUPERSESSION'].includes(correctionType) || explanation.length < 3 || evidenceIds.length === 0) {
    return errorResponse(c, 400, 'INVALID_CORRECTION', 'A valid correction type, explanation, and evidence are required.', request);
  }
  try {
    const id = await new GambitRepository(c.env.DB).addCorrection({
      articleId,
      predictionId,
      correctionType: correctionType as 'CORRECTION' | 'RETRACTION' | 'SUPERSESSION',
      explanation,
      evidenceIds,
    });
    return c.json({ data: { id, idempotent: id === 0 }, requestId: request }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'CORRECTION_REQUIRES_EVIDENCE') return errorResponse(c, 400, 'CORRECTION_REQUIRES_EVIDENCE', 'A correction must cite evidence.', request);
    console.error('[Open Gambit] correction_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'CORRECTION_FAILED', 'The append-only correction could not be recorded.', request);
  }
});

async function runProviderDiagnosticProbe(
  provider: GambitLLMProvider,
  name: string,
  request: GambitLLMRequest,
  diagnostics: GambitProviderDiagnostic[],
  validate?: (value: unknown) => string[],
  includeProse?: boolean,
): Promise<Record<string, unknown>> {
  const before = diagnostics.length;
  const started = Date.now();
  try {
    const response = await provider.complete<unknown>(request);
    return {
      name,
      ok: true,
      structuredJson: Boolean(response.value && typeof response.value === 'object' && !Array.isArray(response.value)),
      provider: response.provider,
      modelId: response.modelId,
      latencyMs: response.latencyMs ?? Date.now() - started,
      inputTokens: response.inputTokens ?? null,
      outputTokens: response.outputTokens ?? null,
      validationErrors: validate ? validate(response.value) : undefined,
      // Staging-only prose sampling for the fixed TEST_ONLY fixture. The
      // diagnostic remains silent on production and never returns prompts,
      // credentials, or any non-fixture article body.
      prose: includeProse ? diagnosticProseSample(response.value) : undefined,
      jsonShape: safeJsonShape(response.value),
      request: diagnosticRequestSummary(request),
      diagnostics: diagnostics.slice(before).map(safeProviderDiagnostic),
    };
  } catch (error) {
    return {
      name,
      ok: false,
      errorCode: error instanceof GambitProviderError ? error.code : 'provider_error',
      latencyMs: Date.now() - started,
      request: diagnosticRequestSummary(request),
      diagnostics: diagnostics.slice(before).map(safeProviderDiagnostic),
    };
  }
}

function diagnosticProseSample(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sample: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string') sample[key] = entry.slice(0, 1_200);
    else if (Array.isArray(entry) && entry.every(item => typeof item === 'string')) sample[key] = entry.map(item => item.slice(0, 300)).slice(0, 8);
    else if (Array.isArray(entry) && entry.every(item => item && typeof item === 'object')) {
      sample[key] = entry.map(item => {
        const nested = item as Record<string, unknown>;
        return Object.fromEntries(Object.entries(nested)
          .filter(([, nestedValue]) => typeof nestedValue === 'string')
          .map(([nestedKey, nestedValue]) => [nestedKey, String(nestedValue).slice(0, 300)]));
      }).slice(0, 3);
    }
  }
  return Object.keys(sample).length > 0 ? sample : null;
}

function diagnosticRequestSummary(request: GambitLLMRequest): Record<string, unknown> {
  return {
    role: request.role,
    schemaName: request.schemaName,
    tokenBudget: request.tokenBudget,
    timeoutMs: request.timeoutMs,
    retryLimit: request.retryLimit,
    systemBytes: utf8Bytes(request.system),
    userBytes: utf8Bytes(request.user),
    requestBytes: utf8Bytes(JSON.stringify({
      model: 'redacted',
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: request.tokenBudget,
      stream: request.stream !== false,
      ...(request.stream === false ? {} : { stream_options: { include_usage: true } }),
    })),
  };
}

function safeJsonShape(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: Array.isArray(value) ? 'array' : typeof value };
  const record = value as Record<string, unknown>;
  const nested = Object.fromEntries(Object.entries(record)
    .filter(([, entry]) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .slice(0, 6)
    .map(([key, entry]) => [key, Object.keys(entry as Record<string, unknown>).slice(0, 24)]));
  return { type: 'object', keys: Object.keys(record).slice(0, 32), nested };
}

function safeProviderDiagnostic(diagnostic: GambitProviderDiagnostic): Record<string, unknown> {
  return {
    phase: diagnostic.phase,
    endpointHost: diagnostic.endpointHost,
    role: diagnostic.role,
    provider: diagnostic.provider,
    modelId: diagnostic.modelId,
    attempt: diagnostic.attempt,
    latencyMs: diagnostic.latencyMs,
    status: diagnostic.status ?? null,
    errorCode: diagnostic.errorCode ?? null,
    retryable: diagnostic.retryable,
    startedAt: diagnostic.startedAt,
    responseReceived: diagnostic.responseReceived,
    timeoutMs: diagnostic.timeoutMs,
    requestBytes: diagnostic.requestBytes,
    systemBytes: diagnostic.systemBytes,
    userBytes: diagnostic.userBytes,
    schemaBytes: diagnostic.schemaBytes,
    stream: diagnostic.stream,
    contentType: diagnostic.contentType ?? null,
    errorClass: diagnostic.errorClass ?? null,
    responseBytes: diagnostic.responseBytes ?? null,
    streamChunks: diagnostic.streamChunks ?? null,
    contentBytes: diagnostic.contentBytes ?? null,
    bodyReadCompleted: diagnostic.bodyReadCompleted ?? null,
    structuredJsonComplete: diagnostic.structuredJsonComplete ?? null,
    contentShape: diagnostic.contentShape ?? null,
  };
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedDiagnosticNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function boundedJsonBody(
  c: Context<{ Bindings: Env }>,
  maxBytes: number,
  requestIdValue: string,
  invalidMessage: string,
): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(c.req.header('content-length') || '');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.', requestIdValue);
  const stream = c.req.raw.body;
  if (!stream) return {};
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.', requestIdValue);
      }
      chunks.push(part.value);
    }
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', invalidMessage, requestIdValue);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', invalidMessage, requestIdValue);
  }
}

export default openGambitApi;
