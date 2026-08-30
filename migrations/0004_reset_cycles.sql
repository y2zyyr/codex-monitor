-- ============================================================
-- Tibo Codex Monitor - Reset Cycles & Confirmation Engine
-- ============================================================

-- Reset Cycles: tracks each active reset cycle with its status
CREATE TABLE IF NOT EXISTS reset_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN (
    'NONE','SCHEDULED','DUE','CONFIRMING','CONFIRMED','TIME_CHANGED','EXPIRED_UNCONFIRMED'
  )),
  planned_event_id INTEGER,
  expected_reset_at TEXT,          -- ISO 8601 UTC or null if approximate
  expected_reset_time_text TEXT,    -- Original text from post (e.g. "around 2pm PT tomorrow")
  expected_timezone TEXT,          -- IANA timezone (e.g. "America/Los_Angeles")
  is_approximate INTEGER NOT NULL DEFAULT 1,
  time_confidence TEXT DEFAULT 'LOW' CHECK(time_confidence IN ('HIGH','MEDIUM','LOW')),
  due_at TEXT,                      -- When the expected time was reached
  time_changed_event_id INTEGER,    -- If a RESET_TIME_CHANGED event modified this cycle
  previous_expected_reset_at TEXT,  -- The previous expected time before change
  confirmation_type TEXT DEFAULT 'NONE' CHECK(confirmation_type IN ('NONE','DIRECT','OFFICIAL','COMMUNITY')),
  confirmation_confidence REAL DEFAULT 0.0,
  confirmed_reset_at TEXT,          -- Actual confirmed reset time
  confirmation_checked_at TEXT,     -- Last time confirmation was checked
  confirmation_evidence_count INTEGER DEFAULT 0,
  reset_source TEXT,                -- Source account name (e.g. "thsottiaux")
  reset_source_url TEXT,            -- URL to the source post
  completed_event_id INTEGER,       -- The RESET_COMPLETED event if any
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (planned_event_id) REFERENCES monitor_events(id),
  FOREIGN KEY (time_changed_event_id) REFERENCES monitor_events(id),
  FOREIGN KEY (completed_event_id) REFERENCES monitor_events(id)
);

-- Index for finding current active cycle
CREATE INDEX IF NOT EXISTS idx_reset_cycles_status
  ON reset_cycles(status, created_at DESC);

-- Confirmation Evidence: individual pieces of evidence for reset confirmation
CREATE TABLE IF NOT EXISTS reset_confirmation_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reset_cycle_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('DIRECT','OFFICIAL','COMMUNITY')),
  source_url TEXT NOT NULL,
  source_name TEXT,                  -- e.g. "Tibo", "OpenAI", "Community User"
  source_author TEXT,               -- e.g. "@thsottiaux", "@OpenAI"
  source_text TEXT,                  -- The relevant snippet or text
  published_at TEXT,                 -- When the source was published
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  semantic_result TEXT,              -- JSON result from AI classification
  classification TEXT,               -- RESET_CONFIRMED, NOT_CONFIRMED, AMBIGUOUS
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reset_cycle_id) REFERENCES reset_cycles(id)
);

-- Unique constraint: one evidence entry per source URL per cycle
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_source
  ON reset_confirmation_evidence(reset_cycle_id, source_url);
