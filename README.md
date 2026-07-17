# Planorha

**Tu día, en orden.**

Aplicación web personalizable para centralizar tareas, vista semanal, calendario, recordatorios, listas y categorías.

## Estado actual

✅ MVP publicado en `https://planorha.pages.dev`.

✅ Acceso privado activo mediante Cloudflare Access.

✅ Persistencia central activa en Cloudflare D1, separada por correo autenticado.

✅ Sincronización operativa entre computadora y celular, con respaldo local y funcionamiento sin conexión.

✅ Productividad diaria con recurrencias, recordatorios, archivo, orden manual y vista semanal.

✅ PWA instalable en Android, iPhone, iPad y computadora.

## Funciones incluidas

- Panel **Hoy** con tareas del día, vencidas, próximas y resumen de listas.
- **Vista semanal** con navegación anterior/siguiente y acceso rápido por día.
- **Calendario mensual** con tareas y vencimientos de listas.
- Tareas con título, notas, fecha, hora, prioridad, categoría y estado.
- Recurrencias diarias, semanales y mensuales con intervalos personalizados.
- Selección de días para recurrencias semanales y fecha final opcional.
- Generación automática de la siguiente ocurrencia sin duplicados.
- Recordatorios desde la hora exacta hasta un día antes.
- Duplicación de tareas.
- Archivo, restauración y archivo masivo de tareas completadas.
- Búsqueda y filtros persistentes por estado y categoría.
- Orden manual de tareas, listas e ítems.
- Listas personalizables con cantidades, fecha límite e ítems marcables.
- Categorías creadas, editadas y eliminadas por el usuario.
- Exportación e importación de datos en JSON.
- Diseño adaptable a computadora y celular.
- Manifiesto, Service Worker, áreas seguras e íconos preparados para PWA.
- Sincronización automática al guardar, recuperar conexión, volver a la aplicación y mediante control manual.
- Indicador visible de estado, cuenta conectada y hora de última sincronización.
- Resolución de cambios concurrentes por elemento.
- Registro de eliminaciones para impedir que elementos borrados reaparezcan desde otro dispositivo.

## Recurrencias y recordatorios

Al completar una tarea recurrente, Planorha calcula y crea la siguiente ocurrencia. La serie conserva la configuración original y evita crear dos tareas para la misma fecha.

Los recordatorios usan notificaciones web. La aplicación los revisa mientras permanece activa y al volver a primer plano. Las notificaciones con la aplicación completamente cerrada requieren un servicio de push y planificación en backend, que no forma parte de esta versión.

## Sincronización

El estado se conserva localmente en cada navegador y se replica en D1 para la cuenta autenticada. El núcleo compartido de sincronización:

- asigna una fecha de modificación a cada tarea, categoría, lista e ítem;
- combina cambios realizados desde distintos dispositivos;
- conserva marcadores de eliminación durante 180 días;
- reintenta escrituras concurrentes sin sobrescribir silenciosamente el estado más reciente;
- migra automáticamente las copias creadas con versiones anteriores.

La aplicación consulta cambios remotos al recuperar el foco y periódicamente mientras permanece abierta.

## Tecnología

- HTML, CSS y JavaScript sin dependencias de ejecución externas.
- Cloudflare Pages y Pages Functions.
- Almacenamiento local mediante `localStorage`.
- Persistencia central mediante Cloudflare D1.
- Protección de acceso y validación del JWT de Cloudflare Access mediante Web Crypto.
- Pruebas automáticas con el runner nativo de Node.js.

## Despliegue en Cloudflare Pages

El proyecto publicado usa:

- Production branch: `main`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `.`
- Root directory: dejar vacío

Los cambios de bindings o variables de entorno requieren un deployment nuevo para quedar activos. Los commits nuevos sobre `main` lo generan automáticamente.

## Documentación

- [Configuración de D1 y Cloudflare Access](docs/CLOUDFLARE_SYNC_SETUP.md)
- [Instalación de Planorha en Android, iPhone y computadora](docs/INSTALAR_PLANORHA.md)

## Validación local

```bash
npm run check
npm test
```

## Roadmap

1. [Publicar MVP en Cloudflare Pages](https://github.com/gnaEMV90/organizador-personal/issues/1) — completado.
2. [Sincronización con Cloudflare D1 y acceso privado](https://github.com/gnaEMV90/organizador-personal/issues/2) — completado.
3. [Tareas recurrentes, recordatorios y mejoras](https://github.com/gnaEMV90/organizador-personal/issues/3) — completado.
4. [Cierre PWA para iPhone y Android](https://github.com/gnaEMV90/organizador-personal/issues/4) — implementación completada; validación final en dispositivos.

## Respaldo de datos

D1 es la copia central de la cuenta y cada dispositivo mantiene una copia local para continuar trabajando ante una pérdida temporal de conexión. La opción **Ajustes → Exportar datos** permite generar además un respaldo manual en JSON.
