import { resolveRequestUser } from '../../_lib/access.js';
import { auditAuthEvent, clearSessionCookie, revokeAllSessions } from '../../_lib/auth.js';
import { requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    await revokeAllSessions(env.DB, auth.user.id);
    await auditAuthEvent(env.DB, request, 'logout_all', auth.user.id);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (error) {
    console.error('Planorha logout all:', error);
    return json({ error: 'No se pudieron cerrar las sesiones' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
