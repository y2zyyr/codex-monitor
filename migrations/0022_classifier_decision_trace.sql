-- ============================================================
-- Tibo Monitor - bounded classifier decision trace
--
-- Keep operator provenance separate from model reasoning. These nullable
-- fields are additive so existing source-post rows and monitor behavior are
-- preserved; no raw prompt, source text, or chain of thought is stored.
-- ============================================================

ALTER TABLE source_posts ADD COLUMN classification_label TEXT;
ALTER TABLE source_posts ADD COLUMN classification_decision TEXT;
ALTER TABLE source_posts ADD COLUMN classification_reason_code TEXT;
ALTER TABLE source_posts ADD COLUMN classification_source_context TEXT;
ALTER TABLE source_posts ADD COLUMN classification_event_created INTEGER NOT NULL DEFAULT 0 CHECK(classification_event_created IN (0, 1));
ALTER TABLE source_posts ADD COLUMN classifier_version TEXT;

CREATE INDEX IF NOT EXISTS idx_source_posts_classification_trace
  ON source_posts(classification_decision, classification_reason_code, classification_event_created);
