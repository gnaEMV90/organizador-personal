import { json } from './http.js';

export function authError(error, fallback = 'No se pudo completar la operación') {
  console.error('Planorha auth:', error);
  const status = Number(error?.status || 500);
  return json({ error: status >= 500 ? fallback : error.message }, status);
}

export function requireDatabase(env) {
  if (env.DB) return null;
  return json({ error: 'Base de datos no configurada' }, 503);
}

export function retryAfterResponse(retryAfter) {
  return json(
    { error: 'Demasiados intentos. Esperá unos minutos antes de volver a probar.', retryAfter },
    429,
    { 'Retry-After': String(retryAfter || 60) }
  );
}
