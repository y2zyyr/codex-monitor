-- ============================================================
-- Community agent publishing (first-party automation)
--
-- Additive-only. No existing row loses content, identity, or
-- moderation state. The only write to pre-existing rows is the
-- derived `author_type` value for administrator announcements,
-- which is idempotent and matches the value `mapPost` already
-- derived from `author_role`.
-- ============================================================

ALTER TABLE community_posts ADD COLUMN author_type TEXT NOT NULL DEFAULT 'human'
  CHECK(author_type IN ('human', 'agent', 'admin'));
ALTER TABLE community_posts ADD COLUMN agent_id TEXT;

-- Keep pre-migration administrator announcements consistent with the
-- derived value the read path has always produced from author_role.
UPDATE community_posts SET author_type = 'admin' WHERE author_role = 'admin' AND author_type = 'human';

CREATE INDEX IF NOT EXISTS idx_community_posts_author_type
  ON community_posts(status, author_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_agent
  ON community_posts(agent_id, created_at DESC, id DESC);

-- Server-side agent quota counters. One row per counting bucket:
--   run:<runId>  bounded per agent run (per-run cap)
--   day:agent    bounded across every agent identity (24h cap)
-- The secret is never stored here; only the public agent id is.
CREATE TABLE IF NOT EXISTS community_agent_quotas (
  bucket_key TEXT PRIMARY KEY,
  window_started_ms INTEGER NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  max_count INTEGER NOT NULL,
  agent_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_agent_quotas_window
  ON community_agent_quotas(window_started_ms);
