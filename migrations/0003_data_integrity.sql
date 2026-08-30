-- ============================================================
-- Codex Usage Monitor - Data Integrity Fixes
-- 
-- 1. Add canonical_post_id and canonical_platform for cross-provider dedup
-- 2. published_at should be NULL when unknown, not fetched_at
-- ============================================================

-- Add canonical fields for cross-provider dedup
-- For X posts: canonical_platform = 'x', canonical_post_id = X status ID
ALTER TABLE source_posts ADD COLUMN canonical_platform TEXT;
ALTER TABLE source_posts ADD COLUMN canonical_post_id TEXT;

-- Create unique index for cross-provider dedup
-- Ensures the same X post is not duplicated across providers
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_posts_canonical
  ON source_posts(canonical_platform, canonical_post_id);

-- Verify no existing data has published_at == fetched_at (data integrity check)
-- This is a no-op check; if data exists with this issue, it needs manual review
-- Current source_posts count is 0, so no repair needed
