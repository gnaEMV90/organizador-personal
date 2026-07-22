import {
  ensureAuthSchema,
  provisionExternalUser,
  publicUser,
  refreshEntitlement,
  sessionFromRequest
} from './auth.js';
import { assertSameOrigin, json } from './http.js';

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

export function hasAccessConfiguration(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

async function validateCloudflareAccessIdentity(request, env) {
  if (!hasAccessConfiguration(env)) return null;
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
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const expectedIssuer = `https://${teamDomain}`;
  if (
    !audience.includes(expectedAudience) ||
    !Number.isFinite(Number(payload.exp)) ||
    Number(payload.exp) <= now ||
    Number(payload.nbf || 0) > now ||
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
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    decodeBase64Url(encodedSignature),
    data
  );
  if (!valid) return null;

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    name: String(payload.name || payload.common_name || '').trim(),
    source: 'cloudflare_access'
  };
}

export async function resolveRequestUser(request, env) {
  if (!env.DB) return null;
  await ensureAuthSchema(env.DB);

  const ownSession = await sessionFromRequest(env.DB, request);
  if (ownSession) {
    const user = await refreshEntitlement(env.DB, ownSession.user);
    return {
      user,
      publicUser: publicUser(user, ownSession.sessionId),
      sessionId: ownSession.sessionId,
      source: ownSession.source
    };
  }

  const accessIdentity = await validateCloudflareAccessIdentity(request, env);
  if (!accessIdentity) return null;
  const adminEmail = String(env.PLANORHA_ADMIN_EMAIL || '').trim().toLowerCase();
  const user = await provisionExternalUser(env.DB, {
    email: accessIdentity.email,
    name: accessIdentity.name,
    role: adminEmail ? (accessIdentity.email === adminEmail ? 'admin' : 'user') : 'admin'
  });
  const entitled = await refreshEntitlement(env.DB, user);
  return {
    user: entitled,
    publicUser: publicUser(entitled),
    sessionId: '',
    source: accessIdentity.source
  };
}

export async function validateAccessUser(request, env) {
  const auth = await resolveRequestUser(request, env);
  if (!auth) return null;
  const readMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  if (!readMethod && auth.publicUser.accessMode !== 'full') return null;
  return auth.user.id;
}

export { assertSameOrigin, json };
