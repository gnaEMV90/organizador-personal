const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function normalizeDomain(value) {
  return String(value || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function hasRequiredConfiguration(env) {
  return Boolean(env.DB && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

async function validateAccessJwt(request, env) {
  const teamDomain = normalizeDomain(env.ACCESS_TEAM_DOMAIN);
  const expectedAudience = String(env.ACCESS_AUD || '').trim();
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) return null;

  const parts = assertion.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonPart(encodedHeader);
  const payload = decodeJsonPart(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(payload.exp);
  const notBefore = Number(payload.nbf || 0);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const expectedIssuer = `https://${teamDomain}`;
  if (
    !audience.includes(expectedAudience) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    notBefore > now ||
    payload.iss !== expectedIssuer
  ) return null;

  const certResponse = await fetch(`${expectedIssuer}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!certResponse.ok) return null;

  const jwks = await certResponse.json();
  const jwk = (jwks.keys || []).find(key => key.kid === header.kid);
  if (!jwk) return null;

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = decodeBase64Url(encodedSignature);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data);
  if (!valid) return null;

  const userId = String(payload.email || payload.sub || '').trim().toLowerCase();
  return userId || null;
}

function isValidState(value) {
  return Boolean(
    value &&
    Array.isArray(value.categories) &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.lists)
  );
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!hasRequiredConfiguration(env)) return json({ error: 'Sincronización no configurada' }, 503);

  try {
    const userId = await validateAccessJwt(request, env);
    if (!userId) return json({ error: 'No autorizado' }, 401);

    await ensureSchema(env.DB);
    const row = await env.DB.prepare(
      'SELECT state_json, updated_at FROM user_state WHERE user_id = ?1'
    ).bind(userId).first();

    return json({
      state: row ? JSON.parse(row.state_json) : null,
      updatedAt: row?.updated_at || null,
      user: userId
    });
  } catch (error) {
    console.error('Planorha GET state:', error);
    return json({ error: 'No se pudo leer la información' }, 500);
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  if (!hasRequiredConfiguration(env)) return json({ error: 'Sincronización no configurada' }, 503);

  try {
    const userId = await validateAccessJwt(request, env);
    if (!userId) return json({ error: 'No autorizado' }, 401);

    const rawBody = await request.text();
    if (rawBody.length > 750_000) return json({ error: 'Contenido demasiado grande' }, 413);

    const body = JSON.parse(rawBody);
    if (!isValidState(body.state)) return json({ error: 'Estado inválido' }, 400);

    await ensureSchema(env.DB);
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO user_state (user_id, state_json, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(user_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).bind(userId, JSON.stringify(body.state), updatedAt).run();

    return json({ updatedAt, user: userId });
  } catch (error) {
    console.error('Planorha PUT state:', error);
    return json({ error: 'No se pudo guardar la información' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, PUT, OPTIONS' } });
}