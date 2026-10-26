# Food Ordering — Guía de cierre del proyecto

Esta guía corresponde al estado actual del proyecto Food Ordering. Incluye la aplicación Expo, las funciones de Appwrite, pagos con Stripe, mapas con Geoapify y notificaciones push.

## 1. Requisitos y validaciones locales

Desde la carpeta del proyecto, ejecuta:

```cmd
npm install
npm test -- --runInBand
npx tsc --noEmit
git diff --check
npx expo config --type public
```

Antes de integrar los cambios, verifica que las pruebas y TypeScript terminen sin errores. Las advertencias de finales de línea LF/CRLF de Windows deben revisarse por separado si aparecen.

## 2. Variables de entorno

Copia `.env.example` a `.env.local` y completa los valores necesarios para el entorno local.

Las variables `EXPO_PUBLIC_*` pueden quedar incluidas en la aplicación. No coloques ahí claves secretas.

- Appwrite: endpoint, ID del proyecto e IDs de las funciones.
- Mapas: `EXPO_PUBLIC_GEOAPIFY_API_KEY`.
- Pagos: `EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT`.
- Notificaciones: `EXPO_PUBLIC_APPWRITE_PUSH_PROVIDER_ID`.

Configura `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` exclusivamente en las variables de entorno de la función de Appwrite correspondiente. Nunca subas credenciales reales al repositorio.

Consulta `docs/APPWRITE.md`, `docs/STRIPE.md`, `docs/MAPAS.md` y `docs/NOTIFICACIONES.md`.

## 3. Funciones y servicios externos

Antes de publicar, revisa y configura las funciones actuales:

- `create-order`
- `update-order-status`
- `stripe-webhook`

Verifica en Appwrite los permisos, las variables de entorno, los IDs de las funciones y la configuración de las tablas. Configura Stripe Checkout y su webhook según `docs/STRIPE.md`.

Para mapas y direcciones, configura Geoapify según `docs/MAPAS.md`. Para notificaciones push de Android, sigue `docs/NOTIFICACIONES.md`.

No elimines funciones antiguas de un proyecto desplegado sin comprobar primero que ninguna versión publicada de la aplicación dependa de ellas.

## 4. Migración de Appwrite

Consulta `docs/APPWRITE.md` y revisa `scripts/appwrite-migrate.mjs` antes de ejecutar una migración.

Realiza primero una vista previa. Haz una copia de seguridad cuando corresponda y utiliza la opción de aplicación únicamente después de confirmar el proyecto, las tablas y los cambios previstos. No ejecutes un rollback sin revisar qué datos y estructuras eliminará.

## 5. Pruebas manuales pendientes

Las pruebas automatizadas locales no sustituyen las pruebas contra los servicios reales. Antes de dar por terminada la aplicación, comprueba:

1. Registro, inicio y cierre de sesión.
2. Recuperación de contraseña mediante correo.
3. Creación de pedidos y consulta en «Mis pedidos».
4. Permisos de usuario: intentar consultar un pedido de otra cuenta.
5. Gestión de pedidos por personal y repartidores.
6. Direcciones, permisos de ubicación, mapa y geocodificación en un dispositivo.
7. Pago de prueba con Stripe y actualización del pedido mediante un webhook válido.
8. Rechazo de firmas inválidas del webhook y protección contra eventos duplicados.
9. Recepción de notificaciones push en un dispositivo Android de prueba.
10. Generación e instalación de un build de prueba.

## 6. Git y entrega

Antes del commit:

```cmd
git status --short
git diff --check
npm test -- --runInBand
npx tsc --noEmit
```

Revisa los archivos modificados y nuevos. No agregues `.env`, `.env.local`, `.env.migration`, `google-services.json` ni otros archivos con credenciales.

Cuando la revisión esté completa, agrega únicamente los archivos del proyecto que deban versionarse, crea un commit descriptivo y después revisa el resultado antes de subir la rama.

## 7. Estado de verificación

En la última validación comunicada se aprobaron 269 pruebas en 23 suites, `npx tsc --noEmit` terminó sin errores y `git diff --check` solo mostró advertencias de finales de línea.

Esto no confirma todavía el funcionamiento de los servicios reales, la instalación del APK, los pagos reales o de prueba en un dispositivo, las notificaciones push ni los permisos desplegados en Appwrite. Esas comprobaciones deben completarse antes de considerar el proyecto listo para producción.