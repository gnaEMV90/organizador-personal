import {
  auditAuthEvent,
  authRateIdentity,
  consumeRateLimit,
  createAuthToken,
  findUserByEmail
} from '../../_lib/auth.js';
import { requireDatabase, retryAfterResponse } from '../../_lib/auth-http.js';
import { resetPasswordEmail, sendAuthEmail } from '../../_lib/email.js';
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
      scope: 'forgot_password',
      identity: await authRateIdentity(request, body.email),
      limit: 5,
      windowSeconds: 60 * 60,
      blockSeconds: 60 * 60
    });
    if (!rate.allowed) return retryAfterResponse(rate.retryAfter);

    const user = await findUserByEmail(env.DB, body.email);
    let rawToken = '';
    let delivery = { sent: false, configured: false };
    if (user?.email_verified_at && user.password_hash) {
      rawToken = await createAuthToken(env.DB, user.id, 'reset_password');
      const resetUrl = `${new URL(request.url).origin}/?reset=${encodeURIComponent(rawToken)}`;
      delivery = await sendAuthEmail(env, { to: user.email, ...resetPasswordEmail({ name: user.name, resetUrl }) });
      await auditAuthEvent(env.DB, request, 'password_reset_requested', user.id, { emailSent: delivery.sent });
    }

    return json({
      ok: true,
      message: 'Si existe una cuenta con ese correo, enviaremos las instrucciones.',
      emailSent: delivery.sent,
      emailConfigured: delivery.configured,
      ...(rawToken && String(env.AUTH_DEBUG_TOKENS || '') === '1' ? { resetToken: rawToken } : {})
    });
  } catch (error) {
    console.error('Planorha forgot password:', error);
    return json({ error: 'No se pudo procesar la solicitud' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
