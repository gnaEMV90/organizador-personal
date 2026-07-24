const message = document.querySelector('#admin-message');
const content = document.querySelector('#admin-content');
const stats = document.querySelector('#admin-stats');
const usersBody = document.querySelector('#admin-users');
const searchInput = document.querySelector('#admin-search');
let searchTimer = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function statusLabel(status) {
  return ({ pending_verification: 'Sin verificar', trialing: 'En prueba', trial_expired: 'Prueba vencida', active: 'Activa', past_due: 'Pago pendiente', canceled: 'Cancelada', suspended: 'Suspendida' })[status] || status;
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-AR');
}

function trialLabel(user) {
  if (!user.trial_ends_at) return '—';
  const remaining = Math.ceil((new Date(user.trial_ends_at).getTime() - Date.now()) / 86_400_000);
  return remaining > 0 ? `${remaining} días` : `Venció ${dateLabel(user.trial_ends_at)}`;
}

async function loadOverview() {
  const payload = await api('/api/admin/overview');
  const items = [
    ['Usuarios', payload.totals.total], ['En prueba', payload.totals.trialing],
    ['Activos', payload.totals.active], ['Prueba vencida', payload.totals.trialExpired],
    ['Sin verificar', payload.totals.pendingVerification], ['Sesiones', payload.totals.activeSessions]
  ];
  stats.innerHTML = items.map(([label, value]) => `<article class="admin-stat"><small>${label}</small><strong>${value}</strong></article>`).join('');
}

async function loadUsers(query = '') {
  const payload = await api(`/api/admin/users?q=${encodeURIComponent(query)}`);
  usersBody.innerHTML = payload.users.length ? payload.users.map(user => `
    <tr data-user-id="${escapeHtml(user.id)}">
      <td class="user-cell"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></td>
      <td><span class="status-badge ${['trial_expired', 'suspended'].includes(user.status) ? `is-${user.status === 'suspended' ? 'suspended' : 'expired'}` : ''}">${escapeHtml(statusLabel(user.status))}</span></td>
      <td>${escapeHtml(trialLabel(user))}</td>
      <td>${Number(user.active_sessions || 0)}</td>
      <td>${dateLabel(user.created_at)}</td>
      <td><div class="admin-actions">
        <button data-admin-action="extend_trial">+7 días</button>
        <button data-admin-action="restart_trial">Reiniciar prueba</button>
        ${user.status === 'suspended' ? '<button data-admin-action="activate">Activar</button>' : '<button data-admin-action="suspend">Suspender</button>'}
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6">No se encontraron usuarios.</td></tr>';
  usersBody.querySelectorAll('[data-admin-action]').forEach(button => button.addEventListener('click', handleAction));
}

async function handleAction(event) {
  const button = event.currentTarget;
  const row = button.closest('[data-user-id]');
  const action = button.dataset.adminAction;
  if (!confirm('¿Confirmás esta acción sobre la cuenta?')) return;
  button.disabled = true;
  try {
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ userId: row.dataset.userId, action, days: 7 }) });
    await Promise.all([loadOverview(), loadUsers(searchInput.value)]);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers(searchInput.value).catch(showError), 350);
});

function showError(error) {
  message.textContent = error.message;
  message.className = 'admin-message is-error';
  message.hidden = false;
  content.hidden = true;
}

async function initialize() {
  try {
    const session = await api('/api/auth/session');
    if (session.user.role !== 'admin') throw new Error('Tu cuenta no tiene acceso a la administración.');
    await Promise.all([loadOverview(), loadUsers()]);
    message.hidden = true;
    content.hidden = false;
  } catch (error) {
    showError(error);
  }
}

initialize();
