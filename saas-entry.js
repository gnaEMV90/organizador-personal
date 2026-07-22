(() => {
  'use strict';

  const AUTH_CACHE_KEY = 'planorha.auth.cache.v1';
  const ACTIVE_USER_KEY = 'planorha.activeUser.v1';
  const APP_STATE_KEY = 'organizadorPersonal.v1';
  const SYNC_META_KEY = 'planorha.sync.v3';
  const MUTATIONS = new Set([
    'new-task', 'new-task-selected-date', 'new-task-week', 'new-list', 'new-category',
    'toggle-task', 'edit-task', 'duplicate-task', 'archive-task', 'restore-task',
    'move-task-up', 'move-task-down', 'delete-task', 'archive-completed',
    'add-list-item', 'toggle-list-item', 'delete-list-item', 'move-list-item-up',
    'move-list-item-down', 'move-list-up', 'move-list-down', 'edit-list', 'delete-list',
    'edit-category', 'delete-category', 'import-data', 'reset-data'
  ]);

  let account = null;
  let config = {};
  let observer = null;

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  function resolveGate(allowed) {
    window.PlanorhaResolveAuth?.(Boolean(allowed));
    window.PlanorhaResolveAuth = null;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload.error || `Error ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function userKey(userId, kind) {
    return `planorha.user.${userId}.${kind}.v1`;
  }

  function backupUser(userId = localStorage.getItem(ACTIVE_USER_KEY)) {
    if (!userId) return;
    const state = localStorage.getItem(APP_STATE_KEY);
    const sync = localStorage.getItem(SYNC_META_KEY);
    if (state) localStorage.setItem(userKey(userId, 'state'), state);
    if (sync) localStorage.setItem(userKey(userId, 'sync'), sync);
  }

  function activateUser(user) {
    try {
      const previous = localStorage.getItem(ACTIVE_USER_KEY);
      if (previous && previous !== user.id) {
        backupUser(previous);
        const state = localStorage.getItem(userKey(user.id, 'state'));
        const sync = localStorage.getItem(userKey(user.id, 'sync'));
        state ? localStorage.setItem(APP_STATE_KEY, state) : localStorage.removeItem(APP_STATE_KEY);
        sync ? localStorage.setItem(SYNC_META_KEY, sync) : localStorage.removeItem(SYNC_META_KEY);
      } else if (!previous) {
        let previousEmail = '';
        try { previousEmail = JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}').user || ''; } catch {}
        if (previousEmail && previousEmail.toLowerCase() !== user.email.toLowerCase()) {
          localStorage.removeItem(APP_STATE_KEY);
          localStorage.removeItem(SYNC_META_KEY);
        }
      }
      localStorage.setItem(ACTIVE_USER_KEY, user.id);
      backupUser(user.id);
    } catch (error) {
      console.warn('Planorha: no se pudo activar el espacio local.', error);
    }
  }

  function deactivateUser() {
    try {
      backupUser();
      localStorage.removeItem(APP_STATE_KEY);
      localStorage.removeItem(SYNC_META_KEY);
      localStorage.removeItem(ACTIVE_USER_KEY);
      localStorage.removeItem(AUTH_CACHE_KEY);
    } catch {}
  }

  function saveCache(payload) {
    try {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        user: payload.user,
        source: payload.source,
        paymentsConfigured: payload.paymentsConfigured,
        savedAt: new Date().toISOString()
      }));
    } catch {}
  }

  function readCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || 'null');
      if (!cached?.user) return null;
      const user = { ...cached.user };
      if (user.status === 'trialing' && user.trialEndsAt && Date.parse(user.trialEndsAt) <= Date.now()) {
        user.status = 'trial_expired';
        user.accessMode = 'read_only';
        user.trialDaysRemaining = 0;
        user.trialHoursRemaining = 0;
      }
      return { ...cached, user };
    } catch {
      return null;
    }
  }

  function screen() {
    let node = document.querySelector('#auth-screen');
    if (!node) {
      node = document.createElement('section');
      node.id = 'auth-screen';
      node.className = 'auth-screen';
      document.body.appendChild(node);
    }
    return node;
  }

  function layout(content) {
    return `<div class="auth-layout">
      <section class="auth-presentation">
        <div class="auth-brand"><span class="auth-brand-mark">P</span><span><strong>Planorha</strong><small>Tu día, en orden</small></span></div>
        <div class="auth-pitch"><p class="eyebrow">ORGANIZACIÓN PERSONAL</p><h1>Todo lo importante, en un solo lugar.</h1><p>Organizá tareas, calendarios y listas desde todos tus dispositivos.</p><ul class="auth-benefits"><li>7 días de prueba completa</li><li>Sincronización entre dispositivos</li><li>Recordatorios con la app cerrada</li></ul></div>
      </section><section class="auth-panel">${content}</section></div>`;
  }

  function message(text = '', type = '') {
    const node = document.querySelector('#auth-message');
    if (!node) return;
    node.textContent = text;
    node.className = `auth-message${text ? ' is-visible' : ''}${type ? ` is-${type}` : ''}`;
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button,input').forEach(element => { element.disabled = busy; });
    const submit = form.querySelector('[type="submit"]');
    if (!submit) return;
    submit.dataset.label ||= submit.textContent;
    submit.textContent = busy ? 'Procesando…' : submit.dataset.label;
  }

  function turnstileMarkup() {
    return config.turnstileSiteKey ? '<div class="auth-turnstile" data-turnstile></div>' : '';
  }

  async function mountTurnstile() {
    if (!config.turnstileSiteKey) return;
    if (!window.turnstile) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    document.querySelectorAll('[data-turnstile]:not([data-mounted])').forEach(node => {
      node.dataset.mounted = 'true';
      const form = node.closest('form');
      window.turnstile.render(node, {
        sitekey: config.turnstileSiteKey,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        callback: token => { form.dataset.turnstileToken = token; },
        'expired-callback': () => { form.dataset.turnstileToken = ''; }
      });
    });
  }

  function authShell(content) {
    document.body.classList.remove('auth-pending', 'auth-verifying');
    document.body.classList.add('auth-anonymous');
    screen().innerHTML = layout(content);
    bindNavigation();
    mountTurnstile().catch(error => console.warn('Planorha Turnstile:', error));
  }

  function loginView(note = '') {
    authShell(`<div class="auth-panel-header"><p class="eyebrow">BIENVENIDO</p><h2>Iniciar sesión</h2><p>Entrá para continuar donde lo dejaste.</p></div>
      <div id="auth-message" class="auth-message${note ? ' is-visible' : ''}">${escapeHtml(note)}</div>
      <form class="auth-form" data-auth-form="login">
        <label class="auth-field">Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
        <label class="auth-field">Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
        ${turnstileMarkup()}<button class="button button-primary auth-submit" type="submit">Iniciar sesión</button>
      </form><div class="auth-links"><button class="auth-link" data-auth-view="register">Crear una cuenta</button><button class="auth-link" data-auth-view="forgot">Olvidé mi contraseña</button></div>`);
  }

  function registerView() {
    authShell(`<div class="auth-panel-header"><p class="eyebrow">7 DÍAS GRATIS</p><h2>Crear cuenta</h2><p>Acceso completo durante la prueba. No te pedimos un medio de pago.</p></div>
      <div id="auth-message" class="auth-message"></div>
      <form class="auth-form" data-auth-form="register">
        <label class="auth-field">Nombre<input name="name" autocomplete="name" maxlength="100" required></label>
        <label class="auth-field">Correo electrónico<input name="email" type="email" autocomplete="email" required></label>
        <label class="auth-field">Contraseña<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
        <label class="auth-field">Repetir contraseña<input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required></label>
        <label class="auth-terms"><input name="acceptedTerms" type="checkbox" required><span>Acepto los términos de uso y la política de privacidad.</span></label>
        ${turnstileMarkup()}<button class="button button-primary auth-submit" type="submit">Crear mi cuenta</button>
      </form><div class="auth-links"><button class="auth-link" data-auth-view="login">Ya tengo una cuenta</button></div>`);
  }

  function forgotView() {
    authShell(`<div class="auth-panel-header"><p class="eyebrow">RECUPERAR ACCESO</p><h2>Restablecer contraseña</h2><p>Te enviaremos un enlace seguro a tu correo.</p></div>
      <div id="auth-message" class="auth-message"></div>
      <form class="auth-form" data-auth-form="forgot"><label class="auth-field">Correo electrónico<input name="email" type="email" autocomplete="email" required></label>${turnstileMarkup()}<button class="button button-primary auth-submit" type="submit">Enviar instrucciones</button></form>
      <div class="auth-links"><button class="auth-link" data-auth-view="login">Volver al inicio</button></div>`);
  }

  function resetView(token) {
    authShell(`<div class="auth-panel-header"><p class="eyebrow">NUEVA CONTRASEÑA</p><h2>Elegí una contraseña</h2><p>Debe tener al menos 10 caracteres, con letras y números.</p></div>
      <div id="auth-message" class="auth-message"></div>
      <form class="auth-form" data-auth-form="reset"><input name="token" type="hidden" value="${escapeHtml(token)}"><label class="auth-field">Nueva contraseña<input name="password" type="password" minlength="10" required></label><label class="auth-field">Repetir contraseña<input name="confirmPassword" type="password" minlength="10" required></label><button class="button button-primary auth-submit" type="submit">Guardar contraseña</button></form>`);
  }

  function pendingVerificationView(email, emailConfigured, debugToken = '') {
    authShell(`<div class="auth-status-card"><div class="auth-status-icon">✉</div><h2>Revisá tu correo</h2><p>${emailConfigured ? `Enviamos un enlace de verificación a <strong>${escapeHtml(email)}</strong>. Al confirmarlo empiezan tus 7 días de prueba.` : 'La cuenta fue creada, pero el servicio de correo todavía no está configurado.'}</p>${debugToken ? `<p class="settings-note">Modo de prueba activo: <a href="/?verify=${encodeURIComponent(debugToken)}">verificar ahora</a>.</p>` : ''}<button class="button button-primary" data-auth-view="login">Volver al inicio</button></div>`);
  }

  function bindNavigation() {
    document.querySelectorAll('[data-auth-view]').forEach(button => button.addEventListener('click', () => {
      const view = button.dataset.authView;
      if (view === 'register') registerView();
      else if (view === 'forgot') forgotView();
      else loginView();
    }));
    document.querySelector('[data-auth-form]')?.addEventListener('submit', submitAuthForm);
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.authForm;
    const data = Object.fromEntries(new FormData(form).entries());
    data.turnstileToken = form.dataset.turnstileToken || '';
    if (type === 'register') data.acceptedTerms = Boolean(form.elements.acceptedTerms?.checked);
    if (data.confirmPassword && data.password !== data.confirmPassword) return message('Las contraseñas no coinciden.', 'error');
    const endpoints = { login: '/api/auth/login', register: '/api/auth/register', forgot: '/api/auth/forgot-password', reset: '/api/auth/reset-password' };
    try {
      setBusy(form, true);
      const payload = await api(endpoints[type], { method: 'POST', body: JSON.stringify(data) });
      if (type === 'login') {
        activateUser(payload.user);
        location.replace('/#hoy');
      } else if (type === 'register') {
        pendingVerificationView(data.email, payload.emailConfigured, payload.verificationToken || '');
      } else if (type === 'forgot') {
        message(payload.message || 'Revisá tu correo.', 'success');
        if (payload.resetToken) setTimeout(() => resetView(payload.resetToken), 700);
      } else {
        loginView('La contraseña se actualizó. Ya podés iniciar sesión.');
        history.replaceState(null, '', '/');
      }
    } catch (error) {
      message(error.message, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function verifyEmail(token) {
    document.body.classList.remove('auth-pending');
    document.body.classList.add('auth-verifying');
    screen().innerHTML = layout('<div class="auth-status-card"><div class="auth-status-icon">…</div><h2>Activando tu cuenta</h2><p>Estamos preparando tu espacio personal.</p></div>');
    try {
      const payload = await api('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
      activateUser(payload.user);
      history.replaceState(null, '', '/#hoy');
      location.reload();
    } catch (error) {
      loginView(error.message);
      history.replaceState(null, '', '/');
    }
  }

  function subscriptionDialog() {
    let dialog = document.querySelector('#subscription-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'subscription-dialog';
    dialog.className = 'dialog compact-dialog';
    dialog.innerHTML = `<div class="dialog-header"><div><p class="eyebrow">PLANORHA</p><h2>Gestionar suscripción</h2></div><button class="icon-button" data-subscription-close>×</button></div><div class="panel-body"><p id="subscription-copy"></p></div><div class="dialog-actions"><button class="button button-ghost" data-subscription-close>Volver</button><button class="button button-primary" data-subscription-action>Continuar</button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('[data-subscription-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
    return dialog;
  }

  function showSubscription() {
    const dialog = subscriptionDialog();
    const enabled = Boolean(account?.paymentsConfigured);
    dialog.querySelector('#subscription-copy').textContent = enabled
      ? 'Elegí un plan para conservar el acceso completo a Planorha.'
      : 'La contratación todavía no está habilitada. Tus datos continúan guardados y podrás reactivar la cuenta cuando se publiquen los planes.';
    const action = dialog.querySelector('[data-subscription-action]');
    action.textContent = enabled ? 'Elegir plan' : 'Entendido';
    action.onclick = () => enabled ? location.assign('/suscripcion') : dialog.close();
    dialog.showModal();
  }

  function installBanner(user) {
    document.querySelector('#trial-banner')?.remove();
    if (!['trialing', 'trial_expired', 'past_due', 'canceled'].includes(user.status)) return;
    const banner = document.createElement('div');
    banner.id = 'trial-banner';
    banner.className = `trial-banner${user.trialDaysRemaining <= 1 ? ' is-urgent' : ''}`;
    if (user.status === 'trialing') {
      const time = user.trialDaysRemaining > 1 ? `${user.trialDaysRemaining} días` : `${Math.max(1, user.trialHoursRemaining)} horas`;
      banner.innerHTML = `<span><strong>Prueba completa:</strong> te quedan ${escapeHtml(time)}.</span><button type="button">Ver suscripción</button>`;
    } else {
      banner.innerHTML = '<span><strong>Tu prueba terminó.</strong> Tus datos están seguros y Planorha está en modo de solo lectura.</span><button type="button">Gestionar suscripción</button>';
    }
    banner.querySelector('button').addEventListener('click', showSubscription);
    document.body.prepend(banner);
  }

  function protectReadOnly() {
    if (account?.user?.accessMode !== 'read_only') return;
    document.body.classList.add('is-read-only');
    document.querySelectorAll('[data-action]').forEach(element => {
      if (MUTATIONS.has(element.dataset.action)) element.setAttribute('aria-disabled', 'true');
    });
  }

  function installMutationGuards() {
    document.addEventListener('click', event => {
      if (account?.user?.accessMode !== 'read_only') return;
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action || !MUTATIONS.has(action)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showSubscription();
    }, true);
    document.addEventListener('submit', event => {
      if (account?.user?.accessMode !== 'read_only') return;
      if (!event.target.matches('#task-form,#list-form,#category-form,.add-list-item')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showSubscription();
    }, true);
  }

  async function loadSessions(container) {
    try {
      const payload = await api('/api/auth/sessions');
      container.innerHTML = payload.sessions.length ? payload.sessions.map(session => `<div class="account-session" data-session="${escapeHtml(session.id)}"><span><strong>${escapeHtml(session.device_name || 'Dispositivo')}</strong><small>${session.current ? 'Este dispositivo' : `Último uso: ${new Date(session.last_seen_at).toLocaleString('es-AR')}`}</small></span>${session.current ? '' : '<button type="button" data-revoke>Desconectar</button>'}</div>`).join('') : '<p class="settings-note">La sesión actual usa el acceso transitorio de Cloudflare.</p>';
      container.querySelectorAll('[data-revoke]').forEach(button => button.addEventListener('click', async () => {
        const row = button.closest('[data-session]');
        await api('/api/auth/sessions', { method: 'DELETE', body: JSON.stringify({ sessionId: row.dataset.session }) });
        row.remove();
      }));
    } catch (error) {
      container.innerHTML = `<p class="settings-note">${escapeHtml(error.message)}</p>`;
    }
  }

  function injectAccountCard() {
    const grid = document.querySelector('.settings-grid');
    if (!grid || grid.querySelector('#account-settings-card') || !account?.user) return;
    const user = account.user;
    const card = document.createElement('section');
    card.id = 'account-settings-card';
    card.className = 'settings-card';
    card.innerHTML = `<p class="eyebrow">CUENTA</p><h2>Tu cuenta</h2><p>Administrá el acceso y los dispositivos vinculados.</p><div class="account-card-grid"><div class="account-identity"><span class="account-avatar">${escapeHtml(user.name.slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)} · ${escapeHtml(user.status)}</small></span></div><div class="settings-actions"><button class="button button-ghost" data-logout>Cerrar sesión</button><button class="button button-ghost" data-logout-all>Cerrar todas</button>${user.role === 'admin' ? '<button class="button button-ghost" data-admin>Administración</button>' : ''}${user.accessMode !== 'full' || user.status === 'trialing' ? '<button class="button button-primary" data-subscription>Suscripción</button>' : ''}</div><form class="account-inline-form" data-password-form>${user.hasPassword ? '<input name="currentPassword" type="password" placeholder="Contraseña actual" required>' : ''}<input name="password" type="password" minlength="10" placeholder="Nueva contraseña" required><input name="confirmPassword" type="password" minlength="10" placeholder="Repetir contraseña" required><button class="button button-primary">${user.hasPassword ? 'Cambiar contraseña' : 'Crear contraseña'}</button></form><div class="account-session-list" data-session-list><p class="settings-note">Cargando dispositivos…</p></div></div>`;
    grid.prepend(card);
    card.querySelector('[data-logout]').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); deactivateUser(); location.reload(); });
    card.querySelector('[data-logout-all]').addEventListener('click', async () => { await api('/api/auth/logout-all', { method: 'POST' }); deactivateUser(); location.reload(); });
    card.querySelector('[data-admin]')?.addEventListener('click', () => location.assign('/admin.html'));
    card.querySelector('[data-subscription]')?.addEventListener('click', showSubscription);
    card.querySelector('[data-password-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = Object.fromEntries(new FormData(form).entries());
      if (data.password !== data.confirmPassword) return alert('Las contraseñas no coinciden.');
      try {
        setBusy(form, true);
        const payload = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify(data) });
        account.user = payload.user;
        form.reset();
        alert('La contraseña se actualizó correctamente.');
      } catch (error) { alert(error.message); } finally { setBusy(form, false); }
    });
    loadSessions(card.querySelector('[data-session-list]'));
  }

  function observeApplication() {
    observer?.disconnect();
    observer = new MutationObserver(() => { injectAccountCard(); protectReadOnly(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    injectAccountCard();
    protectReadOnly();
  }

  async function boot(payload) {
    account = payload;
    activateUser(payload.user);
    saveCache(payload);
    screen().remove();
    document.body.classList.remove('auth-pending', 'auth-anonymous', 'auth-verifying');
    document.body.classList.add('auth-authenticated');
    installBanner(payload.user);
    installMutationGuards();
    observeApplication();
    window.PlanorhaAccount = payload;
    resolveGate(true);
    window.dispatchEvent(new CustomEvent('planorha:account-ready', { detail: payload }));
  }

  async function initialize() {
    try { config = await api('/api/auth/config'); } catch { config = {}; }
    const params = new URLSearchParams(location.search);
    if (params.get('verify')) return verifyEmail(params.get('verify'));
    if (params.get('reset')) { resetView(params.get('reset')); resolveGate(false); return; }

    try {
      const payload = await api('/api/auth/session');
      await boot(payload);
    } catch (error) {
      if (error.status === 401) {
        deactivateUser();
        loginView();
        resolveGate(false);
        return;
      }
      const cached = readCache();
      if (cached) {
        await boot({ ...cached, source: 'offline_cache' });
        return;
      }
      loginView('Necesitás conexión para iniciar sesión por primera vez en este dispositivo.');
      resolveGate(false);
    }
  }

  window.addEventListener('pagehide', () => backupUser());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') backupUser(); });
  setInterval(() => backupUser(), 5000);
  initialize();
})();
