# Food Ordering / Delivery — patch v4 (app completa: Sprints 2 y 3 + Unidad II)

## 1. Aplicar el patch (Windows PowerShell)
Usa **`food-ordering-v4-completo.patch`**: está hecho contra el código de tu ZIP actual (`Food-Ordering-codigo.zip`, estado v3 con tus cambios), así que aplica directo sobre tu proyecto.

```powershell
cd C:\Users\braya\Documents\food_ordering
git status                                   # debe estar limpio
git checkout -b sprint-3-cierre              # rama de trabajo (nada se hace commit por ti)
$p = "$env:USERPROFILE\Downloads\food-ordering-v4-completo.patch"
git apply --check $p                         # prueba en seco: sin salida = OK
git apply $p
npm install                                  # OBLIGATORIO: agrega expo-notifications y regenera package-lock.json
npm test ; npx tsc --noEmit
```
- Si se queja de saltos de línea: `git apply --ignore-whitespace $p`. Si modificaste archivos que el patch toca: `git apply --3way $p` (o `--reject` y revisa los `.rej`).
- `package-lock.json` **no** viene en el patch: `npm install` lo actualiza solo (usa `npm install`, no `npm ci`, la primera vez).
- El patch elimina `appwrite-functions/staff-api`, `appwrite-functions/update-driver-location` y los archivos `.bak` (ya no se usan).
- Los `.sh` se guardan con saltos de línea LF (`.gitattributes`); si Git Bash falla con `pipefail: invalid option name`, ejecuta `dos2unix` sobre el script.
- **Revertir:** `git apply -R $p` (o `git checkout .` y borra los archivos nuevos), luego `npm install`.

## 2. Qué cambia (resumen)
**Pago en línea** con Mercado Pago (modo prueba; el servidor cobra y VERIFICA el pago) · **notificaciones push** (opt-in en Perfil; aviso al cliente por estado y al repartidor al asignarle) · **Pedir de nuevo** (precios actuales) · permisos de cámara/micrófono bloqueados · Recuperación de contraseña (`/forgot-password`, `/reset-password`, `recovery-bridge/`) · solo **2 Functions** (`create-order`, `update-order-status` con campo `action`: estado, ubicación, panel staff/repartidor, historial) · panel de administración con filtros por estado y fecha, búsqueda por ID, historial y control de conflictos · disponibilidad de productos · carrito validado (precio ≥ 0, máx. 50 por línea) · sesión robusta (perfil autorreparable; el registro ya inicia sesión) · precisión/GPS apagado en repartidor · errores de Directions (clave/cuota) · Sentry sin PII · textos de acceso en español.

## 3. Cambios en Appwrite (en este orden; **nada lo hace el patch**)
1. **Esquema** (script, no ejecutado por mí): `npm i --no-save node-appwrite@22.1.1`, define `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (clave de servidor; nunca en la app) y:
   ```powershell
   node scripts/appwrite-migrate.mjs            # vista previa, no cambia nada
   node scripts/appwrite-migrate.mjs --apply    # aplica (idempotente)
   node scripts/appwrite-migrate.mjs --rollback --apply   # revierte (BORRA esas columnas y la tabla order_events)
   ```
   Crea: columnas nuevas en `orders` (incl. `paymentStatus`, `paymentId`, `paymentUrl`) y `users` (incl. `pushToken`), `menu.available`, tabla `order_events` (sin permisos de cliente), índices (`uniq_clientRequestId`, `uniq_accountId`…). Si hay perfiles duplicados con el mismo `accountId`, límpialos antes. Appwrite Cloud no expone SQL: no hay migración SQL posible; el script usa la API.
   Confirma a mano que `orders.status` acepta `pending, confirmed, preparing, on_the_way, delivered, cancelled`.
2. **Dos Functions** (carpeta `appwrite-functions/`; Node, entrypoint `src/main.js`, build `npm install`; *Execute access: Users*). Antes: `bash appwrite-functions/sync-shared.sh`.
   - `create-order`: `DATABASE_ID, ORDERS_TABLE_ID, ORDER_ITEMS_TABLE_ID, MENU_TABLE_ID, CUSTOMIZATIONS_TABLE_ID, MENU_CUSTOMIZATIONS_TABLE_ID`, opcionales `ORDER_EVENTS_TABLE_ID, DELIVERY_FEE, DISCOUNT`; para pago en línea `MP_ACCESS_TOKEN` (credencial de **prueba** de Mercado Pago) y `PAYMENT_RETURN_URL` (https de `recovery-bridge/payment-return.html`).
   - `update-order-status`: `DATABASE_ID, ORDERS_TABLE_ID, ORDER_ITEMS_TABLE_ID`, opcionales `ORDER_EVENTS_TABLE_ID`, `USERS_TABLE_ID` (necesario para enviar notificaciones), `EXPO_ACCESS_TOKEN`; para verificar pagos `MP_ACCESS_TOKEN`.
   - Las credenciales de Mercado Pago **solo** van en las variables de las Functions, nunca en la app ni en el repositorio.
   - Scopes de la API key dinámica: filas (leer/escribir) y usuarios (leer); verifica los nombres en tu consola.
   - Si desplegaste antes las funciones `staff-api` / `update-driver-location` de versiones anteriores, **elimínalas**: ya no existen.
3. **Etiquetas** (Auth → usuario → Labels): `staff` (administradores) y `driver` (repartidores).
4. **Recuperación de contraseña:** publica `recovery-bridge/index.html` en una URL https (p. ej. GitHub Pages), agrega su hostname en Appwrite → Overview → Platforms → Web, y pon esa URL en `EXPO_PUBLIC_RECOVERY_URL`. En Appwrite revisa que el correo (SMTP) esté habilitado.
5. **Notificaciones push (Android):** `npx eas-cli init` (agrega el `projectId` a `app.json`), configura las credenciales FCM en EAS y prueba con una compilación de desarrollo o el APK (no funcionan en Expo Go para Android).
5b. **Bucket de imágenes:** permitir crear archivos a usuarios autenticados (las fotos se suben con lectura pública del archivo).
6. **Permisos de tablas — solo al final y con tu autorización:** primero prueba el flujo completo (sección 5). Cuando funcione, quita Create/Update/Delete a *Users* en `orders` y `order_items` y activa seguridad por fila. Si algo falla, restaura esos permisos. Mientras sigan abiertos, **los pedidos no están protegidos**.

## 4. Variables de entorno (`.env.local`, copia de `.env.example`; solo nombres/ejemplos)
`EXPO_PUBLIC_APPWRITE_ENDPOINT`, `EXPO_PUBLIC_APPWRITE_PROJECT_ID` · `EXPO_PUBLIC_FN_CREATE_ORDER`, `EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS` (IDs de las 2 Functions; sin ellos la app escribe directo = solo desarrollo) · `EXPO_PUBLIC_RECOVERY_URL` · `EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT` (`true` para ofrecer el pago en línea) · `EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY` (opcional; sin ella no se dibuja ruta; restríngela a Directions API) · `GOOGLE_MAPS_ANDROID_API_KEY` (Maps SDK for Android, se lee al compilar; restringe por paquete `com.jsm.foodordering` + SHA-1).

## 5. Ejecutar y probar
```powershell
npm test                                    # 239 pruebas con servicios simulados
npx tsc --noEmit
bash appwrite-functions/smoke-test/run.sh   # 90 escenarios de las 2 Functions con doble en memoria (Git Bash/WSL)
npx expo start                              # desarrollo
npx eas-cli build --platform android --profile preview     # APK de prueba
```
Prueba manual mínima (Appwrite real + teléfono): (1) registro → entra a Inicio sin pasar por iniciar sesión; (2) cerrar sesión y volver a entrar; (3) “¿Olvidaste tu contraseña?” → llega el correo → enlace → nueva contraseña → iniciar sesión; (4) pedido con dirección → aparece en *Mis pedidos*; (5) cuenta `staff` → Perfil → *Administrar pedidos*: asignar repartidor, avanzar estados, buscar por ID, ver *Historial*; (6) cuenta `driver` → *Mis entregas* → *Compartir ubicación* → el cliente ve el marcador (y la ruta si hay clave de Directions); (7) producto con `available=false` → “No disponible”; (8) con la segunda cuenta intentar abrir un pedido ajeno → denegado; (9) activar “Pago en línea”, pagar con una cuenta de prueba de Mercado Pago y verificar que el pedido pasa a “Pagado en línea” y solo entonces el personal puede confirmarlo; (10) Perfil → activar notificaciones, cambiar el estado desde el panel y ver llegar el aviso; (11) “Pedir de nuevo” desde Mis pedidos.

## 6. Control de versiones para la evidencia (tú ejecutas; no hice commits)
`.\scripts\evidencias-git.ps1` genera `evidencias-git.txt` (ramas, historial gráfico, merges, etiquetas) **solo leyendo** el repositorio, para capturarlo.
```powershell
git checkout -b feature/recuperacion-contrasena     # una rama por funcionalidad
git add <archivos> ; git commit -m "feat(auth): recuperación de contraseña"
git push -u origin feature/recuperacion-contrasena  # abre un Pull Request y fusiónalo a main
git tag -a sprint-2 <commit-de-cierre-S2> -m "Cierre Sprint 2"
git tag -a sprint-3 -m "Cierre Sprint 3" ; git push origin --tags
```
Captura: ramas, historial de commits, Pull Requests fusionados y las etiquetas/releases `sprint-2` y `sprint-3` en GitHub/GitLab.

## 7. Lo que NO está verificado
Appwrite real (Functions desplegadas, permisos, migración, realtime, correo de recuperación) · mapa/GPS/ruta en dispositivo · APK (sin Android SDK aquí) · `expo-doctor` completo (sin red: 18/21; además un `expo-file-system` duplicado que ya existía) · instalación en Windows (probado en Linux). Pago en línea y push: probados solo con servicios simulados (nunca se cobró ni se envió un aviso real). Límites: GPS solo en primer plano; no hay reembolsos en la app (el cliente no puede cancelar solo un pedido ya pagado); el correo no se edita desde la app.
