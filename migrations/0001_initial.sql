-- ============================================================
-- Codex Usage Monitor - Initial Schema
-- ============================================================

-- Source Posts: raw fetched posts from social media
CREATE TABLE IF NOT EXISTS source_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'x',
  source_account TEXT NOT NULL,
  source_post_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  text TEXT NOT NULL,
  published_at TEXT NOT NULL,  -- ISO 8601 UTC
  fetched_at TEXT NOT NULL,    -- ISO 8601 UTC
  raw_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  classification_pending INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique constraint: (source, source_post_id) must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_posts_source_post
  ON source_posts(source, source_post_id);

-- Index for content_hash dedup fallback
CREATE INDEX IF NOT EXISTS idx_source_posts_content_hash
  ON source_posts(content_hash);

-- Index for sorting by published time
CREATE INDEX IF NOT EXISTS idx_source_posts_published_at
  ON source_posts(published_at DESC);

-- Index for fetching by account
CREATE INDEX IF NOT EXISTS idx_source_posts_account
  ON source_posts(source_account, published_at DESC);

-- Monitor Events: classified and validated events
CREATE TABLE IF NOT EXISTS monitor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_post_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('RESET_PLANNED','RESET_COMPLETED','RESET_TIME_CHANGED','POLICY_CHANGE')),
  title_en TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  summary_en TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.0 CHECK(confidence >= 0 AND confidence <= 1),
  published_at TEXT NOT NULL,     -- ISO 8601 UTC
  effective_at TEXT,              -- ISO 8601 UTC or NULL
  reset_at TEXT,                  -- ISO 8601 UTC or NULL
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_post_id) REFERENCES source_posts(id)
);

-- Unique constraint: one event per source_post
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_events_source_post
  ON monitor_events(source_post_id);

-- Index for timeline display
CREATE INDEX IF NOT EXISTS idx_monitor_events_published_at
  ON monitor_events(published_at DESC);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_monitor_events_category
  ON monitor_events(category, published_at DESC);

-- Monitor Runs: cron execution logs
CREATE TABLE IF NOT EXISTS monitor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,      -- ISO 8601 UTC
  finished_at TEXT,              -- ISO 8601 UTC or NULL
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  posts_checked INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  events_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Index for latest run
CREATE INDEX IF NOT EXISTS idx_monitor_runs_started_at
  ON monitor_runs(started_at DESC);

-- Settings: key-value configuration
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed initial settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('schema_version', '1'),
  ('last_known_event_id', '0'),
  ('monitored_accounts', 'thsottiaux'),
  ('provider_last_fetch', ''),
  ('last_classification_run', '');
