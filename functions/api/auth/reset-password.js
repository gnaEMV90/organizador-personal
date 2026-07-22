import {
  auditAuthEvent,
  consumeAuthToken,
  findUserById,
  setUserPassword
} from '../../_lib/auth.js';
import { authError, requireDatabase } from '../../_lib/auth-http.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const body = await readJsonBody(request);
    if (body.password !== body.confirmPassword) return json({ error: 'Las contraseñas no coinciden.' }, 400);
    const token = await consumeAuthToken(env.DB, String(body.token || ''), 'reset_password');
    if (!token) return json({ error: 'El enlace venció o ya fue utilizado.' }, 400);
    await setUserPassword(env.DB, token.user_id, body.password);
    const user = await findUserById(env.DB, token.user_id);
    await auditAuthEvent(env.DB, request, 'password_reset_completed', user.id);
    return json({ ok: true });
  } catch (error) {
    return authError(error, 'No se pudo cambiar la contraseña');
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
