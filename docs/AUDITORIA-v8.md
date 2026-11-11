# Auditoría v7 y v8, matriz, pruebas y bloqueos

> **Veredicto:** apta para una fase de **pruebas de aceptación**; **no** declarada lista para producción (ver §6). Pagos, push, Appwrite real, GPS y flujos entre roles **no se han verificado fuera de dobles en memoria**.

## 1. Auditoría de v7 (base)
- `food-ordering-v7.patch` se aplica limpio sobre v6 (`git apply --check` y `diff -r` contra el árbol objetivo) — verificado.
- Hallazgos de v7 corregidos en v8:
  1. **Bug:** el botón “Reintentar entrega” del repartidor era rechazado por el servidor (403). Ahora el repartidor asignado puede `delivery_failed → on_the_way`.
  2. **Fuga de inventario/pedidos zombis:** `checkout.session.expired` solo dejaba constancia; un pedido en línea abandonado quedaba `pending` para siempre. Ahora se cancela y libera su stock.
  3. `rolesFromLabels` ignoraba `admin`; el panel de personal no admitía administradores.
  4. “Recogido” y “en camino” estaban fusionados; ahora son estados distintos.
  5. Sin control de inventario, sin CRUD de productos, sin reportes/pagos en la app (cubierto en v8).
- Dependencias: sin librerías nuevas en la app ni en las Functions (`node:crypto` incluido en Node).

## 2. Cambios de v8 (resumen)
| Área | Cambio |
|---|---|
| Inventario | `menu.stock`, reserva atómica al crear pedido, liberación al cancelar/vencer, historial idempotente, alertas |
| Repartidor | disponibilidad (prefs de Auth), aceptar/rechazar, `picked_up`, reintento, autoasignación opcional, no reasignar en tránsito, no duplicar asignación |
| Admin | función `admin-api`: productos, stock, usuarios/roles, pagos, reportes + CSV; 3 pantallas |
| Pagos | sesión vencida → cancelar + liberar; conciliación pedido/pago/stock/notificaciones |
| Push | picked_up, rechazo del repartidor (a personal), existencias bajas |
| Seguimiento | ubicación **actualizada / antigua (> 2 min) / no disponible** |
| Android | `versionCode: 1` en app.json |

## 3. Archivos
**Creados:** `appwrite-functions/admin-api/{package.json,src/main.js,src/rules.js}`, `lib/services/admin.service.ts`, `app/admin/{products,reports,users}.tsx`, `__tests__/backend/v8.test.ts`, `__tests__/services/admin.service.test.ts`, `docs/{ADMIN,AUDITORIA-v8}.md`.
**Modificados:** `appwrite-functions/shared/rules.js` (+copias ESM), `create-order`, `update-order-status`, `stripe-webhook` (`main.js`), `smoke-test/{run.sh,run.mjs,fake-node-appwrite/index.js}`, `sync-shared.sh`, `scripts/{appwrite-migrate,migrate-selftest,verify-appwrite}.mjs`, `lib/{appwrite.ts,domain/orderStatus.ts,domain/coordinates.ts,services/roles.ts,services/staff.service.ts}`, `app/driver/index.tsx`, `app/order/tracking/[id].tsx`, `app/(tabs)/profile.tsx`, `app.json`, `.env.example`, pruebas existentes (`orderStatus`, `order`, `staff.service`, `panels`, `rules`), `docs/{APPWRITE,STRIPE,NOTIFICACIONES,INVENTARIO}.md`, `PATCH-LEEME.md`.
**Eliminados:** ninguno.

## 4. Matriz
| Módulo | Estado | Evidencia |
|---|---|---|
| Autenticación / sesión | Completo (v6) | Jest (no ejecutado aquí) |
| Pedidos idempotentes, precios del servidor | Completo | smoke ✔ |
| Inventario: reserva/libera/idempotencia | **Completo en código** | smoke ✔ + arnés ✔; **atomicidad real: no verificada en Appwrite** |
| Alertas de existencias bajas | Completo | smoke ✔ (push real no verificado) |
| Stripe (sesión, webhook, reembolso, vencida, tardío) | Completo en código | doble de Stripe ✔; **sin prueba real** |
| Push por eventos | Completo en código | doble de Messaging ✔; **sin entrega real** |
| Ciclo del repartidor | Completo | smoke ✔ + Jest (no ejecutado) |
| Ubicación y navegación | Parcial (solo primer plano) | Jest; **sin prueba en dispositivo** |
| Admin: productos/stock | Completo | smoke ✔ |
| Admin: usuarios/roles | Completo | smoke ✔ |
| Admin: pagos/reportes/CSV | Completo (máx. 2,000 pedidos) | smoke ✔ |
| Cierres de caja | **Pendiente** (sin modelo) | — |
| Variantes con stock | **Pendiente** | — |
| Rate limiting | **Pendiente** (parcial: tope de 5 pedidos sin pagar, 1 envío de ubicación/intervalo) | — |
| Ubicación en segundo plano | **Pendiente / documentado** (§7) | — |

## 5. Pruebas y resultados reales
**Ejecutadas y aprobadas (entorno sin npm ni Appwrite):**
- `bash appwrite-functions/smoke-test/run.sh` → **237 OK, 0 fallas** (4 funciones sobre un doble en memoria de `node-appwrite` y de la API de Stripe; incluye autorización, pedidos duplicados, precios manipulados, stock insuficiente y compras simultáneas, transiciones inválidas, webhook repetido, pago pendiente/fallido/vencido, reembolso + devolución de stock, asignaciones, entrega fallida, push y fallo de Messaging, errores de Appwrite al crear/devolver).
- `__tests__/backend/v8.test.ts` con un **arnés mínimo compatible con `describe/it/expect`** (no es Jest) → **27 pasan, 0 fallan**.
- `node --check` de todas las funciones y scripts → sin errores. `node scripts/migrate-selftest.mjs` (con un doble de `node-appwrite`) → plan v8 correcto, idempotente, rollback limpio.
- Revisión de sintaxis TypeScript de los archivos nuevos/editados con `tsc` global (solo errores sintácticos; **no** equivale a `tsc --noEmit` del proyecto).

**Ejecutadas y fallidas:** ninguna en esta ronda (las fallas intermedias del smoke —pruebas viejas que asumían el flujo previo— se corrigieron).

**No se pudieron ejecutar (el proxy bloquea el registro de npm y Appwrite/Stripe/Firebase):**
`npm test` (Jest completo y las pruebas `.tsx`), `npx tsc --noEmit`, `npx expo config --type public`, `npx expo-doctor`, `git diff --check` sobre tu repositorio (se revisó contra el parche), pruebas con Appwrite real, Stripe modo prueba, FCM y dispositivo Android. **Ejecútalos tú** (§8) y corrige lo que reporten; no se asume que pasen.

## 6. Bloqueos para producción
1. `npm test`, `tsc`, `expo-doctor` sin ejecutar.
2. Atomicidad del descuento (`decrementRowColumn` con `min`) y versión de `node-appwrite` en el runtime **sin verificar** contra Appwrite real.
3. Stripe: prueba real en modo prueba + webhook registrado + `PAYMENT_RETURN_URL` https; luego revisión para modo real.
4. Push: Firebase + service account en el proveedor + build de desarrollo + permiso en teléfono.
5. Permisos de tablas: quitar Create/Update/Delete a *Users* en `orders`/`order_items` y activar seguridad por fila (ver `APPWRITE.md`); tabla `menu` con lectura para usuarios.
6. **Rotar las claves que se pegaron en el chat** (Stripe sk/pk de prueba, API key de Appwrite, Geoapify). Usa una API key de Appwrite con scopes mínimos.
7. Sin límites de solicitudes por usuario en las Functions; sin cierres de caja; ubicación solo en primer plano.
8. Sentry: `Sentry.init` con DSN en código y replays; revisar privacidad antes de publicar.
9. Política de privacidad y ficha de Play Store (ubicación, notificaciones, pagos).

## 7. Ubicación en segundo plano (no implementada; requisitos)
Necesita: `expo-location` + `expo-task-manager`, `ACCESS_BACKGROUND_LOCATION` (Android 10+), servicio en primer plano con notificación persistente (Android 14: tipo `location`), `locationAlwaysAndWhenInUsePermission` en el plugin, declaración y vídeo de justificación en Play Console, build nativo (no Expo Go) y pruebas en dispositivos físicos de varias marcas (ahorro de batería puede matar el servicio). Hoy la app **solo** envía ubicación con la pantalla abierta y se detiene al pasar a segundo plano; así está documentado en pantalla.

## 8. Comandos de verificación (en tu PC)
```powershell
npm install
npm test
npx tsc --noEmit
npx expo config --type public
npx expo-doctor
git diff --check
bash appwrite-functions/smoke-test/run.sh   # o: cd appwrite-functions && bash sync-shared.sh
node scripts/appwrite-migrate.mjs            # VISTA PREVIA (no cambia nada)
node scripts/appwrite-migrate.mjs --apply    # solo tras revisar la vista previa
node scripts/verify-appwrite.mjs             # solo lectura
```
(Las variables `APPWRITE_ENDPOINT/PROJECT_ID/API_KEY` van en tu terminal, no en archivos versionados.)

## 9. Pruebas de aceptación en Android (manuales)
1. Registro/inicio de sesión; cerrar y reabrir la app mantiene la sesión.
2. Admin: crear producto con stock 3 → aparece en el menú; desactivarlo → desaparece de pedidos.
3. Comprar 2 (stock → 1); otro usuario compra 2 → mensaje de stock insuficiente.
4. Cancelar el pedido → stock vuelve a 3 (revisar `inventory_movements`).
5. Pago en línea con tarjeta de prueba `4242 4242 4242 4242`; webhook marca pagado; cancelar como personal → reembolso + stock devuelto.
6. Abandonar un pago (sesión vence ≥ 30 min) → pedido cancelado y stock devuelto.
7. Personal asigna repartidor → llega push; repartidor rechaza → personal recibe push; otro acepta.
8. Repartidor: recogido → en camino (compartir ubicación) → cliente ve mapa con “Ubicación actualizada”; apagar la app del repartidor 3 min → “Ubicación antigua”.
9. Entrega fallida → reintentar → entregado.
10. Usuario sin rol abre `/admin/products` → “sin acceso”; rol `staff` no ve “Usuarios y roles”.
11. Modo avión al pedir/ajustar stock: errores claros, sin duplicados al reintentar.
12. Reporte de “Hoy”: ventas = suma de entregados; exportar CSV.

## 10. Compilación y distribución
- Android: `package=com.jsm.foodordering`, `versionCode` 1 (súbelo en cada publicación). Permisos: ubicación (plugin, solo primer plano), `POST_NOTIFICATIONS`; cámara/micrófono bloqueados.
- `google-services.json` (Firebase) debe estar en la raíz o como archivo secreto de EAS (no se incluye en el ZIP).
- Desarrollo/pruebas internas: `eas build -p android --profile development` o `preview` (APK) — requiere cuenta de Expo y sesión (`eas login`).
- Producción: `eas build -p android --profile production` (AAB) + cuenta de Google Play Console (pago único), firma gestionada por EAS o tu keystore, ficha, política de privacidad y pruebas cerradas.
- Revisa íconos: `icon.png`, `adaptive-icon.png` y `splash-icon.png` miden 1024×1024, pero `adaptive-icon.png` y `splash-icon.png` pesan **exactamente lo mismo** (probable duplicado): confirma el diseño final.

## 11. Aplicar el patch en Windows
```powershell
cd C:\ruta\a\food_ordering
git status                          # árbol limpio; si hay cambios, haz commit o stash primero
git checkout -b v8-cierre
git apply --check ..\food-ordering-v8.patch
git apply --whitespace=nowarn ..\food-ordering-v8.patch
git status
```
**v8 es acumulativo contra v6: aplica v8 en lugar de v7** (si ya aplicaste v7, vuelve a v6 con `git stash`/rama limpia antes). No hace commits ni despliega nada. Después: `bash appwrite-functions/sync-shared.sh` (Git Bash/WSL), migración (vista previa → `--apply`), crear `admin-api`, variables, desplegar.
