(() => {
  'use strict';

  let reloadScheduled = false;
  let recovering = false;

  function showRecoveringStatus() {
    document.querySelectorAll('.js-sync-status').forEach(element => {
      element.dataset.status = 'connecting';
      element.innerHTML = '<i></i> Recuperando conexión…';
      element.title = 'Planorha está recuperando la conexión con la cuenta central.';
    });
  }

  async function refreshOnlineServices({ allowReload = true } = {}) {
    if (!navigator.onLine || recovering) return;
    recovering = true;

    try {
      const sync = window.PlanorhaSync;

      // Cuando la aplicación se inició sin internet, bootstrap deja la
      // sincronización deshabilitada para esa sesión. Una recarga controlada
      // vuelve a ejecutar la conciliación de los cambios locales con D1.
      if (allowReload && sync && !sync.enabled) {
        if (!reloadScheduled) {
          reloadScheduled = true;
          showRecoveringStatus();
          setTimeout(() => window.location.reload(), 300);
        }
        return;
      }

      await sync?.syncNow?.();
      await window.PlanorhaPush?.refresh?.();
    } catch (error) {
      console.warn('Planorha: no se pudo recuperar la conexión automáticamente.', error);
    } finally {
      recovering = false;
    }
  }

  window.addEventListener('online', () => refreshOnlineServices());
  window.addEventListener('focus', () => refreshOnlineServices());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnlineServices();
  });

  // En la PWA móvil no existe el botón lateral de sincronización. El indicador
  // superior también funciona como reintento manual al tocarlo.
  document.addEventListener('click', event => {
    const chip = event.target.closest('.mobile-sync-chip');
    if (!chip) return;
    refreshOnlineServices();
  });
})();
