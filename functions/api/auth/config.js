import { authEmailConfigured } from '../../_lib/email.js';
import { json } from '../../_lib/http.js';
import { turnstileConfigured } from '../../_lib/turnstile.js';

export function onRequestGet({ env }) {
  const turnstileSiteKey = turnstileConfigured(env) ? String(env.TURNSTILE_SITE_KEY || '') : null;
  return json({
    trialDays: 7,
    emailConfigured: authEmailConfigured(env),
    paymentsConfigured: String(env.PAYMENTS_ENABLED || '') === '1',
    turnstileSiteKey
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, OPTIONS' } });
}
