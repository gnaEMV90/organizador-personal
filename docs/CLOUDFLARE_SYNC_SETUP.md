# Activación de sincronización en Cloudflare

El código de Planorha ya incluye una Pages Function en `/api/state` y mantiene el modo local como respaldo. La sincronización solo se activa cuando D1 y Cloudflare Access están configurados.

## 1. Crear la base D1

1. En Cloudflare, abrir **Storage & Databases → D1 SQL Database**.
2. Crear una base llamada `planorha-db`.
3. Abrir la consola SQL de la base y ejecutar el contenido de `migrations/0001_user_state.sql`.

## 2. Vincular D1 al proyecto Pages

En **Workers & Pages → planorha → Settings → Bindings**:

- Tipo: **D1 database**
- Variable name: `DB`
- Database: `planorha-db`

Agregar el binding en Production y, si se usan previews, también en Preview. Después volver a desplegar el proyecto.

## 3. Proteger Planorha con Cloudflare Access

Crear una aplicación Access para `planorha.pages.dev` y definir una política **Allow** únicamente para los correos autorizados.

Anotar:

- El dominio del equipo, por ejemplo `mi-equipo.cloudflareaccess.com`.
- El **Application Audience (AUD)** de la aplicación Access.

## 4. Variables de entorno

En **Workers & Pages → planorha → Settings → Variables and Secrets**, agregar:

- `ACCESS_TEAM_DOMAIN`: dominio del equipo sin `https://`.
- `ACCESS_AUD`: Audience de la aplicación Access.

Agregar las variables en Production y redeplegar.

## Comportamiento esperado

- Sin D1 o Access: Planorha funciona normalmente y guarda los datos en el navegador.
- Con D1 y Access: los datos locales se suben automáticamente y luego se sincronizan entre dispositivos autenticados con el mismo correo.
- Sin conexión: la aplicación continúa usando el almacenamiento local y reintenta al recuperar internet.