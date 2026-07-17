import webpush from 'web-push';
import { dueTasks, reminderKey } from './schedule-core.js';

const LOG_RETENTION_DAYS = 180;

function parseState(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && Array.isArray(parsed.tasks) ? parsed : null;
  } catch {
    return null;
  }
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
  `).bind(subscriptionId, timestamp, String(error || '').slice(0, 1000), disable ? 1 : 0).run();
}

async function sendTask(env, subscriptionRow, task, now) {
  const key = reminderKey(task);
  if (await alreadyDelivered(env.DB, subscriptionRow.user_id, subscriptionRow.id, task.id, key)) return false;

  const subscription = JSON.parse(subscriptionRow.subscription_json);
  const payload = JSON.stringify({
    title: task.title || 'Planorha',
    body: task.notes || `${task.date} a las ${task.time}`,
    tag: `planorha-task-${task.id}-${key}`,
    taskId: task.id,
    url: '/#tareas'
  });

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'normal' });
    const timestamp = now.toISOString();
    await recordDelivery(env.DB, subscriptionRow.user_id, subscriptionRow.id, task.id, key, timestamp);
    await markSuccess(env.DB, subscriptionRow.id, timestamp);
    return true;
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    const expired = statusCode === 404 || statusCode === 410;
    await markFailure(env.DB, subscriptionRow.id, error?.body || error?.message || error, expired);
    if (!expired) throw error;
    return false;
  }
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

  let sent = 0;
  let failed = 0;

  for (const row of rows.results || []) {
    const state = parseState(row.state_json);
    if (!state) continue;
    const tasks = dueTasks(state, row.timezone || 'UTC', now);
    for (const task of tasks) {
      try {
        const delivered = await sendTask(env, row, task, now);
        if (delivered) sent += 1;
      } catch (error) {
        failed += 1;
        console.error('Planorha push delivery:', row.user_id, task.id, error);
      }
    }
  }

  return { subscriptions: (rows.results || []).length, sent, failed };
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
    return Response.json({
      ok: Boolean(env.DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
      service: 'planorha-push-worker'
    });
  },

  async scheduled(controller, env) {
    configureVapid(env);
    const now = new Date(controller.scheduledTime || Date.now());
    const result = await processSubscriptions(env, now);
    await cleanOldLogs(env.DB, now);
    console.log('Planorha push cron:', JSON.stringify({ at: now.toISOString(), ...result }));
  }
};
