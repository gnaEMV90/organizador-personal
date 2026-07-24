import { resolveRequestUser } from '../../_lib/access.js';
import {
  auditAuthEvent,
  createSession,
  publicUser,
  setUserPassword,
  verifyPassword
} from '../../_lib/auth.js';
import { authError, requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    const body = await readJsonBody(request);
    if (body.password !== body.confirmPassword) return json({ error: 'Las contraseñas no coinciden.' }, 400);
    if (auth.user.password_hash && !await verifyPassword(auth.user, body.currentPassword)) {
      return json({ error: 'La contraseña actual no es correcta.' }, 400);
    }

    await setUserPassword(env.DB, auth.user.id, body.password);
    const updatedUser = { ...auth.user, password_hash: 'set' };
    const session = await createSession(env.DB, updatedUser, request, body.deviceName);
    await auditAuthEvent(env.DB, request, auth.user.password_hash ? 'password_changed' : 'password_claimed', auth.user.id);
    return json({ ok: true, user: publicUser(updatedUser, session.id) }, 200, { 'Set-Cookie': session.cookie });
  } catch (error) {
    return authError(error, 'No se pudo cambiar la contraseña');
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
