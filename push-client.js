(() => {
  'use strict';

  const API_CONFIG = '/api/push/config';
  const API_SUBSCRIPTION = '/api/push/subscription';

  const state = {
    supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    configured: false,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    subscription: null,
    publicKey: '',
    loading: false,
    error: ''
  };

  function emit() {
    window.dispatchEvent(new CustomEvent('planorha:push-status', { detail: { ...state } }));
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function refresh() {
    if (!state.supported) {
      emit();
      return { ...state };
    }

    state.loading = true;
    state.error = '';
    emit();
    try {
      const config = await fetchJson(API_CONFIG);
      state.configured = Boolean(config.enabled && config.publicKey);
      state.publicKey = config.publicKey || '';
      state.permission = Notification.permission;
      const registration = await navigator.serviceWorker.ready;
      state.subscription = await registration.pushManager.getSubscription();
    } catch (error) {
      state.error = error.message || 'No se pudo consultar Web Push.';
      state.configured = false;
    } finally {
      state.loading = false;
      emit();
    }
    return { ...state };
  }

  async function subscribe() {
    if (!state.supported) throw new Error('Este navegador no admite Web Push.');
    await refresh();
    if (!state.configured) throw new Error('Web Push todavía no está configurado en Cloudflare.');

    const permission = await Notification.requestPermission();
    state.permission = permission;
    if (permission !== 'granted') {
      emit();
      throw new Error('El permiso de notificaciones no fue concedido.');
    }

    state.loading = true;
    emit();
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(state.publicKey)
        });
      }

      await fetchJson(API_SUBSCRIPTION, {
        method: 'POST',
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          deviceName: `${navigator.platform || 'Dispositivo'} · ${navigator.userAgentData?.mobile ? 'móvil' : 'navegador'}`
        })
      });
      state.subscription = subscription;
      state.error = '';
    } catch (error) {
      state.error = error.message || 'No se pudo activar Web Push.';
      throw error;
    } finally {
      state.loading = false;
      emit();
    }
    return { ...state };
  }

  async function unsubscribe() {
    if (!state.supported) return { ...state };
    state.loading = true;
    emit();
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetchJson(API_SUBSCRIPTION, {
          method: 'DELETE',
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        await subscription.unsubscribe();
      }
      state.subscription = null;
      state.error = '';
    } catch (error) {
      state.error = error.message || 'No se pudo desactivar Web Push.';
      throw error;
    } finally {
      state.loading = false;
      emit();
    }
    return { ...state };
  }

  window.PlanorhaPush = {
    state,
    refresh,
    subscribe,
    unsubscribe
  };

  window.addEventListener('load', () => refresh());
})();
