(() => {
  'use strict';

  const STORAGE_KEY = 'planorha.theme.v1';
  const MODES = ['system', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = readPreference();

  function readPreference() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return MODES.includes(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  function resolvedTheme(value = preference) {
    if (value === 'system') return media.matches ? 'dark' : 'light';
    return value;
  }

  function themeIcon() {
    if (preference === 'system') return '◐';
    return resolvedTheme() === 'dark' ? '☾' : '☀';
  }

  function updateThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1513' : '#eef3f0');
  }

  function updateQuickButton() {
    const button = document.querySelector('#theme-toggle-button');
    if (!button) return;
    const theme = resolvedTheme();
    button.innerHTML = `<span aria-hidden="true">${themeIcon()}</span>`;
    button.setAttribute('aria-label', theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    button.title = preference === 'system'
      ? `Tema automático · ahora ${theme === 'dark' ? 'oscuro' : 'claro'}`
      : `Tema ${theme === 'dark' ? 'oscuro' : 'claro'}`;
  }

  function applyTheme(value, { persist = true, announce = true } = {}) {
    preference = MODES.includes(value) ? value : 'system';
    const theme = resolvedTheme();

    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    updateThemeColor(theme);

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, preference);
      } catch {
        // La preferencia visual no debe bloquear el uso de la aplicación.
      }
    }

    updateQuickButton();
    renderSettingsCard();

    if (announce) {
      window.dispatchEvent(new CustomEvent('planorha:theme-change', {
        detail: { preference, theme }
      }));
    }
  }

  function optionMarkup(value, icon, title, description) {
    const active = preference === value ? ' is-active' : '';
    const pressed = preference === value ? 'true' : 'false';
    return `
      <button class="theme-option${active}" type="button" data-theme-choice="${value}" aria-pressed="${pressed}">
        <span class="theme-option-icon" aria-hidden="true">${icon}</span>
        <span><strong>${title}</strong><small>${description}</small></span>
      </button>`;
  }

  function renderSettingsCard() {
    const grid = document.querySelector('.settings-grid');
    if (!grid) return;

    let card = document.querySelector('#theme-settings-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'theme-settings-card';
      card.className = 'settings-card theme-settings-card';
      grid.insertBefore(card, grid.firstElementChild || null);
    }

    const signature = `${preference}|${resolvedTheme()}`;
    if (card.dataset.themeSignature === signature) return;
    card.dataset.themeSignature = signature;

    card.innerHTML = `
      <p class="eyebrow">Apariencia</p>
      <h2>Tema de Planorha</h2>
      <p>Elegí cómo querés ver la aplicación en este dispositivo. El modo automático sigue la configuración del sistema.</p>
      <div class="theme-options" role="group" aria-label="Seleccionar tema">
        ${optionMarkup('system', '◐', 'Automático', 'Sigue al sistema')}
        ${optionMarkup('light', '☀', 'Claro', 'Luminoso y limpio')}
        ${optionMarkup('dark', '☾', 'Oscuro', 'Cómodo de noche')}
      </div>`;

    card.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
    });
  }

  function toggleTheme() {
    applyTheme(resolvedTheme() === 'dark' ? 'light' : 'dark');
  }

  function bindQuickButton() {
    const button = document.querySelector('#theme-toggle-button');
    if (!button || button.dataset.themeBound === 'true') return;
    button.dataset.themeBound = 'true';
    button.addEventListener('click', toggleTheme);
    updateQuickButton();
  }

  function refreshUi() {
    bindQuickButton();
    renderSettingsCard();
  }

  const observer = new MutationObserver(refreshUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const handleSystemTheme = () => {
    if (preference === 'system') applyTheme('system', { persist: false });
  };
  if (typeof media.addEventListener === 'function') media.addEventListener('change', handleSystemTheme);
  else if (typeof media.addListener === 'function') media.addListener(handleSystemTheme);

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) applyTheme(readPreference(), { persist: false });
  });

  window.PlanorhaTheme = {
    get preference() { return preference; },
    get theme() { return resolvedTheme(); },
    set: value => applyTheme(value),
    toggle: toggleTheme
  };

  applyTheme(preference, { persist: false, announce: false });
  refreshUi();
})();
