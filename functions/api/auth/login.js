import {
  auditAuthEvent,
  authRateIdentity,
  consumeRateLimit,
  createSession,
  findUserByEmail,
  publicUser,
  refreshEntitlement,
  verifyPassword
} from '../../_lib/auth.js';
import { authError, requireDatabase, retryAfterResponse } from '../../_lib/auth-http.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';
import { validateTurnstile } from '../../_lib/turnstile.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);

  try {
    const body = await readJsonBody(request);
    const challenge = await validateTurnstile(request, env, body.turnstileToken);
    if (!challenge.success) return json({ error: 'No pudimos validar que seas una persona. Volvé a intentarlo.' }, 403);
    const rate = await consumeRateLimit(env.DB, {
      scope: 'login',
      identity: await authRateIdentity(request, body.email),
      limit: 8,
      windowSeconds: 15 * 60,
      blockSeconds: 30 * 60
    });
    if (!rate.allowed) return retryAfterResponse(rate.retryAfter);

    let user = await findUserByEmail(env.DB, body.email);
    const valid = user && await verifyPassword(user, body.password);
    if (!valid) {
      await auditAuthEvent(env.DB, request, 'login_failed', user?.id || null);
      return json({ error: 'Correo o contraseña incorrectos.' }, 401);
    }
    if (!user.email_verified_at) return json({ error: 'Primero verificá tu correo electrónico.', verificationRequired: true }, 403);
    if (user.status === 'suspended') return json({ error: 'La cuenta está suspendida.' }, 403);

    user = await refreshEntitlement(env.DB, user);
    const session = await createSession(env.DB, user, request, body.deviceName);
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE users SET last_login_at = ?2, updated_at = ?2 WHERE id = ?1').bind(user.id, now).run();
    await auditAuthEvent(env.DB, request, 'login_success', user.id, { sessionId: session.id });
    return json({ ok: true, user: publicUser(user, session.id) }, 200, { 'Set-Cookie': session.cookie });
  } catch (error) {
    return authError(error, 'No se pudo iniciar sesión');
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
