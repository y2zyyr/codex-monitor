-- Reconcile direct completion events that were ingested before the lifecycle
-- handler existed. Each row is intentionally standalone: without a reliable
-- event-to-plan key, linking it to an older plan would invent a relationship.
INSERT INTO reset_cycles (
  status,
  confirmation_type,
  confirmation_confidence,
  confirmed_reset_at,
  confirmation_checked_at,
  due_at,
  reset_source,
  reset_source_url,
  completed_event_id,
  verification_status,
  created_at,
  updated_at
)
SELECT
  'CONFIRMED',
  'DIRECT',
  e.confidence,
  COALESCE(e.reset_at, e.effective_at, e.published_at, e.created_at),
  e.created_at,
  COALESCE(e.reset_at, e.effective_at, e.published_at, e.created_at),
  sp.source_account,
  e.source_url,
  e.id,
  e.verification_status,
  e.created_at,
  e.updated_at
FROM monitor_events e
JOIN source_posts sp ON sp.id = e.source_post_id
WHERE e.category = 'RESET_COMPLETED'
  AND e.verification_status <> 'REJECTED'
  AND NOT EXISTS (
    SELECT 1 FROM reset_cycles rc WHERE rc.completed_event_id = e.id
  );

-- Remove rows written under historical provider aliases. Runtime code uses the
-- canonical keys web_search, x_api, and llm-classifier.
DELETE FROM provider_status
WHERE provider_name IN ('x-api', 'web-search', 'null');
