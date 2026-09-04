-- ============================================================
-- Tibo Monitor - Classifier coverage taxonomy
--
-- This migration does not add a table or a column. SQLite cannot alter the
-- existing category CHECK constraint in place, so the existing monitor event
-- graph is copied with the three additional public categories. All primary
-- keys, foreign-key values, translation rows, reset-cycle rows, evidence rows,
-- and existing indexes are preserved.
--
-- IRRELEVANT is intentionally not an event category: it remains a classifier
-- result and is never written to monitor_events.
-- ============================================================

CREATE TABLE monitor_events_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN (
    'RESET_PLANNED',
    'RESET_COMPLETED',
    'RESET_TIME_CHANGED',
    'POLICY_CHANGE',
    'CODEX_UPDATE',
    'ROADMAP_HINT',
    'FEATURE_DISCUSSION'
  )),
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
  FOREIGN KEY (source_post_id) REFERENCES source_posts(id)
);

INSERT INTO monitor_events_v2 (
  id, source_post_id, category, title_en, title_zh, summary_en, summary_zh,
  confidence, published_at, effective_at, reset_at, source_url,
  evidence_quality, verification_status, verified_at, created_at, updated_at
)
SELECT
  id, source_post_id, category, title_en, title_zh, summary_en, summary_zh,
  confidence, published_at, effective_at, reset_at, source_url,
  evidence_quality, verification_status, verified_at, created_at, updated_at
FROM monitor_events;

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
  completed_event_id, verification_status, created_at, updated_at
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

CREATE TABLE monitor_event_translations_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('ja', 'es', 'fr')),
  title TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('translated', 'failed', 'pending')),
  provider TEXT,
  translated_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES monitor_events_v2(id) ON DELETE CASCADE,
  UNIQUE(event_id, language)
);

INSERT INTO monitor_event_translations_v2 (
  id, event_id, language, title, summary, status, provider, translated_at,
  last_error, created_at, updated_at
)
SELECT
  id, event_id, language, title, summary, status, provider, translated_at,
  last_error, created_at, updated_at
FROM monitor_event_translations;

-- Remove only the old dependency graph after every row has been copied.
DROP TABLE monitor_event_translations;
DROP TABLE reset_confirmation_evidence;
DROP TABLE reset_cycles;
DROP TABLE monitor_events;

ALTER TABLE monitor_events_v2 RENAME TO monitor_events;
ALTER TABLE reset_cycles_v2 RENAME TO reset_cycles;
ALTER TABLE reset_confirmation_evidence_v2 RENAME TO reset_confirmation_evidence;
ALTER TABLE monitor_event_translations_v2 RENAME TO monitor_event_translations;

CREATE UNIQUE INDEX idx_monitor_events_source_post
  ON monitor_events(source_post_id);
CREATE INDEX idx_monitor_events_published_at
  ON monitor_events(published_at DESC);
CREATE INDEX idx_monitor_events_category
  ON monitor_events(category, published_at DESC);
CREATE INDEX idx_monitor_events_verification
  ON monitor_events(verification_status, published_at DESC);
CREATE INDEX idx_monitor_events_public_sort
  ON monitor_events(julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE verification_status <> 'REJECTED';
CREATE INDEX idx_monitor_events_category_public_sort
  ON monitor_events(category, julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE verification_status <> 'REJECTED';
CREATE INDEX idx_monitor_events_direct_reset_sort
  ON monitor_events(julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE category = 'RESET_COMPLETED'
    AND verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
    AND evidence_quality IN ('DIRECT', 'OFFICIAL');

CREATE INDEX idx_reset_cycles_status
  ON reset_cycles(status, created_at DESC);
CREATE UNIQUE INDEX idx_evidence_source
  ON reset_confirmation_evidence(reset_cycle_id, source_url);
CREATE INDEX idx_monitor_event_translations_event_language
  ON monitor_event_translations(event_id, language);
CREATE INDEX idx_monitor_event_translations_language_status
  ON monitor_event_translations(language, status, event_id);
