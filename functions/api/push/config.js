import { json, validateAccessUser } from '../../_lib/access.js';
import { ensurePushSchema } from '../../_lib/push.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ enabled: false, reason: 'missing-db' }, 503);

  try {
    const userId = await validateAccessUser(request, env);
    if (!userId) return json({ error: 'No autorizado' }, 401);

    await ensurePushSchema(env.DB);
    const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
    const row = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM push_subscriptions
      WHERE user_id = ?1 AND enabled = 1
    `).bind(userId).first();

    return json({
      enabled: Boolean(publicKey),
      publicKey,
      activeSubscriptions: Number(row?.total || 0),
      user: userId
    });
  } catch (error) {
    console.error('Planorha push config:', error);
    return json({ error: 'No se pudo consultar la configuración push' }, 500);
  }
}
