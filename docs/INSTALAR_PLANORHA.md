# Instalar Planorha como aplicación

Planorha es una PWA. Puede agregarse a la pantalla de inicio y abrirse sin la interfaz habitual del navegador.

## Android

1. Abrir `https://planorha.pages.dev` con Chrome.
2. Iniciar sesión con el correo autorizado.
3. Abrir el menú de Chrome.
4. Elegir **Instalar aplicación** o **Agregar a pantalla principal**.
5. Confirmar la instalación.

También puede aparecer el botón **Instalar app** dentro de Planorha cuando el navegador lo habilita.

## iPhone y iPad

1. Abrir `https://planorha.pages.dev` con Safari.
2. Iniciar sesión con el correo autorizado.
3. Tocar **Compartir**.
4. Elegir **Agregar a pantalla de inicio**.
5. Confirmar con **Agregar**.

Las notificaciones web en iPhone requieren abrir Planorha desde el ícono instalado y conceder el permiso desde **Ajustes → Notificaciones** dentro de la aplicación.

## Computadora

En Chrome o Edge:

1. Abrir Planorha.
2. Usar el ícono de instalación de la barra de direcciones o el botón **Instalar app**.
3. Confirmar.

## Funcionamiento sin conexión

Después de una primera carga completa, las pantallas y datos locales continúan disponibles temporalmente sin internet. Los cambios quedan guardados en el dispositivo y se envían a D1 cuando vuelve la conexión.

El indicador de sincronización permite distinguir:

- **Sincronizado**: los datos llegaron a D1.
- **Sincronizando**: hay cambios en proceso.
- **Sin conexión**: los cambios permanecen guardados localmente.
- **Error de sincronización**: la operación no pudo completarse.

## Recordatorios

Cada tarea puede avisar:

- a la hora indicada;
- entre 5 minutos y 1 día antes.

La aplicación revisa los recordatorios mientras está abierta y al volver a primer plano. Una notificación programada con la aplicación completamente cerrada requiere un servicio de push y planificación en el backend, capacidad que queda fuera de esta versión.

## Actualizaciones

Planorha busca una versión nueva de sus archivos al abrirse. Cuando se publica una actualización puede ser necesario cerrar y volver a abrir la aplicación instalada una vez.
