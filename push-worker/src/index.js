import webpush from 'web-push';
import { dueTasks, reminderKey } from './schedule-core.js';

const LOG_RETENTION_DAYS = 180;
const TEST_EXPIRATION_MS = 15 * 60 * 1000;

function parseState(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && Array.isArray(parsed.tasks) ? parsed : null;
  } catch {
    return null;
  }
}

function safeError(error) {
  return String(error?.body || error?.message || error || 'Error desconocido').slice(0, 600);
}

async function ensureStatusTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_worker_status (
      id TEXT PRIMARY KEY,
      last_run_at TEXT,
      subscriptions INTEGER NOT NULL DEFAULT 0,
      due INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `).run();
}

async function ensureTestTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS push_test_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )
  `).run();
}

async function saveWorkerStatus(db, status) {
  await ensureStatusTable(db);
  await db.prepare(`
    INSERT INTO push_worker_status (
      id, last_run_at, subscriptions, due, sent, failed, last_error
    ) VALUES ('main', ?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(id) DO UPDATE SET
      last_run_at = excluded.last_run_at,
      subscriptions = excluded.subscriptions,
      due = excluded.due,
      sent = excluded.sent,
      failed = excluded.failed,
      last_error = excluded.last_error
  `).bind(
    status.lastRunAt,
    status.subscriptions || 0,
    status.due || 0,
    status.sent || 0,
    status.failed || 0,
    status.lastError || null
  ).run();
}

async function readWorkerStatus(db) {
  await ensureStatusTable(db);
  return db.prepare(`
    SELECT last_run_at, subscriptions, due, sent, failed, last_error
    FROM push_worker_status
    WHERE id = 'main'
  `).first();
}

async function readLatestTest(db) {
  await ensureTestTable(db);
  return db.prepare(`
    SELECT status, created_at, processed_at, sent, failed, last_error
    FROM push_test_requests
    ORDER BY created_at DESC
    LIMIT 1
  `).first();
}

async function alreadyDelivered(db, userId, subscriptionId, taskId, key) {
  const row = await db.prepare(`
    SELECT 1 AS found
    FROM push_delivery_log
    WHERE user_id = ?1 AND subscription_id = ?2 AND task_id = ?3 AND reminder_key = ?4
    LIMIT 1
  `).bind(userId, subscriptionId, taskId, key).first();
  return Boolean(row?.found);
}

async function recordDelivery(db, userId, subscriptionId, taskId, key, sentAt) {
  await db.prepare(`
    INSERT OR IGNORE INTO push_delivery_log (user_id, subscription_id, task_id, reminder_key, sent_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(userId, subscriptionId, taskId, key, sentAt).run();
}

async function markSuccess(db, subscriptionId, timestamp) {
  await db.prepare(`
    UPDATE push_subscriptions
    SET last_success_at = ?2, last_error = NULL, updated_at = ?2
    WHERE id = ?1
  `).bind(subscriptionId, timestamp).run();
}

async function markFailure(db, subscriptionId, error, disable = false) {
  const timestamp = new Date().toISOString();
  await db.prepare(`
    UPDATE push_subscriptions
    SET last_failure_at = ?2,
        last_error = ?3,
        enabled = CASE WHEN ?4 = 1 THEN 0 ELSE enabled END,
        updated_at = ?2
    WHERE id = ?1
  `).bind(subscriptionId, timestamp, safeError(error), disable ? 1 : 0).run();
}

async function sendPayload(env, subscriptionRow, payload) {
  try {
    await webpush.sendNotification(
      JSON.parse(subscriptionRow.subscription_json),
      JSON.stringify(payload),
      { TTL: 3600, urgency: 'high' }
    );
    await markSuccess(env.DB, subscriptionRow.id, new Date().toISOString());
    return true;
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    const expired = statusCode === 404 || statusCode === 410;
    await markFailure(env.DB, subscriptionRow.id, error, expired);
    throw error;
  }
}

async function sendTask(env, subscriptionRow, task, now) {
  const key = reminderKey(task);
  if (await alreadyDelivered(env.DB, subscriptionRow.user_id, subscriptionRow.id, task.id, key)) return false;

  await sendPayload(env, subscriptionRow, {
    title: task.title || 'Planorha',
    body: task.notes || `${task.date} a las ${task.time}`,
    tag: `planorha-task-${task.id}-${key}`,
    taskId: task.id,
    url: '/#tareas'
  });

  const timestamp = now.toISOString();
  await recordDelivery(env.DB, subscriptionRow.user_id, subscriptionRow.id, task.id, key, timestamp);
  return true;
}

async function processTestRequests(env, now) {
  await ensureTestTable(env.DB);
  const expiration = new Date(now.getTime() - TEST_EXPIRATION_MS).toISOString();
  await env.DB.prepare(`
    UPDATE push_test_requests
    SET status = 'expired', processed_at = ?2, last_error = 'La prueba venció antes de ser procesada.'
    WHERE status = 'pending' AND created_at < ?1
  `).bind(expiration, now.toISOString()).run();

  const pending = await env.DB.prepare(`
    SELECT id, user_id, created_at
    FROM push_test_requests
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 20
  `).all();

  let testsSent = 0;
  let testsFailed = 0;

  for (const request of pending.results || []) {
    const subscriptions = await env.DB.prepare(`
      SELECT id, user_id, subscription_json
      FROM push_subscriptions
      WHERE user_id = ?1 AND enabled = 1
    `).bind(request.user_id).all();

    let sent = 0;
    let failed = 0;
    let lastError = '';

    for (const subscription of subscriptions.results || []) {
      try {
        await sendPayload(env, subscription, {
          title: 'Planorha',
          body: 'Prueba real del servidor: las notificaciones en segundo plano funcionan.',
          tag: `planorha-server-test-${request.id}`,
          taskId: '',
          url: '/#ajustes'
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        lastError = safeError(error);
      }
    }

    if (!(subscriptions.results || []).length) lastError = 'No hay suscripciones activas para este usuario.';
    const status = sent > 0 ? 'sent' : 'failed';
    await env.DB.prepare(`
      UPDATE push_test_requests
      SET status = ?2, processed_at = ?3, sent = ?4, failed = ?5, last_error = ?6
      WHERE id = ?1
    `).bind(request.id, status, now.toISOString(), sent, failed, lastError || null).run();

    testsSent += sent;
    testsFailed += failed || (sent ? 0 : 1);
  }

  return { tests: (pending.results || []).length, testsSent, testsFailed };
}

async function processSubscriptions(env, now) {
  const rows = await env.DB.prepare(`
    SELECT
      ps.id,
      ps.user_id,
      ps.subscription_json,
      ps.timezone,
      us.state_json
    FROM push_subscriptions ps
    INNER JOIN user_state us ON us.user_id = ps.user_id
    WHERE ps.enabled = 1
  `).all();

  let due = 0;
  let sent = 0;
  let failed = 0;
  let lastError = '';

  for (const row of rows.results || []) {
    const state = parseState(row.state_json);
    if (!state) continue;
    const tasks = dueTasks(state, row.timezone || 'UTC', now);
    due += tasks.length;

    for (const task of tasks) {
      try {
        const delivered = await sendTask(env, row, task, now);
        if (delivered) sent += 1;
      } catch (error) {
        failed += 1;
        lastError = safeError(error);
        console.error('Planorha push delivery:', JSON.stringify({ user: row.user_id, taskId: task.id, error: lastError }));
      }
    }
  }

  return { subscriptions: (rows.results || []).length, due, sent, failed, lastError };
}

async function cleanOldLogs(db, now) {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM push_delivery_log WHERE sent_at < ?1').bind(cutoff).run();
}

function configureVapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    throw new Error('Faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT.');
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/health') return new Response('Not found', { status: 404 });

    let status = null;
    let latestTest = null;
    let statusError = '';
    try {
      if (env.DB) {
        [status, latestTest] = await Promise.all([readWorkerStatus(env.DB), readLatestTest(env.DB)]);
      }
    } catch (error) {
      statusError = safeError(error);
    }

    return Response.json({
      ok: Boolean(env.DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
      service: 'planorha-push-worker',
      cron: status ? {
        lastRunAt: status.last_run_at,
        subscriptions: Number(status.subscriptions || 0),
        due: Number(status.due || 0),
        sent: Number(status.sent || 0),
        failed: Number(status.failed || 0),
        lastError: status.last_error || null
      } : null,
      latestTest: latestTest ? {
        status: latestTest.status,
        createdAt: latestTest.created_at,
        processedAt: latestTest.processed_at,
        sent: Number(latestTest.sent || 0),
        failed: Number(latestTest.failed || 0),
        lastError: latestTest.last_error || null
      } : null,
      statusError: statusError || null
    });
  },

  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime || Date.now());
    let result = { subscriptions: 0, due: 0, sent: 0, failed: 0, lastError: '' };

    try {
      configureVapid(env);
      const testResult = await processTestRequests(env, now);
      result = { ...(await processSubscriptions(env, now)), ...testResult };
      await cleanOldLogs(env.DB, now);
    } catch (error) {
      result.failed += 1;
      result.lastError = safeError(error);
      console.error('Planorha push cron fatal:', result.lastError);
    }

    await saveWorkerStatus(env.DB, {
      lastRunAt: now.toISOString(),
      ...result
    });

    console.log('Planorha push cron:', JSON.stringify({ at: now.toISOString(), ...result }));
  }
};
