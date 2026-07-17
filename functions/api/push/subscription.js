import { assertSameOrigin, json, validateAccessUser } from '../../_lib/access.js';
import { ensurePushSchema, isValidSubscription, subscriptionId } from '../../_lib/push.js';

async function authenticatedUser(request, env) {
  if (!env.DB) return { error: json({ error: 'D1 no configurado' }, 503) };
  const userId = await validateAccessUser(request, env);
  if (!userId) return { error: json({ error: 'No autorizado' }, 401) };
  return { userId };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authenticatedUser(request, env);
    if (auth.error) return auth.error;
    await ensurePushSchema(env.DB);

    const rows = await env.DB.prepare(`
      SELECT id, endpoint, timezone, device_name, enabled, created_at, updated_at, last_success_at, last_failure_at, last_error
      FROM push_subscriptions
      WHERE user_id = ?1
      ORDER BY updated_at DESC
    `).bind(auth.userId).all();

    return json({ subscriptions: rows.results || [] });
  } catch (error) {
    console.error('Planorha push subscription GET:', error);
    return json({ error: 'No se pudieron consultar las suscripciones' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);

  try {
    const auth = await authenticatedUser(request, env);
    if (auth.error) return auth.error;
    const rawBody = await request.text();
    if (rawBody.length > 100_000) return json({ error: 'Contenido demasiado grande' }, 413);

    const body = JSON.parse(rawBody);
    if (!isValidSubscription(body.subscription)) return json({ error: 'Suscripción inválida' }, 400);

    await ensurePushSchema(env.DB);
    const now = new Date().toISOString();
    const id = await subscriptionId(body.subscription.endpoint);
    const timezone = String(body.timezone || 'UTC').slice(0, 80);
    const deviceName = String(body.deviceName || '').slice(0, 120);
    const userAgent = String(request.headers.get('User-Agent') || '').slice(0, 500);

    await env.DB.prepare(`
      INSERT INTO push_subscriptions (
        id, user_id, endpoint, subscription_json, timezone, device_name, user_agent,
        enabled, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        subscription_json = excluded.subscription_json,
        timezone = excluded.timezone,
        device_name = excluded.device_name,
        user_agent = excluded.user_agent,
        enabled = 1,
        updated_at = excluded.updated_at,
        last_error = NULL
    `).bind(
      id,
      auth.userId,
      body.subscription.endpoint,
      JSON.stringify(body.subscription),
      timezone,
      deviceName,
      userAgent,
      now
    ).run();

    return json({ ok: true, id, user: auth.userId });
  } catch (error) {
    console.error('Planorha push subscription POST:', error);
    return json({ error: 'No se pudo guardar la suscripción' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);

  try {
    const auth = await authenticatedUser(request, env);
    if (auth.error) return auth.error;
    const body = await request.json();
    const endpoint = String(body.endpoint || '');
    if (!endpoint.startsWith('https://')) return json({ error: 'Endpoint inválido' }, 400);

    await ensurePushSchema(env.DB);
    await env.DB.prepare(`
      UPDATE push_subscriptions
      SET enabled = 0, updated_at = ?3
      WHERE user_id = ?1 AND endpoint = ?2
    `).bind(auth.userId, endpoint, new Date().toISOString()).run();

    return json({ ok: true });
  } catch (error) {
    console.error('Planorha push subscription DELETE:', error);
    return json({ error: 'No se pudo revocar la suscripción' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, POST, DELETE, OPTIONS' } });
}
