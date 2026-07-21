import { assertSameOrigin, json, validateAccessUser } from '../../_lib/access.js';
import { ensurePushSchema } from '../../_lib/push.js';

async function authenticatedUser(request, env) {
  if (!env.DB) return { error: json({ error: 'D1 no configurado' }, 503) };
  const userId = await validateAccessUser(request, env);
  if (!userId) return { error: json({ error: 'No autorizado' }, 401) };
  return { userId };
}

async function latestRequest(db, userId) {
  return db.prepare(`
    SELECT id, status, created_at, processed_at, sent, failed, last_error
    FROM push_test_requests
    WHERE user_id = ?1
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId).first();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await authenticatedUser(request, env);
    if (auth.error) return auth.error;
    await ensurePushSchema(env.DB);
    return json({ test: await latestRequest(env.DB, auth.userId) });
  } catch (error) {
    console.error('Planorha push test GET:', error);
    return json({ error: 'No se pudo consultar la prueba push' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);

  try {
    const auth = await authenticatedUser(request, env);
    if (auth.error) return auth.error;
    await ensurePushSchema(env.DB);

    const active = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM push_subscriptions
      WHERE user_id = ?1 AND enabled = 1
    `).bind(auth.userId).first();
    if (!Number(active?.total || 0)) return json({ error: 'No hay dispositivos activos para probar' }, 409);

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO push_test_requests (id, user_id, status, created_at, sent, failed)
      VALUES (?1, ?2, 'pending', ?3, 0, 0)
    `).bind(id, auth.userId, createdAt).run();

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(`
      DELETE FROM push_test_requests
      WHERE user_id = ?1 AND created_at < ?2
    `).bind(auth.userId, cutoff).run();

    return json({
      ok: true,
      test: { id, status: 'pending', created_at: createdAt, processed_at: null, sent: 0, failed: 0, last_error: null }
    });
  } catch (error) {
    console.error('Planorha push test POST:', error);
    return json({ error: 'No se pudo programar la prueba push' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } });
}
