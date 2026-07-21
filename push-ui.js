(() => {
  'use strict';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function statusCopy(state) {
    if (!state.supported) return {
      title: 'No disponible en este navegador',
      text: 'Este navegador no ofrece las APIs necesarias para recibir notificaciones con Planorha cerrada.',
      action: ''
    };
    if (state.loading) return { title: 'Comprobando notificaciones…', text: 'Planorha está consultando el estado de este dispositivo.', action: '' };
    if (!state.configured) return {
      title: 'Configuración pendiente',
      text: 'La aplicación ya está preparada, pero todavía faltan las claves VAPID y el Worker programado en Cloudflare.',
      action: ''
    };
    if (state.permission === 'denied') return {
      title: 'Notificaciones bloqueadas',
      text: 'El navegador bloqueó el permiso. Debés habilitarlo desde la configuración del sitio o del sistema.',
      action: ''
    };
    if (state.subscriptionNeedsRefresh) return {
      title: 'Suscripción desactualizada',
      text: 'Las claves de notificación cambiaron. Actualizá este dispositivo para poder recibir los próximos recordatorios.',
      action: '<button class="button button-primary" type="button" data-push-action="enable">Actualizar este dispositivo</button>'
    };
    if (state.subscription) return {
      title: 'Recordatorios en segundo plano activos',
      text: 'Este dispositivo puede recibir recordatorios aunque Planorha no esté abierta.',
      action: '<button class="button button-ghost" type="button" data-push-action="disable">Desactivar en este dispositivo</button>'
    };
    return {
      title: 'Recordatorios con Planorha cerrada',
      text: 'Activá Web Push para que este dispositivo reciba los avisos programados incluso cuando la aplicación no esté abierta.',
      action: '<button class="button button-primary" type="button" data-push-action="enable">Activar en este dispositivo</button>'
    };
  }

  function render() {
    const grid = document.querySelector('.settings-grid');
    const api = window.PlanorhaPush;
    if (!grid || !api) return;

    let card = document.querySelector('#push-settings-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'push-settings-card';
      card.className = 'settings-card';
      grid.insertBefore(card, grid.lastElementChild || null);
    }

    const copy = statusCopy(api.state);
    const signature = JSON.stringify({
      supported: api.state.supported,
      configured: api.state.configured,
      permission: api.state.permission,
      subscribed: Boolean(api.state.subscription),
      subscriptionNeedsRefresh: Boolean(api.state.subscriptionNeedsRefresh),
      loading: api.state.loading,
      error: api.state.error,
      title: copy.title,
      text: copy.text
    });
    if (card.dataset.pushSignature === signature) return;
    card.dataset.pushSignature = signature;

    card.innerHTML = `
      <p class="eyebrow">Segundo plano</p>
      <h2>${escapeHtml(copy.title)}</h2>
      <p>${escapeHtml(copy.text)}</p>
      ${api.state.error ? `<p class="settings-note push-error">${escapeHtml(api.state.error)}</p>` : ''}
      <div class="settings-actions">${copy.action}<button class="button button-ghost" type="button" data-push-action="refresh">Actualizar estado</button></div>`;

    card.querySelector('[data-push-action="enable"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {
        await api.subscribe();
      } catch (error) {
        console.warn('Planorha Web Push:', error);
      }
      render();
    });

    card.querySelector('[data-push-action="disable"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      try {
        await api.unsubscribe();
      } catch (error) {
        console.warn('Planorha Web Push:', error);
      }
      render();
    });

    card.querySelector('[data-push-action="refresh"]')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true;
      await api.refresh();
      render();
    });
  }

  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('planorha:push-status', render);
  window.addEventListener('hashchange', () => setTimeout(render, 0));
  render();
})();
