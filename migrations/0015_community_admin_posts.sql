-- Additive-only fields for server-issued administrator announcements.
-- Public posts keep the member role; only the authenticated admin endpoint
-- may insert author_role = 'admin'.

ALTER TABLE community_posts ADD COLUMN author_role TEXT NOT NULL DEFAULT 'member'
  CHECK(author_role IN ('member', 'admin'));

ALTER TABLE community_posts ADD COLUMN is_announcement INTEGER NOT NULL DEFAULT 0
  CHECK(is_announcement IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_community_posts_author_role
  ON community_posts(status, author_role, is_announcement, created_at DESC, id DESC);
