-- Additive Community feed enhancements. Existing posts remain visible as
-- general, unpinned, and unfeatured posts.
ALTER TABLE community_posts ADD COLUMN topic TEXT NOT NULL DEFAULT 'general';
ALTER TABLE community_posts ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1));
ALTER TABLE community_posts ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_community_posts_feed_order
  ON community_posts(status, is_pinned DESC, is_featured DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_community_posts_topic
  ON community_posts(topic, status, created_at DESC, id DESC);
