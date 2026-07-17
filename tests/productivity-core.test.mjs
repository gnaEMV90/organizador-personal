import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextRecurrenceDate,
  shouldNotifyTask,
  reminderKey,
  migrateProductivityState,
  buildNextOccurrence,
  weekDates,
  dateKey
} from '../productivity-core.js';

test('calcula recurrencia diaria con intervalo', () => {
  assert.equal(nextRecurrenceDate({ date: '2026-07-17', recurrence: { type: 'daily', interval: 3 } }), '2026-07-20');
});

test('calcula el próximo día seleccionado de una recurrencia semanal', () => {
  const next = nextRecurrenceDate({
    date: '2026-07-17',
    recurrence: { type: 'weekly', interval: 1, weekdays: [1, 3, 5] }
  });
  assert.equal(next, '2026-07-20');
});

test('respeta intervalos de varias semanas', () => {
  const next = nextRecurrenceDate({
    date: '2026-07-13',
    recurrence: { type: 'weekly', interval: 2, weekdays: [1] }
  });
  assert.equal(next, '2026-07-27');
});

test('ajusta recurrencia mensual al último día disponible', () => {
  assert.equal(nextRecurrenceDate({ date: '2026-01-31', recurrence: { type: 'monthly', interval: 1 } }), '2026-02-28');
});

test('no genera ocurrencias después de la fecha final', () => {
  assert.equal(nextRecurrenceDate({
    date: '2026-07-17',
    recurrence: { type: 'daily', interval: 1, endDate: '2026-07-17' }
  }), '');
});

test('migración agrega campos de productividad sin perder datos', () => {
  const migrated = migrateProductivityState({
    version: 1,
    categories: [{ id: 'personal', name: 'Personal', color: '#000000' }],
    tasks: [{ id: 't1', title: 'Prueba', date: '2026-07-17' }],
    lists: [{ id: 'l1', title: 'Lista', items: [{ id: 'i1', name: 'Leche' }] }]
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.tasks[0].archived, false);
  assert.equal(migrated.tasks[0].recurrence.type, 'none');
  assert.equal(migrated.lists[0].dueDate, '');
  assert.equal(migrated.lists[0].items[0].order, 0);
});

test('genera una sola próxima ocurrencia por serie y fecha', () => {
  const task = {
    id: 'base',
    title: 'Regar',
    date: '2026-07-17',
    time: '09:00',
    recurrence: { type: 'daily', interval: 1 },
    completed: true,
    createdAt: '2026-07-01T10:00:00.000Z'
  };
  const created = buildNextOccurrence(task, [task], () => 'next', new Date('2026-07-17T12:00:00.000Z'));
  assert.equal(created.date, '2026-07-18');
  assert.equal(created.seriesId, 'base');
  assert.equal(created.completed, false);

  const duplicate = buildNextOccurrence(task, [task, created], () => 'other');
  assert.equal(duplicate, null);
});

test('activa recordatorio en su ventana útil y evita repetirlo', () => {
  const task = {
    id: 't1',
    title: 'Reunión',
    date: '2026-07-17',
    time: '10:00',
    reminderMinutes: 15,
    completed: false,
    archived: false,
    reminderNotifiedFor: ''
  };
  assert.equal(shouldNotifyTask(task, new Date('2026-07-17T09:50:00')), true);
  task.reminderNotifiedFor = reminderKey(task);
  assert.equal(shouldNotifyTask(task, new Date('2026-07-17T09:55:00')), false);
});

test('vista semanal comienza el lunes y contiene siete días', () => {
  const days = weekDates(new Date('2026-07-17T12:00:00'));
  assert.deepEqual(days.map(dateKey), [
    '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'
  ]);
});
