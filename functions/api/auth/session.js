import { resolveRequestUser } from '../../_lib/access.js';
import { requireDatabase } from '../../_lib/auth-http.js';
import { json } from '../../_lib/http.js';

export async function onRequestGet({ request, env }) {
  const missingDb = requireDatabase(env);
  if (missingDb) return missingDb;
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ authenticated: false }, 401);
    return json({
      authenticated: true,
      user: auth.publicUser,
      source: auth.source,
      paymentsConfigured: String(env.PAYMENTS_ENABLED || '') === '1'
    });
  } catch (error) {
    console.error('Planorha auth session:', error);
    return json({ error: 'No se pudo validar la sesión' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, OPTIONS' } });
}
