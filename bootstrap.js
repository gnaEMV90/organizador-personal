(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';
  const SYNC_META_KEY = 'planorha.sync.v1';
  const API_URL = '/api/state';
  const SAVE_DELAY_MS = 650;
  const nativeSetItem = Storage.prototype.setItem;

  const sync = {
    enabled: false,
    status: 'local',
    user: null,
    updatedAt: null,
    timer: null
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

  async function pushRemoteState(state) {
    if (!sync.enabled || !isValidState(state)) return;

    updateStatus(navigator.onLine ? 'saving' : 'offline');
    if (!navigator.onLine) return;

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
        return;
      }
      throw new Error(`PUT ${API_URL}: ${response.status}`);
    }

    const payload = await response.json();
    setSyncMeta(payload, false);
    updateStatus('synced');
  }

  function scheduleRemoteSave(rawValue) {
    markLocalChangesPending();
    if (!sync.enabled) return;

    clearTimeout(sync.timer);
    sync.timer = setTimeout(async () => {
      try {
        const parsed = JSON.parse(rawValue);
        await pushRemoteState(parsed);
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
    script.src = '/app.js';
    script.defer = true;
    script.onerror = () => updateStatus('error');
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
        if (localState) await pushRemoteState(localState);
        else setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      if (!localState) {
        writeLocalState(remote.state);
        setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      if (localMeta.dirty && localMeta.updatedAt === remote.updatedAt) {
        await pushRemoteState(localState);
        return;
      }

      if (localMeta.updatedAt && localMeta.updatedAt !== remote.updatedAt) {
        writeLocalState(remote.state);
        setSyncMeta(remote, false);
        updateStatus('synced');
        return;
      }

      if (!localMeta.updatedAt) {
        await pushRemoteState(localState);
        return;
      }

      setSyncMeta(remote, false);
      updateStatus('synced');
    } catch (error) {
      console.warn('Planorha: la sincronización no está disponible.', error);
      updateStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  window.addEventListener('online', () => {
    if (sync.enabled) {
      const current = readLocalState();
      const meta = readSyncMeta();
      if (current && meta.dirty) pushRemoteState(current).catch(() => updateStatus('error'));
      else updateStatus('synced');
    } else {
      updateStatus('local');
    }
  });
  window.addEventListener('offline', () => updateStatus('offline'));

  window.PlanorhaSync = sync;
  installStorageBridge();
  applyBrandAndSettingsPatches();
  initialize().finally(loadApplication);
})();