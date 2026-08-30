-- Correct the direct X post that says the reset has already taken effect.
-- The canonical post id makes this migration safe to apply without relying on
-- an AUTOINCREMENT event id, and the evidence filters prevent an indexed
-- snippet from being promoted by accident.
UPDATE monitor_events
SET category = 'RESET_COMPLETED',
    title_en = 'Tibo indicates Codex usage has reset',
    title_zh = 'Tibo表示Codex用户用量已重置',
    summary_en = 'Tibo said he felt reset and that ChatGPT Work and Codex users had brand-new usage, indicating the usage reset had taken effect.',
    summary_zh = 'Tibo表示自己感觉已重置，并称 ChatGPT Work 和 Codex 用户获得了全新用量，表明额度重置已经生效。',
    confidence = 0.82,
    effective_at = NULL,
    reset_at = NULL,
    updated_at = datetime('now')
WHERE id IN (
  SELECT e.id
  FROM monitor_events e
  JOIN source_posts sp ON sp.id = e.source_post_id
  WHERE sp.canonical_platform = 'x'
    AND sp.canonical_post_id = '2093014447833116908'
    AND e.evidence_quality IN ('DIRECT', 'OFFICIAL')
    AND e.verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
);

-- Promote an existing planned cycle in place. This preserves the lifecycle
-- history while making the direct completion the authoritative confirmation.
UPDATE reset_cycles
SET status = 'CONFIRMED',
    confirmation_type = (
      SELECT CASE WHEN e.evidence_quality = 'OFFICIAL' THEN 'OFFICIAL' ELSE 'DIRECT' END
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    confirmation_confidence = (
      SELECT e.confidence
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    confirmed_reset_at = COALESCE(
      confirmed_reset_at,
      (
        SELECT COALESCE(e.reset_at, e.effective_at, e.published_at, e.created_at)
        FROM monitor_events e
        JOIN source_posts sp ON sp.id = e.source_post_id
        WHERE e.id = reset_cycles.planned_event_id
          AND sp.canonical_platform = 'x'
          AND sp.canonical_post_id = '2093014447833116908'
        LIMIT 1
      )
    ),
    confirmation_checked_at = datetime('now'),
    due_at = COALESCE(due_at, confirmed_reset_at),
    reset_source = (
      SELECT sp.source_account
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    reset_source_url = (
      SELECT e.source_url
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    completed_event_id = (
      SELECT e.id
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    verification_status = (
      SELECT e.verification_status
      FROM monitor_events e
      JOIN source_posts sp ON sp.id = e.source_post_id
      WHERE e.id = reset_cycles.planned_event_id
        AND sp.canonical_platform = 'x'
        AND sp.canonical_post_id = '2093014447833116908'
      LIMIT 1
    ),
    updated_at = datetime('now')
WHERE status <> 'CONFIRMED'
  AND verification_status <> 'REJECTED'
  AND planned_event_id IN (
    SELECT e.id
    FROM monitor_events e
    JOIN source_posts sp ON sp.id = e.source_post_id
    WHERE sp.canonical_platform = 'x'
      AND sp.canonical_post_id = '2093014447833116908'
      AND e.category = 'RESET_COMPLETED'
      AND e.evidence_quality IN ('DIRECT', 'OFFICIAL')
      AND e.verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
  );

-- If a deployment has no corresponding planned cycle, retain the completion
-- as a standalone confirmed cycle just like the normal runtime path does.
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
  CASE WHEN e.evidence_quality = 'OFFICIAL' THEN 'OFFICIAL' ELSE 'DIRECT' END,
  e.confidence,
  COALESCE(e.reset_at, e.effective_at, e.published_at, e.created_at),
  datetime('now'),
  COALESCE(e.reset_at, e.effective_at, e.published_at, e.created_at),
  sp.source_account,
  e.source_url,
  e.id,
  e.verification_status,
  e.created_at,
  datetime('now')
FROM monitor_events e
JOIN source_posts sp ON sp.id = e.source_post_id
WHERE sp.canonical_platform = 'x'
  AND sp.canonical_post_id = '2093014447833116908'
  AND e.category = 'RESET_COMPLETED'
  AND e.evidence_quality IN ('DIRECT', 'OFFICIAL')
  AND e.verification_status IN ('DIRECT_VERIFIED', 'OFFICIAL_VERIFIED')
  AND NOT EXISTS (
    SELECT 1
    FROM reset_cycles rc
    WHERE rc.completed_event_id = e.id
       OR rc.planned_event_id = e.id
  );
