import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dueTasks,
  reminderInstant,
  reminderKey,
  zonedDateTimeToUtc
} from '../push-worker/src/schedule-core.js';

test('convierte hora de Argentina a UTC', () => {
  const result = zonedDateTimeToUtc('2026-07-17', '10:30', 'America/Argentina/Cordoba');
  assert.equal(result.toISOString(), '2026-07-17T13:30:00.000Z');
});

test('calcula el instante del recordatorio', () => {
  const task = {
    date: '2026-07-17',
    time: '10:30',
    reminderMinutes: 30
  };
  const result = reminderInstant(task, 'America/Argentina/Cordoba');
  assert.equal(result.toISOString(), '2026-07-17T13:00:00.000Z');
  assert.equal(reminderKey(task), '2026-07-17T10:30|30');
});

test('selecciona sólo tareas pendientes dentro de la ventana', () => {
  const state = {
    tasks: [
      { id: 'due', date: '2026-07-17', time: '10:30', reminderMinutes: 30, completed: false, archived: false },
      { id: 'done', date: '2026-07-17', time: '10:30', reminderMinutes: 30, completed: true, archived: false },
      { id: 'archived', date: '2026-07-17', time: '10:30', reminderMinutes: 30, completed: false, archived: true },
      { id: 'future', date: '2026-07-17', time: '11:30', reminderMinutes: 30, completed: false, archived: false },
      { id: 'none', date: '2026-07-17', time: '10:30', reminderMinutes: '', completed: false, archived: false }
    ]
  };
  const now = new Date('2026-07-17T13:04:00.000Z');
  assert.deepEqual(
    dueTasks(state, 'America/Argentina/Cordoba', now).map(task => task.id),
    ['due']
  );
});

test('no reenvía recordatorios fuera de la ventana', () => {
  const state = {
    tasks: [
      { id: 'old', date: '2026-07-17', time: '10:30', reminderMinutes: 30, completed: false, archived: false }
    ]
  };
  const now = new Date('2026-07-17T13:11:00.000Z');
  assert.equal(dueTasks(state, 'America/Argentina/Cordoba', now).length, 0);
});
