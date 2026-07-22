import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pushClient = await readFile(new URL('../push-client.js', import.meta.url), 'utf8');
const themeClient = await readFile(new URL('../theme.js', import.meta.url), 'utf8');
const modernStyles = await readFile(new URL('../modern.css', import.meta.url), 'utf8');

test('el manifiesto permite instalar Planorha en modo independiente', () => {
  assert.equal(manifest.name, 'Planorha');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/#hoy');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
});

test('la página contempla áreas seguras y carga los recursos versionados', () => {
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /manifest\.webmanifest\?v=5/);
  assert.match(index, /styles\.css\?v=11/);
  assert.match(index, /productivity\.css\?v=6/);
  assert.match(index, /modern\.css\?v=1/);
  assert.match(index, /theme\.js\?v=1/);
  assert.match(index, /bootstrap\.js\?v=6/);
  assert.match(index, /push-client\.js\?v=10/);
  assert.match(index, /push-ui\.js\?v=10/);
});

test('el selector visual ofrece tema claro oscuro y automático', () => {
  assert.match(themeClient, /planorha\.theme\.v1/);
  assert.match(themeClient, /prefers-color-scheme: dark/);
  assert.match(themeClient, /data-theme-choice/);
  assert.match(modernStyles, /html\[data-theme="dark"\]/);
  assert.match(modernStyles, /theme-options/);
  assert.match(modernStyles, /mobile-nav/);
});

test('el cliente push renueva suscripciones creadas con otra clave VAPID', () => {
  assert.match(pushClient, /subscriptionNeedsRefresh/);
  assert.match(pushClient, /applicationServerKey/);
  assert.match(pushClient, /subscriptionMatchesPublicKey/);
  assert.match(pushClient, /subscription\.unsubscribe\(\)/);
});

test('el service worker guarda el shell y responde a push y notificaciones', () => {
  assert.match(serviceWorker, /planorha-v12/);
  assert.match(serviceWorker, /addEventListener\('push'/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /productivity-core\.js\?v=5/);
  assert.match(serviceWorker, /modern\.css\?v=1/);
  assert.match(serviceWorker, /theme\.js\?v=1/);
  assert.match(serviceWorker, /push-client\.js\?v=10/);
});

test('los recursos locales del shell existen', async () => {
  const expected = [
    '../index.html',
    '../styles.css',
    '../sync.css',
    '../productivity.css',
    '../modern.css',
    '../theme.js',
    '../connectivity-recovery.js',
    '../bootstrap.js',
    '../sync-core.js',
    '../productivity-core.js',
    '../manual-order-addon.js',
    '../push-client.js',
    '../push-ui.js',
    '../app.js',
    '../icons/icon-192.png',
    '../icons/icon-512.png'
  ];
  await Promise.all(expected.map(path => access(new URL(path, import.meta.url))));
});
