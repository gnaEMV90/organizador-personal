(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';
  const SYNC_META_KEY = 'planorha.sync.v2';
  const API_URL = '/api/state';
  const SAVE_DELAY_MS = 650;
  const POLL_INTERVAL_MS = 15000;
  const nativeSetItem = Storage.prototype.setItem;

  const sync = {
    enabled: false,
    status: 'local',
    user: null,
    updatedAt: null,
    timer: null,
    pollTimer: null,
    refreshing: false,
    appLoaded: false
  };

  function isValidState(value) {
    return Boolean(
      value &&
      Array.isArray(value.categories) &&
      Array.isArray(value.tasks) &&
      Array.isArray(value.lists)
    );
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn(`Planorha: no se pudo leer ${key}.`, error);
      return null;
    }
  }

  function readLocalState() {
    const parsed = readJson(STORAGE_KEY);
    return isValidState(parsed) ? parsed : null;
  }

  function readSyncMeta() {
    return readJson(SYNC_META_KEY) || {};
  }

  function writeRaw(key, value) {
    nativeSetItem.call(localStorage, key, value);
  }

  function writeLocalState(value) {
    writeRaw(STORAGE_KEY, JSON.stringify(value));
  }

  function statesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function normalizedText(value) {
    return String(value || '').trim().toLocaleLowerCase('es-AR');
  }

  function mergeById(remoteItems = [], localItems = []) {
    const merged = new Map();
    remoteItems.forEach(item => {
      if (item?.id) merged.set(item.id, item);
    });
    localItems.forEach(item => {
      if (item?.id) merged.set(item.id, item);
    });
    return [...merged.values()];
  }

  function mergeListItems(remoteItems = [], localItems = []) {
    return mergeById(remoteItems, localItems);
  }

  function listSemanticKey(list) {
    return [normalizedText(list?.title), normalizedText(list?.categoryId), normalizedText(list?.notes)].join('|');
  }

  function mergeLists(remoteLists = [], localLists = []) {
    const result = remoteLists.map(list => ({ ...list, items: Array.isArray(list.items) ? [...list.items] : [] }));
    const byId = new Map(result.filter(list => list?.id).map((list, index) => [list.id, index]));
    const bySemanticKey = new Map(result.map((list, index) => [listSemanticKey(list), index]));

    localLists.forEach(localList => {
      if (!localList?.id) return;
      const semanticKey = listSemanticKey(localList);
      const existingIndex = byId.has(localList.id)
        ? byId.get(localList.id)
        : bySemanticKey.get(semanticKey);

      if (existingIndex === undefined) {
        const next = { ...localList, items: Array.isArray(localList.items) ? [...localList.items] : [] };
        result.push(next);
        const index = result.length - 1;
        byId.set(next.id, index);
        bySemanticKey.set(semanticKey, index);
        return;
      }

      const remoteList = result[existingIndex];
      result[existingIndex] = {
        ...remoteList,
        ...localList,
        id: remoteList.id || localList.id,
        items: mergeListItems(remoteList.items, localList.items)
      };
      byId.set(localList.id, existingIndex);
    });

    return result;
  }

  function mergeStates(remoteState, localState) {
    if (!isValidState(remoteState)) return localState;
    if (!isValidState(localState)) return remoteState;

    return {
      ...remoteState,
      ...localState,
      version: Math.max(Number(remoteState.version) || 1, Number(localState.version) || 1),
      categories: mergeById(remoteState.categories, localState.categories),
      tasks: mergeById(remoteState.tasks, localState.tasks),
      lists: mergeLists(remoteState.lists, localState.lists)
    };
  }

  function setSyncMeta(meta, dirty = false) {
    sync.updatedAt = meta.updatedAt || null;
    sync.user = meta.user || sync.user || null;
    writeRaw(SYNC_META_KEY, JSON.stringify({
      updatedAt: sync.updatedAt,
      user: sync.user,
      dirty,
      savedAt: new Date().toISOString()
    }));
  }

  function markLocalChangesPending() {
    const meta = readSyncMeta();
    writeRaw(SYNC_META_KEY, JSON.stringify({
      ...meta,
      user: sync.user || meta.user || null,
      dirty: true,
      changedAt: new Date().toISOString()
    }));
  }

  function updateStatus(status, detail = '') {
    sync.status = status;
    const element = document.querySelector('#sync-status');
    if (!element) return;

    const labels = {
      local: 'Guardado local',
      connecting: 'Conectando…',
      synced: 'Sincronizado',
      saving: 'Sincronizando…',
      offline: 'Sin conexión',
      unavailable: 'Sincronización pendiente',
      error: 'Error de sincronización'
    };

    element.dataset.status = status;
    element.innerHTML = `<i></i> ${labels[status] || labels.local}${detail ? ` · ${detail}` : ''}`;
  }

  async function fetchRemoteState() {
    const response = await fetch(API_URL, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if ([401, 403, 404, 503].includes(response.status)) return { available: false };
    if (!response.ok) throw new Error(`GET ${API_URL}: ${response.status}`);
    return { available: true, ...(await response.json()) };
  }

  async function putRemoteState(state) {
    const response = await fetch(API_URL, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ state })
    });

    if (!response.ok) {
      if ([401, 403, 503].includes(response.status)) {
        sync.enabled = false;
        updateStatus('unavailable');
        return null;
      }
      throw new Error(`PUT ${API_URL}: ${response.status}`);
    }

    return response.json();
  }

  function reloadForRemoteChanges() {
    if (!sync.appLoaded) return;
    setTimeout(() => location.reload(), 80);
  }

  async function pushRemoteState(localState, { mergeRemote = true } = {}) {
    if (!sync.enabled || !isValidState(localState)) return;

    updateStatus(navigator.onLine ? 'saving' : 'offline');
    if (!navigator.onLine) return;

    let stateToSave = localState;

    if (mergeRemote) {
      const remoteBeforeSave = await fetchRemoteState();
      if (remoteBeforeSave.available && isValidState(remoteBeforeSave.state)) {
        stateToSave = mergeStates(remoteBeforeSave.state, localState);
      }
    }

    const localChangedByMerge = !statesEqual(stateToSave, localState);
    if (localChangedByMerge) writeLocalState(stateToSave);

    const payload = await putRemoteState(stateToSave);
    if (!payload) return;

    setSyncMeta(payload, false);
    updateStatus('synced');

    if (localChangedByMerge) reloadForRemoteChanges();
  }

  function scheduleRemoteSave(rawValue) {
    markLocalChangesPending();
    if (!sync.enabled) return;

    clearTimeout(sync.timer);
    sync.timer = setTimeout(async () => {
      try {
        const parsed = JSON.parse(rawValue);
        await pushRemoteState(parsed, { mergeRemote: true });
      } catch (error) {
        console.warn('Planorha: no se pudieron sincronizar los cambios.', error);
        updateStatus(navigator.onLine ? 'error' : 'offline');
      }
    }, SAVE_DELAY_MS);
  }

  function installStorageBridge() {
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      nativeSetItem.call(this, key, value);
      if (this === localStorage && key === STORAGE_KEY) scheduleRemoteSave(value);
    };
  }

  function loadApplication() {
    const script = document.createElement('script');
    script.src = '/app.js?v=3';
    script.defer = true;
    script.onerror = () => updateStatus('error');
    script.onload = () => { sync.appLoaded = true; };
    document.body.appendChild(script);
  }

  function applyBrandAndSettingsPatches() {
    const patch = () => {
      if (document.title.includes('Mi Organizador')) {
        document.title = document.title.replace('Mi Organizador', 'Planorha');
      }

      const settingsCards = [...document.querySelectorAll('.settings-card')];
      const storageCard = settingsCards.find(card => card.textContent.includes('Versión inicial'));
      if (storageCard) {
        const connected = sync.enabled;
        storageCard.innerHTML = `
          <p class="eyebrow">Almacenamiento</p>
          <h2>${connected ? 'Sincronización activa' : 'Modo local seguro'}</h2>
          <p>${connected
            ? 'Tus cambios se guardan en este dispositivo y también se sincronizan con Cloudflare D1.'
            : 'Tus datos continúan guardándose en este navegador. La sincronización se activará cuando Cloudflare Access y D1 estén vinculados.'}</p>
          <ul class="info-list">
            <li>Guardado automático local.</li>
            <li>Funcionamiento sin conexión.</li>
            <li>${connected ? `Cuenta: ${sync.user || 'autenticada'}.` : 'Sin riesgo de perder funcionalidad durante la configuración.'}</li>
          </ul>`;
      }
    };

    const observer = new MutationObserver(patch);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    patch();
  }

  async function initialize() {
    updateStatus('connecting');
    const localState = readLocalState();
    const localMeta = readSyncMeta();

    try {
      const remote = await fetchRemoteState();
      if (!remote.available) {
        updateStatus('unavailable');
        return;
      }

      sync.enabled = true;
      sync.user = remote.user || null;
      sync.updatedAt = remote.updatedAt || null;

      if (!isValidState(remote.state)) {
        if (localState) await pushRemoteState(localState, { mergeRemote: false });
        else setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      const belongsToAnotherUser = localMeta.user && remote.user && localMeta.user !== remote.user;
      if (!localState || belongsToAnotherUser) {
        writeLocalState(remote.state);
        setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      if (localMeta.dirty) {
        const merged = mergeStates(remote.state, localState);
        writeLocalState(merged);
        await pushRemoteState(merged, { mergeRemote: false });
        return;
      }

      if (!localMeta.updatedAt) {
        const merged = mergeStates(remote.state, localState);
        writeLocalState(merged);
        if (!statesEqual(merged, remote.state)) await pushRemoteState(merged, { mergeRemote: false });
        else setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      writeLocalState(remote.state);
      setSyncMeta(remote, false);
      updateStatus('synced');
    } catch (error) {
      console.warn('Planorha: la sincronización no está disponible.', error);
      updateStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function refreshFromRemote() {
    if (!sync.enabled || sync.refreshing || !navigator.onLine) return;
    const meta = readSyncMeta();
    if (meta.dirty) return;

    sync.refreshing = true;
    try {
      const remote = await fetchRemoteState();
      if (!remote.available || !isValidState(remote.state)) return;

      const localState = readLocalState();
      const changed = !statesEqual(localState, remote.state);
      writeLocalState(remote.state);
      setSyncMeta(remote, false);
      updateStatus('synced');

      if (changed) reloadForRemoteChanges();
    } catch (error) {
      console.warn('Planorha: no se pudo actualizar desde D1.', error);
      updateStatus(navigator.onLine ? 'error' : 'offline');
    } finally {
      sync.refreshing = false;
    }
  }

  function startPolling() {
    clearInterval(sync.pollTimer);
    sync.pollTimer = setInterval(refreshFromRemote, POLL_INTERVAL_MS);
  }

  window.addEventListener('online', () => {
    if (sync.enabled) {
      const current = readLocalState();
      const meta = readSyncMeta();
      if (current && meta.dirty) pushRemoteState(current, { mergeRemote: true }).catch(() => updateStatus('error'));
      else refreshFromRemote();
    } else {
      updateStatus('local');
    }
  });
  window.addEventListener('offline', () => updateStatus('offline'));
  window.addEventListener('focus', refreshFromRemote);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromRemote();
  });

  window.PlanorhaSync = sync;
  installStorageBridge();
  applyBrandAndSettingsPatches();
  initialize().finally(() => {
    loadApplication();
    startPolling();
  });
})();