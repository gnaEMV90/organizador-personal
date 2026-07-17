import webpush from 'web-push';

const DELIVERY_WINDOW_MS = 10 * 60 * 1000;
const LOG_RETENTION_DAYS = 180;

function parseState(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && Array.isArray(parsed.tasks) ? parsed : null;
  } catch {
    return null;
  }
}

function partsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}

function zonedDateTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  const [hour, minute] = String(timeValue || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const expectedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(expectedAsUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInTimeZone(candidate, timeZone || 'UTC');
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0,
      0
    );
    candidate = new Date(candidate.getTime() + (expectedAsUtc - actualAsUtc));
  }

  return candidate;
}

function reminderKey(task) {
  if (!task?.date || !task?.time || task.reminderMinutes === '' || task.reminderMinutes == null) return '';
  return `${task.date}T${task.time}|${Number(task.reminderMinutes) || 0}`;
}

function reminderInstant(task, timeZone) {
  const dueAt = zonedDateTimeToUtc(task.date, task.time, timeZone);
  const minutes = Number(task.reminderMinutes);
  if (!dueAt || !Number.isFinite(minutes) || minutes < 0) return null;
  return new Date(dueAt.getTime() - minutes * 60_000);
}

function dueTasks(state, timeZone, now) {
  return (state.tasks || []).filter(task => {
    if (!task || task.completed || task.archived) return false;
    const key = reminderKey(task);
    if (!key) return false;
    const instant = reminderInstant(task, timeZone);
    if (!instant) return false;
    const age = now.getTime() - instant.getTime();
    return age >= 0 && age <= DELIVERY_WINDOW_MS;
  });
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
  if (await alreadyDelivered(env.DB, subscriptionRow.user_id, subscriptionRow.id, task.id, key)) return;

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
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    const expired = statusCode === 404 || statusCode === 410;
    await markFailure(env.DB, subscriptionRow.id, error?.body || error?.message || error, expired);
    if (!expired) throw error;
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
        const wasDelivered = await alreadyDelivered(env.DB, row.user_id, row.id, task.id, reminderKey(task));
        if (wasDelivered) continue;
        await sendTask(env, row, task, now);
        sent += 1;
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

export {
  zonedDateTimeToUtc,
  reminderInstant,
  reminderKey,
  dueTasks
};
