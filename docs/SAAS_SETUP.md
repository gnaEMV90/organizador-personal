# Planorha SaaS — configuración y publicación

Esta documentación corresponde a la rama `feature/saas-auth-trial`. La producción actual debe conservar Cloudflare Access hasta completar las pruebas integrales.

## Variables de entorno

### Obligatorias antes de publicar el registro

- `PLANORHA_ADMIN_EMAIL`: correo que tendrá rol administrador.
- `AUTH_EMAIL_PROVIDER`: usar `gmail` para el proveedor inicial.
- `AUTH_FROM_EMAIL`: remitente confirmado: `Planorha <planorhainfo@gmail.com>`.

### Secretos para Gmail API

Estos valores deben cargarse como secretos de Cloudflare y nunca confirmarse en el repositorio ni enviarse por chat:

- `GMAIL_CLIENT_ID`: identificador OAuth del proyecto de Google Cloud.
- `GMAIL_CLIENT_SECRET`: secreto OAuth del proyecto.
- `GMAIL_REFRESH_TOKEN`: autorización revocable otorgada por `planorhainfo@gmail.com` con alcance de envío.

Planorha obtiene tokens de acceso de corta duración mediante OAuth y envía los mensajes con `users.messages.send`. La contraseña de Gmail no se solicita ni se almacena.

### Adaptador alternativo

La aplicación conserva compatibilidad con un proveedor HTTPS genérico para una futura migración a un dominio propio:

- `AUTH_EMAIL_ENDPOINT`: endpoint HTTPS del proveedor o adaptador.
- `AUTH_EMAIL_TOKEN`: token opcional del adaptador, cargado como secreto.

Planorha realiza un `POST` a `AUTH_EMAIL_ENDPOINT` con este JSON:

```json
{
  "from": "Planorha <cuentas@dominio.com>",
  "to": "usuario@ejemplo.com",
  "subject": "Asunto",
  "text": "Versión de texto",
  "html": "Versión HTML"
}
```

El adaptador debe responder con un estado HTTP entre 200 y 299 cuando el mensaje fue aceptado.

### Turnstile

- `TURNSTILE_SECRET_KEY`: secreto de Turnstile, cargado como secreto de Cloudflare.
- `TURNSTILE_SITE_KEY`: clave pública del widget.

### Variables públicas o no sensibles

- `AUTH_DEBUG_TOKENS`: usar `1` únicamente en un entorno Preview temporal sin usuarios reales. Debe eliminarse antes de producción.
- `PAYMENTS_ENABLED`: mantener distinto de `1` hasta integrar y validar el proveedor de cobro.

## Autorización única de Gmail

Para habilitar los correos transaccionales se debe:

1. Crear o seleccionar un proyecto en Google Cloud.
2. Habilitar Gmail API.
3. Configurar una pantalla de consentimiento OAuth.
4. Crear un cliente OAuth.
5. Autorizar una sola vez la cuenta `planorhainfo@gmail.com` con el alcance mínimo `gmail.send`.
6. Guardar `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN` directamente como secretos del entorno Preview de Cloudflare.
7. Enviar un correo real de verificación y otro de recuperación antes de habilitar el registro público.

La cuenta Gmail estándar tiene límites diarios de envío y se utilizará como solución inicial. El adaptador permite migrar más adelante a un proveedor transaccional con dominio propio sin modificar los flujos de registro.

## Prueba gratuita

- Comienza cuando el usuario verifica el correo.
- Dura exactamente 7 días, calculados por el servidor.
- Durante la prueba el acceso es completo.
- Al finalizar, el estado cambia a `trial_expired`.
- La cuenta queda en modo de solo lectura y los datos no se eliminan.
- Un administrador puede reiniciar o extender una prueba desde `/admin.html`.

## Estrategia de transición

1. Desplegar y probar la rama en Preview.
2. Configurar Gmail API y Turnstile en Preview.
3. Probar dos usuarios distintos y dos dispositivos por usuario.
4. Verificar aislamiento de tareas, listas, preferencias y Push.
5. Migrar y comprobar la cuenta existente de Germán.
6. Configurar `PLANORHA_ADMIN_EMAIL` en producción.
7. Fusionar el PR manteniendo Cloudflare Access.
8. Crear una contraseña propia desde Ajustes.
9. Validar el inicio de sesión propio en varios dispositivos.
10. Retirar Cloudflare Access únicamente después de completar todas las validaciones.

## Cobros

El modelo de planes y suscripciones está preparado, pero permanece deshabilitado. Antes de implementar pagos deben confirmarse con Germán:

- proveedor;
- precio y moneda;
- periodicidad mensual, anual o ambas;
- renovación automática;
- tratamiento de rechazos;
- cancelaciones y reintegros;
- período de conservación de datos.
