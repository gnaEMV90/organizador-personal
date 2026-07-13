(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';
  const VIEWS = ['hoy', 'calendario', 'tareas', 'listas', 'categorias', 'ajustes'];
  const VIEW_TITLES = {
    hoy: 'Hoy',
    calendario: 'Calendario',
    tareas: 'Tareas',
    listas: 'Listas',
    categorias: 'Categorías',
    ajustes: 'Ajustes'
  };
  const PRIORITY_LABELS = { high: 'Alta', medium: 'Media', low: 'Baja' };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const pad = number => String(number).padStart(2, '0');
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const todayKey = () => dateKey(new Date());
  const parseLocalDate = value => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const defaultState = () => ({
    version: 1,
    categories: [
      { id: 'personal', name: 'Personal', color: '#5c7c70' },
      { id: 'familia', name: 'Familia', color: '#c88764' },
      { id: 'trabajo', name: 'Trabajo', color: '#58789a' },
      { id: 'iglesia', name: 'Iglesia', color: '#8d6a9f' },
      { id: 'anavim', name: 'Anavim', color: '#b18a46' }
    ],
    tasks: [],
    lists: [
      { id: uid(), title: 'Compras', notes: 'Lista general para el supermercado y la casa.', categoryId: 'familia', items: [], createdAt: new Date().toISOString() }
    ]
  });

  let state = loadState();
  let currentView = normalizeView(location.hash.slice(1));
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedCalendarDate = todayKey();
  let deferredInstallPrompt = null;
  let toastTimer = null;

  const content = $('#app-content');
  const viewTitle = $('#view-title');
  const todayLabel = $('#today-label');

  function normalizeView(view) {
    return VIEWS.includes(view) ? view : 'hoy';
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.lists)) {
        return defaultState();
      }
      return parsed;
    } catch (error) {
      console.error('No se pudieron cargar los datos:', error);
      return defaultState();
    }
  }

  function saveState(message) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (message) showToast(message);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function categoryById(id) {
    return state.categories.find(category => category.id === id) || { id: '', name: 'Sin categoría', color: '#84918b' };
  }

  function categoryOptions(selected = '') {
    return `<option value="">Sin categoría</option>${state.categories.map(category => `<option value="${escapeHtml(category.id)}" ${category.id === selected ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}`;
  }

  function formatDate(value, options = { day: 'numeric', month: 'short' }) {
    const date = parseLocalDate(value);
    if (!date) return 'Sin fecha';
    return new Intl.DateTimeFormat('es-AR', options).format(date);
  }

  function formatLongDate(value) {
    const date = typeof value === 'string' ? parseLocalDate(value) : value;
    return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  function taskSort(a, b) {
    const aDate = a.date || '9999-12-31';
    const bDate = b.date || '9999-12-31';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return (a.time || '99:99').localeCompare(b.time || '99:99');
  }

  function render() {
    viewTitle.textContent = VIEW_TITLES[currentView];
    todayLabel.textContent = formatLongDate(new Date());
    document.title = `${VIEW_TITLES[currentView]} · Mi Organizador`;
    updateActiveNavigation();

    const renderers = {
      hoy: renderToday,
      calendario: renderCalendar,
      tareas: renderTasks,
      listas: renderLists,
      categorias: renderCategories,
      ajustes: renderSettings
    };
    content.innerHTML = renderers[currentView]();
    bindViewEvents();
    content.focus({ preventScroll: true });
  }

  function updateActiveNavigation() {
    $$('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === currentView));
  }

  function navigate(view) {
    currentView = normalizeView(view);
    if (location.hash !== `#${currentView}`) history.pushState(null, '', `#${currentView}`);
    render();
  }

  function taskRow(task, compact = false) {
    const category = categoryById(task.categoryId);
    const dateText = task.date ? `${formatDate(task.date)}${task.time ? ` · ${task.time}` : ''}` : 'Sin fecha';
    return `
      <article class="task-row ${task.completed ? 'is-complete' : ''}" data-task-id="${escapeHtml(task.id)}">
        <input class="check-control" type="checkbox" ${task.completed ? 'checked' : ''} data-action="toggle-task" aria-label="Marcar tarea como ${task.completed ? 'pendiente' : 'completada'}" />
        <div>
          <p class="task-title">${escapeHtml(task.title)}</p>
          <div class="task-meta">
            <span>${escapeHtml(dateText)}</span>
            <span class="category-dot" style="--category-color:${category.color}">${escapeHtml(category.name)}</span>
            ${compact ? '' : `<span class="priority priority-${task.priority || 'medium'}">${PRIORITY_LABELS[task.priority] || 'Media'}</span>`}
          </div>
        </div>
        <div class="row-actions">
          <button data-action="edit-task" title="Editar">Editar</button>
          <button data-action="delete-task" title="Eliminar">Eliminar</button>
        </div>
      </article>`;
  }

  function emptyState(title, description, actionLabel, action) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${actionLabel ? `<button class="button button-primary button-small" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
  }

  function renderToday() {
    const today = todayKey();
    const pending = state.tasks.filter(task => !task.completed);
    const todayTasks = pending.filter(task => task.date === today).sort(taskSort);
    const overdue = pending.filter(task => task.date && task.date < today).sort(taskSort);
    const upcoming = pending.filter(task => task.date && task.date > today).sort(taskSort).slice(0, 6);
    const completedToday = state.tasks.filter(task => task.completed && task.completedAt?.slice(0, 10) === today).length;
    const totalFocus = todayTasks.length + completedToday;
    const progress = totalFocus ? Math.round((completedToday / totalFocus) * 100) : 0;
    const listItems = state.lists.flatMap(list => list.items || []);
    const pendingListItems = listItems.filter(item => !item.completed).length;

    return `
      <section class="hero-card">
        <div>
          <p class="eyebrow" style="color:rgba(255,255,255,.62)">Tu día, en orden</p>
          <h2>${todayTasks.length ? `Tenés ${todayTasks.length} ${todayTasks.length === 1 ? 'tarea' : 'tareas'} para hoy.` : 'Hoy está despejado.'}</h2>
          <p>${overdue.length ? `Hay ${overdue.length} ${overdue.length === 1 ? 'tarea vencida' : 'tareas vencidas'} para revisar.` : 'No tenés tareas vencidas. Podés aprovechar para planificar lo que sigue.'}</p>
        </div>
        <div class="hero-progress"><strong>${progress}%</strong><span>avance de las tareas de hoy</span></div>
      </section>

      <section class="stats-grid" aria-label="Resumen">
        <article class="stat-card"><span>Para hoy</span><strong>${todayTasks.length}</strong></article>
        <article class="stat-card danger"><span>Vencidas</span><strong>${overdue.length}</strong></article>
        <article class="stat-card"><span>Próximas</span><strong>${upcoming.length}</strong></article>
        <article class="stat-card"><span>Ítems pendientes</span><strong>${pendingListItems}</strong></article>
      </section>

      <div class="content-grid">
        <div>
          <section class="section" style="margin-top:0">
            <div class="section-header"><div><h2>Tareas de hoy</h2><p>Lo que necesita tu atención ahora.</p></div><button class="text-button" data-action="new-task">+ Nueva tarea</button></div>
            <div class="panel task-list">${todayTasks.length ? todayTasks.map(task => taskRow(task)).join('') : emptyState('No hay tareas para hoy', 'Agregá una tarea o disfrutá de la rara sensación de tener el día bajo control.', 'Agregar tarea', 'new-task')}</div>
          </section>

          ${overdue.length ? `<section class="section"><div class="section-header"><div><h2>Vencidas</h2><p>Pendientes de días anteriores.</p></div></div><div class="panel task-list">${overdue.slice(0, 5).map(task => taskRow(task, true)).join('')}</div></section>` : ''}
        </div>

        <aside>
          <section class="section" style="margin-top:0">
            <div class="section-header"><div><h2>Próximas</h2><p>Lo que viene después.</p></div><button class="text-button" data-action="go-tasks">Ver todas</button></div>
            <div class="panel task-list">${upcoming.length ? upcoming.map(task => taskRow(task, true)).join('') : emptyState('Sin próximas tareas', 'Todavía no hay pendientes con fecha futura.', null, null)}</div>
          </section>

          <section class="section">
            <div class="section-header"><div><h2>Tus listas</h2><p>Compras y pendientes rápidos.</p></div><button class="text-button" data-action="go-lists">Abrir listas</button></div>
            <div class="panel">
              ${state.lists.length ? state.lists.slice(0, 4).map(list => {
                const items = list.items || [];
                const completed = items.filter(item => item.completed).length;
                return `<button class="task-row" style="width:100%;border-top:0;border-left:0;border-right:0;background:transparent;text-align:left;cursor:pointer" data-action="open-list-view"><span class="category-swatch" style="width:11px;height:36px;border-radius:99px;--category-color:${categoryById(list.categoryId).color}"></span><div><p class="task-title">${escapeHtml(list.title)}</p><div class="task-meta"><span>${completed}/${items.length} completados</span></div></div><span>›</span></button>`;
              }).join('') : emptyState('No hay listas', 'Creá una lista para compras o cualquier grupo de pendientes.', 'Nueva lista', 'new-list')}
            </div>
          </section>
        </aside>
      </div>`;
  }

  function renderTasks() {
    const categories = categoryOptions();
    return `
      <div class="section-header"><div><h2>Todos tus pendientes</h2><p>Buscá, filtrá y organizá las tareas como necesites.</p></div><button class="button button-primary" data-action="new-task">+ Nueva tarea</button></div>
      <div class="filters">
        <input class="search-input" id="task-search" type="search" placeholder="Buscar tareas..." />
        <select class="filter-select" id="task-status-filter"><option value="pending">Pendientes</option><option value="all">Todas</option><option value="completed">Completadas</option><option value="overdue">Vencidas</option><option value="nodate">Sin fecha</option></select>
        <select class="filter-select" id="task-category-filter"><option value="all">Todas las categorías</option>${categories.replace('<option value="">Sin categoría</option>', '<option value="">Sin categoría</option>')}</select>
      </div>
      <div class="panel task-list" id="tasks-results">${renderFilteredTasks()}</div>`;
  }

  function renderFilteredTasks() {
    const search = ($('#task-search')?.value || '').trim().toLowerCase();
    const status = $('#task-status-filter')?.value || 'pending';
    const category = $('#task-category-filter')?.value ?? 'all';
    const today = todayKey();

    let tasks = [...state.tasks];
    if (status === 'pending') tasks = tasks.filter(task => !task.completed);
    if (status === 'completed') tasks = tasks.filter(task => task.completed);
    if (status === 'overdue') tasks = tasks.filter(task => !task.completed && task.date && task.date < today);
    if (status === 'nodate') tasks = tasks.filter(task => !task.completed && !task.date);
    if (category !== 'all') tasks = tasks.filter(task => (task.categoryId || '') === category);
    if (search) tasks = tasks.filter(task => `${task.title} ${task.notes || ''}`.toLowerCase().includes(search));
    tasks.sort(taskSort);

    return tasks.length ? tasks.map(task => taskRow(task)).join('') : emptyState('No encontramos tareas', 'Probá cambiando los filtros o agregá una tarea nueva.', 'Agregar tarea', 'new-task');
  }

  function renderCalendar() {
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - mondayOffset);
    const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const monthTitle = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(first);
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      const key = dateKey(day);
      const events = state.tasks.filter(task => task.date === key && !task.completed).sort(taskSort);
      const classes = [
        'calendar-day',
        day.getMonth() !== first.getMonth() ? 'is-outside' : '',
        key === todayKey() ? 'is-today' : '',
        key === selectedCalendarDate ? 'is-selected' : ''
      ].filter(Boolean).join(' ');
      cells.push(`<button class="${classes}" data-calendar-date="${key}"><span class="day-number">${day.getDate()}</span><span class="day-events">${events.slice(0, 3).map(task => `<span class="day-event" style="--category-color:${categoryById(task.categoryId).color}">${escapeHtml(task.title)}</span>`).join('')}${events.length > 3 ? `<span class="day-event">+${events.length - 3}</span>` : ''}</span></button>`);
    }

    const selectedTasks = state.tasks.filter(task => task.date === selectedCalendarDate).sort(taskSort);
    return `
      <div class="content-grid">
        <section class="panel">
          <div class="calendar-toolbar">
            <button class="icon-button" data-action="calendar-prev" aria-label="Mes anterior">‹</button>
            <h2>${escapeHtml(monthTitle)}</h2>
            <div style="display:flex;gap:7px"><button class="button button-ghost button-small" data-action="calendar-today">Hoy</button><button class="icon-button" data-action="calendar-next" aria-label="Mes siguiente">›</button></div>
          </div>
          <div class="calendar-grid">${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div>
        </section>
        <aside class="panel panel-body selected-day-panel">
          <h3>${formatDate(selectedCalendarDate, { day: 'numeric', month: 'long' })}</h3>
          <p>${formatLongDate(selectedCalendarDate)}</p>
          <button class="button button-primary button-small" data-action="new-task-selected-date">+ Agregar tarea</button>
          <div class="task-list" style="margin:18px -20px -20px">${selectedTasks.length ? selectedTasks.map(task => taskRow(task, true)).join('') : emptyState('Día libre', 'No hay tareas registradas para esta fecha.', null, null)}</div>
        </aside>
      </div>`;
  }

  function listCard(list) {
    const items = list.items || [];
    const completed = items.filter(item => item.completed).length;
    const progress = items.length ? Math.round((completed / items.length) * 100) : 0;
    const category = categoryById(list.categoryId);
    return `
      <article class="list-card" data-list-id="${escapeHtml(list.id)}" style="--category-color:${category.color}">
        <header class="list-card-header">
          <div><h3>${escapeHtml(list.title)}</h3><p>${escapeHtml(list.notes || `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'} · ${category.name}`)}</p></div>
          <div class="row-actions"><button data-action="edit-list">Editar</button><button data-action="delete-list">Eliminar</button></div>
        </header>
        <div class="progress-track"><span style="width:${progress}%"></span></div>
        <div class="list-items">
          ${items.length ? items.map(item => `<div class="list-item ${item.completed ? 'is-complete' : ''}" data-item-id="${escapeHtml(item.id)}"><input class="check-control" type="checkbox" ${item.completed ? 'checked' : ''} data-action="toggle-list-item" /><span class="list-item-name">${escapeHtml(item.name)}</span><span class="list-item-qty">${escapeHtml(item.quantity || '')}</span><button class="delete-mini" data-action="delete-list-item" aria-label="Eliminar ítem">×</button></div>`).join('') : `<div class="empty-state" style="padding:24px 16px"><p>La lista está vacía.</p></div>`}
        </div>
        <form class="add-list-item" data-action="add-list-item"><input name="name" required maxlength="100" placeholder="Agregar ítem..." /><input name="quantity" maxlength="20" placeholder="Cant." /><button class="button button-primary button-small" type="submit">Agregar</button></form>
      </article>`;
  }

  function renderLists() {
    return `
      <div class="section-header"><div><h2>Listas personalizables</h2><p>Compras, ideas, trámites o cualquier conjunto de pendientes.</p></div><button class="button button-primary" data-action="new-list">+ Nueva lista</button></div>
      <div class="list-grid">${state.lists.length ? state.lists.map(listCard).join('') : emptyState('Todavía no hay listas', 'Creá la primera para empezar a organizar compras o pendientes.', 'Crear lista', 'new-list')}</div>`;
  }

  function renderCategories() {
    return `
      <div class="section-header"><div><h2>Tu forma de organizarte</h2><p>Podés crear todas las categorías que necesites.</p></div><button class="button button-primary" data-action="new-category">+ Nueva categoría</button></div>
      <div class="category-grid">
        ${state.categories.length ? state.categories.map(category => {
          const taskCount = state.tasks.filter(task => task.categoryId === category.id).length;
          const listCount = state.lists.filter(list => list.categoryId === category.id).length;
          return `<article class="category-card" data-category-id="${escapeHtml(category.id)}" style="--category-color:${category.color}"><div class="category-swatch"></div><h3>${escapeHtml(category.name)}</h3><p>${taskCount} ${taskCount === 1 ? 'tarea' : 'tareas'} · ${listCount} ${listCount === 1 ? 'lista' : 'listas'}</p><div class="category-card-footer"><span class="eyebrow">${escapeHtml(category.color)}</span><div class="row-actions" style="opacity:1"><button data-action="edit-category">Editar</button><button data-action="delete-category">Eliminar</button></div></div></article>`;
        }).join('') : emptyState('No hay categorías', 'Creá categorías para separar tus ámbitos y proyectos.', 'Nueva categoría', 'new-category')}
      </div>`;
  }

  function renderSettings() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return `
      <div class="settings-grid">
        <section class="settings-card"><p class="eyebrow">Respaldo</p><h2>Tus datos</h2><p>Descargá una copia completa en formato JSON o restaurala en otro navegador.</p><div class="settings-actions"><button class="button button-primary" data-action="export-data">Exportar datos</button><button class="button button-ghost" data-action="import-data">Importar copia</button></div></section>
        <section class="settings-card"><p class="eyebrow">Aplicación</p><h2>Instalar en el celular</h2><p>${standalone ? 'La aplicación ya se está ejecutando en modo instalado.' : isIos ? 'En iPhone: abrí esta página con Safari, tocá Compartir y luego “Agregar a pantalla de inicio”.' : 'Instalá la aplicación para abrirla desde la pantalla de inicio y usarla sin apariencia de navegador.'}</p><div class="settings-actions">${!standalone && !isIos ? '<button class="button button-primary" data-action="install-app">Instalar aplicación</button>' : ''}</div></section>
        <section class="settings-card"><p class="eyebrow">Almacenamiento</p><h2>Versión inicial</h2><p>En esta etapa los datos se guardan solamente en este navegador. No se comparten entre dispositivos todavía.</p><ul class="info-list"><li>Guardado automático.</li><li>Funciona sin conexión después de la primera visita.</li><li>La sincronización con Cloudflare D1 será un próximo hito.</li></ul></section>
        <section class="settings-card"><p class="eyebrow">Zona de cuidado</p><h2>Restablecer</h2><p>Elimina tareas, listas y categorías de este dispositivo. Esta acción no se puede deshacer salvo que tengas una copia exportada.</p><button class="button button-danger" data-action="reset-data">Borrar todos los datos</button></section>
      </div>`;
  }

  function bindViewEvents() {
    $$('[data-action]', content).forEach(element => {
      const action = element.dataset.action;
      if (action === 'new-task') element.addEventListener('click', () => openTaskDialog());
      if (action === 'new-task-selected-date') element.addEventListener('click', () => openTaskDialog(null, selectedCalendarDate));
      if (action === 'new-list') element.addEventListener('click', () => openListDialog());
      if (action === 'new-category') element.addEventListener('click', () => openCategoryDialog());
      if (action === 'go-tasks') element.addEventListener('click', () => navigate('tareas'));
      if (action === 'go-lists' || action === 'open-list-view') element.addEventListener('click', () => navigate('listas'));
      if (action === 'calendar-prev') element.addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); render(); });
      if (action === 'calendar-next') element.addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); render(); });
      if (action === 'calendar-today') element.addEventListener('click', () => { calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1); selectedCalendarDate = todayKey(); render(); });
      if (action === 'export-data') element.addEventListener('click', exportData);
      if (action === 'import-data') element.addEventListener('click', () => $('#import-input').click());
      if (action === 'reset-data') element.addEventListener('click', resetData);
      if (action === 'install-app') element.addEventListener('click', installApp);
    });

    $$('[data-calendar-date]', content).forEach(day => day.addEventListener('click', () => { selectedCalendarDate = day.dataset.calendarDate; render(); }));

    $$('.task-row[data-task-id]', content).forEach(row => {
      const id = row.dataset.taskId;
      $('[data-action="toggle-task"]', row)?.addEventListener('change', () => toggleTask(id));
      $('[data-action="edit-task"]', row)?.addEventListener('click', () => openTaskDialog(state.tasks.find(task => task.id === id)));
      $('[data-action="delete-task"]', row)?.addEventListener('click', () => deleteTask(id));
    });

    $$('.list-card', content).forEach(card => {
      const listId = card.dataset.listId;
      $('[data-action="edit-list"]', card)?.addEventListener('click', () => openListDialog(state.lists.find(list => list.id === listId)));
      $('[data-action="delete-list"]', card)?.addEventListener('click', () => deleteList(listId));
      $('[data-action="add-list-item"]', card)?.addEventListener('submit', event => addListItem(event, listId));
      $$('.list-item', card).forEach(item => {
        $('[data-action="toggle-list-item"]', item)?.addEventListener('change', () => toggleListItem(listId, item.dataset.itemId));
        $('[data-action="delete-list-item"]', item)?.addEventListener('click', () => deleteListItem(listId, item.dataset.itemId));
      });
    });

    $$('.category-card', content).forEach(card => {
      const id = card.dataset.categoryId;
      $('[data-action="edit-category"]', card)?.addEventListener('click', () => openCategoryDialog(state.categories.find(category => category.id === id)));
      $('[data-action="delete-category"]', card)?.addEventListener('click', () => deleteCategory(id));
    });

    const filters = ['#task-search', '#task-status-filter', '#task-category-filter'];
    filters.forEach(selector => $(selector)?.addEventListener('input', refreshTaskResults));
    filters.forEach(selector => $(selector)?.addEventListener('change', refreshTaskResults));
  }

  function refreshTaskResults() {
    const results = $('#tasks-results');
    if (!results) return;
    results.innerHTML = renderFilteredTasks();
    $$('.task-row[data-task-id]', results).forEach(row => {
      const id = row.dataset.taskId;
      $('[data-action="toggle-task"]', row)?.addEventListener('change', () => toggleTask(id));
      $('[data-action="edit-task"]', row)?.addEventListener('click', () => openTaskDialog(state.tasks.find(task => task.id === id)));
      $('[data-action="delete-task"]', row)?.addEventListener('click', () => deleteTask(id));
    });
    $('[data-action="new-task"]', results)?.addEventListener('click', () => openTaskDialog());
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  function openTaskDialog(task = null, presetDate = '') {
    const dialog = $('#task-dialog');
    const form = $('#task-form');
    form.reset();
    $('#task-dialog-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
    form.elements.id.value = task?.id || '';
    form.elements.title.value = task?.title || '';
    form.elements.notes.value = task?.notes || '';
    form.elements.date.value = task?.date || presetDate || '';
    form.elements.time.value = task?.time || '';
    form.elements.priority.value = task?.priority || 'medium';
    form.elements.category.innerHTML = categoryOptions(task?.categoryId || '');
    closeDialog($('#action-dialog'));
    openDialog(dialog);
    setTimeout(() => form.elements.title.focus(), 50);
  }

  function openListDialog(list = null) {
    const dialog = $('#list-dialog');
    const form = $('#list-form');
    form.reset();
    $('#list-dialog-title').textContent = list ? 'Editar lista' : 'Nueva lista';
    form.elements.id.value = list?.id || '';
    form.elements.title.value = list?.title || '';
    form.elements.notes.value = list?.notes || '';
    form.elements.category.innerHTML = categoryOptions(list?.categoryId || '');
    closeDialog($('#action-dialog'));
    openDialog(dialog);
    setTimeout(() => form.elements.title.focus(), 50);
  }

  function openCategoryDialog(category = null) {
    const dialog = $('#category-dialog');
    const form = $('#category-form');
    form.reset();
    $('#category-dialog-title').textContent = category ? 'Editar categoría' : 'Nueva categoría';
    form.elements.id.value = category?.id || '';
    form.elements.name.value = category?.name || '';
    form.elements.color.value = category?.color || '#5c7c70';
    closeDialog($('#action-dialog'));
    openDialog(dialog);
    setTimeout(() => form.elements.name.focus(), 50);
  }

  function submitTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = data.get('id');
    const existing = state.tasks.find(task => task.id === id);
    const task = {
      id: id || uid(),
      title: data.get('title').trim(),
      notes: data.get('notes').trim(),
      date: data.get('date'),
      time: data.get('time'),
      priority: data.get('priority'),
      categoryId: data.get('category'),
      completed: existing?.completed || false,
      completedAt: existing?.completedAt || null,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (!task.title) return;
    if (existing) Object.assign(existing, task);
    else state.tasks.push(task);
    saveState(existing ? 'Tarea actualizada.' : 'Tarea creada.');
    closeDialog($('#task-dialog'));
    render();
  }

  function submitList(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = data.get('id');
    const existing = state.lists.find(list => list.id === id);
    const list = {
      id: id || uid(),
      title: data.get('title').trim(),
      notes: data.get('notes').trim(),
      categoryId: data.get('category'),
      items: existing?.items || [],
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (!list.title) return;
    if (existing) Object.assign(existing, list);
    else state.lists.push(list);
    saveState(existing ? 'Lista actualizada.' : 'Lista creada.');
    closeDialog($('#list-dialog'));
    render();
  }

  function submitCategory(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = data.get('id');
    const existing = state.categories.find(category => category.id === id);
    const category = { id: id || uid(), name: data.get('name').trim(), color: data.get('color') };
    if (!category.name) return;
    if (existing) Object.assign(existing, category);
    else state.categories.push(category);
    saveState(existing ? 'Categoría actualizada.' : 'Categoría creada.');
    closeDialog($('#category-dialog'));
    render();
  }

  function toggleTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    saveState(task.completed ? 'Tarea completada.' : 'Tarea reabierta.');
    render();
  }

  function deleteTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task || !confirm(`¿Eliminar la tarea “${task.title}”?`)) return;
    state.tasks = state.tasks.filter(item => item.id !== id);
    saveState('Tarea eliminada.');
    render();
  }

  function deleteList(id) {
    const list = state.lists.find(item => item.id === id);
    if (!list || !confirm(`¿Eliminar la lista “${list.title}” y todos sus ítems?`)) return;
    state.lists = state.lists.filter(item => item.id !== id);
    saveState('Lista eliminada.');
    render();
  }

  function addListItem(event, listId) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = data.get('name').trim();
    if (!name) return;
    const list = state.lists.find(item => item.id === listId);
    if (!list) return;
    list.items ||= [];
    list.items.push({ id: uid(), name, quantity: data.get('quantity').trim(), completed: false, createdAt: new Date().toISOString() });
    saveState('Ítem agregado.');
    render();
  }

  function toggleListItem(listId, itemId) {
    const list = state.lists.find(item => item.id === listId);
    const item = list?.items?.find(entry => entry.id === itemId);
    if (!item) return;
    item.completed = !item.completed;
    saveState();
    render();
  }

  function deleteListItem(listId, itemId) {
    const list = state.lists.find(item => item.id === listId);
    if (!list) return;
    list.items = (list.items || []).filter(item => item.id !== itemId);
    saveState('Ítem eliminado.');
    render();
  }

  function deleteCategory(id) {
    const category = state.categories.find(item => item.id === id);
    if (!category || !confirm(`¿Eliminar la categoría “${category.name}”? Las tareas y listas quedarán sin categoría.`)) return;
    state.categories = state.categories.filter(item => item.id !== id);
    state.tasks.forEach(task => { if (task.categoryId === id) task.categoryId = ''; });
    state.lists.forEach(list => { if (list.categoryId === id) list.categoryId = ''; });
    saveState('Categoría eliminada.');
    render();
  }

  function exportData() {
    const payload = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `organizador-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Copia descargada.');
  }

  async function importData(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.lists)) throw new Error('Formato inválido');
      if (!confirm('La importación reemplazará los datos actuales. ¿Continuar?')) return;
      state = { version: 1, categories: parsed.categories, tasks: parsed.tasks, lists: parsed.lists };
      saveState('Datos importados correctamente.');
      render();
    } catch (error) {
      console.error(error);
      showToast('No se pudo importar el archivo.');
    }
  }

  function resetData() {
    if (!confirm('¿Borrar todos los datos del organizador en este dispositivo?')) return;
    if (!confirm('Última confirmación: esta acción no se puede deshacer.')) return;
    state = defaultState();
    saveState('Datos restablecidos.');
    render();
  }

  async function installApp() {
    if (!deferredInstallPrompt) {
      showToast('Abrí el menú del navegador y elegí “Instalar aplicación”.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#install-button').hidden = true;
  }

  function setupGlobalEvents() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
    $('#quick-add-button').addEventListener('click', () => openDialog($('#action-dialog')));
    $('#mobile-add-button').addEventListener('click', () => openDialog($('#action-dialog')));
    $('#install-button').addEventListener('click', installApp);
    $('#task-form').addEventListener('submit', submitTask);
    $('#list-form').addEventListener('submit', submitList);
    $('#category-form').addEventListener('submit', submitCategory);
    $('#import-input').addEventListener('change', importData);

    $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
    $$('[data-open-form]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.openForm === 'task') openTaskDialog();
      if (button.dataset.openForm === 'list') openListDialog();
      if (button.dataset.openForm === 'category') openCategoryDialog();
    }));

    $$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) closeDialog(dialog);
    }));

    window.addEventListener('hashchange', () => {
      currentView = normalizeView(location.hash.slice(1));
      render();
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('#install-button').hidden = false;
    });

    document.addEventListener('keydown', event => {
      if (event.target.matches('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < VIEWS.length) navigate(VIEWS[index]);
      if (event.key.toLowerCase() === 'n') openDialog($('#action-dialog'));
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service Worker:', error)));
  }

  setupGlobalEvents();
  if (!location.hash) history.replaceState(null, '', '#hoy');
  render();
})();
