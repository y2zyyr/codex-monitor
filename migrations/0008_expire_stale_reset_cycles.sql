-- Approximate reset announcements are short-lived. Do not keep an old
-- indexed plan as the current reset after its source is more than 48 hours
-- old. The row remains in history as EXPIRED_UNCONFIRMED.
UPDATE reset_cycles
SET status = 'EXPIRED_UNCONFIRMED',
    due_at = COALESCE(due_at, datetime('now')),
    updated_at = datetime('now')
WHERE status IN ('SCHEDULED', 'TIME_CHANGED')
  AND expected_reset_at IS NULL
  AND julianday(COALESCE(
    (SELECT me.published_at FROM monitor_events me WHERE me.id = reset_cycles.planned_event_id),
    (SELECT me.created_at FROM monitor_events me WHERE me.id = reset_cycles.planned_event_id),
    reset_cycles.created_at
  )) < julianday('now', '-48 hours');
