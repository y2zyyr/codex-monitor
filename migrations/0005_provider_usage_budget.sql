-- ============================================================
-- Tibo Monitor - Hybrid providers, provenance and hard budgets
--
-- This migration is append-only at the migration level. The table rebuilds
-- copy every existing row and preserve primary keys/FK values. They are
-- required because 0001 declared published_at NOT NULL while indexed search
-- evidence legitimately has no authoritative publication time.
--
-- New *_v2 tables reference one another, so the old FK graph can remain
-- enabled during the migration. This is important for production D1, where
-- PRAGMA state is not guaranteed to persist between migration statements.
-- ============================================================

-- source_posts: nullable published_at plus provenance fields.
CREATE TABLE source_posts_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'x',
  source_account TEXT NOT NULL,
  source_post_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  text TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  classification_pending INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  classification_attempts INTEGER NOT NULL DEFAULT 0,
  last_classification_attempt_at TEXT,
  classification_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  canonical_platform TEXT,
  canonical_post_id TEXT,
  source_quality TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK(source_quality IN ('INDEXED','DIRECT','OFFICIAL')),
  first_discovered_via TEXT,
  last_verified_via TEXT,
  verified_at TEXT,
  indexed_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'DIRECT_VERIFIED'
    CHECK(verification_status IN ('INDEXED_ONLY','DIRECT_VERIFIED','OFFICIAL_VERIFIED','REJECTED'))
);

INSERT INTO source_posts_v2 (
  id, source, source_account, source_post_id, source_url, text,
  published_at, fetched_at, raw_json, content_hash, classification_pending,
  created_at, classification_attempts, last_classification_attempt_at,
  classification_error, updated_at, canonical_platform, canonical_post_id,
  source_quality, first_discovered_via, last_verified_via, verified_at,
  indexed_at, verification_status
)
SELECT
  id, source, source_account, source_post_id, source_url, text,
  published_at, fetched_at, raw_json, content_hash, classification_pending,
  created_at, classification_attempts, last_classification_attempt_at,
  classification_error, datetime('now'), canonical_platform, canonical_post_id,
  CASE WHEN source IN ('web_search','google_search') THEN 'INDEXED' ELSE 'DIRECT' END,
  CASE WHEN source IN ('web_search','google_search') THEN 'web_search' ELSE NULL END,
  CASE WHEN source IN ('web_search','google_search') THEN NULL ELSE 'x_api' END,
  NULL, NULL,
  CASE WHEN source IN ('web_search','google_search') THEN 'INDEXED_ONLY' ELSE 'DIRECT_VERIFIED' END
FROM source_posts;

-- monitor_events: nullable published_at and event-level verification.
CREATE TABLE monitor_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('RESET_PLANNED','RESET_COMPLETED','RESET_TIME_CHANGED','POLICY_CHANGE')),
  title_en TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  summary_en TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0 CHECK(confidence >= 0 AND confidence <= 1),
  published_at TEXT,
  effective_at TEXT,
  reset_at TEXT,
  source_url TEXT NOT NULL,
  evidence_quality TEXT NOT NULL DEFAULT 'DIRECT'
    CHECK(evidence_quality IN ('INDEXED','DIRECT','OFFICIAL')),
  verification_status TEXT NOT NULL DEFAULT 'DIRECT_VERIFIED'
    CHECK(verification_status IN ('INDEXED_ONLY','DIRECT_VERIFIED','OFFICIAL_VERIFIED','REJECTED')),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_post_id) REFERENCES source_posts_v2(id)
);

INSERT INTO monitor_events_v2 (
  id, source_post_id, category, title_en, title_zh, summary_en, summary_zh,
  confidence, published_at, effective_at, reset_at, source_url,
  evidence_quality, verification_status, verified_at, created_at, updated_at
)
SELECT
  e.id, e.source_post_id, e.category, e.title_en, e.title_zh, e.summary_en, e.summary_zh,
  e.confidence, e.published_at, e.effective_at, e.reset_at, e.source_url,
  CASE WHEN sp.source IN ('web_search','google_search') THEN 'INDEXED' ELSE 'DIRECT' END,
  CASE WHEN sp.source IN ('web_search','google_search') THEN 'INDEXED_ONLY' ELSE 'DIRECT_VERIFIED' END,
  NULL, e.created_at, e.updated_at
FROM monitor_events e
JOIN source_posts sp ON sp.id = e.source_post_id;

-- reset_cycles and evidence are rebuilt as children of the v2 event graph so
-- the old tables can be removed without disabling FK enforcement.
CREATE TABLE reset_cycles_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN (
    'NONE','SCHEDULED','DUE','CONFIRMING','CONFIRMED','TIME_CHANGED','EXPIRED_UNCONFIRMED'
  )),
  planned_event_id INTEGER,
  expected_reset_at TEXT,
  expected_reset_time_text TEXT,
  expected_timezone TEXT,
  is_approximate INTEGER NOT NULL DEFAULT 1,
  time_confidence TEXT DEFAULT 'LOW' CHECK(time_confidence IN ('HIGH','MEDIUM','LOW')),
  due_at TEXT,
  time_changed_event_id INTEGER,
  previous_expected_reset_at TEXT,
  confirmation_type TEXT DEFAULT 'NONE' CHECK(confirmation_type IN ('NONE','DIRECT','OFFICIAL','COMMUNITY')),
  confirmation_confidence REAL DEFAULT 0.0,
  confirmed_reset_at TEXT,
  confirmation_checked_at TEXT,
  confirmation_evidence_count INTEGER DEFAULT 0,
  reset_source TEXT,
  reset_source_url TEXT,
  completed_event_id INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'DIRECT_VERIFIED'
    CHECK(verification_status IN ('INDEXED_ONLY','DIRECT_VERIFIED','OFFICIAL_VERIFIED','REJECTED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (planned_event_id) REFERENCES monitor_events_v2(id),
  FOREIGN KEY (time_changed_event_id) REFERENCES monitor_events_v2(id),
  FOREIGN KEY (completed_event_id) REFERENCES monitor_events_v2(id)
);

INSERT INTO reset_cycles_v2 (
  id, status, planned_event_id, expected_reset_at, expected_reset_time_text,
  expected_timezone, is_approximate, time_confidence, due_at,
  time_changed_event_id, previous_expected_reset_at, confirmation_type,
  confirmation_confidence, confirmed_reset_at, confirmation_checked_at,
  confirmation_evidence_count, reset_source, reset_source_url,
  completed_event_id, verification_status, created_at, updated_at
)
SELECT
  id, status, planned_event_id, expected_reset_at, expected_reset_time_text,
  expected_timezone, is_approximate, time_confidence, due_at,
  time_changed_event_id, previous_expected_reset_at, confirmation_type,
  confirmation_confidence, confirmed_reset_at, confirmation_checked_at,
  confirmation_evidence_count, reset_source, reset_source_url,
  completed_event_id, 'DIRECT_VERIFIED', created_at, updated_at
FROM reset_cycles;

CREATE TABLE reset_confirmation_evidence_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_cycle_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('DIRECT','OFFICIAL','COMMUNITY')),
  source_url TEXT NOT NULL,
  source_name TEXT,
  source_author TEXT,
  source_text TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  semantic_result TEXT,
  classification TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reset_cycle_id) REFERENCES reset_cycles_v2(id)
);

INSERT INTO reset_confirmation_evidence_v2 (
  id, reset_cycle_id, source_type, source_url, source_name, source_author,
  source_text, published_at, fetched_at, semantic_result, classification, created_at
)
SELECT
  id, reset_cycle_id, source_type, source_url, source_name, source_author,
  source_text, published_at, fetched_at, semantic_result, classification, created_at
FROM reset_confirmation_evidence;

-- Remove only copied table shells in dependency order; all rows now live in
-- the v2 copies above.
DROP TABLE reset_confirmation_evidence;
DROP TABLE reset_cycles;
DROP TABLE monitor_events;
DROP TABLE source_posts;

ALTER TABLE source_posts_v2 RENAME TO source_posts;
ALTER TABLE monitor_events_v2 RENAME TO monitor_events;
ALTER TABLE reset_cycles_v2 RENAME TO reset_cycles;
ALTER TABLE reset_confirmation_evidence_v2 RENAME TO reset_confirmation_evidence;

CREATE UNIQUE INDEX idx_source_posts_source_post
  ON source_posts(source, source_post_id);
CREATE INDEX idx_source_posts_content_hash
  ON source_posts(content_hash);
CREATE INDEX idx_source_posts_published_at
  ON source_posts(published_at DESC);
CREATE INDEX idx_source_posts_account
  ON source_posts(source_account, published_at DESC);
CREATE UNIQUE INDEX idx_source_posts_canonical
  ON source_posts(canonical_platform, canonical_post_id);
CREATE INDEX idx_source_posts_quality
  ON source_posts(source_quality, verified_at DESC);

CREATE UNIQUE INDEX idx_monitor_events_source_post
  ON monitor_events(source_post_id);
CREATE INDEX idx_monitor_events_published_at
  ON monitor_events(published_at DESC);
CREATE INDEX idx_monitor_events_category
  ON monitor_events(category, published_at DESC);
CREATE INDEX idx_monitor_events_verification
  ON monitor_events(verification_status, published_at DESC);

CREATE INDEX idx_reset_cycles_status
  ON reset_cycles(status, created_at DESC);
CREATE UNIQUE INDEX idx_evidence_source
  ON reset_confirmation_evidence(reset_cycle_id, source_url);

ALTER TABLE monitor_runs ADD COLUMN x_api_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_runs ADD COLUMN web_search_calls INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_runs ADD COLUMN llm_classifications INTEGER NOT NULL DEFAULT 0;

CREATE TABLE provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_request_at TEXT,
  last_request_slot TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, usage_date)
);

CREATE INDEX idx_provider_usage_date
  ON provider_usage(provider, usage_date DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('x_api_since_id:thsottiaux', ''),
  ('x_api_user_id:thsottiaux', '');
INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', '5', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

UPDATE provider_status SET provider_name = 'x_api' WHERE provider_name = 'x-api';

