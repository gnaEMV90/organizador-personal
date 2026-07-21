import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pushClient = await readFile(new URL('../push-client.js', import.meta.url), 'utf8');

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
  assert.match(index, /productivity\.css\?v=5/);
  assert.match(index, /bootstrap\.js\?v=6/);
  assert.match(index, /push-client\.js\?v=8/);
  assert.match(index, /push-ui\.js\?v=8/);
});

test('el cliente push renueva suscripciones creadas con otra clave VAPID', () => {
  assert.match(pushClient, /subscriptionNeedsRefresh/);
  assert.match(pushClient, /applicationServerKey/);
  assert.match(pushClient, /subscriptionMatchesPublicKey/);
  assert.match(pushClient, /subscription\.unsubscribe\(\)/);
});

test('el service worker guarda el shell y responde a push y notificaciones', () => {
  assert.match(serviceWorker, /planorha-v8/);
  assert.match(serviceWorker, /addEventListener\('push'/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /notificationclick/);
  assert.match(serviceWorker, /productivity-core\.js\?v=5/);
  assert.match(serviceWorker, /push-client\.js\?v=8/);
});

test('los recursos locales del shell existen', async () => {
  const expected = [
    '../index.html',
    '../styles.css',
    '../sync.css',
    '../productivity.css',
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
