-- ============================================================
-- Open Gambit - first-class editorial locale support
--
-- Additive migration. 0021 and 0022 are already applied and remain
-- immutable. The table rebuild only widens the locale constraint; all
-- existing translation rows are copied byte-for-byte.
-- ============================================================

CREATE TABLE gambit_translations_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  revision_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('en','zh','ja','fr','es')),
  content_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','TRANSLATED','FAILED')),
  provider TEXT,
  translated_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES gambit_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES gambit_article_revisions(id),
  UNIQUE(article_id, revision_id, locale)
);

INSERT INTO gambit_translations_v2 (
  id, article_id, revision_id, locale, content_json, status, provider,
  translated_at, last_error, created_at, updated_at
)
SELECT
  id, article_id, revision_id, locale, content_json, status, provider,
  translated_at, last_error, created_at, updated_at
FROM gambit_translations;

DROP TABLE gambit_translations;
ALTER TABLE gambit_translations_v2 RENAME TO gambit_translations;

CREATE INDEX idx_gambit_translations_locale
  ON gambit_translations(locale, status, article_id, revision_id);
