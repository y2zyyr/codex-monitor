-- Additive cache for localized monitor-event title and summary content.
-- The existing English/Chinese fields and joined source text remain the
-- source-of-truth fields. These rows are derived and safe to retry.
CREATE TABLE IF NOT EXISTS monitor_event_translations (
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
  FOREIGN KEY (event_id) REFERENCES monitor_events(id) ON DELETE CASCADE,
  UNIQUE(event_id, language)
);

CREATE INDEX IF NOT EXISTS idx_monitor_event_translations_event_language
  ON monitor_event_translations(event_id, language);

CREATE INDEX IF NOT EXISTS idx_monitor_event_translations_language_status
  ON monitor_event_translations(language, status, event_id);
