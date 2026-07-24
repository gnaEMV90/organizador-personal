import { resolveRequestUser } from '../../_lib/access.js';
import { auditAuthEvent, ensureAuthSchema } from '../../_lib/auth.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

async function requireAdmin(request, env) {
  if (!env.DB) return { error: json({ error: 'Base de datos no configurada' }, 503) };
  const auth = await resolveRequestUser(request, env);
  if (!auth || auth.user.role !== 'admin') return { error: json({ error: 'No autorizado' }, 403) };
  return { auth };
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await requireAdmin(request, env);
    if (access.error) return access.error;
    await ensureAuthSchema(env.DB);
    const url = new URL(request.url);
    const search = String(url.searchParams.get('q') || '').trim().slice(0, 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const rows = await env.DB.prepare(`
      SELECT
        u.id, u.name, u.email, u.role, u.status, u.email_verified_at,
        u.trial_started_at, u.trial_ends_at, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > ?1) AS active_sessions
      FROM users u
      WHERE (?2 = '' OR u.email LIKE '%' || ?2 || '%' OR u.name LIKE '%' || ?2 || '%')
      ORDER BY u.created_at DESC
      LIMIT ?3
    `).bind(new Date().toISOString(), search, limit).all();
    return json({ users: rows.results || [] });
  } catch (error) {
    console.error('Planorha admin users GET:', error);
    return json({ error: 'No se pudieron consultar los usuarios' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const access = await requireAdmin(request, env);
    if (access.error) return access.error;
    const body = await readJsonBody(request);
    const userId = String(body.userId || '');
    const action = String(body.action || '');
    if (!userId || userId === access.auth.user.id) return json({ error: 'No podés aplicar esa acción sobre tu propia cuenta.' }, 400);

    const now = new Date().toISOString();
    let detail = {};
    if (action === 'suspend') {
      await env.DB.prepare(`UPDATE users SET status = 'suspended', updated_at = ?2 WHERE id = ?1`).bind(userId, now).run();
      await env.DB.prepare(`UPDATE sessions SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL`).bind(userId, now).run();
    } else if (action === 'activate') {
      await env.DB.prepare(`UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, ?2), updated_at = ?2 WHERE id = ?1`).bind(userId, now).run();
    } else if (action === 'restart_trial') {
      const ends = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await env.DB.prepare(`
        UPDATE users SET status = 'trialing', email_verified_at = COALESCE(email_verified_at, ?2),
          trial_started_at = ?2, trial_ends_at = ?3, updated_at = ?2 WHERE id = ?1
      `).bind(userId, now, ends).run();
      detail = { trialEndsAt: ends };
    } else if (action === 'extend_trial') {
      const days = Math.min(30, Math.max(1, Number(body.days || 7)));
      const user = await env.DB.prepare('SELECT trial_ends_at FROM users WHERE id = ?1').bind(userId).first();
      const base = Math.max(Date.now(), new Date(user?.trial_ends_at || 0).getTime() || 0);
      const ends = new Date(base + days * 86_400_000).toISOString();
      await env.DB.prepare(`UPDATE users SET status = 'trialing', trial_ends_at = ?2, updated_at = ?3 WHERE id = ?1`).bind(userId, ends, now).run();
      detail = { days, trialEndsAt: ends };
    } else {
      return json({ error: 'Acción no admitida' }, 400);
    }

    await auditAuthEvent(env.DB, request, `admin_${action}`, access.auth.user.id, { targetUserId: userId, ...detail });
    return json({ ok: true, ...detail });
  } catch (error) {
    console.error('Planorha admin users POST:', error);
    return json({ error: 'No se pudo actualizar el usuario' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, POST, OPTIONS' } });
}
