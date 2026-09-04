-- ============================================================
-- Open Gambit V1 - isolated strategic-analysis domain
--
-- Additive only. This migration is intentionally local/migration-ready and
-- must not be applied to a production D1 database as part of development.
-- All public forecast originals are insert-only; later state belongs in
-- gambit_resolution_events or gambit_corrections.
-- ============================================================

CREATE TABLE IF NOT EXISTS gambit_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('RSS','ATOM','OFFICIAL_BLOG','OFFICIAL_PRODUCT','GITHUB_RELEASE','SEARCH','X_DISCOVERY')),
  url TEXT NOT NULL,
  publisher TEXT NOT NULL,
  quality_tier TEXT NOT NULL CHECK(quality_tier IN ('PRIMARY_OFFICIAL','PRIMARY_REPOSITORY','PRIMARY_DOCUMENTATION','SECONDARY_HIGH_QUALITY','DISCOVERY_ONLY')),
  allowed_hosts_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gambit_sources_enabled_quality
  ON gambit_sources(enabled, quality_tier, id);

CREATE TABLE IF NOT EXISTS gambit_source_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  requested_url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  extractor_version TEXT NOT NULL,
  source_quality_tier TEXT NOT NULL CHECK(source_quality_tier IN ('PRIMARY_OFFICIAL','PRIMARY_REPOSITORY','PRIMARY_DOCUMENTATION','SECONDARY_HIGH_QUALITY','DISCOVERY_ONLY')),
  r2_key TEXT,
  retention_until TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES gambit_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_snapshots_source_retrieved
  ON gambit_source_snapshots(source_id, retrieved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gambit_snapshots_canonical
  ON gambit_source_snapshots(canonical_url, retrieved_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS gambit_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  snapshot_ids_json TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  political_topic INTEGER NOT NULL DEFAULT 0 CHECK(political_topic IN (0, 1)),
  political_reasons_json TEXT NOT NULL DEFAULT '[]',
  evidence_sufficient INTEGER NOT NULL DEFAULT 0 CHECK(evidence_sufficient IN (0, 1)),
  strategic_value REAL NOT NULL DEFAULT 0 CHECK(strategic_value >= 0 AND strategic_value <= 1),
  falsifiable INTEGER NOT NULL DEFAULT 0 CHECK(falsifiable IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK(status IN ('DISCOVERED','DUPLICATE','REJECTED','QUALIFIED','ANALYZING','DRAFTED','WAITING_FOR_REVIEW','APPROVED','PUBLISHED')),
  rejection_reason TEXT CHECK(rejection_reason IS NULL OR rejection_reason IN ('NO_GAMBIT_WORTH_PUBLISHING','INSUFFICIENT_EVIDENCE','POLITICAL_TOPIC_EXCLUDED','DUPLICATE','LOW_STRATEGIC_VALUE','NON_FALSIFIABLE','UNSUPPORTED_MOTIVE','NEEDS_HUMAN_REVIEW')),
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gambit_candidates_status_discovered
  ON gambit_candidates(status, discovered_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gambit_candidates_url
  ON gambit_candidates(canonical_url, id DESC);

CREATE TABLE IF NOT EXISTS gambit_candidate_sources (
  candidate_id INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'PRIMARY' CHECK(relationship IN ('PRIMARY','CORROBORATING','DISCOVERY')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, snapshot_id),
  FOREIGN KEY (candidate_id) REFERENCES gambit_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES gambit_source_snapshots(id),
  FOREIGN KEY (source_id) REFERENCES gambit_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_candidate_sources_source
  ON gambit_candidate_sources(source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gambit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL UNIQUE,
  run_type TEXT NOT NULL CHECK(run_type IN ('DISCOVERY','RESOLUTION','PUBLISH')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING','COMPLETED','FAILED','SKIPPED')),
  sources_fetched INTEGER NOT NULL DEFAULT 0,
  fetch_failures INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  political_rejects INTEGER NOT NULL DEFAULT 0,
  no_gambit_rejects INTEGER NOT NULL DEFAULT 0,
  qualified_gambits INTEGER NOT NULL DEFAULT 0,
  workflow_starts INTEGER NOT NULL DEFAULT 0,
  workflow_failures INTEGER NOT NULL DEFAULT 0,
  due_resolutions INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_gambit_runs_type_started
  ON gambit_runs(run_type, started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS gambit_llm_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  candidate_id INTEGER,
  article_id INTEGER,
  stage TEXT NOT NULL CHECK(stage IN ('DETERMINISTIC_GATE','TRIAGE','ANALYSIS','CRITIC','COMPOSITION','TRANSLATION','RESOLUTION')),
  role TEXT NOT NULL,
  -- provider/model_id are actual runtime provenance; display_name is the
  -- visitor-facing PUBLIC_AI_IDENTITY and is never used for routing.
  provider TEXT NOT NULL,
  model_id TEXT,
  display_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUCCESS','ERROR','SKIPPED')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES gambit_runs(id),
  FOREIGN KEY (candidate_id) REFERENCES gambit_candidates(id),
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_llm_attempts_subject
  ON gambit_llm_attempts(candidate_id, stage, created_at DESC);

CREATE TABLE IF NOT EXISTS gambit_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  headline TEXT NOT NULL,
  surface_event TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','WAITING_FOR_REVIEW','APPROVED','PUBLISHED','REJECTED','NEEDS_REANALYSIS')),
  political_topic INTEGER NOT NULL DEFAULT 0 CHECK(political_topic IN (0, 1)),
  no_trajectory_issued INTEGER NOT NULL DEFAULT 0 CHECK(no_trajectory_issued IN (0, 1)),
  current_revision_id INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ai_disclosure_version TEXT NOT NULL DEFAULT 'v1',
  FOREIGN KEY (candidate_id) REFERENCES gambit_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_articles_public_status
  ON gambit_articles(status, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_gambit_articles_slug
  ON gambit_articles(slug);

CREATE TABLE IF NOT EXISTS gambit_article_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_number INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  model_prompt_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','WAITING_FOR_REVIEW','APPROVED','PUBLISHED','REJECTED','SUPERSEDED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  UNIQUE(article_id, revision_number),
  UNIQUE(article_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_gambit_article_revisions_review
  ON gambit_article_revisions(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS gambit_theses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  facts_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  obvious_logic TEXT NOT NULL,
  thesis TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  beneficiaries_json TEXT NOT NULL,
  pressured_actors_json TEXT NOT NULL,
  countercase TEXT NOT NULL,
  uncertainty TEXT NOT NULL,
  critic_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id),
  UNIQUE(article_id, revision_id)
);

CREATE TABLE IF NOT EXISTS gambit_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  snapshot_id INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  source_tier TEXT NOT NULL CHECK(source_tier IN ('PRIMARY_OFFICIAL','PRIMARY_REPOSITORY','PRIMARY_DOCUMENTATION','SECONDARY_HIGH_QUALITY','DISCOVERY_ONLY')),
  canonical_url TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  published_at TEXT,
  quote TEXT NOT NULL,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN ('FACT','CONTEXT','CORROBORATION')),
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id),
  FOREIGN KEY (snapshot_id) REFERENCES gambit_source_snapshots(id),
  FOREIGN KEY (source_id) REFERENCES gambit_sources(id),
  UNIQUE(article_id, revision_id, snapshot_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_gambit_evidence_article
  ON gambit_evidence(article_id, revision_id, id);

CREATE TABLE IF NOT EXISTS gambit_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  trajectory_id TEXT NOT NULL,
  original_prediction_statement TEXT NOT NULL,
  original_probability INTEGER NOT NULL CHECK(original_probability IN (20,30,40,50,60,70,80)),
  original_target TEXT NOT NULL,
  original_observable_condition TEXT NOT NULL,
  original_deadline TEXT NOT NULL,
  original_reasoning TEXT NOT NULL,
  original_falsifier TEXT NOT NULL,
  original_publication_timestamp TEXT NOT NULL,
  original_model_prompt_version TEXT NOT NULL,
  original_content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WATCHING' CHECK(status IN ('WATCHING','DUE','HIT','PARTIAL','MISS','EXPIRED','UNRESOLVED','RETRACTED','SUPERSEDED')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id),
  UNIQUE(article_id, revision_id, trajectory_id),
  UNIQUE(original_content_hash)
);

CREATE INDEX IF NOT EXISTS idx_gambit_predictions_due
  ON gambit_predictions(status, original_deadline, id);

CREATE TRIGGER IF NOT EXISTS gambit_predictions_immutable_update
  BEFORE UPDATE ON gambit_predictions
BEGIN
  SELECT RAISE(ABORT, 'gambit_predictions_are_immutable');
END;

CREATE TRIGGER IF NOT EXISTS gambit_predictions_immutable_delete
  BEFORE DELETE ON gambit_predictions
BEGIN
  SELECT RAISE(ABORT, 'gambit_predictions_are_immutable');
END;

CREATE TABLE IF NOT EXISTS gambit_prediction_evidence (
  prediction_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(prediction_id, evidence_id),
  FOREIGN KEY (prediction_id) REFERENCES gambit_predictions(id) ON DELETE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES gambit_evidence(id)
);

CREATE TABLE IF NOT EXISTS gambit_resolution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('WATCHING','DUE','HIT','PARTIAL','MISS','EXPIRED','UNRESOLVED','RETRACTED','SUPERSEDED')),
  evaluator_result TEXT NOT NULL CHECK(evaluator_result IN ('DETERMINISTIC','PRIMARY_SOURCE','SECONDARY_CORROBORATION','LLM_INTERPRETATION','HUMAN_REVIEW')),
  review_state TEXT NOT NULL CHECK(review_state IN ('NOT_REQUIRED','WAITING_FOR_REVIEW','APPROVED')),
  explanation TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  superseded_reason TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (prediction_id) REFERENCES gambit_predictions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gambit_resolution_events_prediction
  ON gambit_resolution_events(prediction_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS gambit_resolution_events_append_only_update
  BEFORE UPDATE ON gambit_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'gambit_resolution_events_are_append_only');
END;

CREATE TRIGGER IF NOT EXISTS gambit_resolution_events_append_only_delete
  BEFORE DELETE ON gambit_resolution_events
BEGIN
  SELECT RAISE(ABORT, 'gambit_resolution_events_are_append_only');
END;

CREATE TABLE IF NOT EXISTS gambit_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('en','zh')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','TRANSLATED','FAILED')),
  provider TEXT,
  translated_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id),
  UNIQUE(article_id, revision_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_gambit_translations_locale
  ON gambit_translations(locale, status, article_id, revision_id);

CREATE TABLE IF NOT EXISTS gambit_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('APPROVE','REJECT','RETURN_FOR_REANALYSIS')),
  admin_subject_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  stale_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(stale_acknowledged IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_approvals_article
  ON gambit_approvals(article_id, revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gambit_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  prediction_id INTEGER,
  correction_type TEXT NOT NULL CHECK(correction_type IN ('CORRECTION','RETRACTION','SUPERSESSION')),
  explanation TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (prediction_id) REFERENCES gambit_predictions(id)
);

CREATE TRIGGER IF NOT EXISTS gambit_corrections_append_only_update
  BEFORE UPDATE ON gambit_corrections
BEGIN
  SELECT RAISE(ABORT, 'gambit_corrections_are_append_only');
END;

CREATE TRIGGER IF NOT EXISTS gambit_corrections_append_only_delete
  BEFORE DELETE ON gambit_corrections
BEGIN
  SELECT RAISE(ABORT, 'gambit_corrections_are_append_only');
END;

CREATE TABLE IF NOT EXISTS gambit_metrics_daily (
  metric_date TEXT PRIMARY KEY,
  discovery_runs INTEGER NOT NULL DEFAULT 0,
  sources_fetched INTEGER NOT NULL DEFAULT 0,
  fetch_failures INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  political_rejects INTEGER NOT NULL DEFAULT 0,
  no_gambit_rejects INTEGER NOT NULL DEFAULT 0,
  qualified_gambits INTEGER NOT NULL DEFAULT 0,
  workflow_starts INTEGER NOT NULL DEFAULT 0,
  workflow_failures INTEGER NOT NULL DEFAULT 0,
  human_approvals INTEGER NOT NULL DEFAULT 0,
  human_rejections INTEGER NOT NULL DEFAULT 0,
  publications INTEGER NOT NULL DEFAULT 0,
  predictions INTEGER NOT NULL DEFAULT 0,
  due_resolutions INTEGER NOT NULL DEFAULT 0,
  resolution_results INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gambit_workflow_instances (
  workflow_id TEXT PRIMARY KEY,
  candidate_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','NO_GAMBIT','WAITING_FOR_REVIEW','NEEDS_HUMAN_REVIEW','FAILED','COMPLETED')),
  article_id INTEGER,
  revision_id INTEGER,
  result_hash TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES gambit_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id),
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id)
);

CREATE INDEX IF NOT EXISTS idx_gambit_workflow_instances_candidate
  ON gambit_workflow_instances(candidate_id, created_at DESC);
