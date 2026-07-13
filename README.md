# Organizador Personal

Aplicación web personalizable para centralizar tareas, calendario, listas de compras y categorías.

## Estado actual

✅ MVP web funcional cargado en `main`.

La primera versión incluye persistencia local en el navegador y está preparada para publicarse como sitio estático en Cloudflare Pages. Todavía no existe sincronización entre dispositivos ni acceso privado mediante usuario.

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

## Tecnología

- HTML, CSS y JavaScript sin dependencias externas.
- Almacenamiento inicial mediante `localStorage`.
- Aplicación estática compatible con Cloudflare Pages.
- Base preparada para incorporar Cloudflare D1 y Pages Functions/Workers.

## Despliegue en Cloudflare Pages

Conectar este repositorio y usar:

- Production branch: `main`
- Framework preset: `None`
- Build command: dejar vacío
- Build output directory: `/`
- Root directory: `/`

## Roadmap

1. [Publicar MVP en Cloudflare Pages](https://github.com/gnaEMV90/organizador-personal/issues/1)
2. [Sincronización con Cloudflare D1 y acceso privado](https://github.com/gnaEMV90/organizador-personal/issues/2)
3. [Tareas recurrentes, recordatorios y mejoras](https://github.com/gnaEMV90/organizador-personal/issues/3)
4. [Cierre PWA para iPhone y Android](https://github.com/gnaEMV90/organizador-personal/issues/4)

## Importante sobre los datos

Hasta completar el hito de D1, cada navegador mantiene su propia información. Antes de borrar datos del navegador o cambiar de dispositivo conviene usar **Ajustes → Exportar datos**.
