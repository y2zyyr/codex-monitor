-- Indexed search hits are discovery evidence only. They must not be stored as
-- a DIRECT reset confirmation, including rows created by migration 0009.
UPDATE reset_cycles
SET status = 'EXPIRED_UNCONFIRMED',
    confirmation_type = 'NONE',
    confirmation_confidence = 0,
    confirmed_reset_at = NULL,
    confirmation_checked_at = NULL,
    confirmation_evidence_count = 0,
    updated_at = datetime('now')
WHERE completed_event_id IN (
  SELECT id FROM monitor_events WHERE verification_status = 'INDEXED_ONLY'
)
  AND confirmation_type = 'DIRECT';

-- Preserve the quality semantics for official evidence that was ingested by
-- older code as ordinary direct evidence.
UPDATE source_posts
SET verification_status = 'OFFICIAL_VERIFIED'
WHERE source_quality = 'OFFICIAL'
  AND verification_status = 'DIRECT_VERIFIED';

UPDATE monitor_events
SET verification_status = 'OFFICIAL_VERIFIED'
WHERE evidence_quality = 'OFFICIAL'
  AND verification_status = 'DIRECT_VERIFIED';

UPDATE reset_cycles
SET confirmation_type = 'OFFICIAL',
    verification_status = 'OFFICIAL_VERIFIED',
    updated_at = datetime('now')
WHERE completed_event_id IN (
  SELECT id FROM monitor_events WHERE verification_status = 'OFFICIAL_VERIFIED'
)
  AND confirmation_type = 'DIRECT';
