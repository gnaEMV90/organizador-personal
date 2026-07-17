import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, prepareStateForLocalSave, mergeStates } from '../sync-core.js';

const empty = () => ({ version: 2, categories: [], tasks: [], lists: [] });

test('combina tareas creadas desde dos dispositivos', () => {
  const remote = normalizeState({ ...empty(), tasks: [{ id: 'a', title: 'Desde PC', createdAt: '2026-07-17T10:00:00.000Z' }] }, '2026-07-17T10:00:00.000Z');
  const local = normalizeState({ ...empty(), tasks: [{ id: 'b', title: 'Desde celular', createdAt: '2026-07-17T10:01:00.000Z' }] }, '2026-07-17T10:01:00.000Z');
  const merged = mergeStates(remote, local);
  assert.deepEqual(new Set(merged.tasks.map(task => task.id)), new Set(['a', 'b']));
});

test('una eliminación registrada evita que una copia vieja reviva la tarea', () => {
  const original = normalizeState({ ...empty(), tasks: [{ id: 'a', title: 'Borrar', createdAt: '2026-07-17T10:00:00.000Z' }] }, '2026-07-17T10:00:00.000Z');
  const deleted = prepareStateForLocalSave(original, { ...original, tasks: [] });
  const stale = normalizeState({ ...empty(), tasks: [{ id: 'a', title: 'Borrar', createdAt: '2026-07-17T10:00:00.000Z' }] }, '2026-07-17T10:00:00.000Z');
  const merged = mergeStates(deleted, stale);
  assert.equal(merged.tasks.length, 0);
});

test('gana la edición más reciente del mismo elemento', () => {
  const remote = normalizeState({ ...empty(), tasks: [{ id: 'a', title: 'Viejo', createdAt: '2026-07-17T10:00:00.000Z', _updatedAt: '2026-07-17T10:01:00.000Z' }] });
  const local = normalizeState({ ...empty(), tasks: [{ id: 'a', title: 'Nuevo', createdAt: '2026-07-17T10:00:00.000Z', _updatedAt: '2026-07-17T10:02:00.000Z' }] });
  const merged = mergeStates(remote, local);
  assert.equal(merged.tasks[0].title, 'Nuevo');
});
