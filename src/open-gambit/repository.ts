import type { D1Database } from '@cloudflare/workers-types';
import { canonicalJson, safeJsonParse, sha256Hex } from './canonical';
import { GAMBIT_LOCALES } from './types';
import type {
  GambitApprovalAction,
  GambitArticleStatus,
  GambitCandidate,
  GambitCandidateStatus,
  GambitDiscoveryStats,
  GambitDraft,
  GambitEvidence,
  GambitLatestScan,
  GambitLLMResponse,
  GambitMetrics,
  GambitModelRoleProvenance,
  GambitPoliticalDecision,
  GambitPublicArticle,
  GambitPublicCorrection,
  GambitPublicResolutionEvent,
  GambitResolutionInput,
  GambitResolutionState,
  GambitSourceDefinition,
  GambitSourceSnapshot,
  GambitSourceTier,
  GambitTranslation,
  GambitTrajectory,
  GambitWorkflowResult,
} from './types';

type Row = Record<string, unknown>;

export interface GambitApprovalResult {
  approved: boolean;
  idempotent: boolean;
  stale: boolean;
  status: GambitArticleStatus;
  articleId: number;
  revisionId: number;
}

export interface GambitSnapshotInsertResult {
  id: number;
  isNew: boolean;
}

export interface GambitCandidateInsertResult {
  id: number;
  isNew: boolean;
}

export interface GambitRunRecord {
  id: number;
  runKey: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  isNew: boolean;
}

export interface GambitRevisionRecord {
  id: number;
  articleId: number;
  revisionNumber: number;
  draft: GambitDraft;
  status: string;
  contentHash: string;
}

export interface GambitDuePrediction {
  id: number;
  articleId: number;
  revisionId: number;
  trajectoryId: string;
  originalPredictionStatement: string;
  originalProbability: number;
  originalTarget: string;
  originalObservableCondition: string;
  originalDeadline: string;
  originalReasoning: string;
  originalFalsifier: string;
  originalPublicationTimestamp: string;
  originalModelPromptVersion: string;
  originalContentHash: string;
  latestState: GambitResolutionState;
}

export class GambitRepository {
  constructor(private readonly db: D1Database) {}

  async listSources(enabledOnly = true): Promise<GambitSourceDefinition[]> {
    const query = enabledOnly
      ? 'SELECT * FROM gambit_sources WHERE enabled = 1 ORDER BY id'
      : 'SELECT * FROM gambit_sources ORDER BY id';
    const { results } = await this.db.prepare(query).all<Row>();
    return results.map(mapSource);
  }

  async upsertSource(source: GambitSourceDefinition, now = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      INSERT INTO gambit_sources (id, name, source_type, url, publisher, quality_tier, allowed_hosts_json, enabled, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        source_type = excluded.source_type,
        url = excluded.url,
        publisher = excluded.publisher,
        quality_tier = excluded.quality_tier,
        allowed_hosts_json = excluded.allowed_hosts_json,
        enabled = excluded.enabled,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).bind(
      source.id,
      source.name,
      source.type,
      source.url,
      source.publisher,
      source.qualityTier,
      JSON.stringify(source.allowedHosts),
      source.enabled ? 1 : 0,
      source.notes ?? null,
      now,
      now,
    ).run();
  }

  async getSource(id: string): Promise<GambitSourceDefinition | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_sources WHERE id = ?').bind(id).first<Row>();
    return row ? mapSource(row) : null;
  }

  async insertSnapshot(snapshot: GambitSourceSnapshot, r2Key: string | null = null): Promise<GambitSnapshotInsertResult> {
    const createdAt = snapshot.createdAt ?? snapshot.retrievedAt;
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_source_snapshots (
        source_id, requested_url, final_url, canonical_url, title, publisher,
        published_at, retrieved_at, normalized_content, content_hash,
        extractor_version, source_quality_tier, r2_key, retention_until, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshot.sourceId,
      snapshot.requestedUrl,
      snapshot.finalUrl,
      snapshot.canonicalUrl,
      snapshot.title,
      snapshot.publisher,
      snapshot.publishedAt,
      snapshot.retrievedAt,
      snapshot.normalizedContent,
      snapshot.contentHash,
      snapshot.extractorVersion,
      snapshot.sourceQualityTier,
      r2Key ?? snapshot.r2Key ?? null,
      snapshot.retentionUntil ?? null,
      createdAt,
    ).run();
    const row = await this.db.prepare('SELECT * FROM gambit_source_snapshots WHERE content_hash = ?').bind(snapshot.contentHash).first<Row>();
    if (!row) throw new Error('gambit snapshot could not be reloaded');
    return { id: numberValue(row.id), isNew: Number(result.meta?.changes ?? 0) > 0 };
  }

  async getSnapshot(id: number): Promise<GambitSourceSnapshot | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_source_snapshots WHERE id = ?').bind(id).first<Row>();
    return row ? mapSnapshot(row) : null;
  }

  async getSnapshots(ids: number[]): Promise<GambitSourceSnapshot[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await this.db.prepare(`SELECT * FROM gambit_source_snapshots WHERE id IN (${placeholders})`).bind(...ids).all<Row>();
    return results.map(mapSnapshot);
  }

  async getSnapshotByHash(contentHash: string): Promise<GambitSourceSnapshot | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_source_snapshots WHERE content_hash = ?').bind(contentHash).first<Row>();
    return row ? mapSnapshot(row) : null;
  }

  async findCandidateByFingerprint(fingerprint: string): Promise<GambitCandidate | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_candidates WHERE fingerprint = ?').bind(fingerprint).first<Row>();
    return row ? mapCandidate(row) : null;
  }

  async insertCandidate(candidate: GambitCandidate): Promise<GambitCandidateInsertResult> {
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_candidates (
        fingerprint, headline, summary, canonical_url, snapshot_ids_json,
        source_ids_json, political_topic, political_reasons_json,
        political_decision_source, political_decision_confidence,
        evidence_sufficient, strategic_value, falsifiable, status,
        rejection_reason, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      candidate.fingerprint,
      candidate.headline,
      candidate.summary,
      candidate.canonicalUrl,
      JSON.stringify(candidate.snapshotIds),
      JSON.stringify(candidate.sourceIds),
      candidate.politicalTopic ? 1 : 0,
      JSON.stringify(candidate.politicalReasons),
      candidate.politicalDecisionSource ?? (candidate.politicalTopic ? 'DETERMINISTIC_POLICY' : null),
      candidate.politicalDecisionConfidence ?? null,
      candidate.evidenceSufficient ? 1 : 0,
      candidate.strategicValue,
      candidate.falsifiable ? 1 : 0,
      candidate.status,
      candidate.rejectionReason ?? null,
      candidate.discoveredAt,
      candidate.updatedAt ?? candidate.discoveredAt,
    ).run();
    const row = await this.db.prepare('SELECT * FROM gambit_candidates WHERE fingerprint = ?').bind(candidate.fingerprint).first<Row>();
    if (!row) throw new Error('gambit candidate could not be reloaded');
    return { id: numberValue(row.id), isNew: Number(result.meta?.changes ?? 0) > 0 };
  }

  async getCandidate(id: number): Promise<GambitCandidate | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_candidates WHERE id = ?').bind(id).first<Row>();
    return row ? mapCandidate(row) : null;
  }

  async linkCandidateSource(candidateId: number, snapshotId: number, sourceId: string, relationship: 'PRIMARY' | 'CORROBORATING' | 'DISCOVERY' = 'PRIMARY', now = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_candidate_sources (candidate_id, snapshot_id, source_id, relationship, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(candidateId, snapshotId, sourceId, relationship, now).run();
  }

  async setCandidateStatus(id: number, status: GambitCandidateStatus, rejectionReason: string | null = null, now = new Date().toISOString()): Promise<void> {
    await this.db.prepare('UPDATE gambit_candidates SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?')
      .bind(status, rejectionReason, now, id).run();
  }

  /**
   * Record how many bounded analysis retries a candidate consumed (migration
   * 0027). 0 means the first analysis attempt decided the candidate. The value
   * is clamped: it is operational telemetry, and a corrupted counter must never
   * be able to widen the retry bound or fail the run.
   */
  async recordCandidateAnalysisAttempts(id: number, attempts: number, now = new Date().toISOString()): Promise<void> {
    const parsed = typeof attempts === 'number' && Number.isFinite(attempts) ? Math.floor(attempts) : 0;
    const bounded = Math.min(10, Math.max(0, parsed));
    await this.db.prepare('UPDATE gambit_candidates SET analysis_attempts = ?, updated_at = ? WHERE id = ?')
      .bind(bounded, now, id).run();
  }

  /**
   * Record how many bounded TRIAGE re-samples a candidate consumed (migration
   * 0029). Same contract as `recordCandidateAnalysisAttempts`: 0 means the first
   * triage attempt decided the candidate, and the value is clamped so corrupted
   * telemetry can never widen the retry bound or fail the run.
   */
  async recordCandidateTriageAttempts(id: number, attempts: number, now = new Date().toISOString()): Promise<void> {
    const parsed = typeof attempts === 'number' && Number.isFinite(attempts) ? Math.floor(attempts) : 0;
    const bounded = Math.min(10, Math.max(0, parsed));
    await this.db.prepare('UPDATE gambit_candidates SET triage_attempts = ?, updated_at = ? WHERE id = ?')
      .bind(bounded, now, id).run();
  }

  /**
   * Record how many bounded CRITIC OPERATIONAL re-samples a candidate consumed
   * (migration 0030). Same contract as `recordCandidateAnalysisAttempts` and
   * `recordCandidateTriageAttempts`: 0 means the first critic attempt decided
   * the candidate, and the value is clamped so corrupted telemetry can never
   * widen the retry bound or fail the run.
   *
   * This counts re-samples spent on an OPERATIONAL failure only. A critic that
   * returned a usable verdict -- accepted or rejected -- spent no re-sample and
   * records 0, even though the critic stage did run.
   */
  async recordCandidateCriticAttempts(id: number, attempts: number, now = new Date().toISOString()): Promise<void> {
    const parsed = typeof attempts === 'number' && Number.isFinite(attempts) ? Math.floor(attempts) : 0;
    const bounded = Math.min(10, Math.max(0, parsed));
    await this.db.prepare('UPDATE gambit_candidates SET critic_attempts = ?, updated_at = ? WHERE id = ?')
      .bind(bounded, now, id).run();
  }

  /** Persist the policy decision that accompanied a triage/gate outcome. */  async recordPoliticalDecision(id: number, decision: GambitPoliticalDecision, now = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      UPDATE gambit_candidates
      SET political_topic = ?, political_reasons_json = ?,
          political_decision_source = ?, political_decision_confidence = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      decision.excluded ? 1 : 0,
      JSON.stringify(decision.reasons.slice(0, 8)),
      decision.decisionSource,
      decision.confidence,
      now,
      id,
    ).run();
  }

  async listCandidates(status: GambitCandidateStatus | null = null, limit = 50): Promise<GambitCandidate[]> {
    const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
    const statement = status
      ? this.db.prepare('SELECT * FROM gambit_candidates WHERE status = ? ORDER BY discovered_at DESC, id DESC LIMIT ?').bind(status, bounded)
      : this.db.prepare('SELECT * FROM gambit_candidates ORDER BY discovered_at DESC, id DESC LIMIT ?').bind(bounded);
    const { results } = await statement.all<Row>();
    return results.map(mapCandidate);
  }

  async createRun(runKey: string, runType: 'DISCOVERY' | 'RESOLUTION' | 'PUBLISH', startedAt = new Date().toISOString()): Promise<GambitRunRecord> {
    const insertResult = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_runs (run_key, run_type, started_at, status)
      VALUES (?, ?, ?, 'RUNNING')
    `).bind(runKey, runType, startedAt).run();
    const row = await this.db.prepare('SELECT id, run_key, status FROM gambit_runs WHERE run_key = ?').bind(runKey).first<Row>();
    if (!row) throw new Error('gambit run could not be reloaded');
    return {
      id: numberValue(row.id),
      runKey: String(row.run_key),
      status: String(row.status) as GambitRunRecord['status'],
      isNew: Number(insertResult.meta?.changes ?? 0) > 0,
    };
  }

  async finishRun(id: number, status: 'COMPLETED' | 'FAILED' | 'SKIPPED', counts: Partial<GambitMetrics> & { candidatesFound?: number } = {}, errorMessage: string | null = null, finishedAt = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      UPDATE gambit_runs SET status = ?, finished_at = ?,
        sources_fetched = ?, fetch_failures = ?, candidates_found = ?, duplicates = ?,
        political_rejects = ?, no_gambit_rejects = ?, qualified_gambits = ?,
        workflow_starts = ?, workflow_failures = ?, due_resolutions = ?, error_message = ?
      WHERE id = ?
    `).bind(
      status,
      finishedAt,
      counts.sourcesFetched ?? 0,
      counts.fetchFailures ?? 0,
      counts.candidatesFound ?? 0,
      counts.duplicates ?? 0,
      counts.politicalRejects ?? 0,
      counts.noGambitRejects ?? 0,
      counts.qualifiedGambits ?? 0,
      counts.workflowStarts ?? 0,
      counts.workflowFailures ?? 0,
      counts.dueResolutions ?? 0,
      errorMessage,
      id,
    ).run();
  }

  async recordLLMAttempt(input: {
    runId?: number;
    candidateId?: number;
    articleId?: number;
    stage: string;
    role: string;
    response: GambitLLMResponse<unknown> | null;
    publicAiIdentity: string;
    promptVersion: string;
    requestHash: string;
    status: 'SUCCESS' | 'ERROR' | 'SKIPPED';
    errorCode?: string | null;
    createdAt?: string;
  }): Promise<number> {
    const result = await this.db.prepare(`
      INSERT INTO gambit_llm_attempts (
        run_id, candidate_id, article_id, stage, role, provider, model_id,
        display_name, prompt_version, request_hash, status, input_tokens,
        output_tokens, latency_ms, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.runId ?? null,
      input.candidateId ?? null,
      input.articleId ?? null,
      input.stage,
      input.role,
      input.response?.provider ?? 'unknown',
      input.response?.modelId ?? null,
      input.publicAiIdentity,
      input.promptVersion,
      input.requestHash,
      input.status,
      input.response?.inputTokens ?? null,
      input.response?.outputTokens ?? null,
      input.response?.latencyMs ?? null,
      input.errorCode ?? null,
      input.createdAt ?? new Date().toISOString(),
    ).run();
    return numberValue(result.meta?.last_row_id);
  }

  async createArticleDraft(
    draft: GambitDraft,
    options: { publication?: 'REVIEW' | 'AUTO_PUBLISH' | 'AUTO_PUBLISH_PENDING'; now?: string } = {},
  ): Promise<{ articleId: number; revisionId: number }> {
    const now = draft.createdAt;
    const articleStatus = options.publication === 'AUTO_PUBLISH'
      ? 'PUBLISHED'
      : options.publication === 'AUTO_PUBLISH_PENDING' ? 'DRAFT' : 'WAITING_FOR_REVIEW';
    const publishedAt = articleStatus === 'PUBLISHED' ? (options.now ?? now) : null;
    const existing = await this.db.prepare('SELECT id, current_revision_id FROM gambit_articles WHERE candidate_id = ?').bind(draft.candidateId).first<Row>();
    if (existing?.id) {
      const articleId = numberValue(existing.id);
      const revisionId = numberValue(existing.current_revision_id);
      if (revisionId > 0) return { articleId, revisionId };
    }

    const articleResult = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_articles (
        candidate_id, slug, headline, surface_event, status, political_topic,
        no_trajectory_issued, published_at, created_at, updated_at, ai_disclosure_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      draft.candidateId,
      draft.slug,
      draft.headline,
      draft.surfaceEvent,
      articleStatus,
      draft.politicalTopic ? 1 : 0,
      draft.trajectories.length === 0 ? 1 : 0,
      publishedAt,
      now,
      now,
      draft.aiDisclosureVersion,
    ).run();
    const article = await this.db.prepare('SELECT id FROM gambit_articles WHERE candidate_id = ?').bind(draft.candidateId).first<Row>();
    if (!article) throw new Error('gambit article could not be created');
    const articleId = numberValue(article.id);
    const current = await this.db.prepare('SELECT COALESCE(MAX(revision_number), 0) AS revision_number FROM gambit_article_revisions WHERE article_id = ?').bind(articleId).first<Row>();
    const revisionNumber = numberValue(current?.revision_number) + 1;
    const canonical = canonicalJson(draft);
    const contentHash = await sha256Hex(canonical);
    const revisionResult = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_article_revisions (
        article_id, revision_number, draft_json, canonical_json, content_hash,
        model_prompt_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(articleId, revisionNumber, JSON.stringify(draft), canonical, contentHash, draft.modelPromptVersion, articleStatus, now).run();
    const revision = await this.db.prepare('SELECT id FROM gambit_article_revisions WHERE article_id = ? AND content_hash = ?').bind(articleId, contentHash).first<Row>();
    if (!revision) throw new Error('gambit article revision could not be created');
    const revisionId = numberValue(revision.id);
    await this.db.prepare(`
      UPDATE gambit_articles SET current_revision_id = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?
    `).bind(revisionId, articleStatus, publishedAt, now, articleId).run();
    const evidenceIds = await this.insertThesisAndEvidence(articleId, revisionId, draft);
    await this.insertPredictions(articleId, revisionId, draft, evidenceIds);
    void articleResult;
    void revisionResult;
    return { articleId, revisionId };
  }

  private async insertThesisAndEvidence(articleId: number, revisionId: number, draft: GambitDraft): Promise<Map<string, number>> {
    const evidenceIds = new Map<string, number>();
    const thesisPayload = {
      facts: draft.facts,
      evidenceIds: [],
      obviousLogic: draft.obviousLogic,
      thesis: draft.thesis,
      mechanism: draft.mechanism,
      beneficiaries: draft.beneficiaries,
      pressuredActors: draft.pressuredActors,
      countercase: draft.countercase,
      uncertainty: draft.uncertainty,
      critic: draft.critic,
    };
    await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_theses (
        article_id, revision_id, facts_json, evidence_ids_json, obvious_logic,
        thesis, mechanism, beneficiaries_json, pressured_actors_json,
        countercase, uncertainty, critic_json, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      articleId,
      revisionId,
      JSON.stringify(draft.facts),
      JSON.stringify(thesisPayload.evidenceIds),
      draft.obviousLogic,
      draft.thesis,
      draft.mechanism,
      JSON.stringify(draft.beneficiaries),
      JSON.stringify(draft.pressuredActors),
      draft.countercase,
      draft.uncertainty,
      JSON.stringify(draft.critic),
      await sha256Hex(canonicalJson(thesisPayload)),
      draft.createdAt,
    ).run();
    for (const evidence of draft.evidence) {
      await this.db.prepare(`
        INSERT OR IGNORE INTO gambit_evidence (
          article_id, revision_id, snapshot_id, source_id, source_tier,
          canonical_url, title, publisher, published_at, quote, evidence_role,
          content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        articleId,
        revisionId,
        evidence.snapshotId,
        evidence.sourceId,
        evidence.sourceTier,
        evidence.canonicalUrl,
        evidence.title,
        evidence.publisher,
        evidence.publishedAt,
        evidence.quote,
        evidence.role,
        evidence.contentHash,
        evidence.createdAt ?? draft.createdAt,
      ).run();
      const row = await this.db.prepare(`
        SELECT id FROM gambit_evidence
        WHERE article_id = ? AND revision_id = ? AND snapshot_id = ? AND content_hash = ?
      `).bind(articleId, revisionId, evidence.snapshotId, evidence.contentHash).first<Row>();
      if (row) evidenceIds.set(evidence.contentHash, numberValue(row.id));
    }
    if (evidenceIds.size > 0) {
      await this.db.prepare('UPDATE gambit_theses SET evidence_ids_json = ? WHERE article_id = ? AND revision_id = ?')
        .bind(JSON.stringify([...evidenceIds.values()]), articleId, revisionId).run();
    }
    return evidenceIds;
  }

  private async insertPredictions(articleId: number, revisionId: number, draft: GambitDraft, evidenceIds: Map<string, number>): Promise<void> {
    for (const trajectory of draft.trajectories) {
      const original = {
        predictionStatement: trajectory.predictionStatement,
        probability: trajectory.probability,
        target: trajectory.targetEntity,
        observableCondition: trajectory.evidenceCriteria,
        deadline: trajectory.deadline,
        reasoning: trajectory.reasoning,
        falsifier: trajectory.falsifier,
        publicationTimestamp: draft.createdAt,
        modelPromptVersion: draft.modelPromptVersion,
      };
      const contentHash = await sha256Hex(canonicalJson(original));
      const result = await this.db.prepare(`
        INSERT OR IGNORE INTO gambit_predictions (
          article_id, revision_id, trajectory_id, original_prediction_statement,
          original_probability, original_target, original_observable_condition,
          original_deadline, original_reasoning, original_falsifier,
          original_publication_timestamp, original_model_prompt_version,
          original_content_hash, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WATCHING', ?)
      `).bind(
        articleId,
        revisionId,
        trajectory.id,
        trajectory.predictionStatement,
        trajectory.probability,
        trajectory.targetEntity,
        trajectory.evidenceCriteria,
        trajectory.deadline,
        trajectory.reasoning,
        trajectory.falsifier,
        draft.createdAt,
        draft.modelPromptVersion,
        contentHash,
        draft.createdAt,
      ).run();
      const row = await this.db.prepare('SELECT id FROM gambit_predictions WHERE article_id = ? AND revision_id = ? AND trajectory_id = ?').bind(articleId, revisionId, trajectory.id).first<Row>();
      if (!row) continue;
      const predictionId = numberValue(row.id);
      for (const evidence of draft.evidence) {
        const evidenceId = evidenceIds.get(evidence.contentHash);
        if (!evidenceId) continue;
        await this.db.prepare('INSERT OR IGNORE INTO gambit_prediction_evidence (prediction_id, evidence_id, created_at) VALUES (?, ?, ?)')
          .bind(predictionId, evidenceId, draft.createdAt).run();
      }
      void result;
    }
  }

  async getArticleById(id: number): Promise<GambitPublicArticle | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_articles WHERE id = ?').bind(id).first<Row>();
    return row ? this.mapPublicArticle(row) : null;
  }

  async getArticleBySlug(slug: string): Promise<GambitPublicArticle | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_articles WHERE slug = ?').bind(slug).first<Row>();
    return row ? this.mapPublicArticle(row) : null;
  }

  async listPublished(limit = 10): Promise<GambitPublicArticle[]> {
    const bounded = Math.min(50, Math.max(1, Math.floor(limit)));
    const { results } = await this.db.prepare(`
      SELECT * FROM gambit_articles
      WHERE status = 'PUBLISHED' AND political_topic = 0
      ORDER BY published_at DESC, id DESC LIMIT ?
    `).bind(bounded).all<Row>();
    return Promise.all(results.map(row => this.mapPublicArticle(row)));
  }

  async listReviewQueue(limit = 50): Promise<GambitPublicArticle[]> {
    const bounded = Math.min(50, Math.max(1, Math.floor(limit)));
    const { results } = await this.db.prepare(`
      SELECT * FROM gambit_articles
      WHERE status = 'WAITING_FOR_REVIEW' AND political_topic = 0
      ORDER BY updated_at ASC, id ASC LIMIT ?
    `).bind(bounded).all<Row>();
    return Promise.all(results.map(row => this.mapPublicArticle(row)));
  }

  async getRevision(id: number): Promise<GambitRevisionRecord | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_article_revisions WHERE id = ?').bind(id).first<Row>();
    if (!row) return null;
    return {
      id,
      articleId: numberValue(row.article_id),
      revisionNumber: numberValue(row.revision_number),
      draft: safeJsonParse(String(row.draft_json ?? '{}'), {} as GambitDraft),
      status: String(row.status ?? 'DRAFT'),
      contentHash: String(row.content_hash ?? ''),
    };
  }

  async getPredictionOriginal(id: number): Promise<GambitDuePrediction | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_predictions WHERE id = ?').bind(id).first<Row>();
    if (!row) return null;
    const latest = await this.db.prepare('SELECT state FROM gambit_resolution_events WHERE prediction_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(id).first<Row>();
    return {
      id: numberValue(row.id),
      articleId: numberValue(row.article_id),
      revisionId: numberValue(row.revision_id),
      trajectoryId: String(row.trajectory_id),
      originalPredictionStatement: String(row.original_prediction_statement),
      originalProbability: numberValue(row.original_probability),
      originalTarget: String(row.original_target),
      originalObservableCondition: String(row.original_observable_condition),
      originalDeadline: String(row.original_deadline),
      originalReasoning: String(row.original_reasoning),
      originalFalsifier: String(row.original_falsifier),
      originalPublicationTimestamp: String(row.original_publication_timestamp),
      originalModelPromptVersion: String(row.original_model_prompt_version),
      originalContentHash: String(row.original_content_hash),
      latestState: String(latest?.state ?? row.status) as GambitResolutionState,
    };
  }

  async listResolutionEvents(predictionId: number): Promise<Array<{ id: number; state: GambitResolutionState; explanation: string; createdAt: string }>> {
    const { results } = await this.db.prepare('SELECT id, state, explanation, created_at FROM gambit_resolution_events WHERE prediction_id = ? ORDER BY created_at ASC, id ASC').bind(predictionId).all<Row>();
    return results.map(row => ({ id: numberValue(row.id), state: String(row.state) as GambitResolutionState, explanation: String(row.explanation), createdAt: String(row.created_at) }));
  }

  async approveRevision(input: {
    revisionId: number;
    action: GambitApprovalAction;
    adminSubjectHash: string;
    idempotencyKey: string;
    staleAcknowledged?: boolean;
    note?: string | null;
    now?: string;
  }): Promise<GambitApprovalResult> {
    const now = input.now ?? new Date().toISOString();
    const revision = await this.getRevision(input.revisionId);
    if (!revision) throw new Error('REVISION_NOT_FOUND');
    const articleRow = await this.db.prepare('SELECT * FROM gambit_articles WHERE id = ?').bind(revision.articleId).first<Row>();
    if (!articleRow) throw new Error('ARTICLE_NOT_FOUND');
    const existingApproval = await this.db.prepare('SELECT * FROM gambit_approvals WHERE idempotency_key = ?').bind(input.idempotencyKey).first<Row>();
    if (existingApproval) {
      return {
        approved: String(existingApproval.action) === 'APPROVE',
        idempotent: true,
        stale: false,
        status: String(articleRow.status) as GambitArticleStatus,
        articleId: revision.articleId,
        revisionId: input.revisionId,
      };
    }
    const currentRevisionId = numberValue(articleRow.current_revision_id);
    const stale = currentRevisionId !== input.revisionId;
    if (stale && !input.staleAcknowledged) throw new Error('STALE_REVISION');

    const articleStatus = input.action === 'APPROVE' ? 'APPROVED'
      : input.action === 'REJECT' ? 'REJECTED' : 'NEEDS_REANALYSIS';
    await this.db.prepare(`
      INSERT INTO gambit_approvals (article_id, revision_id, action, admin_subject_hash, idempotency_key, stale_acknowledged, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      revision.articleId,
      input.revisionId,
      input.action,
      input.adminSubjectHash,
      input.idempotencyKey,
      input.staleAcknowledged ? 1 : 0,
      input.note ?? null,
      now,
    ).run();
    await this.db.prepare('UPDATE gambit_articles SET status = ?, updated_at = ? WHERE id = ?')
      .bind(articleStatus, now, revision.articleId).run();
    await this.db.prepare('UPDATE gambit_article_revisions SET status = ? WHERE id = ?')
      .bind(input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'SUPERSEDED', input.revisionId).run();
    return {
      approved: input.action === 'APPROVE',
      idempotent: false,
      stale,
      status: articleStatus,
      articleId: revision.articleId,
      revisionId: input.revisionId,
    };
  }

  async publishApprovedArticle(articleId: number, revisionId: number, publishedAt = new Date().toISOString()): Promise<boolean> {
    const article = await this.db.prepare('SELECT status, current_revision_id, political_topic FROM gambit_articles WHERE id = ?').bind(articleId).first<Row>();
    if (!article || numberValue(article.current_revision_id) !== revisionId || numberValue(article.political_topic) !== 0) return false;
    if (String(article.status) === 'PUBLISHED') return true;
    if (String(article.status) !== 'APPROVED') return false;
    await this.db.prepare('UPDATE gambit_articles SET status = \'PUBLISHED\', published_at = ?, updated_at = ? WHERE id = ? AND status = \'APPROVED\' AND current_revision_id = ?')
      .bind(publishedAt, publishedAt, articleId, revisionId).run();
    await this.db.prepare('UPDATE gambit_article_revisions SET status = \'PUBLISHED\' WHERE id = ? AND status = \'APPROVED\'').bind(revisionId).run();
    return true;
  }

  async publishAutomaticallyArticle(articleId: number, revisionId: number, publishedAt = new Date().toISOString()): Promise<boolean> {
    const article = await this.db.prepare('SELECT status, current_revision_id, political_topic FROM gambit_articles WHERE id = ?').bind(articleId).first<Row>();
    if (!article || numberValue(article.current_revision_id) !== revisionId || numberValue(article.political_topic) !== 0) return false;
    if (String(article.status) === 'PUBLISHED') return true;
    if (String(article.status) !== 'DRAFT') return false;
    await this.db.prepare('UPDATE gambit_articles SET status = \'PUBLISHED\', published_at = ?, updated_at = ? WHERE id = ? AND status = \'DRAFT\' AND current_revision_id = ?')
      .bind(publishedAt, publishedAt, articleId, revisionId).run();
    await this.db.prepare('UPDATE gambit_article_revisions SET status = \'PUBLISHED\' WHERE id = ? AND status = \'DRAFT\'').bind(revisionId).run();
    return true;
  }

  async saveTranslation(input: {
    articleId: number;
    revisionId: number;
    translation: GambitTranslation;
    provider: string | null;
    status: 'PENDING' | 'TRANSLATED' | 'FAILED';
    error?: string | null;
    now?: string;
  }): Promise<void> {
    const now = input.now ?? new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO gambit_translations (article_id, revision_id, locale, content_json, status, provider, translated_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(article_id, revision_id, locale) DO UPDATE SET
        content_json = excluded.content_json,
        status = excluded.status,
        provider = excluded.provider,
        translated_at = excluded.translated_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).bind(
      input.articleId,
      input.revisionId,
      input.translation.locale,
      JSON.stringify(input.translation),
      input.status,
      input.provider,
      input.status === 'TRANSLATED' ? now : null,
      input.error ?? null,
      now,
      now,
    ).run();
  }

  async appendResolutionEvent(input: GambitResolutionInput & { now?: string }): Promise<{ id: number; idempotent: boolean }> {
    const now = input.now ?? new Date().toISOString();
    const payload = {
      predictionId: input.predictionId,
      state: input.state,
      evaluatorResult: input.evaluatorResult,
      reviewState: input.reviewState,
      explanation: input.explanation,
      evidenceIds: input.evidenceIds,
      supersededReason: input.supersededReason ?? null,
    };
    const contentHash = await sha256Hex(canonicalJson(payload));
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_resolution_events (
        prediction_id, state, evaluator_result, review_state, explanation,
        evidence_ids_json, superseded_reason, content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.predictionId,
      input.state,
      input.evaluatorResult,
      input.reviewState,
      input.explanation,
      JSON.stringify(input.evidenceIds),
      input.supersededReason ?? null,
      contentHash,
      now,
    ).run();
    const row = await this.db.prepare('SELECT id FROM gambit_resolution_events WHERE content_hash = ?').bind(contentHash).first<Row>();
    if (!row) throw new Error('resolution event could not be reloaded');
    await this.db.prepare(`
      UPDATE gambit_articles SET updated_at = ?
      WHERE id = (SELECT article_id FROM gambit_predictions WHERE id = ?)
    `).bind(now, input.predictionId).run();
    return { id: numberValue(row.id), idempotent: Number(result.meta?.changes ?? 0) === 0 };
  }

  async addCorrection(input: {
    articleId: number;
    predictionId?: number | null;
    correctionType: 'CORRECTION' | 'RETRACTION' | 'SUPERSESSION';
    explanation: string;
    evidenceIds: number[];
    now?: string;
  }): Promise<number> {
    if (input.evidenceIds.length === 0) throw new Error('CORRECTION_REQUIRES_EVIDENCE');
    const now = input.now ?? new Date().toISOString();
    const payload = {
      articleId: input.articleId,
      predictionId: input.predictionId ?? null,
      correctionType: input.correctionType,
      explanation: input.explanation,
      evidenceIds: input.evidenceIds,
    };
    const contentHash = await sha256Hex(canonicalJson(payload));
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_corrections (article_id, prediction_id, correction_type, explanation, evidence_ids_json, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(input.articleId, input.predictionId ?? null, input.correctionType, input.explanation, JSON.stringify(input.evidenceIds), contentHash, now).run();
    await this.db.prepare('UPDATE gambit_articles SET updated_at = ? WHERE id = ?').bind(now, input.articleId).run();
    return numberValue(result.meta?.last_row_id);
  }

  async listDuePredictions(now = new Date().toISOString(), limit = 100): Promise<GambitDuePrediction[]> {
    const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
    const { results } = await this.db.prepare(`
      SELECT p.*, COALESCE((
        SELECT re.state FROM gambit_resolution_events re
        WHERE re.prediction_id = p.id ORDER BY re.created_at DESC, re.id DESC LIMIT 1
      ), p.status) AS latest_state
      FROM gambit_predictions p
      WHERE p.original_deadline <= ?
        AND NOT EXISTS (
          SELECT 1 FROM gambit_resolution_events final_re
          WHERE final_re.prediction_id = p.id
            AND final_re.state IN ('HIT','PARTIAL','MISS','EXPIRED','RETRACTED','SUPERSEDED')
        )
      ORDER BY p.original_deadline ASC, p.id ASC LIMIT ?
    `).bind(now, bounded).all<Row>();
    return results.map(row => ({
      id: numberValue(row.id),
      articleId: numberValue(row.article_id),
      revisionId: numberValue(row.revision_id),
      trajectoryId: String(row.trajectory_id),
      originalPredictionStatement: String(row.original_prediction_statement),
      originalProbability: numberValue(row.original_probability),
      originalTarget: String(row.original_target),
      originalObservableCondition: String(row.original_observable_condition),
      originalDeadline: String(row.original_deadline),
      originalReasoning: String(row.original_reasoning),
      originalFalsifier: String(row.original_falsifier),
      originalPublicationTimestamp: String(row.original_publication_timestamp),
      originalModelPromptVersion: String(row.original_model_prompt_version),
      originalContentHash: String(row.original_content_hash),
      latestState: String(row.latest_state) as GambitResolutionState,
    }));
  }

  async recordWorkflowResult(input: {
    workflowId: string;
    candidateId: number;
    result: GambitWorkflowResult;
    resultHash: string | null;
    now?: string;
  }): Promise<void> {
    const now = input.now ?? new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO gambit_workflow_instances (workflow_id, candidate_id, status, article_id, revision_id, result_hash, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        status = excluded.status,
        article_id = excluded.article_id,
        revision_id = excluded.revision_id,
        result_hash = excluded.result_hash,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).bind(
      input.workflowId,
      input.candidateId,
      input.result.status === 'WAITING_FOR_REVIEW' ? 'WAITING_FOR_REVIEW' : input.result.status,
      input.result.articleId ?? null,
      input.result.revisionId ?? null,
      input.resultHash,
      input.result.reason ?? input.result.publicationDecision ?? null,
      now,
      now,
    ).run();
  }

  /** Reserve the deterministic workflow id before calling Cloudflare. */
  async recordWorkflowStart(input: {
    workflowId: string;
    candidateId: number;
    startedAt?: string;
  }): Promise<boolean> {
    const now = input.startedAt ?? new Date().toISOString();
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO gambit_workflow_instances (
        workflow_id, candidate_id, status, article_id, revision_id, result_hash,
        last_error, created_at, updated_at
      ) VALUES (?, ?, 'RUNNING', NULL, NULL, NULL, NULL, ?, ?)
    `).bind(input.workflowId, input.candidateId, now, now).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async getWorkflowResult(workflowId: string): Promise<{ status: string; articleId: number | null; revisionId: number | null; resultHash: string | null; reason: string | null } | null> {
    const row = await this.db.prepare('SELECT status, article_id, revision_id, result_hash, last_error FROM gambit_workflow_instances WHERE workflow_id = ?').bind(workflowId).first<Row>();
    return row ? {
      status: String(row.status),
      articleId: row.article_id === null || row.article_id === undefined ? null : numberValue(row.article_id),
      revisionId: row.revision_id === null || row.revision_id === undefined ? null : numberValue(row.revision_id),
      resultHash: row.result_hash ? String(row.result_hash) : null,
      reason: row.last_error ? String(row.last_error) : null,
    } : null;
  }

  async upsertDailyMetrics(metricDate: string, metrics: Partial<GambitMetrics>, now = new Date().toISOString()): Promise<void> {
    const names = [
      'discovery_runs', 'sources_fetched', 'fetch_failures', 'duplicates',
      'political_rejects', 'no_gambit_rejects', 'qualified_gambits',
      'workflow_starts', 'workflow_failures', 'human_approvals',
      'human_rejections', 'publications', 'predictions', 'due_resolutions',
      'resolution_results',
    ] as const;
    const values = names.map(name => metrics[camelMetric(name)] ?? 0);
    await this.db.prepare(`
      INSERT INTO gambit_metrics_daily (metric_date, ${names.join(', ')}, updated_at)
      VALUES (?, ${names.map(() => '?').join(', ')}, ?)
      ON CONFLICT(metric_date) DO UPDATE SET
        ${names.map(name => `${name} = gambit_metrics_daily.${name} + excluded.${name}`).join(', ')},
        updated_at = excluded.updated_at
    `).bind(metricDate, ...values, now).run();
  }

  // -------------------------------------------------------------------------
  // Discovery funnel observability (migration 0025 — additive)
  // -------------------------------------------------------------------------

  async insertDiscoveryStats(stats: GambitDiscoveryStats, now = new Date().toISOString()): Promise<void> {
    await this.db.prepare(`
      INSERT INTO gambit_discovery_stats (
        run_id, sources_attempted, sources_succeeded, sources_failed,
        raw_items_observed, stale_items, malformed_items, version_noise_items,
        admitted_items, exact_duplicates, routine_noise_rejects, strategic_eligible,
        event_duplicates, global_pool_size, global_top_k_selected,
        workflow_dispatches, workflow_failures, partial_source_failure,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        sources_attempted = excluded.sources_attempted,
        sources_succeeded = excluded.sources_succeeded,
        sources_failed = excluded.sources_failed,
        raw_items_observed = excluded.raw_items_observed,
        stale_items = excluded.stale_items,
        malformed_items = excluded.malformed_items,
        version_noise_items = excluded.version_noise_items,
        admitted_items = excluded.admitted_items,
        exact_duplicates = excluded.exact_duplicates,
        routine_noise_rejects = excluded.routine_noise_rejects,
        strategic_eligible = excluded.strategic_eligible,
        event_duplicates = excluded.event_duplicates,
        global_pool_size = excluded.global_pool_size,
        global_top_k_selected = excluded.global_top_k_selected,
        workflow_dispatches = excluded.workflow_dispatches,
        workflow_failures = excluded.workflow_failures,
        partial_source_failure = excluded.partial_source_failure,
        updated_at = excluded.updated_at
    `).bind(
      stats.runId,
      stats.sourcesAttempted,
      stats.sourcesSucceeded,
      stats.sourcesFailed,
      stats.rawItemsObserved,
      stats.staleItems,
      stats.malformedItems,
      stats.versionNoiseItems,
      stats.admittedItems,
      stats.exactDuplicates,
      stats.routineNoiseRejects,
      stats.strategicEligible,
      stats.eventDuplicates,
      stats.globalPoolSize,
      stats.globalTopKSelected,
      stats.workflowDispatches,
      stats.workflowFailures,
      stats.partialSourceFailure ? 1 : 0,
      now,
      now,
    ).run();
  }

  async getDiscoveryStats(runId: number): Promise<GambitDiscoveryStats | null> {
    const row = await this.db.prepare('SELECT * FROM gambit_discovery_stats WHERE run_id = ?').bind(runId).first<Row>();
    if (!row) return null;
    return {
      runId: numberValue(row.run_id),
      sourcesAttempted: numberValue(row.sources_attempted),
      sourcesSucceeded: numberValue(row.sources_succeeded),
      sourcesFailed: numberValue(row.sources_failed),
      rawItemsObserved: numberValue(row.raw_items_observed),
      staleItems: numberValue(row.stale_items),
      malformedItems: numberValue(row.malformed_items),
      // NULL for rows written before migration 0028; those runs genuinely had
      // no version-noise filter, so 0 is the honest reading.
      versionNoiseItems: numberValue(row.version_noise_items),
      admittedItems: numberValue(row.admitted_items),
      exactDuplicates: numberValue(row.exact_duplicates),
      routineNoiseRejects: numberValue(row.routine_noise_rejects),
      strategicEligible: numberValue(row.strategic_eligible),
      eventDuplicates: numberValue(row.event_duplicates),
      globalPoolSize: numberValue(row.global_pool_size),
      globalTopKSelected: numberValue(row.global_top_k_selected),
      workflowDispatches: numberValue(row.workflow_dispatches),
      workflowFailures: numberValue(row.workflow_failures),
      partialSourceFailure: numberValue(row.partial_source_failure) === 1,
      createdAt: row.created_at ? String(row.created_at) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    };
  }

  async countEnabledSources(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS total FROM gambit_sources WHERE enabled = 1').first<Row>();
    return numberValue(row?.total);
  }

  async countPublishedArticles(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS total FROM gambit_articles WHERE status = ? AND political_topic = 0').bind('PUBLISHED').first<Row>();
    return numberValue(row?.total);
  }

  /**
   * Public "Latest Scan / Watching" summary derived from REAL persisted data.
   * Only safe aggregates are exposed: no candidate ids, workflow ids,
   * provider/model names, token counts, prompts, or error strings.
   */
  async getLatestScan(now = new Date().toISOString()): Promise<GambitLatestScan> {
    const run = await this.db.prepare(`
      SELECT * FROM gambit_runs
      WHERE run_type = 'DISCOVERY' AND status IN ('COMPLETED', 'FAILED')
      ORDER BY id DESC LIMIT 1
    `).first<Row>();
    if (!run) {
      return {
        hasRun: false,
        completedAt: null,
        status: null,
        sourcesChecked: 0,
        itemsReviewed: 0,
        candidatesReviewed: 0,
        published: 0,
        partialSourceFailure: false,
      };
    }
    const runId = numberValue(run.id);
    const stats = await this.getDiscoveryStats(runId);
    const published = await this.countPublishedArticles();
    const runStatus = String(run.status) as GambitLatestScan['status'];
    return {
      hasRun: true,
      completedAt: run.finished_at ? String(run.finished_at) : null,
      status: runStatus,
      sourcesChecked: stats ? stats.sourcesSucceeded : numberValue(run.sources_fetched),
      itemsReviewed: stats ? stats.admittedItems : numberValue(run.candidates_found),
      candidatesReviewed: stats ? stats.globalTopKSelected : 0,
      published,
      partialSourceFailure: stats ? stats.sourcesFailed > 0 : runStatus === 'FAILED',
    };
  }

  private async mapPublicArticle(row: Row): Promise<GambitPublicArticle> {
    const revisionId = numberValue(row.current_revision_id);
    const revision = revisionId > 0
      ? await this.db.prepare('SELECT draft_json FROM gambit_article_revisions WHERE id = ?').bind(revisionId).first<Row>()
      : null;
    const draft = safeJsonParse(String(revision?.draft_json ?? '{}'), {
      candidateId: numberValue(row.candidate_id),
      slug: String(row.slug),
      headline: String(row.headline),
      surfaceEvent: String(row.surface_event),
      facts: [],
      obviousLogic: '',
      thesis: '',
      mechanism: '',
      beneficiaries: [],
      pressuredActors: [],
      countercase: '',
      trajectories: [],
      falsifier: '',
      evidence: [],
      uncertainty: '',
      politicalTopic: numberValue(row.political_topic) === 1,
      critic: {
        accepted: true,
        rejectionReasons: [],
        simplerExplanation: '',
        motiveConcern: false,
        causalConcern: false,
        politicalFraming: false,
        sensationalismConcern: false,
        falsifiabilityConcern: false,
        notes: '',
      },
      modelRoleProvenance: {},
      modelPromptVersion: '',
      aiDisclosureVersion: String(row.ai_disclosure_version ?? 'v1'),
      draftVersion: 1,
      createdAt: String(row.created_at),
    } as GambitDraft);
    const translationRows = await this.db.prepare('SELECT content_json FROM gambit_translations WHERE article_id = ? AND revision_id = ? AND status = \'TRANSLATED\'').bind(numberValue(row.id), revisionId).all<Row>();
    const translations: Partial<Record<import('./types').GambitLocale, GambitTranslation>> = {};
    for (const translationRow of translationRows.results) {
      const translation = safeJsonParse<GambitTranslation | null>(String(translationRow.content_json ?? ''), null);
      if (translation && GAMBIT_LOCALES.includes(translation.locale)) translations[translation.locale] = translation;
    }
    const evidenceRows = await this.db.prepare(`
      SELECT id, snapshot_id, source_id, source_tier, canonical_url, title, publisher,
        published_at, quote, evidence_role, content_hash, created_at
      FROM gambit_evidence WHERE article_id = ? AND revision_id = ? ORDER BY id ASC
    `).bind(numberValue(row.id), revisionId).all<Row>();
    const storedEvidence: GambitEvidence[] = evidenceRows.results.map(mapEvidence);
    const latestStates = await this.latestPredictionStates(numberValue(row.id), revisionId);
    const trajectories = draft.trajectories.map(trajectory => ({
      ...trajectory,
      status: latestStates.get(trajectory.id) ?? trajectory.status,
    }));
    for (const locale of GAMBIT_LOCALES) {
      const translation = translations[locale];
      if (translation) {
        translations[locale] = {
          ...translation,
          trajectories: translation.trajectories.map(trajectory => ({
            ...trajectory,
            status: latestStates.get(trajectory.id) ?? trajectory.status,
          })),
        };
      }
    }
    const { results: resolutionRows } = await this.db.prepare(`
      SELECT re.id, p.trajectory_id, re.state, re.evaluator_result, re.review_state,
        re.explanation, re.evidence_ids_json, re.superseded_reason, re.created_at
      FROM gambit_resolution_events re
      JOIN gambit_predictions p ON p.id = re.prediction_id
      WHERE p.article_id = ? AND p.revision_id = ?
      ORDER BY re.created_at ASC, re.id ASC
    `).bind(numberValue(row.id), revisionId).all<Row>();
    const resolutionHistory: GambitPublicResolutionEvent[] = resolutionRows.map(item => ({
      id: numberValue(item.id),
      trajectoryId: String(item.trajectory_id),
      state: String(item.state) as GambitPublicResolutionEvent['state'],
      evaluatorResult: String(item.evaluator_result) as GambitPublicResolutionEvent['evaluatorResult'],
      reviewState: String(item.review_state) as GambitPublicResolutionEvent['reviewState'],
      explanation: String(item.explanation),
      evidenceIds: safeJsonParse<number[]>(String(item.evidence_ids_json ?? '[]'), []),
      supersededReason: item.superseded_reason ? String(item.superseded_reason) : null,
      createdAt: String(item.created_at),
    }));
    const { results: correctionRows } = await this.db.prepare(`
      SELECT id, prediction_id, correction_type, explanation, evidence_ids_json, created_at
      FROM gambit_corrections WHERE article_id = ? ORDER BY created_at ASC, id ASC
    `).bind(numberValue(row.id)).all<Row>();
    const corrections: GambitPublicCorrection[] = correctionRows.map(item => ({
      id: numberValue(item.id),
      predictionId: item.prediction_id === null || item.prediction_id === undefined ? null : numberValue(item.prediction_id),
      correctionType: String(item.correction_type) as GambitPublicCorrection['correctionType'],
      explanation: String(item.explanation),
      evidenceIds: safeJsonParse<number[]>(String(item.evidence_ids_json ?? '[]'), []),
      createdAt: String(item.created_at),
    }));
    return {
      ...draft,
      articleId: numberValue(row.id),
      revisionId: revisionId > 0 ? revisionId : undefined,
      status: String(row.status) as GambitArticleStatus,
      publishedAt: row.published_at ? String(row.published_at) : null,
      modifiedAt: String(row.updated_at),
      trajectories,
      evidence: storedEvidence,
      translations,
      resolutionHistory,
      corrections,
    };
  }

  private async latestPredictionStates(articleId: number, revisionId: number): Promise<Map<string, GambitResolutionState>> {
    const { results } = await this.db.prepare(`
      SELECT p.trajectory_id,
        COALESCE((SELECT re.state FROM gambit_resolution_events re WHERE re.prediction_id = p.id ORDER BY re.created_at DESC, re.id DESC LIMIT 1), p.status) AS latest_state
      FROM gambit_predictions p WHERE p.article_id = ? AND p.revision_id = ?
    `).bind(articleId, revisionId).all<Row>();
    return new Map(results.map(row => [String(row.trajectory_id), String(row.latest_state) as GambitResolutionState]));
  }
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayValue(value: unknown): string[] {
  const parsed = safeJsonParse<unknown[]>(String(value ?? '[]'), []);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}

function mapSource(row: Row): GambitSourceDefinition {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.source_type) as GambitSourceDefinition['type'],
    url: String(row.url),
    publisher: String(row.publisher),
    qualityTier: String(row.quality_tier) as GambitSourceTier,
    enabled: numberValue(row.enabled) === 1,
    allowedHosts: arrayValue(row.allowed_hosts_json),
    notes: row.notes ? String(row.notes) : undefined,
  };
}

function mapSnapshot(row: Row): GambitSourceSnapshot {
  return {
    id: numberValue(row.id),
    sourceId: String(row.source_id),
    requestedUrl: String(row.requested_url),
    finalUrl: String(row.final_url),
    canonicalUrl: String(row.canonical_url),
    title: row.title ? String(row.title) : null,
    publisher: row.publisher ? String(row.publisher) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    retrievedAt: String(row.retrieved_at),
    normalizedContent: String(row.normalized_content),
    contentHash: String(row.content_hash),
    extractorVersion: String(row.extractor_version),
    sourceQualityTier: String(row.source_quality_tier) as GambitSourceTier,
    r2Key: row.r2_key ? String(row.r2_key) : null,
    retentionUntil: row.retention_until ? String(row.retention_until) : null,
    createdAt: String(row.created_at),
  };
}

function mapEvidence(row: Row): GambitEvidence {
  return {
    id: numberValue(row.id),
    snapshotId: numberValue(row.snapshot_id),
    sourceId: String(row.source_id),
    sourceTier: String(row.source_tier) as GambitSourceTier,
    canonicalUrl: String(row.canonical_url),
    title: row.title ? String(row.title) : null,
    publisher: row.publisher ? String(row.publisher) : null,
    publishedAt: row.published_at ? String(row.published_at) : null,
    quote: String(row.quote),
    role: String(row.evidence_role) as GambitEvidence['role'],
    contentHash: String(row.content_hash),
    createdAt: row.created_at ? String(row.created_at) : undefined,
  };
}

function mapCandidate(row: Row): GambitCandidate {
  return {
    id: numberValue(row.id),
    fingerprint: String(row.fingerprint),
    headline: String(row.headline),
    summary: String(row.summary),
    canonicalUrl: String(row.canonical_url),
    snapshotIds: safeJsonParse<number[]>(String(row.snapshot_ids_json ?? '[]'), []),
    sourceIds: arrayValue(row.source_ids_json),
    politicalTopic: numberValue(row.political_topic) === 1,
    politicalReasons: arrayValue(row.political_reasons_json),
    politicalDecisionSource: row.political_decision_source === 'DETERMINISTIC_POLICY'
      || row.political_decision_source === 'LLM_TRIAGE'
      || row.political_decision_source === 'HYBRID'
      ? row.political_decision_source
      : null,
    politicalDecisionConfidence: row.political_decision_confidence === null || row.political_decision_confidence === undefined
      ? null
      : Math.max(0, Math.min(1, numberValue(row.political_decision_confidence))),
    evidenceSufficient: numberValue(row.evidence_sufficient) === 1,
    strategicValue: numberValue(row.strategic_value),
    falsifiable: numberValue(row.falsifiable) === 1,
    status: String(row.status) as GambitCandidateStatus,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) as GambitCandidate['rejectionReason'] : null,
    discoveredAt: String(row.discovered_at),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

function camelMetric(name: string): keyof GambitMetrics {
  return name.replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase()) as keyof GambitMetrics;
}
