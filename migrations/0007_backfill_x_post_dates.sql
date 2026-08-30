-- X status IDs are Snowflake IDs. Recover publication timestamps for indexed
-- posts that were previously stored with published_at = NULL, then propagate
-- them to their monitor events so old search hits cannot sort by ingest time.
UPDATE source_posts
SET published_at = replace(
      strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        ((CAST(canonical_post_id AS INTEGER) >> 22) + 1288834974657) / 1000.0,
        'unixepoch'
      ),
      ' ', 'T'
    )
WHERE published_at IS NULL
  AND canonical_platform = 'x'
  AND length(canonical_post_id) BETWEEN 16 AND 20
  AND canonical_post_id NOT GLOB '*[^0-9]*'
  AND CAST(canonical_post_id AS INTEGER) > 0;

UPDATE monitor_events
SET published_at = (
      SELECT sp.published_at
      FROM source_posts sp
      WHERE sp.id = monitor_events.source_post_id
    ),
    updated_at = datetime('now')
WHERE published_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM source_posts sp
    WHERE sp.id = monitor_events.source_post_id
      AND sp.published_at IS NOT NULL
  );
