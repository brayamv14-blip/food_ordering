# V16 — Guía (ampliación sobre V15; el módulo de repartidor se CONSERVA íntegro)

## Qué se añadió
| Módulo | Qué hace | Dónde |
|---|---|---|
| Categorías por tienda | Cada tienda tiene sus categorías; las antiguas (sin `storeId`) quedan **comunes** (visibles para todas, editables solo por superadmin). Un producto solo usa categorías de su tienda o comunes. | admin-api, `app/admin/categories.tsx`, `getCategories(storeId)` |
| Selector de tienda (superadmin) | Filtro por tienda en Dashboard, Categorías y Finanzas. | `components/AdminStoreFilter.tsx` |
| Tienda persistente | La tienda elegida por el cliente se guarda en las preferencias de su cuenta (sin paquetes nuevos). | `lib/services/storePrefs.ts`, `StorePicker` |
| Buscador por tienda | El buscador ya respeta la tienda elegida. | `app/(tabs)/search.tsx` |
| Alta de repartidor | Un cliente pide ser repartidor (`pdriver` = pendiente). Admin de la tienda o superadmin aprueba (`driver` + tienda) o rechaza. Un pendiente no opera ni se conecta. Estados: pendiente / aprobado / suspendido. | `app/driver/apply.tsx`, `app/admin/driver-applications.tsx`, acciones `applyDriver`, `myDriverStatus`, `listDriverApplications`, `reviewDriver` |
| Código de entrega (OTP) | Opcional. El cliente ve 4 dígitos (HMAC por pedido, sin guardarlos); el repartidor debe escribirlos para marcar entregado. 5 fallos → bloqueo; el personal puede cerrar la entrega. | `DELIVERY_OTP`, `DeliveryCodeBadge`, `DeliveryCodeModal` |
| Ganancias del repartidor | Pestaña “Ganancias” (hoy/7/30 días/todo), por día y últimas entregas. | `DriverEarningsPanel`, acción `driverEarnings` |
| Finanzas | Cobrado, comisión de plataforma, ingreso de tienda, ganancia de repartidores, reembolsos; por tienda y repartidor. Comisión global o por tienda (solo superadmin). **Solo calcula; no mueve dinero.** | `app/admin/finance.tsx`, acción `financeReport`, `splitFinance` en `rules.js` |
| Tiempo límite de respuesta | Con `ASSIGNMENT_TIMEOUT_SECONDS>0`, las asignaciones pendientes vencidas se liberan (candado anti-duplicado), se avisa y se reasigna. Se dispara al abrir/refrescar el panel de pedidos del personal. | acción `expireAssignments` |

## Reglas financieras (servidor, nunca el cliente)
neto = subtotal − descuento · comisión = neto × `platformPct`% · tienda = neto − comisión · repartidor = envío × `driverPct`% + propina. Reembolsos escalan todo por la parte no reembolsada. Cálculo en centavos. Sin configurar: comisión 0 %, repartidor 100 % del envío.

## Pasos para desplegar (CMD)
1. `node appwrite-functions/sync-shared.mjs` y `node appwrite-functions/build-2-functions.mjs`
2. `node scripts/appwrite-migrate.mjs` (preview) y luego `node scripts/appwrite-migrate.mjs --apply` → añade `categories.storeId`, `stores.platformPct`, `stores.driverPct`.
3. Subir los dos `.tar.gz` (create-order y update-order-status) y verificar `diag` = v15/v16.
4. Variables opcionales de las Functions (ver `.env.example`).
5. `npx tsc --noEmit`, `npx jest`, `npm run lint`.

## Fuera de alcance (honesto)
No hay retiros ni transferencias automáticas (Stripe Connect no está integrado); chat cliente–repartidor, evidencia fotográfica de entrega, cola de solicitudes simultáneas a varios repartidores, panel de incidencias/soporte con estados, seguimiento en segundo plano nativo y notificaciones de cada transición nueva **no** se implementaron en V16 (ver AUDITORIA-v16.md, sección C).
