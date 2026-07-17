# Web Push para Planorha

Esta guía activa recordatorios cuando Planorha está cerrada. La solución se compone de:

- Pages Functions para registrar y revocar suscripciones.
- D1 para guardar suscripciones y evitar envíos duplicados.
- Un Worker separado con Cron Trigger cada minuto.
- El Service Worker de Planorha para recibir el mensaje y mostrar la notificación.

## Valores productivos definidos

- Base D1: `planorha-db`
- Database ID: `fbcdcf86-5661-4bb8-a5fd-c615b61c282a`
- VAPID Public Key: `BFBJYfmsYkFK3tHETq7VS8ivgrLyP0M_33TxpOjDTADiQpHzScgw_nTQrxKTbdZbU9QWe2lY3Fhkp70cesjoQ-g`
- VAPID Subject: `mailto:german.andrighetti@gmail.com`
- Worker: `planorha-push-worker`
- Cron: cada minuto (`* * * * *`)

La clave privada VAPID no debe guardarse en GitHub ni pegarse en documentación.

## 1. Aplicar la migración D1

Desde la raíz del repositorio:

```bash
cd push-worker
npm install
npm run migrate
```

El comando ejecuta `migrations/0002_push_notifications.sql` sobre la base remota `planorha-db`.

También puede aplicarse copiando el contenido del archivo SQL en la consola de D1 del dashboard.

## 2. Configurar Cloudflare Pages

En **Workers & Pages → planorha → Settings → Variables and Secrets**, agregar para Production:

- Nombre: `VAPID_PUBLIC_KEY`
- Tipo: texto sin cifrar
- Valor: `BFBJYfmsYkFK3tHETq7VS8ivgrLyP0M_33TxpOjDTADiQpHzScgw_nTQrxKTbdZbU9QWe2lY3Fhkp70cesjoQ-g`

El binding D1 debe continuar llamándose `DB`.

Después de guardar la variable, ejecutar un deployment nuevo de Pages. La ruta autenticada `/api/push/config` informará si la función quedó habilitada.

## 3. Configurar el Worker programado

`push-worker/wrangler.jsonc` ya contiene:

- Database ID productivo.
- Clave pública VAPID.
- Contacto VAPID.
- Cron Trigger cada minuto.

La única variable pendiente es la clave privada. Desde `push-worker`:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Cuando Wrangler solicite el valor, pegar la **Private Key** generada junto con la clave pública. No escribirla en el comando ni guardarla en archivos del repositorio.

Luego desplegar:

```bash
npm run deploy
```

El Worker comparte la misma base D1 que Planorha.

## 4. Verificar el Worker

Después del despliegue, abrir la URL del Worker terminada en `/health`.

Respuesta esperada:

```json
{
  "ok": true,
  "service": "planorha-push-worker"
}
```

En Cloudflare, revisar también que el Cron Trigger figure con la expresión `* * * * *`.

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
- El endpoint de una suscripción se guarda únicamente en D1.
- La clave privada VAPID existe solamente como secreto cifrado del Worker.
- Las respuestas `404` y `410` del servicio push desactivan automáticamente suscripciones vencidas.
- Los envíos se registran por usuario, dispositivo, tarea y recordatorio para impedir duplicados.

## Diagnóstico

- **Configuración pendiente**: falta `VAPID_PUBLIC_KEY` en Pages o falta redeplegar.
- **Notificaciones bloqueadas**: el permiso fue denegado en el navegador o sistema operativo.
- **La suscripción se registra pero no llega el aviso**: revisar el Worker, `VAPID_PRIVATE_KEY`, el binding D1 y los eventos del Cron Trigger.
- **Error 401 en `/api/push/config`**: revisar la sesión y la configuración de Cloudflare Access.
- **Error 500 en la API push**: revisar el esquema D1 y los logs de Pages Functions.

## Referencias técnicas

- Cloudflare Workers: Cron Triggers y handler `scheduled()`.
- Cloudflare Workers: variables, secretos y `nodejs_compat`.
- Cloudflare D1: ejecución remota de archivos SQL.
- Push API y `PushManager.subscribe()`.
- Evento `push` del Service Worker y `showNotification()`.
