export function turnstileConfigured(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

export async function validateTurnstile(request, env, token) {
  if (!turnstileConfigured(env)) return { success: true, configured: false };
  if (!token) return { success: false, configured: true, error: 'missing_token' };

  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', String(token));
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });
  if (!response.ok) return { success: false, configured: true, error: `http_${response.status}` };
  const result = await response.json();
  return {
    success: Boolean(result.success),
    configured: true,
    error: (result['error-codes'] || []).join(',')
  };
}
