-- ============================================================
-- Tibo Community V1
-- Additive-only schema for anonymous posts, derived embeds, abuse
-- controls, and moderation. Raw client IP addresses are never stored.
-- ============================================================

CREATE TABLE IF NOT EXISTS community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  original_content TEXT NOT NULL,
  original_language TEXT NOT NULL DEFAULT 'und',
  content_en TEXT,
  content_zh TEXT,
  translation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(translation_status IN ('pending', 'translated', 'partial', 'failed')),
  translation_provider TEXT,
  translated_at TEXT,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK(status IN ('approved', 'pending', 'hidden', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  moderation_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_community_posts_status_created
  ON community_posts(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_content_hash
  ON community_posts(content_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_source_hash
  ON community_posts(source_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS community_embeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('repository')),
  provider TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  image_url TEXT,
  metadata_json TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fetch_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(fetch_status IN ('pending', 'success', 'failed')),
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  UNIQUE(post_id, type, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_community_embeds_canonical
  ON community_embeds(canonical_url, fetch_status, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_embeds_post
  ON community_embeds(post_id, fetch_status);

CREATE TABLE IF NOT EXISTS community_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_community_bans_active_source
  ON community_bans(source_hash, active, expires_at);

CREATE TABLE IF NOT EXISTS community_rate_limits (
  source_hash TEXT PRIMARY KEY,
  minute_started_ms INTEGER NOT NULL DEFAULT 0,
  minute_count INTEGER NOT NULL DEFAULT 0,
  hour_started_ms INTEGER NOT NULL DEFAULT 0,
  hour_count INTEGER NOT NULL DEFAULT 0,
  day_started_ms INTEGER NOT NULL DEFAULT 0,
  day_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
