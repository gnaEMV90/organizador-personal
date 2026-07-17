(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';

  function readOrderMap() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return new Map((state.tasks || []).map((task, index) => [task.id, Number.isFinite(Number(task.order)) ? Number(task.order) : index]));
    } catch {
      return new Map();
    }
  }

  function applyManualOrder() {
    const container = document.querySelector('#tasks-results');
    if (!container) return;
    const rows = [...container.querySelectorAll(':scope > .task-row[data-task-id]')];
    if (rows.length < 2) return;
    const order = readOrderMap();
    rows
      .sort((left, right) => (order.get(left.dataset.taskId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.dataset.taskId) ?? Number.MAX_SAFE_INTEGER))
      .forEach(row => container.appendChild(row));
  }

  const observer = new MutationObserver(applyManualOrder);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('storage', applyManualOrder);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyManualOrder();
  });
  applyManualOrder();
})();
