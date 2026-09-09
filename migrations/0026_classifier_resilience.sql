-- ============================================================
-- Tibo Monitor - classifier resilience taxonomy
--
-- Additive only. Provider failures remain recoverable after the existing
-- bounded classifier-output retry budget is exhausted.
-- ============================================================

ALTER TABLE source_posts ADD COLUMN classification_failure_kind TEXT
  CHECK(classification_failure_kind IN (
    'TRANSIENT_PROVIDER_ERROR',
    'PERMANENT_OR_CONFIGURATION_ERROR',
    'CLASSIFIER_OUTPUT_ERROR'
  ));

-- Recover legacy pending rows from the old bounded error strings. This does
-- not copy or expose the old message; it only assigns the smallest safe
-- taxonomy needed to let provider-failure rows re-enter the queue.
UPDATE source_posts
SET classification_failure_kind = CASE
  WHEN classification_error LIKE 'LLM API error: 408%'
    OR classification_error LIKE 'LLM API error: 425%'
    OR classification_error LIKE 'LLM API error: 429%'
    OR classification_error LIKE 'LLM API error: 5%'
    OR classification_error LIKE 'LLM request failed:%'
    THEN 'TRANSIENT_PROVIDER_ERROR'
  WHEN classification_error LIKE 'LLM API error: 4%'
    THEN 'PERMANENT_OR_CONFIGURATION_ERROR'
  WHEN classification_error LIKE 'Empty LLM response%'
    OR classification_error LIKE 'Parse error:%'
    THEN 'CLASSIFIER_OUTPUT_ERROR'
  ELSE classification_failure_kind
END
WHERE classification_pending = 1
  AND classification_failure_kind IS NULL;

CREATE INDEX IF NOT EXISTS idx_source_posts_classifier_recovery
  ON source_posts(classification_pending, classification_failure_kind, last_classification_attempt_at, classification_attempts);
