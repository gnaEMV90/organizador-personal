import {
  EPOCH,
  SYNC_SCHEMA_VERSION,
  isValidState,
  statesEqual,
  normalizeState,
  prepareStateForLocalSave,
  mergeStates
} from './sync-core.js?v=4';

(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';
  const SYNC_META_KEY = 'planorha.sync.v3';
  const API_URL = '/api/state';
  const SAVE_DELAY_MS = 700;
  const POLL_INTERVAL_MS = 12000;
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

  function setSyncMeta(meta, dirty = false) {
    sync.updatedAt = meta.updatedAt || sync.updatedAt || null;
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

  function formatSyncTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function updateStatus(status, detail = '') {
    sync.status = status;
    const elements = document.querySelectorAll('.js-sync-status');
    const account = document.querySelector('#sync-account');
    const button = document.querySelector('#sync-now-button');
    const labels = {
      local: 'Guardado local',
      connecting: 'Conectando…',
      synced: 'Sincronizado',
      saving: 'Sincronizando…',
      offline: 'Sin conexión',
      unavailable: 'Sincronización pendiente',
      error: 'Error de sincronización'
    };
    const defaultDetail = status === 'synced' ? formatSyncTime(sync.updatedAt) : '';
    elements.forEach(element => {
      element.dataset.status = status;
      element.innerHTML = `<i></i> ${labels[status] || labels.local}${detail || defaultDetail ? ` · ${detail || defaultDetail}` : ''}`;
      element.title = sync.updatedAt ? `Última sincronización: ${new Date(sync.updatedAt).toLocaleString('es-AR')}` : labels[status];
    });
    if (account) account.textContent = sync.user || (sync.enabled ? 'Cuenta autenticada' : 'Datos en este dispositivo');
    if (button) {
      button.hidden = !sync.enabled;
      button.disabled = ['connecting', 'saving', 'offline'].includes(status);
    }
  }

  async function fetchRemoteState() {
    const response = await fetch(API_URL, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if ([401, 403, 404, 503].includes(response.status)) return { available: false, status: response.status };
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
    setTimeout(() => location.reload(), 100);
  }

  async function pushRemoteState(localValue) {
    if (!sync.enabled || !isValidState(localValue)) return;
    updateStatus(navigator.onLine ? 'saving' : 'offline');
    if (!navigator.onLine) return;

    const meta = readSyncMeta();
    const prepared = normalizeState(localValue, meta.changedAt || meta.savedAt || new Date().toISOString());
    const payload = await putRemoteState(prepared);
    if (!payload) return;

    const serverState = isValidState(payload.state) ? normalizeState(payload.state, payload.updatedAt) : prepared;
    writeLocalState(serverState);
    setSyncMeta(payload, false);
    updateStatus('synced');

    // Un guardado iniciado en este dispositivo no debe recargar la página.
    // La interfaz ya contiene el cambio local y el polling traerá cualquier
    // combinación remota posterior sin entrar en un ciclo de recargas.
  }

  function scheduleRemoteSave(rawValue) {
    markLocalChangesPending();
    if (!sync.enabled) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(async () => {
      try {
        await pushRemoteState(JSON.parse(rawValue));
      } catch (error) {
        console.warn('Planorha: no se pudieron sincronizar los cambios.', error);
        updateStatus(navigator.onLine ? 'error' : 'offline');
      }
    }, SAVE_DELAY_MS);
  }

  function installStorageBridge() {
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (this !== localStorage || key !== STORAGE_KEY) {
        nativeSetItem.call(this, key, value);
        return;
      }
      try {
        const previous = readLocalState();
        const incoming = JSON.parse(value);

        // app.js normaliza el estado al iniciar. Cuando esa normalización no
        // cambia ningún dato, no debe marcar la cuenta como sucia ni volver a
        // enviarla a D1 en cada carga.
        if (previous && statesEqual(previous, incoming)) {
          nativeSetItem.call(this, key, value);
          return;
        }

        const prepared = prepareStateForLocalSave(previous, incoming);
        const serialized = JSON.stringify(prepared);
        nativeSetItem.call(this, key, serialized);
        scheduleRemoteSave(serialized);
      } catch (error) {
        nativeSetItem.call(this, key, value);
        console.warn('Planorha: no se pudo preparar el cambio para sincronizar.', error);
        scheduleRemoteSave(value);
      }
    };
  }

  function loadApplication() {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/app.js?v=5';
    script.onerror = () => updateStatus('error');
    script.onload = () => { sync.appLoaded = true; };
    document.body.appendChild(script);
  }

  function applyBrandAndSettingsPatches() {
    const patch = () => {
      const settingsCards = [...document.querySelectorAll('.settings-card')];
      const storageCard = settingsCards.find(card => card.textContent.includes('Versión inicial') || card.dataset.syncCard === 'true');
      if (!storageCard) return;
      const connected = sync.enabled;
      const signature = [connected, sync.user, sync.updatedAt].join('|');
      if (storageCard.dataset.syncSignature === signature) return;
      storageCard.dataset.syncCard = 'true';
      storageCard.dataset.syncSignature = signature;
      storageCard.innerHTML = `
        <p class="eyebrow">Almacenamiento</p>
        <h2>${connected ? 'Sincronización activa' : 'Modo local seguro'}</h2>
        <p>${connected
          ? 'Tus cambios se guardan en este dispositivo y se sincronizan con Cloudflare D1.'
          : 'Tus datos continúan guardándose en este navegador mientras la sincronización no esté disponible.'}</p>
        <ul class="info-list">
          <li>Guardado automático local y funcionamiento sin conexión.</li>
          <li>${connected ? `Cuenta: ${sync.user || 'autenticada'}.` : 'Sin conexión con la cuenta central.'}</li>
          <li>${sync.updatedAt ? `Última sincronización: ${new Date(sync.updatedAt).toLocaleString('es-AR')}.` : 'Todavía no se registró una sincronización.'}</li>
        </ul>`;
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
        if (localState) {
          const prepared = prepareStateForLocalSave(null, localState);
          writeLocalState(prepared);
          await pushRemoteState(prepared);
        } else {
          setSyncMeta(remote, false);
          updateStatus('synced');
        }
        return;
      }

      const remoteState = normalizeState(remote.state, remote.updatedAt || EPOCH);
      const belongsToAnotherUser = localMeta.user && remote.user && localMeta.user !== remote.user;
      if (!localState || belongsToAnotherUser) {
        writeLocalState(remoteState);
        setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      const localFallback = localMeta.changedAt || localMeta.savedAt || EPOCH;
      const shouldReconcile = localMeta.dirty || !localMeta.updatedAt || Number(localState?._sync?.schemaVersion || 0) < SYNC_SCHEMA_VERSION;
      if (shouldReconcile) {
        const merged = mergeStates(remoteState, localState, remote.updatedAt || EPOCH, localFallback);
        writeLocalState(merged);
        await pushRemoteState(merged);
        return;
      }

      if (localMeta.updatedAt !== remote.updatedAt || !statesEqual(normalizeState(localState, localFallback), remoteState)) writeLocalState(remoteState);
      setSyncMeta(remote, false);
      updateStatus('synced');
    } catch (error) {
      console.warn('Planorha: la sincronización no está disponible.', error);
      updateStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function refreshFromRemote({ force = false } = {}) {
    if (!sync.enabled || sync.refreshing || !navigator.onLine) return;
    const meta = readSyncMeta();
    if (meta.dirty && !force) return;
    sync.refreshing = true;
    if (force) updateStatus('connecting');
    try {
      if (meta.dirty) {
        await pushRemoteState(readLocalState());
        return;
      }
      const remote = await fetchRemoteState();
      if (!remote.available || !isValidState(remote.state)) return;
      const remoteState = normalizeState(remote.state, remote.updatedAt || EPOCH);
      const changed = !statesEqual(readLocalState(), remoteState);
      writeLocalState(remoteState);
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
    sync.pollTimer = setInterval(() => refreshFromRemote(), POLL_INTERVAL_MS);
  }

  document.querySelector('#sync-now-button')?.addEventListener('click', () => refreshFromRemote({ force: true }));
  window.addEventListener('online', () => sync.enabled ? refreshFromRemote({ force: true }) : updateStatus('local'));
  window.addEventListener('offline', () => updateStatus('offline'));
  window.addEventListener('focus', () => refreshFromRemote());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshFromRemote();
  });

  sync.syncNow = () => refreshFromRemote({ force: true });
  window.PlanorhaSync = sync;
  installStorageBridge();
  applyBrandAndSettingsPatches();
  initialize().finally(() => {
    loadApplication();
    startPolling();
  });
})();
