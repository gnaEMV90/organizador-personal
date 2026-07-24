import {
  auditAuthEvent,
  authRateIdentity,
  consumeRateLimit,
  createAuthToken,
  findUserByEmail
} from '../../_lib/auth.js';
import { requireDatabase, retryAfterResponse } from '../../_lib/auth-http.js';
import { sendAuthEmail, verificationEmail } from '../../_lib/email.js';
import { assertSameOrigin, json, readJsonBody } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const body = await readJsonBody(request);
    const rate = await consumeRateLimit(env.DB, {
      scope: 'resend_verification',
      identity: await authRateIdentity(request, body.email),
      limit: 4,
      windowSeconds: 60 * 60,
      blockSeconds: 60 * 60
    });
    if (!rate.allowed) return retryAfterResponse(rate.retryAfter);

    const user = await findUserByEmail(env.DB, body.email);
    let delivery = { sent: false, configured: false };
    let rawToken = '';
    if (user && !user.email_verified_at) {
      rawToken = await createAuthToken(env.DB, user.id, 'verify_email');
      const verificationUrl = `${new URL(request.url).origin}/?verify=${encodeURIComponent(rawToken)}`;
      delivery = await sendAuthEmail(env, { to: user.email, ...verificationEmail({ name: user.name, verificationUrl }) });
      await auditAuthEvent(env.DB, request, 'verification_resent', user.id, { emailSent: delivery.sent });
    }
    return json({
      ok: true,
      message: 'Si la cuenta existe y está pendiente, enviaremos un nuevo enlace.',
      emailSent: delivery.sent,
      emailConfigured: delivery.configured,
      ...(rawToken && String(env.AUTH_DEBUG_TOKENS || '') === '1' ? { verificationToken: rawToken } : {})
    });
  } catch (error) {
    console.error('Planorha resend verification:', error);
    return json({ error: 'No se pudo procesar la solicitud' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } });
}
