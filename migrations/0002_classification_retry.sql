-- ============================================================
-- Codex Usage Monitor - Add classification retry support
-- ============================================================

-- Add retry tracking fields to source_posts
ALTER TABLE source_posts ADD COLUMN classification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_posts ADD COLUMN last_classification_attempt_at TEXT;
ALTER TABLE source_posts ADD COLUMN classification_error TEXT;

-- Add index for retry queries
CREATE INDEX IF NOT EXISTS idx_source_posts_retry
  ON source_posts(classification_pending, classification_attempts, fetched_at);

-- Add a table for tracking provider status over time
CREATE TABLE IF NOT EXISTS provider_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ok','degraded','down','not_configured')),
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_status_name
  ON provider_status(provider_name);
