import { resolveRequestUser } from '../../_lib/access.js';
import { ensureAuthSchema } from '../../_lib/auth.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'Base de datos no configurada' }, 503);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth || auth.user.role !== 'admin') return json({ error: 'No autorizado' }, 403);
    await ensureAuthSchema(env.DB);

    const totals = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'trialing' THEN 1 ELSE 0 END) AS trialing,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'trial_expired' THEN 1 ELSE 0 END) AS trial_expired,
        SUM(CASE WHEN status = 'pending_verification' THEN 1 ELSE 0 END) AS pending_verification,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended
      FROM users
    `).first();
    const sessions = await env.DB.prepare(`
      SELECT COUNT(*) AS active_sessions
      FROM sessions
      WHERE revoked_at IS NULL AND expires_at > ?1
    `).bind(new Date().toISOString()).first();
    const registrations = await env.DB.prepare(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS registrations
      FROM users
      WHERE created_at >= ?1
      GROUP BY substr(created_at, 1, 10)
      ORDER BY day ASC
    `).bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).all();

    return json({
      totals: {
        total: Number(totals?.total || 0),
        trialing: Number(totals?.trialing || 0),
        active: Number(totals?.active || 0),
        trialExpired: Number(totals?.trial_expired || 0),
        pendingVerification: Number(totals?.pending_verification || 0),
        suspended: Number(totals?.suspended || 0),
        activeSessions: Number(sessions?.active_sessions || 0)
      },
      registrations: registrations.results || []
    });
  } catch (error) {
    console.error('Planorha admin overview:', error);
    return json({ error: 'No se pudo cargar el resumen' }, 500);
  }
}
