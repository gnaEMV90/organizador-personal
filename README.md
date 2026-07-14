# Planorha

**Tu día, en orden.**

Aplicación web personalizable para centralizar tareas, calendario, listas de compras y categorías.

## Estado actual

✅ MVP publicado en `https://planorha.pages.dev`.

✅ Marca interna y PWA actualizadas a **Planorha**.

✅ Código de sincronización con Cloudflare D1 y validación de Cloudflare Access incorporado.

La aplicación continúa funcionando con almacenamiento local mientras D1 y Access no estén vinculados. Cuando se complete esa configuración, los datos se sincronizarán automáticamente entre dispositivos autenticados con el mismo correo.

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
- Sincronización progresiva con respaldo local y reintento al recuperar internet.

## Tecnología

- HTML, CSS y JavaScript sin dependencias externas.
- Cloudflare Pages y Pages Functions.
- Almacenamiento local mediante `localStorage`.
- Persistencia central preparada para Cloudflare D1.
- Validación del JWT de Cloudflare Access mediante Web Crypto.

## Despliegue en Cloudflare Pages

El proyecto publicado usa:

- Production branch: `main`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `.`
- Root directory: dejar vacío

Los cambios de bindings o variables de entorno requieren un deployment nuevo para quedar activos. Los commits nuevos sobre `main` lo generan automáticamente.

## Activar sincronización

Seguir la guía [docs/CLOUDFLARE_SYNC_SETUP.md](docs/CLOUDFLARE_SYNC_SETUP.md).

Resumen de recursos esperados:

- Base D1: `planorha-db`
- Binding D1: `DB`
- Variable: `ACCESS_TEAM_DOMAIN`
- Variable: `ACCESS_AUD`
- Aplicación Cloudflare Access para `planorha.pages.dev`

## Roadmap

1. [Publicar MVP en Cloudflare Pages](https://github.com/gnaEMV90/organizador-personal/issues/1)
2. [Sincronización con Cloudflare D1 y acceso privado](https://github.com/gnaEMV90/organizador-personal/issues/2)
3. [Tareas recurrentes, recordatorios y mejoras](https://github.com/gnaEMV90/organizador-personal/issues/3)
4. [Cierre PWA para iPhone y Android](https://github.com/gnaEMV90/organizador-personal/issues/4)

## Respaldo de datos

Mientras la sincronización no esté activada, cada navegador mantiene su propia información. Antes de borrar datos del navegador o cambiar de dispositivo conviene usar **Ajustes → Exportar datos**.
