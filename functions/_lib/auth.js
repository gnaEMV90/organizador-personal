const SESSION_COOKIE = 'planorha_session';
const SESSION_DAYS = 30;
const TRIAL_DAYS = 7;
const PASSWORD_ITERATIONS = 310_000;
const TOKEN_TTL_MINUTES = {
  verify_email: 24 * 60,
  reset_password: 60
};

const encoder = new TextEncoder();
let schemaPromise = null;

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  const a = base64UrlToBytes(left);
  const b = base64UrlToBytes(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);
}

function isoAfter({ days = 0, minutes = 0 } = {}) {
  return new Date(Date.now() + days * 86_400_000 + minutes * 60_000).toISOString();
}

function cookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}

function deviceLabel(request, supplied = '') {
  if (supplied) return String(supplied).trim().slice(0, 120);
  const ua = request.headers.get('User-Agent') || 'Dispositivo desconocido';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone o iPad';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  return ua.slice(0, 120);
}

async function createSchema(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT,
      password_salt TEXT,
      password_iterations INTEGER,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending_verification',
      email_verified_at TEXT,
      trial_started_at TEXT,
      trial_ends_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_name TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at, expires_at)`,
    `CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens(type, token_hash, used_at, expires_at)`,
    `CREATE TABLE IF NOT EXISTS auth_rate_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at TEXT NOT NULL,
      blocked_until TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS auth_audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      detail_json TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_log(user_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price_minor INTEGER,
      currency TEXT,
      interval TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      features_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      plan_id TEXT,
      provider TEXT,
      external_id TEXT,
      status TEXT NOT NULL,
      current_period_start TEXT,
      current_period_end TEXT,
      canceled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, status, updated_at)`
  ];
  for (const statement of statements) await db.prepare(statement).run();
}

export async function ensureAuthSchema(db) {
  if (!schemaPromise) schemaPromise = createSchema(db).catch(error => { schemaPromise = null; throw error; });
  await schemaPromise;
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

export function validatePasswordPolicy(password) {
  const value = String(password || '');
  if (value.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (value.length > 200) return 'La contraseña es demasiado larga.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value) || !/\d/.test(value)) return 'La contraseña debe incluir letras y números.';
  return '';
}

async function passwordRecord(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return {
    hash: await derivePassword(password, salt, PASSWORD_ITERATIONS),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_ITERATIONS
  };
}

export async function verifyPassword(user, password) {
  if (!user?.password_hash || !user?.password_salt) return false;
  const derived = await derivePassword(
    String(password || ''),
    base64UrlToBytes(user.password_salt),
    Number(user.password_iterations || PASSWORD_ITERATIONS)
  );
  return constantTimeEqual(derived, user.password_hash);
}

export async function setUserPassword(db, userId, password) {
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    const error = new Error(policyError);
    error.status = 400;
    throw error;
  }
  const record = await passwordRecord(password);
  await db.prepare(`
    UPDATE users
    SET password_hash = ?2, password_salt = ?3, password_iterations = ?4, updated_at = ?5
    WHERE id = ?1
  `).bind(userId, record.hash, record.salt, record.iterations, new Date().toISOString()).run();
  await db.prepare(`UPDATE sessions SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL`).bind(userId, new Date().toISOString()).run();
}

export async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?1 COLLATE NOCASE').bind(normalizeEmail(email)).first();
}

export async function findUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?1').bind(userId).first();
}

async function migrateLegacyRows(db, email, userId) {
  const operations = [
    [`INSERT OR IGNORE INTO user_state (user_id, state_json, updated_at)
      SELECT ?2, state_json, updated_at FROM user_state WHERE user_id = ?1`, [email, userId]],
    [`UPDATE push_subscriptions SET user_id = ?2 WHERE user_id = ?1`, [email, userId]],
    [`UPDATE push_delivery_log SET user_id = ?2 WHERE user_id = ?1`, [email, userId]],
    [`UPDATE push_test_requests SET user_id = ?2 WHERE user_id = ?1`, [email, userId]]
  ];
  for (const [sql, bindings] of operations) {
    try { await db.prepare(sql).bind(...bindings).run(); } catch { /* La tabla puede no existir todavía. */ }
  }
}

export async function provisionExternalUser(db, { email, name = '', role = 'user' }) {
  await ensureAuthSchema(db);
  const normalizedEmail = normalizeEmail(email);
  let user = await findUserByEmail(db, normalizedEmail);
  if (!user) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO users (
        id, name, email, role, status, email_verified_at,
        trial_started_at, trial_ends_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5, NULL, ?5, ?5)
    `).bind(id, cleanName(name) || normalizedEmail.split('@')[0], normalizedEmail, role, now).run();
    user = await findUserById(db, id);
  } else if (user.status === 'pending_verification' && !user.email_verified_at) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE users SET status = 'active', email_verified_at = ?2, role = ?3, updated_at = ?2 WHERE id = ?1`).bind(user.id, now, role).run();
    user = await findUserById(db, user.id);
  } else if (role === 'admin' && user.role !== 'admin') {
    await db.prepare(`UPDATE users SET role = 'admin', updated_at = ?2 WHERE id = ?1`).bind(user.id, new Date().toISOString()).run();
    user = await findUserById(db, user.id);
  }
  await migrateLegacyRows(db, normalizedEmail, user.id);
  return user;
}

export async function createAuthToken(db, userId, type) {
  const ttlMinutes = TOKEN_TTL_MINUTES[type];
  if (!ttlMinutes) throw new Error('Tipo de token no admitido');
  const rawToken = randomToken(32);
  const now = new Date().toISOString();
  await db.prepare(`UPDATE auth_tokens SET used_at = ?3 WHERE user_id = ?1 AND type = ?2 AND used_at IS NULL`).bind(userId, type, now).run();
  await db.prepare(`
    INSERT INTO auth_tokens (id, user_id, type, token_hash, created_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(crypto.randomUUID(), userId, type, await sha256(rawToken), now, isoAfter({ minutes: ttlMinutes })).run();
  return rawToken;
}

export async function consumeAuthToken(db, rawToken, type) {
  const hash = await sha256(rawToken);
  const row = await db.prepare(`
    SELECT * FROM auth_tokens
    WHERE token_hash = ?1 AND type = ?2 AND used_at IS NULL AND expires_at > ?3
  `).bind(hash, type, new Date().toISOString()).first();
  if (!row) return null;
  const usedAt = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE auth_tokens SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL
  `).bind(row.id, usedAt).run();
  return Number(result?.meta?.changes || 0) === 1 ? row : null;
}

export async function registerUser(db, { name, email, password }) {
  await ensureAuthSchema(db);
  const normalizedEmail = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    const error = new Error('Ingresá un correo electrónico válido.');
    error.status = 400;
    throw error;
  }
  const normalizedName = cleanName(name);
  if (normalizedName.length < 2) {
    const error = new Error('Ingresá tu nombre.');
    error.status = 400;
    throw error;
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    const error = new Error(policyError);
    error.status = 400;
    throw error;
  }
  if (await findUserByEmail(db, normalizedEmail)) {
    const error = new Error('Ya existe una cuenta con ese correo.');
    error.status = 409;
    throw error;
  }
  const record = await passwordRecord(password);
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO users (
      id, name, email, password_hash, password_salt, password_iterations,
      role, status, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'user', 'pending_verification', ?7, ?7)
  `).bind(userId, normalizedName, normalizedEmail, record.hash, record.salt, record.iterations, now).run();
  return {
    user: await findUserById(db, userId),
    verificationToken: await createAuthToken(db, userId, 'verify_email')
  };
}

export async function verifyUserEmail(db, rawToken) {
  await ensureAuthSchema(db);
  const token = await consumeAuthToken(db, rawToken, 'verify_email');
  if (!token) return null;
  const now = new Date().toISOString();
  const trialEndsAt = isoAfter({ days: TRIAL_DAYS });
  await db.prepare(`
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, ?2),
        status = CASE WHEN status = 'pending_verification' THEN 'trialing' ELSE status END,
        trial_started_at = COALESCE(trial_started_at, ?2),
        trial_ends_at = COALESCE(trial_ends_at, ?3),
        updated_at = ?2
    WHERE id = ?1
  `).bind(token.user_id, now, trialEndsAt).run();
  return findUserById(db, token.user_id);
}

export async function createSession(db, user, request, suppliedDeviceName = '') {
  const rawToken = randomToken(32);
  const now = new Date().toISOString();
  const expiresAt = isoAfter({ days: SESSION_DAYS });
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sessions (
      id, user_id, token_hash, device_name, user_agent, ip_hash,
      created_at, last_seen_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
  `).bind(
    id,
    user.id,
    await sha256(rawToken),
    deviceLabel(request, suppliedDeviceName),
    String(request.headers.get('User-Agent') || '').slice(0, 500),
    await sha256(clientIp(request)),
    now,
    expiresAt
  ).run();
  return {
    id,
    rawToken,
    expiresAt,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`
  };
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function sessionFromRequest(db, request) {
  await ensureAuthSchema(db);
  const rawToken = cookieValue(request, SESSION_COOKIE);
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const now = new Date().toISOString();
  const row = await db.prepare(`
    SELECT s.id AS session_id, s.last_seen_at, s.expires_at, u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2
  `).bind(tokenHash, now).first();
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 300_000) {
    await db.prepare(`UPDATE sessions SET last_seen_at = ?2 WHERE id = ?1`).bind(row.session_id, now).run();
  }
  return { user: row, sessionId: row.session_id, source: 'session' };
}

export async function revokeSessionByRequest(db, request) {
  const rawToken = cookieValue(request, SESSION_COOKIE);
  if (!rawToken) return;
  await db.prepare(`UPDATE sessions SET revoked_at = ?2 WHERE token_hash = ?1 AND revoked_at IS NULL`)
    .bind(await sha256(rawToken), new Date().toISOString()).run();
}

export async function revokeAllSessions(db, userId, exceptSessionId = '') {
  const now = new Date().toISOString();
  if (exceptSessionId) {
    await db.prepare(`UPDATE sessions SET revoked_at = ?3 WHERE user_id = ?1 AND id <> ?2 AND revoked_at IS NULL`)
      .bind(userId, exceptSessionId, now).run();
  } else {
    await db.prepare(`UPDATE sessions SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL`).bind(userId, now).run();
  }
}

export async function listUserSessions(db, userId, currentSessionId = '') {
  const rows = await db.prepare(`
    SELECT id, device_name, created_at, last_seen_at, expires_at
    FROM sessions
    WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2
    ORDER BY last_seen_at DESC
  `).bind(userId, new Date().toISOString()).all();
  return (rows.results || []).map(row => ({ ...row, current: row.id === currentSessionId }));
}

export async function revokeUserSession(db, userId, sessionId) {
  await db.prepare(`UPDATE sessions SET revoked_at = ?3 WHERE user_id = ?1 AND id = ?2 AND revoked_at IS NULL`)
    .bind(userId, sessionId, new Date().toISOString()).run();
}

export async function refreshEntitlement(db, user) {
  if (!user) return null;
  if (user.status === 'trialing' && user.trial_ends_at && new Date(user.trial_ends_at).getTime() <= Date.now()) {
    const now = new Date().toISOString();
    await db.prepare(`UPDATE users SET status = 'trial_expired', updated_at = ?2 WHERE id = ?1 AND status = 'trialing'`)
      .bind(user.id, now).run();
    user = { ...user, status: 'trial_expired', updated_at: now };
  }
  return user;
}

export function publicUser(user, sessionId = '') {
  const trialEnd = user?.trial_ends_at ? new Date(user.trial_ends_at).getTime() : NaN;
  const remainingMs = Number.isFinite(trialEnd) ? Math.max(0, trialEnd - Date.now()) : 0;
  const full = (user?.role === 'admin' && user?.status !== 'suspended') || ['active', 'trialing'].includes(user?.status);
  const readOnly = ['trial_expired', 'past_due', 'canceled'].includes(user?.status);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.email_verified_at),
    trialStartedAt: user.trial_started_at || null,
    trialEndsAt: user.trial_ends_at || null,
    trialDaysRemaining: user.status === 'trialing' ? Math.ceil(remainingMs / 86_400_000) : 0,
    trialHoursRemaining: user.status === 'trialing' ? Math.ceil(remainingMs / 3_600_000) : 0,
    accessMode: full ? 'full' : readOnly ? 'read_only' : 'blocked',
    sessionId: sessionId || null,
    hasPassword: Boolean(user.password_hash)
  };
}

export async function consumeRateLimit(db, { scope, identity, limit, windowSeconds, blockSeconds }) {
  await ensureAuthSchema(db);
  const key = await sha256(`${scope}|${String(identity || '').toLowerCase()}`);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const row = await db.prepare('SELECT * FROM auth_rate_limits WHERE key = ?1').bind(key).first();
  if (row?.blocked_until && new Date(row.blocked_until).getTime() > nowMs) {
    return { allowed: false, retryAfter: Math.ceil((new Date(row.blocked_until).getTime() - nowMs) / 1000) };
  }
  const windowExpired = !row || nowMs - new Date(row.window_started_at).getTime() >= windowSeconds * 1000;
  const attempts = windowExpired ? 1 : Number(row.attempts || 0) + 1;
  const blockedUntil = attempts > limit ? new Date(nowMs + blockSeconds * 1000).toISOString() : null;
  await db.prepare(`
    INSERT INTO auth_rate_limits (key, attempts, window_started_at, blocked_until, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(key) DO UPDATE SET
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at
  `).bind(key, attempts, windowExpired ? now : row.window_started_at, blockedUntil, now).run();
  return { allowed: !blockedUntil, retryAfter: blockedUntil ? blockSeconds : 0 };
}

export async function authRateIdentity(request, email = '') {
  return `${await sha256(clientIp(request))}|${normalizeEmail(email)}`;
}

export async function auditAuthEvent(db, request, eventType, userId = null, detail = {}) {
  try {
    await db.prepare(`
      INSERT INTO auth_audit_log (id, user_id, event_type, detail_json, ip_hash, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `).bind(
      crypto.randomUUID(),
      userId,
      String(eventType).slice(0, 80),
      JSON.stringify(detail || {}).slice(0, 5000),
      await sha256(clientIp(request)),
      new Date().toISOString()
    ).run();
  } catch (error) {
    console.warn('Planorha: no se pudo registrar auditoría.', error);
  }
}

export { normalizeEmail, SESSION_COOKIE, TRIAL_DAYS };
