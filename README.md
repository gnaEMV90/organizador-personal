# Planorha

**Tu día, en orden.**

Aplicación web personalizable para centralizar tareas, calendario, listas de compras y categorías.

## Estado actual

✅ MVP publicado en `https://planorha.pages.dev`.

✅ Acceso privado activo mediante Cloudflare Access.

✅ Persistencia central activa en Cloudflare D1, separada por correo autenticado.

✅ Sincronización operativa entre computadora y celular, con respaldo local y funcionamiento sin conexión.

## Funciones incluidas

- Panel **Hoy** con tareas del día, vencidas, próximas y resumen de listas.
- **Calendario** mensual con tareas por fecha.
- **Tareas** con título, notas, fecha, hora, prioridad, categoría y estado.
- Búsqueda y filtros por estado y categoría.
- **Listas** personalizables con cantidades e ítems marcables.
- **Categorías** creadas, editadas y eliminadas por el usuario.
- Exportación e importación de datos en JSON.
- Diseño adaptable a computadora y celular.
- Manifiesto, Service Worker e íconos preparados para PWA.
- Sincronización automática al guardar, al recuperar conexión, al volver a la aplicación y mediante control manual.
- Indicador visible de estado, cuenta conectada y hora de última sincronización.
- Resolución de cambios concurrentes por elemento.
- Registro de eliminaciones para impedir que tareas, listas o ítems borrados reaparezcan desde otro dispositivo.

## Sincronización

El estado se conserva localmente en cada navegador y se replica en D1 para la cuenta autenticada. El núcleo compartido de sincronización:

- asigna una fecha de modificación a cada tarea, categoría, lista e ítem;
- combina cambios realizados desde distintos dispositivos;
- conserva marcadores de eliminación durante 180 días;
- reintenta escrituras concurrentes sin sobrescribir silenciosamente el estado más reciente;
- migra automáticamente las copias creadas con la primera versión del MVP.

La aplicación consulta cambios remotos al recuperar el foco y periódicamente mientras permanece abierta.

## Tecnología

- HTML, CSS y JavaScript sin dependencias externas.
- Cloudflare Pages y Pages Functions.
- Almacenamiento local mediante `localStorage`.
- Persistencia central mediante Cloudflare D1.
- Protección de acceso y validación del JWT de Cloudflare Access mediante Web Crypto.

## Despliegue en Cloudflare Pages

El proyecto publicado usa:

- Production branch: `main`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `.`
- Root directory: dejar vacío

Los cambios de bindings o variables de entorno requieren un deployment nuevo para quedar activos. Los commits nuevos sobre `main` lo generan automáticamente.

## Configuración de sincronización

La guía técnica se encuentra en [docs/CLOUDFLARE_SYNC_SETUP.md](docs/CLOUDFLARE_SYNC_SETUP.md).

Recursos configurados:

- Base D1: `planorha-db`
- Binding D1: `DB`
- Variable: `ACCESS_TEAM_DOMAIN`
- Variable: `ACCESS_AUD`
- Aplicación Cloudflare Access para `planorha.pages.dev`

## Roadmap

1. [Publicar MVP en Cloudflare Pages](https://github.com/gnaEMV90/organizador-personal/issues/1) — completado.
2. [Sincronización con Cloudflare D1 y acceso privado](https://github.com/gnaEMV90/organizador-personal/issues/2) — completado.
3. [Tareas recurrentes, recordatorios y mejoras](https://github.com/gnaEMV90/organizador-personal/issues/3).
4. [Cierre PWA para iPhone y Android](https://github.com/gnaEMV90/organizador-personal/issues/4).

## Respaldo de datos

D1 es la copia central de la cuenta y cada dispositivo mantiene una copia local para continuar trabajando ante una pérdida temporal de conexión. La opción **Ajustes → Exportar datos** permite generar además un respaldo manual en JSON.
