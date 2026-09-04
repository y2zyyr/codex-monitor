-- Additive normalized translation cache for the multilingual Community feed.
-- original_content remains the source of truth; these rows are derived data.
CREATE TABLE IF NOT EXISTS community_post_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('en', 'zh', 'ja', 'es', 'fr')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'translated'
    CHECK(status IN ('translated', 'failed', 'pending')),
  provider TEXT,
  translated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  UNIQUE(post_id, language)
);

CREATE INDEX IF NOT EXISTS idx_community_post_translations_post_language
  ON community_post_translations(post_id, language);

CREATE INDEX IF NOT EXISTS idx_community_post_translations_language_post
  ON community_post_translations(language, post_id);

-- Backfill the two legacy columns without overwriting or deleting anything.
INSERT OR IGNORE INTO community_post_translations (
  post_id, language, content, status, provider, translated_at, created_at, updated_at
)
SELECT id, 'en', content_en, 'translated', translation_provider, translated_at, created_at, updated_at
FROM community_posts
WHERE content_en IS NOT NULL AND content_en <> '';

INSERT OR IGNORE INTO community_post_translations (
  post_id, language, content, status, provider, translated_at, created_at, updated_at
)
SELECT id, 'zh', content_zh, 'translated', translation_provider, translated_at, created_at, updated_at
FROM community_posts
WHERE content_zh IS NOT NULL AND content_zh <> '';
