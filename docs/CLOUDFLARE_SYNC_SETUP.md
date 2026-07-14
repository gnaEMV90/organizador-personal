# Sincronización de Planorha en Cloudflare

Planorha utiliza una Pages Function en `/api/state`, una base Cloudflare D1 como copia central y `localStorage` como respaldo por dispositivo.

## Estado del entorno

La instalación productiva de `planorha.pages.dev` tiene configurados:

- Base D1: `planorha-db`
- Binding: `DB`
- Aplicación Cloudflare Access
- Variable: `ACCESS_TEAM_DOMAIN`
- Variable: `ACCESS_AUD`

Los datos se separan por el correo validado en el JWT de Cloudflare Access.

## 1. Crear la base D1

1. En Cloudflare, abrir **Storage & Databases → D1 SQL Database**.
2. Crear una base llamada `planorha-db`.
3. Abrir la consola SQL y ejecutar `migrations/0001_user_state.sql`.

La Function también ejecuta `CREATE TABLE IF NOT EXISTS` para verificar el esquema al atender una solicitud.

## 2. Vincular D1 al proyecto Pages

En **Workers & Pages → planorha → Settings → Bindings**:

- Tipo: **D1 database**
- Variable name: `DB`
- Database: `planorha-db`

Agregar el binding en Production y, si se usan previews, también en Preview. Después volver a desplegar el proyecto.

## 3. Proteger Planorha con Cloudflare Access

Crear una aplicación Access para `planorha.pages.dev` y definir una política **Allow** únicamente para los correos autorizados.

Datos necesarios:

- Dominio del equipo, por ejemplo `mi-equipo.cloudflareaccess.com`.
- **Application Audience (AUD)** de la aplicación Access.

Para una instalación personal puede usarse **One-time PIN** como único proveedor de identidad.

## 4. Variables de entorno

En **Workers & Pages → planorha → Settings → Variables and Secrets**, agregar en Production:

- `ACCESS_TEAM_DOMAIN`: dominio del equipo sin `https://` ni barra final.
- `ACCESS_AUD`: Audience exacto de la aplicación Access.

Después de modificar bindings o variables debe ejecutarse un nuevo deployment.

## Verificación

Con una sesión autenticada, abrir:

```text
https://planorha.pages.dev/api/state
```

La respuesta esperada contiene:

```json
{
  "state": {},
  "updatedAt": "fecha ISO",
  "user": "correo autenticado"
}
```

Luego:

1. Crear una tarea desde un dispositivo.
2. Esperar el estado **Sincronizado**.
3. Abrir Planorha en otro dispositivo con el mismo correo.
4. Comprobar que la tarea aparezca.
5. Eliminarla desde el segundo dispositivo y comprobar que la eliminación llegue al primero.

## Comportamiento operativo

- Cada elemento mantiene su propia fecha de modificación.
- Los cambios de distintos dispositivos se combinan en vez de reemplazar todo el estado sin control.
- Las eliminaciones se registran para evitar reapariciones desde copias antiguas.
- La API reintenta escrituras cuando detecta una actualización concurrente.
- La aplicación consulta D1 al abrirse, recuperar el foco, volver desde segundo plano y periódicamente mientras está activa.
- El botón **Sincronizar ahora** fuerza una actualización manual.
- Sin conexión, Planorha continúa trabajando con la copia local y reintenta al volver internet.

## Diagnóstico rápido

- `401 No autorizado`: revisar Access, `ACCESS_AUD` y `ACCESS_TEAM_DOMAIN`.
- `503 Sincronización no configurada`: revisar variables y binding `DB` en Production.
- `500 No se pudo leer/guardar`: revisar los logs de Pages Functions y el estado de D1.
- La interfaz muestra **Guardado local** o **Sincronización pendiente**: la API no está disponible para esa sesión.
