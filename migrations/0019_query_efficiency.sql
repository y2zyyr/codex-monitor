-- Query-efficiency indexes for the public read paths.
-- D1 bills rows scanned, so these indexes target the ORDER BY expressions
-- used by the timeline/latest-event queries and the latest successful Cron
-- query. They are additive and safe to apply repeatedly.

CREATE INDEX IF NOT EXISTS idx_monitor_runs_successful_finished_at
  ON monitor_runs(finished_at DESC, id DESC)
  WHERE status = 'completed' AND error_message IS NULL;

CREATE INDEX IF NOT EXISTS idx_monitor_events_public_sort
  ON monitor_events(julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE verification_status <> 'REJECTED';

CREATE INDEX IF NOT EXISTS idx_monitor_events_category_public_sort
  ON monitor_events(category, julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE verification_status <> 'REJECTED';

CREATE INDEX IF NOT EXISTS idx_monitor_events_direct_reset_sort
  ON monitor_events(julianday(COALESCE(published_at, created_at)) DESC, id DESC)
  WHERE category = 'RESET_COMPLETED'
    AND verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
    AND evidence_quality IN ('DIRECT', 'OFFICIAL');
