-- 0025_gambit_discovery_stats.sql
-- Additive migration: durable per-run discovery funnel for the broad-discovery
-- redesign. Each row records how many sources were attempted/succeeded/failed
-- and how the cross-source candidate pool was formed, deduplicated, ranked and
-- capped before the expensive analysis path.
--
-- This table is strictly additive: it does not modify old migrations, does not
-- rewrite historical rows, and does not change existing schema semantics.
-- History before this migration will have NULL stats (not zero).

CREATE TABLE IF NOT EXISTS gambit_discovery_stats (
  run_id INTEGER PRIMARY KEY REFERENCES gambit_runs(id) ON DELETE CASCADE,
  sources_attempted INTEGER NOT NULL DEFAULT 0,
  sources_succeeded INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  raw_items_observed INTEGER NOT NULL DEFAULT 0,
  stale_items INTEGER NOT NULL DEFAULT 0,
  malformed_items INTEGER NOT NULL DEFAULT 0,
  admitted_items INTEGER NOT NULL DEFAULT 0,
  exact_duplicates INTEGER NOT NULL DEFAULT 0,
  routine_noise_rejects INTEGER NOT NULL DEFAULT 0,
  strategic_eligible INTEGER NOT NULL DEFAULT 0,
  event_duplicates INTEGER NOT NULL DEFAULT 0,
  global_pool_size INTEGER NOT NULL DEFAULT 0,
  global_top_k_selected INTEGER NOT NULL DEFAULT 0,
  workflow_dispatches INTEGER NOT NULL DEFAULT 0,
  workflow_failures INTEGER NOT NULL DEFAULT 0,
  partial_source_failure INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_gambit_discovery_stats_run
  ON gambit_discovery_stats(run_id DESC);