import { auditAuthEvent, createSession, publicUser, verifyUserEmail } from '../../_lib/auth.js';
import { authError, requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);

  try {
    const body = await readJsonBody(request);
    const token = String(body.token || '');
    if (!token) return json({ error: 'El enlace de verificación no es válido.' }, 400);
    const user = await verifyUserEmail(env.DB, token);
    if (!user) return json({ error: 'El enlace venció o ya fue utilizado.' }, 400);

    const session = await createSession(env.DB, user, request, body.deviceName);
    await auditAuthEvent(env.DB, request, 'email_verified', user.id);
    return json({ ok: true, user: publicUser(user, session.id) }, 200, { 'Set-Cookie': session.cookie });
  } catch (error) {
    return authError(error, 'No se pudo verificar la cuenta');
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
