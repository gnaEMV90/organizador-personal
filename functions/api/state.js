import {
  EPOCH,
  SYNC_SCHEMA_VERSION,
  isValidState,
  normalizeState,
  mergeStates
} from '../../sync-core.js';
import { resolveRequestUser } from '../_lib/access.js';
import { assertSameOrigin, json } from '../_lib/http.js';

const MAX_WRITE_ATTEMPTS = 5;

async function ensureStateSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function readStateRow(db, userId) {
  return db.prepare('SELECT state_json, updated_at FROM user_state WHERE user_id = ?1').bind(userId).first();
}

async function mergeAndSaveState(db, userId, incomingState) {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const row = await readStateRow(db, userId);
    const currentState = row ? JSON.parse(row.state_json) : null;
    const currentUsesSyncSchema = Number(currentState?._sync?.schemaVersion || 0) >= SYNC_SCHEMA_VERSION;
    const incomingUsesSyncSchema = Number(incomingState?._sync?.schemaVersion || 0) >= SYNC_SCHEMA_VERSION;
    const incomingFallback = currentUsesSyncSchema && !incomingUsesSyncSchema ? EPOCH : new Date().toISOString();
    const mergedState = mergeStates(currentState, incomingState, row?.updated_at || EPOCH, incomingFallback);
    const updatedAt = new Date(Date.now() + attempt).toISOString();
    let result;

    if (row) {
      result = await db.prepare(`
        UPDATE user_state
        SET state_json = ?2, updated_at = ?3
        WHERE user_id = ?1 AND updated_at = ?4
      `).bind(userId, JSON.stringify(mergedState), updatedAt, row.updated_at).run();
    } else {
      result = await db.prepare(`
        INSERT OR IGNORE INTO user_state (user_id, state_json, updated_at)
        VALUES (?1, ?2, ?3)
      `).bind(userId, JSON.stringify(mergedState), updatedAt).run();
    }

    if (Number(result?.meta?.changes || 0) === 1) return { state: mergedState, updatedAt };
  }
  throw new Error('No se pudo resolver el conflicto de sincronización después de varios intentos.');
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'Sincronización no configurada' }, 503);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    if (auth.publicUser.accessMode === 'blocked') return json({ error: 'Cuenta no habilitada', user: auth.publicUser }, 403);

    await ensureStateSchema(env.DB);
    const row = await readStateRow(env.DB, auth.user.id);
    return json({
      state: row ? normalizeState(JSON.parse(row.state_json), row.updated_at) : null,
      updatedAt: row?.updated_at || null,
      user: auth.publicUser.email,
      userId: auth.user.id,
      accessMode: auth.publicUser.accessMode
    });
  } catch (error) {
    console.error('Planorha GET state:', error);
    return json({ error: 'No se pudo leer la información' }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return json({ error: 'Sincronización no configurada' }, 503);
  if (!assertSameOrigin(request)) return json({ error: 'Origen inválido' }, 403);
  try {
    const auth = await resolveRequestUser(request, env);
    if (!auth) return json({ error: 'No autorizado' }, 401);
    if (auth.publicUser.accessMode !== 'full') {
      return json({
        error: 'La cuenta está en modo de solo lectura. Gestioná tu suscripción para volver a editar.',
        code: 'SUBSCRIPTION_REQUIRED',
        user: auth.publicUser
      }, 402);
    }

    const rawBody = await request.text();
    if (rawBody.length > 750_000) return json({ error: 'Contenido demasiado grande' }, 413);
    const body = JSON.parse(rawBody);
    if (!isValidState(body.state)) return json({ error: 'Estado inválido' }, 400);

    await ensureStateSchema(env.DB);
    const saved = await mergeAndSaveState(env.DB, auth.user.id, body.state);
    return json({
      state: saved.state,
      updatedAt: saved.updatedAt,
      user: auth.publicUser.email,
      userId: auth.user.id,
      accessMode: auth.publicUser.accessMode
    });
  } catch (error) {
    console.error('Planorha PUT state:', error);
    return json({ error: 'No se pudo guardar la información' }, 500);
  }
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: { Allow: 'GET, PUT, OPTIONS' } });
}
