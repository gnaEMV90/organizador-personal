const CACHE_NAME = 'planorha-v13';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=11',
  '/sync.css?v=5',
  '/productivity.css?v=6',
  '/modern.css?v=1',
  '/mobile-fixes.css?v=1',
  '/theme.js?v=1',
  '/push-client.js?v=10',
  '/push-ui.js?v=10',
  '/connectivity-recovery.js?v=1',
  '/manual-order-addon.js?v=5',
  '/bootstrap.js?v=6',
  '/sync-core.js?v=4',
  '/productivity-core.js?v=5',
  '/app.js?v=5',
  '/manifest.webmanifest?v=5',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isAppAsset = event.request.mode === 'navigate' || /\.(?:js|css|html|webmanifest)$/.test(url.pathname);
  if (isAppAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const title = payload.title || 'Planorha';
  const options = {
    body: payload.body || 'Tenés un recordatorio pendiente.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || `planorha-push-${Date.now()}`,
    renotify: false,
    data: {
      url: payload.url || '/#tareas',
      taskId: payload.taskId || ''
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/#hoy', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(client => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});