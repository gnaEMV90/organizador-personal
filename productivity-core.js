export const PRODUCTIVITY_SCHEMA_VERSION = 3;

const pad = value => String(value).padStart(2, '0');

export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(value, amount) {
  const date = value instanceof Date ? new Date(value) : parseLocalDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(amount || 0));
  return date;
}

function startOfWeekDate(value) {
  const date = value instanceof Date ? new Date(value) : parseLocalDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return date;
}

export function weekDates(value = new Date()) {
  const start = startOfWeekDate(value);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function normalizeRecurrence(value) {
  const type = ['none', 'daily', 'weekly', 'monthly'].includes(value?.type) ? value.type : 'none';
  const interval = Math.min(365, Math.max(1, Number(value?.interval) || 1));
  const weekdays = [...new Set((Array.isArray(value?.weekdays) ? value.weekdays : [])
    .map(Number)
    .filter(day => day >= 0 && day <= 6))].sort((a, b) => a - b);
  return {
    type,
    interval,
    weekdays,
    endDate: value?.endDate || ''
  };
}

function addMonthsClamped(base, amount) {
  const date = new Date(base);
  const expectedDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(expectedDay, lastDay));
  return date;
}

function weekDistance(base, candidate) {
  const baseWeek = startOfWeekDate(base);
  const candidateWeek = startOfWeekDate(candidate);
  return Math.round((candidateWeek - baseWeek) / (7 * 24 * 60 * 60 * 1000));
}

export function nextRecurrenceDate(task) {
  const recurrence = normalizeRecurrence(task?.recurrence);
  const base = parseLocalDate(task?.date);
  if (!base || recurrence.type === 'none') return '';

  let candidate = null;
  if (recurrence.type === 'daily') {
    candidate = addDays(base, recurrence.interval);
  }

  if (recurrence.type === 'monthly') {
    candidate = addMonthsClamped(base, recurrence.interval);
  }

  if (recurrence.type === 'weekly') {
    const weekdays = recurrence.weekdays.length ? recurrence.weekdays : [base.getDay()];
    for (let offset = 1; offset <= Math.max(370, recurrence.interval * 14); offset += 1) {
      const possible = addDays(base, offset);
      const distance = weekDistance(base, possible);
      if (weekdays.includes(possible.getDay()) && distance % recurrence.interval === 0) {
        candidate = possible;
        break;
      }
    }
  }

  if (!candidate) return '';
  const result = dateKey(candidate);
  if (recurrence.endDate && result > recurrence.endDate) return '';
  return result;
}

export function recurrenceLabel(value) {
  const recurrence = normalizeRecurrence(value);
  if (recurrence.type === 'none') return '';
  if (recurrence.type === 'daily') return recurrence.interval === 1 ? 'Diaria' : `Cada ${recurrence.interval} días`;
  if (recurrence.type === 'monthly') return recurrence.interval === 1 ? 'Mensual' : `Cada ${recurrence.interval} meses`;
  if (recurrence.type === 'weekly') {
    const dayNames = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    const days = recurrence.weekdays.map(day => dayNames[day]).join(', ');
    const cadence = recurrence.interval === 1 ? 'Semanal' : `Cada ${recurrence.interval} semanas`;
    return days ? `${cadence} · ${days}` : cadence;
  }
  return '';
}

export function reminderDateTime(task) {
  if (!task?.date || !task?.time) return null;
  const [hours, minutes] = String(task.time).split(':').map(Number);
  const date = parseLocalDate(task.date);
  if (!date || !Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function reminderKey(task) {
  if (!task?.date || !task?.time || task?.reminderMinutes === '' || task?.reminderMinutes == null) return '';
  return `${task.date}T${task.time}|${Number(task.reminderMinutes) || 0}`;
}

export function shouldNotifyTask(task, now = new Date()) {
  if (!task || task.completed || task.archived) return false;
  const dueAt = reminderDateTime(task);
  if (!dueAt) return false;
  const minutes = Number(task.reminderMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return false;
  const key = reminderKey(task);
  if (!key || task.reminderNotifiedFor === key) return false;
  const notifyAt = new Date(dueAt.getTime() - minutes * 60_000);
  const latestUsefulTime = new Date(dueAt.getTime() + 2 * 60 * 60_000);
  return now >= notifyAt && now <= latestUsefulTime;
}

export function migrateProductivityState(value) {
  if (!value || !Array.isArray(value.tasks) || !Array.isArray(value.lists) || !Array.isArray(value.categories)) return value;
  const state = JSON.parse(JSON.stringify(value));
  state.version = Math.max(Number(state.version) || 1, PRODUCTIVITY_SCHEMA_VERSION);

  state.tasks = state.tasks.map((task, index) => ({
    ...task,
    archived: Boolean(task.archived),
    archivedAt: task.archivedAt || null,
    order: Number.isFinite(Number(task.order)) ? Number(task.order) : index,
    recurrence: normalizeRecurrence(task.recurrence),
    seriesId: task.seriesId || null,
    reminderMinutes: task.reminderMinutes === '' || task.reminderMinutes == null ? '' : Math.max(0, Number(task.reminderMinutes) || 0),
    reminderNotifiedFor: task.reminderNotifiedFor || ''
  }));

  state.lists = state.lists.map((list, listIndex) => ({
    ...list,
    dueDate: list.dueDate || '',
    order: Number.isFinite(Number(list.order)) ? Number(list.order) : listIndex,
    items: (Array.isArray(list.items) ? list.items : []).map((item, itemIndex) => ({
      ...item,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : itemIndex
    }))
  }));

  return state;
}

export function buildNextOccurrence(task, existingTasks, createId, now = new Date()) {
  const nextDate = nextRecurrenceDate(task);
  if (!nextDate) return null;
  const seriesId = task.seriesId || task.id;
  const duplicate = (existingTasks || []).some(candidate => candidate.id !== task.id && candidate.seriesId === seriesId && candidate.date === nextDate && !candidate.archived);
  if (duplicate) return null;
  const nextId = createId();
  return {
    ...task,
    id: nextId,
    date: nextDate,
    completed: false,
    completedAt: null,
    archived: false,
    archivedAt: null,
    seriesId,
    reminderNotifiedFor: '',
    createdAt: now.toISOString(),
    order: Math.max(-1, ...(existingTasks || []).map(item => Number(item.order) || 0)) + 1,
    _updatedAt: undefined
  };
}
