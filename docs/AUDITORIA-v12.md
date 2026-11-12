# V12 — Cierre técnico, seguridad y preparación para producción

**Veredicto: NO está listo para producción ni se declara terminado.** Se auditó el código, se corrigieron los hallazgos que se pueden resolver en código/configuración y se enumeran con exactitud los pendientes que exigen tu entorno real. El entorno donde trabajo **no tiene acceso a npm** (verificado de nuevo): `tsc`, Jest, `expo-doctor` y `expo config` **NO EJECUTADOS**; no hay Android, Stripe, Firebase ni Appwrite reales.

## 1. Hallazgos y correcciones

| # | Hallazgo | Gravedad | Acción |
|---|---|---|---|
| 1 | `appwrite.config.json` daba permisos `any` de lectura/escritura en `orders`, `order_items`, `users` y de escritura en `menu`, `categories`, `customizations`, `menu_customizations`; el bucket permitía subir a `any`. Un `appwrite push` habría expuesto correos, teléfonos, direcciones y permitido alterar pedidos/precios. | **Crítica** | Corregido en el archivo: catálogo solo `read("any")`; `orders`/`order_items` sin permisos de tabla y `rowSecurity:true`; `users` con `create("users")` + `rowSecurity:true`; bucket `create("users")` + `read("any")`. |
| 2 | Perfil de usuario creado sin permisos por fila. | Alta | `lib/appwrite.ts` ahora crea el perfil con `read/update/delete` solo del dueño (`ownerPermissions`). |
| 3 | Filas antiguas sin permisos por fila quedarían inaccesibles al cambiar la tabla. | Alta | Nuevo `scripts/backfill-row-permissions.mjs` (simulación por defecto, `--apply` para escribir, idempotente). |
| 4 | Si faltaba `EXPO_PUBLIC_FN_CREATE_ORDER` en un build de producción, la app degradaba a **escritura directa** con precios del cliente. | Alta | `orders.service.ts`: en producción (`!__DEV__`) falla con `backend_missing`. En desarrollo sigue el modo directo. |
| 5 | `verify-appwrite.mjs` solo revisaba `orders`/`users` superficialmente. | Media | Ahora marca CRÍTICO lectura/escritura abierta en `orders`, `order_items`, `users`, escritura abierta en catálogo y falta de `rowSecurity`. |
| 6 | Logs de funciones. | — | Revisados: solo ids y códigos, sin nombres/teléfonos/direcciones/claves. Sin cambios. |
| 7 | Claves privadas en la app. | — | Solo `EXPO_PUBLIC_*` públicos (endpoint, project, ids, `pk` de Stripe si se usa, Geoapify). `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` solo viven en variables de las Functions. Geoapify es una clave de cliente: **restríngela por dominio/app en su panel**. |

## 2. Verificado por revisión de código y simulación (no real)
Precios/totales/estado/método de pago los fija el servidor; el cliente solo envía ítems, `clientRequestId` y método. Pedido duplicado por reconexión: índice único `uniq_clientRequestId` + respuesta `duplicate`. Stock: descuento único con `stockReserved`, devolución única al cancelar. Webhook: firma + idempotencia por evento; un pedido solo pasa a `paid` desde el webhook firmado (no existe “marcar pagado”). Reembolsos: centavos, nunca más de lo pagado, llave idempotente en Stripe. Repartidor: ve solo su cola; el pool no expone datos personales; máximo de activos; no se entrega sin salir; ubicación solo del propio pedido. 414 escenarios en simulación en memoria, 0 fallas. **Esto no prueba comportamiento real.**

## 3. Ubicaciones: retención y acceso
Solo se guarda **la última posición** en la fila del pedido (`driverLatitude/Longitude/UpdatedAt`); se **borra al entregar, cancelar, rechazar o reasignar**. No hay historial (no existe tabla). Pueden verla: el cliente dueño del pedido, el personal/admin y el repartidor asignado. Si se quiere historial, hace falta tabla, plazo (sugerido ≤30 días) y aviso de privacidad: no implementado.

## 4. Evidencia fotográfica de entrega — NO implementada
Es viable (bucket `delivery-proofs`, subida por el repartidor con `expo-image-picker`/cámara, función `attachProof` que valida pedido/estado/archivo y fija permisos de lectura para cliente y personal; columna `orders.proofFileId`). No se implementó porque requiere un bucket y permisos nuevos, permiso de cámara y verificación en dispositivo real, y tú pediste no agregar pantallas sin poder probarlas. Pendiente decidir.

## 5. Mapas, GPS y notificaciones
Sin cambios de código en V12. Siguen **sin probarse en real**: precisión GPS en Android, permisos aceptados/rechazados/revocados, rutas/ETA, consumo de batería, FCM con app abierta/cerrada/segundo plano, tokens vencidos, duplicados. Limitaciones con la app cerrada: no hay envío de ubicación (solo primer plano; ver `UBICACION-SEGUNDO-PLANO.md`); el cliente ve “ubicación desactualizada”. Notificaciones: se envían desde Appwrite Messaging por usuario destinatario (objetivo del dueño/repartidor/personal); su entrega real depende de FCM y no se verificó.

## 6. Recuperación y mantenimiento
- **Respaldos:** Appwrite Cloud (plan gratuito) no garantiza respaldos restaurables por ti. Antes de cualquier cambio masivo exporta tablas (`orders`, `order_items`, `users`, `menu`) con un script de lectura o desde la consola y guarda el `appwrite.config.json`.
- **Función falla a mitad de operación:** `create-order` compensa (borra pedido e ítems o lo cancela); el candado de reclamo se elimina si la escritura falla; los webhooks son reintentables e idempotentes. Casos no cubiertos: caída entre cobro de Stripe y escritura → reconciliar con el panel de pagos y el evento reintentado de Stripe.
- **Actualizar Functions sin perder datos:** las Functions no guardan estado propio; todo está en TablesDB. Despliega una versión nueva, ejecuta `verify-appwrite.mjs`, prueba un pedido de efectivo y uno en línea (modo test). Para volver atrás, redespliega el despliegue anterior desde la consola (Appwrite conserva versiones).
- **Límites del plan gratuito:** 5 Functions (se usan 2), tiempo de ejecución limitado por función y cuotas mensuales de ejecuciones, almacenamiento y ancho de banda: **no verificados contra tu cuenta**; revísalos en Console → Usage.
- **Orden de despliegue seguro de permisos:** ver `DEPLOYMENT-v12.md`.

## 7. Matriz V12 (S = simulada, A = automatizada en Jest, R = real)
Leyenda de estado: **OK** ejecutado y pasó · **NO EJECUTADA** (motivo).

| Área | S (simulación/revisión) | A (Jest/tsc/doctor) | R (real) |
|---|---|---|---|
| Cliente (pedido, pago, recepción) | OK | NO EJECUTADA (sin npm) | NO EJECUTADA |
| Administrador | OK | NO EJECUTADA | NO EJECUTADA |
| Repartidor | OK | NO EJECUTADA | NO EJECUTADA |
| Appwrite (permisos, funciones) | OK (config revisada estáticamente) | — | NO EJECUTADA: correr `verify-appwrite.mjs` |
| Stripe (cobro, webhook, reembolsos total/parcial) | OK (Stripe simulado) | — | NO EJECUTADA |
| Firebase / FCM | NO EJECUTADA | — | NO EJECUTADA |
| GPS y mapas | NO EJECUTADA | — | NO EJECUTADA |
| Inventario | OK | NO EJECUTADA | NO EJECUTADA |
| Cancelaciones | OK | NO EJECUTADA | NO EJECUTADA |
| Reembolsos | OK | NO EJECUTADA | NO EJECUTADA |
| Conexión/desconexión de internet | OK (reintentos, duplicados) | NO EJECUTADA | NO EJECUTADA |
| APK/AAB de producción | — | — | NO EJECUTADA (`eas build`) |

Nota: `tsc`, Jest, `expo-doctor`, `expo config` no pudieron correrse. Un ejecutor mínimo propio corrió las pruebas puras de reglas (`v11.test.ts`: 8/8); **no equivale a Jest**.

## 8. Condiciones para declarar terminado — estado exacto
| Condición | Estado |
|---|---|
| TypeScript sin errores | **PENDIENTE** (`npx tsc --noEmit` en tu PC) |
| Jest ejecutado y aprobado | **PENDIENTE** (`npx jest`) |
| Expo Doctor / Expo config | **PENDIENTE** |
| Functions desplegadas y verificadas | **PENDIENTE** (despliegue manual + `verify-appwrite.mjs`) |
| Stripe de principio a fin (test) | **PENDIENTE** |
| Notificaciones reales | **PENDIENTE** |
| Pruebas en Android físico | **PENDIENTE** |
| Migración y backfill de permisos | **PENDIENTE** (tú, con respaldo) |
| Evidencia fotográfica, ubicación en segundo plano, rate limiting, historial de ubicaciones | **NO IMPLEMENTADOS** |
| Rotar claves expuestas (Stripe, Appwrite, Geoapify) | **PENDIENTE (urgente)** |
| ZIP limpio sin secretos | Hecho (escaneo sin hallazgos) |
