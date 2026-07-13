# Organizador Personal

Aplicación web personalizable para centralizar tareas, calendario, listas de compras y categorías.

## Estado

MVP web en desarrollo.

## Módulos incluidos

- Panel **Hoy** con pendientes, vencidas y próximas tareas.
- **Calendario** mensual.
- **Tareas** con prioridad, estado, fecha, hora y categoría.
- **Listas** personalizables con ítems marcables.
- **Categorías** creadas por el usuario.
- Exportación e importación de datos.
- Base PWA para instalar en iPhone, iPad y Android.

## Tecnología

Aplicación estática sin dependencias externas, preparada para Cloudflare Pages. En esta primera etapa los datos se guardan en `localStorage` dentro del navegador.

## Despliegue en Cloudflare Pages

- Framework preset: `None`
- Build command: dejar vacío
- Build output directory: `/`
- Root directory: `/`

## Próximos hitos

1. Publicación inicial en Cloudflare Pages.
2. Pruebas funcionales y mejoras de experiencia.
3. Persistencia y sincronización con Cloudflare D1.
4. Acceso privado.
5. Notificaciones y tareas recurrentes.
6. Instalación como PWA en iPhone y Android.
