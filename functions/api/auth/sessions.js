import { resolveRequestUser } from '../../_lib/access.js';
import { listUserSessions, revokeUserSession } from '../../_lib/auth.js';
import { requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    return json({ sessions: await listUserSessions(env.DB, auth.user.id, auth.sessionId) });
  } catch (error) {
    console.error('Planorha sessions GET:', error);
    return json({ error: 'No se pudieron consultar los dispositivos' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    const body = await readJsonBody(request);
    if (!body.sessionId || body.sessionId === auth.sessionId) return json({ error: 'Usá Cerrar sesión para este dispositivo.' }, 400);
    await revokeUserSession(env.DB, auth.user.id, String(body.sessionId));
    return json({ ok: true });
  } catch (error) {
    console.error('Planorha sessions DELETE:', error);
    return json({ error: 'No se pudo cerrar la sesión seleccionada' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, DELETE, OPTIONS' } });
}
