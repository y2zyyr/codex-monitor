-- The approximate reset-time field was accidentally populated with complete
-- indexed social-page extracts. Those extracts belong in source_posts/source_text,
-- not in the compact countdown label.
UPDATE reset_cycles
SET expected_reset_time_text = NULL,
    updated_at = datetime('now')
WHERE expected_reset_time_text IS NOT NULL
  AND length(expected_reset_time_text) > 160;
