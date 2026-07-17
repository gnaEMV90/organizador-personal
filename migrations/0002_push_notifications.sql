CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  device_name TEXT,
  user_agent TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id, enabled);

CREATE TABLE IF NOT EXISTS push_delivery_log (
  user_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  reminder_key TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subscription_id, task_id, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_log_sent
  ON push_delivery_log (sent_at);
