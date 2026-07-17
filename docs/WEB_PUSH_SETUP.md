# Web Push para Planorha

Esta guía activa recordatorios cuando Planorha está cerrada. La solución se compone de:

- Pages Functions para registrar y revocar suscripciones.
- D1 para guardar suscripciones y evitar envíos duplicados.
- Un Worker separado con Cron Trigger cada minuto.
- El Service Worker de Planorha para recibir el mensaje y mostrar la notificación.

## 1. Aplicar la migración D1

Ejecutar `migrations/0002_push_notifications.sql` sobre la base `planorha-db`.

También puede ejecutarse desde la consola SQL del dashboard de Cloudflare.

## 2. Generar las claves VAPID

Desde una terminal con Node.js:

```bash
npx web-push generate-vapid-keys
```

El comando genera una clave pública y una privada. Deben generarse una sola vez y conservarse.

No subir la clave privada al repositorio.

## 3. Configurar Cloudflare Pages

En **Workers & Pages → planorha → Settings → Variables and Secrets**, agregar para Production:

- `VAPID_PUBLIC_KEY`: clave pública generada.

El binding D1 debe continuar llamándose `DB`.

Después de guardar la variable, ejecutar un deployment nuevo.

La ruta autenticada `/api/push/config` informará si la función quedó habilitada.

## 4. Preparar el Worker programado

Editar `push-worker/wrangler.jsonc` y reemplazar:

```text
REEMPLAZAR_CON_DATABASE_ID
```

por el ID real de `planorha-db`.

Luego:

```bash
cd push-worker
npm install
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npm run deploy
```

Valores:

- `VAPID_PUBLIC_KEY`: la misma clave pública configurada en Pages.
- `VAPID_PRIVATE_KEY`: clave privada VAPID.
- `VAPID_SUBJECT`: un contacto válido, por ejemplo `mailto:german.andrighetti@gmail.com`.

El Worker usa el mismo D1 que Planorha y ejecuta un Cron Trigger cada minuto.

## 5. Activar un dispositivo

1. Abrir Planorha con la sesión autenticada.
2. Ingresar a **Ajustes**.
3. Buscar la tarjeta **Segundo plano**.
4. Presionar **Activar en este dispositivo**.
5. Aceptar el permiso del navegador.

Cada navegador o dispositivo genera una suscripción diferente. Puede desactivarse individualmente desde la misma tarjeta.

## 6. Probar

1. Crear una tarea con fecha y hora de pocos minutos en el futuro.
2. Elegir un recordatorio.
3. Esperar que Planorha muestre **Sincronizado**.
4. Cerrar Planorha.
5. Esperar el horario del recordatorio.
6. Tocar la notificación y comprobar que abra Planorha.

## Seguridad

- Las rutas de suscripción validan el JWT de Cloudflare Access.
- Las escrituras exigen el mismo origen de Planorha.
- El endpoint de una suscripción se trata como dato sensible y se guarda únicamente en D1.
- La clave privada VAPID existe solamente como secreto del Worker.
- Las respuestas `404` y `410` del servicio push desactivan automáticamente suscripciones vencidas.
- Los envíos se registran por usuario, dispositivo, tarea y recordatorio para impedir duplicados.

## Diagnóstico

- **Configuración pendiente**: falta `VAPID_PUBLIC_KEY` en Pages o falta redeplegar.
- **Notificaciones bloqueadas**: el permiso fue denegado en el navegador o sistema operativo.
- **La suscripción se registra pero no llega el aviso**: revisar el Worker, los secretos VAPID, el binding D1 y los eventos del Cron Trigger.
- **Error 401 en `/api/push/config`**: revisar la sesión y la configuración de Cloudflare Access.
- **Error 500 en la API push**: revisar el esquema D1 y los logs de Pages Functions.

## Referencias técnicas

- Cloudflare Workers: Cron Triggers y handler `scheduled()`.
- Cloudflare Workers: compatibilidad `nodejs_compat` para `web-push`.
- Push API y `PushManager.subscribe()`.
- Evento `push` del Service Worker y `showNotification()`.
