export async function ensurePushSchema(db) {
  await db.batch([
    db.prepare(`
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
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
      ON push_subscriptions (user_id, enabled)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS push_delivery_log (
        user_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        reminder_key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (user_id, subscription_id, task_id, reminder_key)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_push_delivery_log_sent
      ON push_delivery_log (sent_at)
    `)
  ]);
}

export async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function isValidSubscription(value) {
  return Boolean(
    value &&
    typeof value.endpoint === 'string' &&
    value.endpoint.startsWith('https://') &&
    value.keys &&
    typeof value.keys.p256dh === 'string' &&
    typeof value.keys.auth === 'string'
  );
}
