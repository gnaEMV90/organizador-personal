import { auditAuthEvent, clearSessionCookie, revokeSessionByRequest } from '../../_lib/auth.js';
import { resolveRequestUser } from '../../_lib/access.js';
import { requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const auth = await resolveRequestUser(request, env);
    await revokeSessionByRequest(env.DB, request);
    if (auth) await auditAuthEvent(env.DB, request, 'logout', auth.user.id);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (error) {
    console.error('Planorha logout:', error);
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
