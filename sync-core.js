export const SYNC_SCHEMA_VERSION = 2;
export const EPOCH = '1970-01-01T00:00:00.000Z';
const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

function isValidState(value) {
  return Boolean(
    value &&
    Array.isArray(value.categories) &&
    Array.isArray(value.tasks) &&
    Array.isArray(value.lists)
  );
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function timestampMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(...values) {
  const latest = values.reduce((current, value) => timestampMs(value) > timestampMs(current) ? value : current, EPOCH);
  return latest || EPOCH;
}

function entityTimestamp(entity, fallback = EPOCH) {
  return latestTimestamp(entity?._updatedAt, entity?.updatedAt, entity?.completedAt, entity?.createdAt, fallback);
}

function emptyTombstones() {
  return { categories: {}, tasks: {}, lists: {}, listItems: {} };
}

function normalizeTombstones(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    categories: { ...(source.categories || {}) },
    tasks: { ...(source.tasks || {}) },
    lists: { ...(source.lists || {}) },
    listItems: Object.fromEntries(
      Object.entries(source.listItems || {}).map(([listId, items]) => [listId, { ...(items || {}) }])
    )
  };
}

function mergeTimestampMaps(left = {}, right = {}) {
  const result = { ...left };
  Object.entries(right).forEach(([id, timestamp]) => {
    if (timestampMs(timestamp) > timestampMs(result[id])) result[id] = timestamp;
  });
  return result;
}

function mergeTombstones(leftValue, rightValue) {
  const left = normalizeTombstones(leftValue);
  const right = normalizeTombstones(rightValue);
  const listIds = new Set([...Object.keys(left.listItems), ...Object.keys(right.listItems)]);
  const listItems = {};
  listIds.forEach(listId => {
    listItems[listId] = mergeTimestampMaps(left.listItems[listId], right.listItems[listId]);
  });
  return {
    categories: mergeTimestampMaps(left.categories, right.categories),
    tasks: mergeTimestampMaps(left.tasks, right.tasks),
    lists: mergeTimestampMaps(left.lists, right.lists),
    listItems
  };
}

function pruneTimestampMap(map, cutoff) {
  return Object.fromEntries(Object.entries(map || {}).filter(([, timestamp]) => timestampMs(timestamp) >= cutoff));
}

function pruneTombstones(value) {
  const tombstones = normalizeTombstones(value);
  const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
  const listItems = {};
  Object.entries(tombstones.listItems).forEach(([listId, items]) => {
    const pruned = pruneTimestampMap(items, cutoff);
    if (Object.keys(pruned).length) listItems[listId] = pruned;
  });
  return {
    categories: pruneTimestampMap(tombstones.categories, cutoff),
    tasks: pruneTimestampMap(tombstones.tasks, cutoff),
    lists: pruneTimestampMap(tombstones.lists, cutoff),
    listItems
  };
}

function normalizeState(value, fallbackTimestamp = EPOCH) {
  if (!isValidState(value)) return null;
  const state = clone(value);
  const existingSync = state._sync && typeof state._sync === 'object' ? state._sync : {};
  state.version = Math.max(Number(state.version) || 1, SYNC_SCHEMA_VERSION);
  state._sync = {
    schemaVersion: SYNC_SCHEMA_VERSION,
    tombstones: pruneTombstones(existingSync.tombstones || emptyTombstones())
  };

  state.categories = state.categories.filter(item => item?.id).map(item => ({
    ...item,
    _updatedAt: entityTimestamp(item, fallbackTimestamp)
  }));
  state.tasks = state.tasks.filter(item => item?.id).map(item => ({
    ...item,
    _updatedAt: entityTimestamp(item, fallbackTimestamp)
  }));
  state.lists = state.lists.filter(item => item?.id).map(list => ({
    ...list,
    _updatedAt: entityTimestamp(list, fallbackTimestamp),
    items: Array.isArray(list.items)
      ? list.items.filter(item => item?.id).map(item => ({ ...item, _updatedAt: entityTimestamp(item, fallbackTimestamp) }))
      : []
  }));
  return state;
}

function comparableEntity(entity, { omitItems = false } = {}) {
  const copy = { ...(entity || {}) };
  delete copy._updatedAt;
  if (omitItems) delete copy.items;
  return JSON.stringify(copy);
}

function stampCollection(previousItems, nextItems, tombstoneMap, now) {
  const previousById = new Map((previousItems || []).filter(item => item?.id).map(item => [item.id, item]));
  const nextById = new Map((nextItems || []).filter(item => item?.id).map(item => [item.id, item]));

  nextById.forEach((nextItem, id) => {
    const previousItem = previousById.get(id);
    const changed = !previousItem || comparableEntity(previousItem) !== comparableEntity(nextItem);
    nextItem._updatedAt = changed ? now : entityTimestamp(previousItem, now);
    if (timestampMs(nextItem._updatedAt) > timestampMs(tombstoneMap[id])) delete tombstoneMap[id];
  });

  previousById.forEach((previousItem, id) => {
    if (!nextById.has(id)) tombstoneMap[id] = latestTimestamp(tombstoneMap[id], now, entityTimestamp(previousItem));
  });
}

function prepareStateForLocalSave(previousValue, incomingValue) {
  if (!isValidState(incomingValue)) return incomingValue;
  const now = new Date().toISOString();
  const previous = normalizeState(previousValue || { version: 1, categories: [], tasks: [], lists: [] }, EPOCH);
  const next = normalizeState(incomingValue, now);
  next._sync.tombstones = mergeTombstones(previous?._sync?.tombstones, next._sync.tombstones);
  const tombstones = next._sync.tombstones;

  stampCollection(previous?.categories, next.categories, tombstones.categories, now);
  stampCollection(previous?.tasks, next.tasks, tombstones.tasks, now);

  const previousLists = new Map((previous?.lists || []).map(list => [list.id, list]));
  const nextLists = new Map(next.lists.map(list => [list.id, list]));

  nextLists.forEach((nextList, listId) => {
    const previousList = previousLists.get(listId);
    const listChanged = !previousList || comparableEntity(previousList, { omitItems: true }) !== comparableEntity(nextList, { omitItems: true });
    nextList._updatedAt = listChanged ? now : entityTimestamp(previousList, now);
    if (timestampMs(nextList._updatedAt) > timestampMs(tombstones.lists[listId])) delete tombstones.lists[listId];

    tombstones.listItems[listId] ||= {};
    stampCollection(previousList?.items || [], nextList.items || [], tombstones.listItems[listId], now);
    if (!Object.keys(tombstones.listItems[listId]).length) delete tombstones.listItems[listId];
  });

  previousLists.forEach((previousList, listId) => {
    if (!nextLists.has(listId)) {
      tombstones.lists[listId] = latestTimestamp(tombstones.lists[listId], now, entityTimestamp(previousList));
      delete tombstones.listItems[listId];
    }
  });

  next._sync.tombstones = pruneTombstones(tombstones);
  return next;
}

function orderedIds(remoteItems = [], localItems = []) {
  return [...new Set([...remoteItems.map(item => item?.id), ...localItems.map(item => item?.id)].filter(Boolean))];
}

function chooseNewest(remoteItem, localItem) {
  if (!remoteItem) return localItem;
  if (!localItem) return remoteItem;
  return timestampMs(entityTimestamp(localItem)) >= timestampMs(entityTimestamp(remoteItem)) ? localItem : remoteItem;
}

function mergeCollection(remoteItems, localItems, tombstones) {
  const remoteById = new Map((remoteItems || []).map(item => [item.id, item]));
  const localById = new Map((localItems || []).map(item => [item.id, item]));
  const result = [];

  orderedIds(remoteItems, localItems).forEach(id => {
    const chosen = chooseNewest(remoteById.get(id), localById.get(id));
    if (!chosen) return;
    if (timestampMs(tombstones?.[id]) >= timestampMs(entityTimestamp(chosen))) return;
    result.push(clone(chosen));
  });
  return result;
}

function normalizedText(value) {
  return String(value || '').trim().toLocaleLowerCase('es-AR');
}

function legacyListKey(list) {
  return [normalizedText(list?.title), normalizedText(list?.categoryId), normalizedText(list?.notes)].join('|');
}

function mergeListItems(remoteList, localList, itemTombstones) {
  return mergeCollection(remoteList?.items || [], localList?.items || [], itemTombstones || {});
}

function mergeLists(remoteState, localState, tombstones, allowLegacySemanticMatch) {
  const remoteLists = remoteState.lists || [];
  const localLists = localState.lists || [];
  const remoteById = new Map(remoteLists.map(list => [list.id, list]));
  const localById = new Map(localLists.map(list => [list.id, list]));
  const consumedLocalIds = new Set();
  const result = [];

  remoteLists.forEach(remoteList => {
    let localList = localById.get(remoteList.id);
    if (!localList && allowLegacySemanticMatch) {
      localList = localLists.find(candidate => !consumedLocalIds.has(candidate.id) && legacyListKey(candidate) === legacyListKey(remoteList));
    }
    if (localList) consumedLocalIds.add(localList.id);

    const chosen = chooseNewest(remoteList, localList);
    const listId = remoteList.id;
    if (timestampMs(tombstones.lists[listId]) >= timestampMs(entityTimestamp(chosen))) return;

    result.push({
      ...clone(chosen),
      id: listId,
      items: mergeListItems(remoteList, localList, mergeTimestampMaps(
        tombstones.listItems[remoteList.id],
        localList ? tombstones.listItems[localList.id] : {}
      ))
    });
  });

  localLists.forEach(localList => {
    if (remoteById.has(localList.id) || consumedLocalIds.has(localList.id)) return;
    if (timestampMs(tombstones.lists[localList.id]) >= timestampMs(entityTimestamp(localList))) return;
    result.push({
      ...clone(localList),
      items: mergeListItems(null, localList, tombstones.listItems[localList.id])
    });
  });

  return result;
}

function mergeStates(remoteValue, localValue, remoteFallback = EPOCH, localFallback = EPOCH) {
  if (!isValidState(remoteValue)) return normalizeState(localValue, localFallback);
  if (!isValidState(localValue)) return normalizeState(remoteValue, remoteFallback);

  const remoteWasLegacy = Number(remoteValue?._sync?.schemaVersion || 0) < SYNC_SCHEMA_VERSION;
  const localWasLegacy = Number(localValue?._sync?.schemaVersion || 0) < SYNC_SCHEMA_VERSION;
  const remote = normalizeState(remoteValue, remoteFallback);
  const local = normalizeState(localValue, localFallback);
  const tombstones = mergeTombstones(remote._sync.tombstones, local._sync.tombstones);

  const merged = {
    ...remote,
    ...local,
    version: Math.max(Number(remote.version) || 1, Number(local.version) || 1, SYNC_SCHEMA_VERSION),
    categories: mergeCollection(remote.categories, local.categories, tombstones.categories),
    tasks: mergeCollection(remote.tasks, local.tasks, tombstones.tasks),
    lists: mergeLists(remote, local, tombstones, remoteWasLegacy || localWasLegacy),
    _sync: {
      schemaVersion: SYNC_SCHEMA_VERSION,
      tombstones: pruneTombstones(tombstones)
    }
  };
  return merged;
}

export {
  isValidState,
  statesEqual,
  normalizeState,
  prepareStateForLocalSave,
  mergeStates
};
