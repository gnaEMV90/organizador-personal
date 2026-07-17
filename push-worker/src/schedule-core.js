export const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

function partsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}

export function zonedDateTimeToUtc(dateValue, timeValue, timeZone) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  const [hour, minute] = String(timeValue || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const expectedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(expectedAsUtc);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInTimeZone(candidate, timeZone || 'UTC');
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second || 0,
      0
    );
    candidate = new Date(candidate.getTime() + (expectedAsUtc - actualAsUtc));
  }

  return candidate;
}

export function reminderKey(task) {
  if (!task?.date || !task?.time || task.reminderMinutes === '' || task.reminderMinutes == null) return '';
  return `${task.date}T${task.time}|${Number(task.reminderMinutes) || 0}`;
}

export function reminderInstant(task, timeZone) {
  const dueAt = zonedDateTimeToUtc(task.date, task.time, timeZone);
  const minutes = Number(task.reminderMinutes);
  if (!dueAt || !Number.isFinite(minutes) || minutes < 0) return null;
  return new Date(dueAt.getTime() - minutes * 60_000);
}

export function dueTasks(state, timeZone, now, deliveryWindowMs = DELIVERY_WINDOW_MS) {
  return (state?.tasks || []).filter(task => {
    if (!task || task.completed || task.archived) return false;
    const key = reminderKey(task);
    if (!key) return false;
    const instant = reminderInstant(task, timeZone);
    if (!instant) return false;
    const age = now.getTime() - instant.getTime();
    return age >= 0 && age <= deliveryWindowMs;
  });
}
