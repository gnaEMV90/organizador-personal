export function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function readJsonBody(request, maxBytes = 100_000) {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    const error = new Error('Contenido demasiado grande');
    error.status = 413;
    throw error;
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error('JSON inválido');
    error.status = 400;
    throw error;
  }
}

export function methodNotAllowed(allow) {
  return new Response(null, { status: 204, headers: { Allow: allow } });
}
