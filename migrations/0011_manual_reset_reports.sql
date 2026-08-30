-- Operator-reported reset confirmations are intentionally separate from
-- monitor_events so a Telegram assertion is never presented as X or official
-- evidence. Telegram update_id provides idempotency across webhook retries.
CREATE TABLE IF NOT EXISTS manual_reset_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_update_id INTEGER NOT NULL UNIQUE,
  telegram_message_id INTEGER,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  telegram_display_name TEXT,
  telegram_chat_id TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  reset_at TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manual_reset_reports_active_time
  ON manual_reset_reports(status, reset_at DESC, id DESC);
