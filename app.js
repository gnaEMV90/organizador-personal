import {
  PRODUCTIVITY_SCHEMA_VERSION,
  dateKey,
  parseLocalDate,
  addDays,
  weekDates,
  normalizeRecurrence,
  nextRecurrenceDate,
  recurrenceLabel,
  reminderKey,
  shouldNotifyTask,
  migrateProductivityState,
  buildNextOccurrence
} from './productivity-core.js?v=5';

(() => {
  'use strict';

  const STORAGE_KEY = 'organizadorPersonal.v1';
  const UI_PREFS_KEY = 'planorha.ui.v2';
  const VIEWS = ['hoy', 'semana', 'calendario', 'tareas', 'listas', 'categorias', 'ajustes'];
  const VIEW_TITLES = {
    hoy: 'Hoy',
    semana: 'Semana',
    calendario: 'Calendario',
    tareas: 'Tareas',
    listas: 'Listas',
    categorias: 'Categorías',
    ajustes: 'Ajustes'
  };
  const PRIORITY_LABELS = { high: 'Alta', medium: 'Media', low: 'Baja' };
  const REMINDER_LABELS = {
    '': 'Sin recordatorio',
    0: 'A la hora indicada',
    5: '5 minutos antes',
    10: '10 minutos antes',
    15: '15 minutos antes',
    30: '30 minutos antes',
    60: '1 hora antes',
    1440: '1 día antes'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const todayKey = () => dateKey(new Date());
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  const defaultState = () => migrateProductivityState({
    version: PRODUCTIVITY_SCHEMA_VERSION,
    categories: [
      { id: 'personal', name: 'Personal', color: '#5c7c70' },
      { id: 'familia', name: 'Familia', color: '#c88764' },
      { id: 'trabajo', name: 'Trabajo', color: '#58789a' },
      { id: 'iglesia', name: 'Iglesia', color: '#8d6a9f' },
      { id: 'anavim', name: 'Anavim', color: '#b18a46' }
    ],
    tasks: [],
    lists: [
      {
        id: uid(),
        title: 'Compras',
        notes: 'Lista general para el supermercado y la casa.',
        categoryId: 'familia',
        dueDate: '',
        order: 0,
        items: [],
        createdAt: new Date().toISOString()
      }
    ]
  });

  let state = loadState();
  let uiPrefs = loadUiPrefs();
  let currentView = normalizeView(location.hash.slice(1));
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let weekCursor = parseLocalDate(todayKey());
  let selectedCalendarDate = todayKey();
  let deferredInstallPrompt = null;
  let toastTimer = null;
  let reminderTimer = null;

  const content = $('#app-content');
  const viewTitle = $('#view-title');
  const todayLabel = $('#today-label');

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.lists)) return defaultState();
      return migrateProductivityState(parsed);
    } catch (error) {
      console.error('No se pudieron cargar los datos:', error);
      return defaultState();
    }
  }

  function loadUiPrefs() {
    try {
      return {
        taskSearch: '',
        taskStatus: 'pending',
        taskCategory: 'all',
        ...JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}')
      };
    } catch {
      return { taskSearch: '', taskStatus: 'pending', taskCategory: 'all' };
    }
  }

  function saveUiPrefs() {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(uiPrefs));
  }

  function normalizeView(view) {
    return VIEWS.includes(view) ? view : 'hoy';
  }

  function saveState(message) {
    state = migrateProductivityState(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (message) showToast(message);
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
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
    if (!date) return '';
    return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  }

  function orderValue(item, fallback = 0) {
    return Number.isFinite(Number(item?.order)) ? Number(item.order) : fallback;
  }

  function taskSort(a, b) {
    const aDate = a.date || '9999-12-31';
    const bDate = b.date || '9999-12-31';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aTime = a.time || '99:99';
    const bTime = b.time || '99:99';
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return orderValue(a) - orderValue(b);
  }

  function orderedTasks(tasks) {
    return [...tasks].sort(taskSort);
  }

  function activeTasks() {
    return state.tasks.filter(task => !task.archived);
  }

  function render() {
    viewTitle.textContent = VIEW_TITLES[currentView];
    todayLabel.textContent = formatLongDate(new Date());
    document.title = `${VIEW_TITLES[currentView]} · Planorha`;
    updateActiveNavigation();

    const renderers = {
      hoy: renderToday,
      semana: renderWeek,
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

  function recurrenceBadge(task) {
    const label = recurrenceLabel(task.recurrence);
    return label ? `<span class="meta-badge">↻ ${escapeHtml(label)}</span>` : '';
  }

  function reminderBadge(task) {
    if (task.reminderMinutes === '' || task.reminderMinutes == null || !task.date || !task.time) return '';
    const label = REMINDER_LABELS[task.reminderMinutes] || `${task.reminderMinutes} min antes`;
    return `<span class="meta-badge">◷ ${escapeHtml(label)}</span>`;
  }

  function taskRow(task, compact = false) {
    const category = categoryById(task.categoryId);
    const dateText = task.date ? `${formatDate(task.date)}${task.time ? ` · ${task.time}` : ''}` : 'Sin fecha';
    const archivedClass = task.archived ? 'is-archived' : '';
    return `
      <article class="task-row ${task.completed ? 'is-complete' : ''} ${archivedClass}" data-task-id="${escapeHtml(task.id)}">
        <input class="check-control" type="checkbox" ${task.completed ? 'checked' : ''} ${task.archived ? 'disabled' : ''} data-action="toggle-task" aria-label="Marcar tarea como ${task.completed ? 'pendiente' : 'completada'}" />
        <div>
          <p class="task-title">${escapeHtml(task.title)}</p>
          <div class="task-meta">
            <span>${escapeHtml(dateText)}</span>
            <span class="category-dot" style="--category-color:${category.color}">${escapeHtml(category.name)}</span>
            ${compact ? '' : `<span class="priority priority-${task.priority || 'medium'}">${PRIORITY_LABELS[task.priority] || 'Media'}</span>`}
            ${recurrenceBadge(task)}
            ${reminderBadge(task)}
            ${task.archived ? '<span class="meta-badge">Archivada</span>' : ''}
          </div>
        </div>
        <div class="row-actions">
          ${!compact && !task.archived ? '<button data-action="move-task-up" title="Subir">↑</button><button data-action="move-task-down" title="Bajar">↓</button>' : ''}
          ${task.archived ? '<button data-action="restore-task" title="Restaurar">Restaurar</button>' : '<button data-action="duplicate-task" title="Duplicar">Duplicar</button>'}
          ${task.completed && !task.archived ? '<button data-action="archive-task" title="Archivar">Archivar</button>' : ''}
          ${!task.archived ? '<button data-action="edit-task" title="Editar">Editar</button>' : ''}
          <button data-action="delete-task" title="Eliminar">Eliminar</button>
        </div>
      </article>`;
  }

  function emptyState(title, description, actionLabel, action) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${actionLabel ? `<button class="button button-primary button-small" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
  }

  function renderToday() {
    const today = todayKey();
    const tasks = activeTasks();
    const pending = tasks.filter(task => !task.completed);
    const todayTasks = orderedTasks(pending.filter(task => task.date === today));
    const overdue = orderedTasks(pending.filter(task => task.date && task.date < today));
    const upcoming = orderedTasks(pending.filter(task => task.date && task.date > today)).slice(0, 6);
    const completedToday = tasks.filter(task => task.completed && task.completedAt?.slice(0, 10) === today).length;
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
            <div class="panel task-list">${todayTasks.length ? todayTasks.map(task => taskRow(task)).join('') : emptyState('No hay tareas para hoy', 'Agregá una tarea o aprovechá el día despejado.', 'Agregar tarea', 'new-task')}</div>
          </section>
          ${overdue.length ? `<section class="section"><div class="section-header"><div><h2>Vencidas</h2><p>Conviene resolverlas o reprogramarlas.</p></div><button class="text-button" data-action="go-tasks">Ver todas</button></div><div class="panel task-list">${overdue.slice(0, 4).map(task => taskRow(task)).join('')}</div></section>` : ''}
        </div>
        <aside class="side-stack">
          <section class="quote-card"><p>“Un lugar para cada cosa y cada cosa en su momento.”</p><span>Planorha</span></section>
          <section class="panel panel-body"><div class="section-header"><div><h3>Próximas</h3><p>Lo que viene después.</p></div></div><div class="mini-list">${upcoming.length ? upcoming.map(task => `<button data-action="edit-week-task" data-task-id="${escapeHtml(task.id)}"><span class="category-swatch" style="--category-color:${categoryById(task.categoryId).color}"></span><span><strong>${escapeHtml(task.title)}</strong><small>${formatDate(task.date, { weekday: 'short', day: 'numeric', month: 'short' })}${task.time ? ` · ${task.time}` : ''}</small></span></button>`).join('') : '<p class="muted-copy">No hay tareas próximas.</p>'}</div></section>
          <button class="panel panel-body list-summary-button" data-action="open-list-view"><span><small>Listas</small><strong>${state.lists.length}</strong></span><span><small>Ítems pendientes</small><strong>${pendingListItems}</strong></span></button>
        </aside>
      </div>`;
  }

  function renderWeek() {
    const days = weekDates(weekCursor);
    const start = days[0];
    const end = days[6];
    const title = `${formatDate(dateKey(start), { day: 'numeric', month: 'short' })} — ${formatDate(dateKey(end), { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const unplanned = orderedTasks(activeTasks().filter(task => !task.completed && !task.date));
    return `
      <div class="section-header"><div><h2>Semana actual</h2><p>${escapeHtml(title)}</p></div><div class="toolbar-actions"><button class="icon-button" data-action="week-prev" aria-label="Semana anterior">‹</button><button class="button button-ghost button-small" data-action="week-today">Esta semana</button><button class="icon-button" data-action="week-next" aria-label="Semana siguiente">›</button></div></div>
      <div class="week-grid">${days.map(day => {
        const key = dateKey(day);
        const tasks = orderedTasks(activeTasks().filter(task => task.date === key));
        return `<section class="week-day ${key === todayKey() ? 'is-today' : ''}"><header><span>${new Intl.DateTimeFormat('es-AR', { weekday: 'short' }).format(day)}</span><strong>${day.getDate()}</strong></header><div class="week-day-tasks">${tasks.length ? tasks.map(task => `<button class="week-task ${task.completed ? 'is-complete' : ''}" data-action="edit-week-task" data-task-id="${escapeHtml(task.id)}" style="--category-color:${categoryById(task.categoryId).color}"><span>${escapeHtml(task.time || 'Todo el día')}</span><strong>${escapeHtml(task.title)}</strong></button>`).join('') : '<p>Sin tareas</p>'}</div><button class="week-add" data-action="new-task-week" data-date="${key}">+ Agregar</button></section>`;
      }).join('')}</div>
      ${unplanned.length ? `<section class="section"><div class="section-header"><div><h2>Sin fecha</h2><p>Pendientes que todavía no ubicás en la semana.</p></div></div><div class="panel task-list">${unplanned.map(task => taskRow(task)).join('')}</div></section>` : ''}`;
  }

  function renderTasks() {
    const categories = state.categories.map(category => `<option value="${escapeHtml(category.id)}" ${uiPrefs.taskCategory === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
    const completedCount = state.tasks.filter(task => task.completed && !task.archived).length;
    return `
      <div class="section-header"><div><h2>Todas tus tareas</h2><p>Buscá, filtrá, ordená y archivá lo que ya terminaste.</p></div><div class="toolbar-actions">${completedCount ? `<button class="button button-ghost" data-action="archive-completed">Archivar completadas (${completedCount})</button>` : ''}<button class="button button-primary" data-action="new-task">+ Nueva tarea</button></div></div>
      <div class="filter-bar">
        <input class="search-input" id="task-search" type="search" placeholder="Buscar tareas..." value="${escapeHtml(uiPrefs.taskSearch)}" />
        <select class="filter-select" id="task-status-filter">
          <option value="pending" ${uiPrefs.taskStatus === 'pending' ? 'selected' : ''}>Pendientes</option>
          <option value="all" ${uiPrefs.taskStatus === 'all' ? 'selected' : ''}>Todas</option>
          <option value="completed" ${uiPrefs.taskStatus === 'completed' ? 'selected' : ''}>Completadas</option>
          <option value="overdue" ${uiPrefs.taskStatus === 'overdue' ? 'selected' : ''}>Vencidas</option>
          <option value="nodate" ${uiPrefs.taskStatus === 'nodate' ? 'selected' : ''}>Sin fecha</option>
          <option value="archived" ${uiPrefs.taskStatus === 'archived' ? 'selected' : ''}>Archivadas</option>
        </select>
        <select class="filter-select" id="task-category-filter"><option value="all" ${uiPrefs.taskCategory === 'all' ? 'selected' : ''}>Todas las categorías</option>${categories}</select>
      </div>
      <div class="panel task-list" id="tasks-results">${renderFilteredTasks()}</div>`;
  }

  function filteredTasks() {
    const search = uiPrefs.taskSearch.trim().toLowerCase();
    const status = uiPrefs.taskStatus;
    const category = uiPrefs.taskCategory;
    const today = todayKey();
    let tasks = [...state.tasks];

    if (status !== 'archived') tasks = tasks.filter(task => !task.archived);
    if (status === 'pending') tasks = tasks.filter(task => !task.completed);
    if (status === 'completed') tasks = tasks.filter(task => task.completed);
    if (status === 'overdue') tasks = tasks.filter(task => !task.completed && task.date && task.date < today);
    if (status === 'nodate') tasks = tasks.filter(task => !task.completed && !task.date);
    if (status === 'archived') tasks = tasks.filter(task => task.archived);
    if (category !== 'all') tasks = tasks.filter(task => (task.categoryId || '') === category);
    if (search) tasks = tasks.filter(task => `${task.title} ${task.notes || ''}`.toLowerCase().includes(search));
    return orderedTasks(tasks);
  }

  function renderFilteredTasks() {
    const tasks = filteredTasks();
    return tasks.length ? tasks.map(task => taskRow(task)).join('') : emptyState('No encontramos tareas', 'Probá cambiando los filtros o agregá una tarea nueva.', 'Agregar tarea', 'new-task');
  }

  function renderCalendar() {
    const first = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -mondayOffset);
    const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const monthTitle = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(first);
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const day = addDays(gridStart, index);
      const key = dateKey(day);
      const events = orderedTasks(activeTasks().filter(task => task.date === key && !task.completed));
      const dueLists = state.lists.filter(list => list.dueDate === key);
      const classes = ['calendar-day', day.getMonth() !== first.getMonth() ? 'is-outside' : '', key === todayKey() ? 'is-today' : '', key === selectedCalendarDate ? 'is-selected' : ''].filter(Boolean).join(' ');
      cells.push(`<button class="${classes}" data-calendar-date="${key}"><span class="day-number">${day.getDate()}</span><span class="day-events">${events.slice(0, 2).map(task => `<span class="day-event" style="--category-color:${categoryById(task.categoryId).color}">${escapeHtml(task.title)}</span>`).join('')}${dueLists.slice(0, 1).map(list => `<span class="day-event is-list-event" style="--category-color:${categoryById(list.categoryId).color}">Lista: ${escapeHtml(list.title)}</span>`).join('')}${events.length + dueLists.length > 3 ? `<span class="day-event">+${events.length + dueLists.length - 3}</span>` : ''}</span></button>`);
    }

    const selectedTasks = orderedTasks(activeTasks().filter(task => task.date === selectedCalendarDate));
    const selectedLists = state.lists.filter(list => list.dueDate === selectedCalendarDate);
    return `
      <div class="content-grid">
        <section class="panel">
          <div class="calendar-toolbar"><button class="icon-button" data-action="calendar-prev" aria-label="Mes anterior">‹</button><h2>${escapeHtml(monthTitle)}</h2><div class="toolbar-actions"><button class="button button-ghost button-small" data-action="go-week">Semana</button><button class="button button-ghost button-small" data-action="calendar-today">Hoy</button><button class="icon-button" data-action="calendar-next" aria-label="Mes siguiente">›</button></div></div>
          <div class="calendar-grid">${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${cells.join('')}</div>
        </section>
        <aside class="panel panel-body selected-day-panel">
          <h3>${formatDate(selectedCalendarDate, { day: 'numeric', month: 'long' })}</h3>
          <p>${formatLongDate(selectedCalendarDate)}</p>
          <button class="button button-primary button-small" data-action="new-task-selected-date">+ Agregar tarea</button>
          <div class="task-list selected-day-list">${selectedTasks.length ? selectedTasks.map(task => taskRow(task, true)).join('') : emptyState('Día libre', 'No hay tareas registradas para esta fecha.', null, null)}${selectedLists.map(list => `<button class="task-row list-summary-row" data-action="go-lists"><span class="category-swatch list-summary-swatch" style="--category-color:${categoryById(list.categoryId).color}"></span><div><p class="task-title">Lista: ${escapeHtml(list.title)}</p><div class="task-meta"><span>Vence este día</span></div></div><span>›</span></button>`).join('')}</div>
        </aside>
      </div>`;
  }

  function listCard(list) {
    const items = [...(list.items || [])].sort((a, b) => orderValue(a) - orderValue(b));
    const completed = items.filter(item => item.completed).length;
    const progress = items.length ? Math.round((completed / items.length) * 100) : 0;
    const category = categoryById(list.categoryId);
    const due = list.dueDate ? `<span class="due-badge ${list.dueDate < todayKey() && completed < items.length ? 'is-overdue' : ''}">Vence ${formatDate(list.dueDate, { day: 'numeric', month: 'short' })}</span>` : '';
    return `
      <article class="list-card" data-list-id="${escapeHtml(list.id)}" style="--category-color:${category.color}">
        <header class="list-card-header">
          <div><h3>${escapeHtml(list.title)}</h3><p>${escapeHtml(list.notes || `${items.length} ${items.length === 1 ? 'ítem' : 'ítems'} · ${category.name}`)}</p>${due}</div>
          <div class="row-actions list-actions"><button data-action="move-list-up" title="Subir">↑</button><button data-action="move-list-down" title="Bajar">↓</button><button data-action="edit-list">Editar</button><button data-action="delete-list">Eliminar</button></div>
        </header>
        <div class="progress-track"><span style="width:${progress}%"></span></div>
        <div class="list-items">
          ${items.length ? items.map(item => `<div class="list-item ${item.completed ? 'is-complete' : ''}" data-item-id="${escapeHtml(item.id)}"><input class="check-control" type="checkbox" ${item.completed ? 'checked' : ''} data-action="toggle-list-item" /><span class="list-item-name">${escapeHtml(item.name)}</span><span class="list-item-qty">${escapeHtml(item.quantity || '')}</span><span class="item-order-actions"><button data-action="move-list-item-up" aria-label="Subir ítem">↑</button><button data-action="move-list-item-down" aria-label="Bajar ítem">↓</button></span><button class="delete-mini" data-action="delete-list-item" aria-label="Eliminar ítem">×</button></div>`).join('') : '<div class="empty-state list-empty"><p>La lista está vacía.</p></div>'}
        </div>
        <form class="add-list-item" data-action="add-list-item"><input name="name" required maxlength="100" placeholder="Agregar ítem..." /><input name="quantity" maxlength="20" placeholder="Cant." /><button class="button button-primary button-small" type="submit">Agregar</button></form>
      </article>`;
  }

  function renderLists() {
    const lists = [...state.lists].sort((a, b) => orderValue(a) - orderValue(b));
    return `<div class="section-header"><div><h2>Listas personalizables</h2><p>Compras, ideas y trámites con fecha de vencimiento y orden manual.</p></div><button class="button button-primary" data-action="new-list">+ Nueva lista</button></div><div class="list-grid">${lists.length ? lists.map(listCard).join('') : emptyState('Todavía no hay listas', 'Creá la primera para empezar a organizar compras o pendientes.', 'Crear lista', 'new-list')}</div>`;
  }

  function renderCategories() {
    return `<div class="section-header"><div><h2>Tu forma de organizarte</h2><p>Podés crear todas las categorías que necesites.</p></div><button class="button button-primary" data-action="new-category">+ Nueva categoría</button></div><div class="category-grid">${state.categories.length ? state.categories.map(category => {
      const taskCount = state.tasks.filter(task => task.categoryId === category.id && !task.archived).length;
      const listCount = state.lists.filter(list => list.categoryId === category.id).length;
      return `<article class="category-card" data-category-id="${escapeHtml(category.id)}" style="--category-color:${category.color}"><div class="category-swatch"></div><h3>${escapeHtml(category.name)}</h3><p>${taskCount} ${taskCount === 1 ? 'tarea' : 'tareas'} · ${listCount} ${listCount === 1 ? 'lista' : 'listas'}</p><div class="category-card-footer"><span class="eyebrow">${escapeHtml(category.color)}</span><div class="row-actions visible-actions"><button data-action="edit-category">Editar</button><button data-action="delete-category">Eliminar</button></div></div></article>`;
    }).join('') : emptyState('No hay categorías', 'Creá categorías para separar tus ámbitos y proyectos.', 'Nueva categoría', 'new-category')}</div>`;
  }

  function notificationStatusText() {
    if (!('Notification' in window)) return 'Este navegador no admite notificaciones web.';
    if (Notification.permission === 'granted') return 'Las notificaciones están habilitadas en este dispositivo.';
    if (Notification.permission === 'denied') return 'Las notificaciones están bloqueadas en la configuración del navegador o de Windows.';
    return 'Podés habilitar avisos para las tareas que tengan fecha, hora y recordatorio.';
  }

  function renderSettings() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const notificationButton = 'Notification' in window && Notification.permission === 'default' ? '<button class="button button-primary" data-action="enable-notifications">Habilitar notificaciones</button>' : '';
    return `
      <div class="settings-grid">
        <section class="settings-card"><p class="eyebrow">Respaldo</p><h2>Tus datos</h2><p>Descargá una copia completa en formato JSON o restaurala en otro navegador.</p><div class="settings-actions"><button class="button button-primary" data-action="export-data">Exportar datos</button><button class="button button-ghost" data-action="import-data">Importar copia</button></div></section>
        <section class="settings-card"><p class="eyebrow">Aplicación</p><h2>${standalone ? 'Planorha instalada' : 'Instalar en el celular'}</h2><p>${standalone ? 'La aplicación se está ejecutando en modo independiente.' : isIos ? 'En iPhone: abrí Planorha con Safari, tocá Compartir y luego “Agregar a pantalla de inicio”.' : 'Instalá Planorha para abrirla desde la pantalla de inicio y mejorar el funcionamiento sin conexión.'}</p><div class="settings-actions">${!standalone && !isIos ? '<button class="button button-primary" data-action="install-app">Instalar aplicación</button>' : ''}</div></section>
        <section class="settings-card"><p class="eyebrow">Prueba inmediata</p><h2>Notificación en este dispositivo</h2><p>${escapeHtml(notificationStatusText())}</p><div class="settings-actions">${notificationButton}<button class="button button-ghost" data-action="test-notification" ${'Notification' in window && Notification.permission === 'granted' ? '' : 'disabled'}>Probar notificación ahora</button></div><p class="settings-note">Esta prueba muestra un aviso inmediato en Windows o en el sistema del dispositivo. La tarjeta “Segundo plano” controla los recordatorios enviados por el servidor cuando Planorha está cerrada.</p></section>
        <section class="settings-card"><p class="eyebrow">Almacenamiento</p><h2>Versión inicial</h2><p>Los datos se guardan en este navegador y se sincronizan con la cuenta central.</p></section>
        <section class="settings-card"><p class="eyebrow">Zona de cuidado</p><h2>Restablecer</h2><p>Elimina tareas, listas y categorías de todos los dispositivos sincronizados.</p><button class="button button-danger" data-action="reset-data">Borrar todos los datos</button></section>
      </div>`;
  }

  function bindTaskRows(root = content) {
    $$('.task-row[data-task-id]', root).forEach(row => {
      const id = row.dataset.taskId;
      $('[data-action="toggle-task"]', row)?.addEventListener('change', () => toggleTask(id));
      $('[data-action="edit-task"]', row)?.addEventListener('click', () => openTaskDialog(state.tasks.find(task => task.id === id)));
      $('[data-action="duplicate-task"]', row)?.addEventListener('click', () => duplicateTask(id));
      $('[data-action="archive-task"]', row)?.addEventListener('click', () => archiveTask(id));
      $('[data-action="restore-task"]', row)?.addEventListener('click', () => restoreTask(id));
      $('[data-action="move-task-up"]', row)?.addEventListener('click', () => moveTask(id, -1));
      $('[data-action="move-task-down"]', row)?.addEventListener('click', () => moveTask(id, 1));
      $('[data-action="delete-task"]', row)?.addEventListener('click', () => deleteTask(id));
    });
  }

  function bindViewEvents() {
    $$('[data-action]', content).forEach(element => {
      const action = element.dataset.action;
      if (action === 'new-task') element.addEventListener('click', () => openTaskDialog());
      if (action === 'new-task-selected-date') element.addEventListener('click', () => openTaskDialog(null, selectedCalendarDate));
      if (action === 'new-task-week') element.addEventListener('click', () => openTaskDialog(null, element.dataset.date));
      if (action === 'new-list') element.addEventListener('click', () => openListDialog());
      if (action === 'new-category') element.addEventListener('click', () => openCategoryDialog());
      if (action === 'go-tasks') element.addEventListener('click', () => navigate('tareas'));
      if (action === 'go-week') element.addEventListener('click', () => navigate('semana'));
      if (action === 'go-calendar') element.addEventListener('click', () => navigate('calendario'));
      if (action === 'go-lists' || action === 'open-list-view') element.addEventListener('click', () => navigate('listas'));
      if (action === 'calendar-prev') element.addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); render(); });
      if (action === 'calendar-next') element.addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); render(); });
      if (action === 'calendar-today') element.addEventListener('click', () => { calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1); selectedCalendarDate = todayKey(); render(); });
      if (action === 'week-prev') element.addEventListener('click', () => { weekCursor = addDays(weekCursor, -7); render(); });
      if (action === 'week-next') element.addEventListener('click', () => { weekCursor = addDays(weekCursor, 7); render(); });
      if (action === 'week-today') element.addEventListener('click', () => { weekCursor = parseLocalDate(todayKey()); render(); });
      if (action === 'archive-completed') element.addEventListener('click', archiveCompletedTasks);
      if (action === 'export-data') element.addEventListener('click', exportData);
      if (action === 'import-data') element.addEventListener('click', () => $('#import-input').click());
      if (action === 'reset-data') element.addEventListener('click', resetData);
      if (action === 'install-app') element.addEventListener('click', installApp);
      if (action === 'enable-notifications') element.addEventListener('click', enableNotifications);
      if (action === 'test-notification') element.addEventListener('click', testNotificationNow);
      if (action === 'edit-week-task') element.addEventListener('click', () => openTaskDialog(state.tasks.find(task => task.id === element.dataset.taskId)));
    });

    $$('[data-calendar-date]', content).forEach(day => day.addEventListener('click', () => { selectedCalendarDate = day.dataset.calendarDate; render(); }));
    bindTaskRows();

    $$('.list-card', content).forEach(card => {
      const listId = card.dataset.listId;
      $('[data-action="edit-list"]', card)?.addEventListener('click', () => openListDialog(state.lists.find(list => list.id === listId)));
      $('[data-action="delete-list"]', card)?.addEventListener('click', () => deleteList(listId));
      $('[data-action="move-list-up"]', card)?.addEventListener('click', () => moveList(listId, -1));
      $('[data-action="move-list-down"]', card)?.addEventListener('click', () => moveList(listId, 1));
      $('[data-action="add-list-item"]', card)?.addEventListener('submit', event => addListItem(event, listId));
      $$('.list-item', card).forEach(item => {
        const itemId = item.dataset.itemId;
        $('[data-action="toggle-list-item"]', item)?.addEventListener('change', () => toggleListItem(listId, itemId));
        $('[data-action="move-list-item-up"]', item)?.addEventListener('click', () => moveListItem(listId, itemId, -1));
        $('[data-action="move-list-item-down"]', item)?.addEventListener('click', () => moveListItem(listId, itemId, 1));
        $('[data-action="delete-list-item"]', item)?.addEventListener('click', () => deleteListItem(listId, itemId));
      });
    });

    $$('.category-card', content).forEach(card => {
      const id = card.dataset.categoryId;
      $('[data-action="edit-category"]', card)?.addEventListener('click', () => openCategoryDialog(state.categories.find(category => category.id === id)));
      $('[data-action="delete-category"]', card)?.addEventListener('click', () => deleteCategory(id));
    });

    $('#task-search')?.addEventListener('input', event => { uiPrefs.taskSearch = event.currentTarget.value; saveUiPrefs(); refreshTaskResults(); });
    $('#task-status-filter')?.addEventListener('change', event => { uiPrefs.taskStatus = event.currentTarget.value; saveUiPrefs(); refreshTaskResults(); });
    $('#task-category-filter')?.addEventListener('change', event => { uiPrefs.taskCategory = event.currentTarget.value; saveUiPrefs(); refreshTaskResults(); });
  }

  function refreshTaskResults() {
    const results = $('#tasks-results');
    if (!results) return;
    results.innerHTML = renderFilteredTasks();
    bindTaskRows(results);
    $('[data-action="new-task"]', results)?.addEventListener('click', () => openTaskDialog());
  }

  function openDialog(dialog) {
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function updateRecurrenceFields() {
    const form = $('#task-form');
    const type = form?.elements.recurrenceType?.value || 'none';
    const details = $('#recurrence-details');
    const weekdays = $('#weekly-days');
    if (details) details.hidden = type === 'none';
    if (weekdays) weekdays.hidden = type !== 'weekly';
  }

  function openTaskDialog(task = null, presetDate = '') {
    const dialog = $('#task-dialog');
    const form = $('#task-form');
    const recurrence = normalizeRecurrence(task?.recurrence);
    form.reset();
    $('#task-dialog-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
    form.elements.id.value = task?.id || '';
    form.elements.title.value = task?.title || '';
    form.elements.notes.value = task?.notes || '';
    form.elements.date.value = task?.date || presetDate || '';
    form.elements.time.value = task?.time || '';
    form.elements.priority.value = task?.priority || 'medium';
    form.elements.category.innerHTML = categoryOptions(task?.categoryId || '');
    form.elements.recurrenceType.value = recurrence.type;
    form.elements.recurrenceInterval.value = recurrence.interval;
    form.elements.recurrenceEndDate.value = recurrence.endDate;
    $$('input[name="recurrenceWeekday"]', form).forEach(input => { input.checked = recurrence.weekdays.includes(Number(input.value)); });
    form.elements.reminderMinutes.value = task?.reminderMinutes === '' || task?.reminderMinutes == null ? '' : String(task.reminderMinutes);
    updateRecurrenceFields();
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
    form.elements.dueDate.value = list?.dueDate || '';
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
    const recurrence = normalizeRecurrence({
      type: data.get('recurrenceType'),
      interval: data.get('recurrenceInterval'),
      weekdays: data.getAll('recurrenceWeekday').map(Number),
      endDate: data.get('recurrenceEndDate')
    });
    const date = data.get('date');
    const time = data.get('time');
    const reminderMinutes = data.get('reminderMinutes');
    const task = {
      ...existing,
      id: id || uid(),
      title: data.get('title').trim(),
      notes: data.get('notes').trim(),
      date,
      time,
      priority: data.get('priority'),
      categoryId: data.get('category'),
      recurrence,
      reminderMinutes: reminderMinutes === '' ? '' : Number(reminderMinutes),
      reminderNotifiedFor: existing && existing.date === date && existing.time === time && String(existing.reminderMinutes) === String(reminderMinutes) ? existing.reminderNotifiedFor || '' : '',
      completed: existing?.completed || false,
      completedAt: existing?.completedAt || null,
      archived: existing?.archived || false,
      archivedAt: existing?.archivedAt || null,
      seriesId: existing?.seriesId || null,
      order: existing?.order ?? state.tasks.length,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    if (!task.title) return;
    if (recurrence.type !== 'none' && !date) {
      showToast('Las tareas recurrentes necesitan una fecha inicial.');
      return;
    }
    if (existing) Object.assign(existing, task);
    else state.tasks.push(task);
    saveState(existing ? 'Tarea actualizada.' : 'Tarea creada.');
    closeDialog($('#task-dialog'));
    render();
    checkReminders();
  }

  function submitList(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = data.get('id');
    const existing = state.lists.find(list => list.id === id);
    const list = {
      ...existing,
      id: id || uid(),
      title: data.get('title').trim(),
      notes: data.get('notes').trim(),
      dueDate: data.get('dueDate'),
      categoryId: data.get('category'),
      items: existing?.items || [],
      order: existing?.order ?? state.lists.length,
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
    const category = { ...existing, id: id || uid(), name: data.get('name').trim(), color: data.get('color') };
    if (!category.name) return;
    if (existing) Object.assign(existing, category);
    else state.categories.push(category);
    saveState(existing ? 'Categoría actualizada.' : 'Categoría creada.');
    closeDialog($('#category-dialog'));
    render();
  }

  function toggleTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task || task.archived) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    let message = task.completed ? 'Tarea completada.' : 'Tarea reabierta.';
    if (task.completed && task.recurrence?.type !== 'none') {
      const next = buildNextOccurrence(task, state.tasks, uid);
      if (next) {
        state.tasks.push(next);
        message = `Tarea completada. Próxima: ${formatDate(next.date, { day: 'numeric', month: 'long' })}.`;
      }
    }
    saveState(message);
    render();
  }

  function duplicateTask(id) {
    const original = state.tasks.find(task => task.id === id);
    if (!original) return;
    const copy = {
      ...original,
      id: uid(),
      title: `${original.title} (copia)`,
      completed: false,
      completedAt: null,
      archived: false,
      archivedAt: null,
      seriesId: null,
      reminderNotifiedFor: '',
      order: state.tasks.length,
      createdAt: new Date().toISOString(),
      _updatedAt: undefined
    };
    state.tasks.push(copy);
    saveState('Tarea duplicada.');
    render();
  }

  function archiveTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task || !task.completed) return;
    task.archived = true;
    task.archivedAt = new Date().toISOString();
    saveState('Tarea archivada.');
    render();
  }

  function restoreTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    task.archived = false;
    task.archivedAt = null;
    saveState('Tarea restaurada.');
    render();
  }

  function archiveCompletedTasks() {
    const completed = state.tasks.filter(task => task.completed && !task.archived);
    if (!completed.length) return;
    if (!confirm(`¿Archivar ${completed.length} ${completed.length === 1 ? 'tarea completada' : 'tareas completadas'}?`)) return;
    const now = new Date().toISOString();
    completed.forEach(task => { task.archived = true; task.archivedAt = now; });
    saveState('Tareas completadas archivadas.');
    render();
  }

  function moveWithin(items, id, direction) {
    const ordered = [...items].sort((a, b) => orderValue(a) - orderValue(b));
    const index = ordered.findIndex(item => item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return false;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    ordered.forEach((item, order) => { item.order = order; });
    return true;
  }

  function moveTask(id, direction) {
    if (!moveWithin(state.tasks.filter(task => !task.archived), id, direction)) return;
    saveState();
    render();
  }

  function deleteTask(id) {
    const task = state.tasks.find(item => item.id === id);
    if (!task || !confirm(`¿Eliminar la tarea “${task.title}”?`)) return;
    state.tasks = state.tasks.filter(item => item.id !== id);
    saveState('Tarea eliminada.');
    render();
  }

  function moveList(id, direction) {
    if (!moveWithin(state.lists, id, direction)) return;
    saveState();
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
    list.items.push({ id: uid(), name, quantity: data.get('quantity').trim(), completed: false, order: list.items.length, createdAt: new Date().toISOString() });
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

  function moveListItem(listId, itemId, direction) {
    const list = state.lists.find(item => item.id === listId);
    if (!list || !moveWithin(list.items || [], itemId, direction)) return;
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
    link.download = `planorha-${todayKey()}.json`;
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
      if (!confirm('La importación reemplazará los datos actuales y los sincronizará. ¿Continuar?')) return;
      state = migrateProductivityState(parsed);
      saveState('Datos importados correctamente.');
      render();
    } catch (error) {
      console.error(error);
      showToast('No se pudo importar el archivo.');
    }
  }

  function resetData() {
    if (!confirm('¿Borrar todos los datos de Planorha? El cambio se sincronizará con los demás dispositivos.')) return;
    if (!confirm('Última confirmación: esta acción no se puede deshacer salvo que tengas una copia exportada.')) return;
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

  async function enableNotifications() {
    if (!('Notification' in window)) {
      showToast('Este navegador no admite notificaciones.');
      return;
    }
    const permission = await Notification.requestPermission();
    showToast(permission === 'granted' ? 'Notificaciones habilitadas.' : 'No se habilitaron las notificaciones.');
    render();
    if (permission === 'granted') checkReminders();
  }

  async function showNotification(title, body, taskId = '') {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (registration) {
        await registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: taskId ? `planorha-task-${taskId}` : `planorha-test-${Date.now()}`,
          renotify: false,
          requireInteraction: false,
          data: { url: taskId ? '/#tareas' : '/#hoy', taskId }
        });
      } else {
        new Notification(title, { body, icon: '/icons/icon-192.png', tag: `planorha-test-${Date.now()}` });
      }
      return true;
    } catch (error) {
      console.warn('No se pudo mostrar la notificación:', error);
      return false;
    }
  }

  async function testNotificationNow(event) {
    const button = event?.currentTarget;
    if (button) button.disabled = true;
    try {
      if (!('Notification' in window)) {
        showToast('Este navegador no admite notificaciones.');
        return;
      }
      if (Notification.permission !== 'granted') {
        showToast('Primero habilitá las notificaciones del sitio.');
        return;
      }
      const shown = await showNotification('Planorha', 'La notificación de prueba funciona correctamente.');
      showToast(shown ? 'Aviso de prueba enviado a Windows.' : 'Windows o el navegador bloquearon el aviso.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function checkReminders() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const dueTasks = activeTasks().filter(task => shouldNotifyTask(task));
    if (!dueTasks.length) return;
    for (const task of dueTasks) {
      const shown = await showNotification(task.title, task.notes || `${task.date} a las ${task.time}`, task.id);
      if (shown) task.reminderNotifiedFor = reminderKey(task);
    }
    saveState();
  }

  function startReminderChecks() {
    clearInterval(reminderTimer);
    reminderTimer = setInterval(checkReminders, 30_000);
    setTimeout(checkReminders, 1200);
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
    $('#task-form').elements.recurrenceType.addEventListener('change', updateRecurrenceFields);

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

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkReminders();
    });

    document.addEventListener('keydown', event => {
      if (event.target.matches('input, textarea, select') || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < VIEWS.length) navigate(VIEWS[index]);
      if (event.key.toLowerCase() === 'n') openDialog($('#action-dialog'));
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js?v=8');
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showToast('Planorha se actualizó. La nueva versión se aplicará al recargar.');
        });
      });
    } catch (error) {
      console.warn('Service Worker:', error);
    }
  }

  state = migrateProductivityState(state);
  saveState();
  setupGlobalEvents();
  registerServiceWorker();
  startReminderChecks();
  if (!location.hash) history.replaceState(null, '', '#hoy');
  render();
})();
