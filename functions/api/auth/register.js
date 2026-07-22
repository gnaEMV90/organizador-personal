import {
  auditAuthEvent,
  authRateIdentity,
  consumeRateLimit,
  registerUser
} from '../../_lib/auth.js';
import { authError, requireDatabase, retryAfterResponse } from '../../_lib/auth-http.js';
import { sendAuthEmail, verificationEmail } from '../../_lib/email.js';
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
    if (body.acceptedTerms !== true) return json({ error: 'Debés aceptar los términos y la política de privacidad.' }, 400);

    const rate = await consumeRateLimit(env.DB, {
      scope: 'register',
      identity: await authRateIdentity(request, body.email),
      limit: 5,
      windowSeconds: 15 * 60,
      blockSeconds: 30 * 60
    });
    if (!rate.allowed) return retryAfterResponse(rate.retryAfter);

    const created = await registerUser(env.DB, body);
    const origin = new URL(request.url).origin;
    const verificationUrl = `${origin}/?verify=${encodeURIComponent(created.verificationToken)}`;
    const message = verificationEmail({ name: created.user.name, verificationUrl });
    const delivery = await sendAuthEmail(env, { to: created.user.email, ...message });

    await auditAuthEvent(env.DB, request, 'register', created.user.id, { emailSent: delivery.sent });
    return json({
      ok: true,
      verificationRequired: true,
      emailSent: delivery.sent,
      emailConfigured: delivery.configured,
      ...(String(env.AUTH_DEBUG_TOKENS || '') === '1' ? { verificationToken: created.verificationToken } : {})
    }, 201);
  } catch (error) {
    return authError(error, 'No se pudo crear la cuenta');
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
