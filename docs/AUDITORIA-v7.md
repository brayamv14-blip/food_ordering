# Auditoría v7 (matriz)

Base: v6 (commit local bdd48d2). Estado "probado" = prueba automatizada con servicios simulados (Jest, que **no pudo ejecutarse en el entorno de desarrollo del asistente por falta de acceso a npm**, y smoke test de las Functions, que sí se ejecutó: 154 escenarios OK). Nada se verificó contra Appwrite, Stripe, Firebase o un teléfono reales.

| Característica | Estado real | Archivos | Hallazgo / cambio v7 | Prueba |
|---|---|---|---|---|
| Autenticación, sesión, recuperación | Implementado | `lib/appwrite.ts`, `app/(auth)/*`, `recovery-bridge/` | Sin cambios | `screens.test.tsx`, `auth.test.ts` |
| Roles (staff/driver) | Implementado, validado en servidor por etiquetas de Appwrite | `update-order-status/src/main.js` | Sin cambios; el cliente no envía su rol | `smoke-test` (403 sin permiso) |
| Catálogo/carrito, precios | Implementado; servidor recalcula | `create-order`, `rules.js priceOrder` | Sin cambios | `rules.test.ts`, smoke (precio alterado) |
| Inventario/stock | **Ausente** (solo `available` true/false) | — | Bloqueado: requiere decisión de negocio y columna de stock | — |
| Estados del pedido | v6: 6 estados. **v7: + `ready` (listo para recoger, opcional) y `delivery_failed`** | `rules.js`, `orderStatus.ts`, `update-order-status`, `OrderStatusTimeline`, `driver/index.tsx` | `orders.status` es varchar(255): **no requiere migración**. "Aceptado/rechazado" = confirmar/cancelar (ya existía). "Recogido" no se agregó (equivale a `on_the_way`) | `rules.test.ts`, `orderStatus.test.ts`, smoke |
| Entrega fallida | v7 nuevo: solo el repartidor asignado la registra; borra su ubicación; solo el personal reintenta/cancela (con reembolso si estaba pagado) | idem | — | smoke (varios escenarios) |
| Pagos Stripe | Implementado (v5/v6) | `create-order`, `update-order-status`, `stripe-webhook` | **v7: tope de 5 pedidos en línea sin pagar por usuario (429)** contra abuso de sesiones | smoke, `rules.test.ts` |
| Webhook | Implementado; firma, frescura, idempotencia, importes | `stripe-webhook` | Sin cambios | smoke (10+ escenarios) |
| Reembolsos | Al cancelar pedido pagado (personal) y pago tardío; sin parciales | idem | Sin cambios | smoke |
| Mapas/seguimiento | Implementado (Leaflet/Geoapify), ubicación real del repartidor; **no es GPS continuo en segundo plano** | `LeafletMap`, `tracking/[id].tsx` | Marcador de restaurante opcional (v6) | `geo.test.ts` |
| Abrir en app de mapas | Repartidor: sí (restaurante/cliente). Cliente: no | `driver/index.tsx` | Sin cambios | `panels.test.tsx` |
| Repartidor | Entregas activas, historial, navegación, compartir ubicación (primer plano), **entrega fallida (v7)** | `driver/index.tsx` | Aceptar/rechazar asignación, disponibilidad y asignación automática: **ausentes** (requieren columnas/colección nuevas y decisión de negocio) | `panels.test.tsx`, smoke |
| Ubicación solo del repartidor asignado | Implementado en servidor | `updateLocation` | Sin cambios | smoke |
| Push | Implementado (FCM nativo + Appwrite Messaging); **entrega real no verificada** | `notifications.service.ts`, Functions | v7: avisos de listo/entrega fallida | `commerce.test.ts`, smoke |
| Admin/personal | Pedidos, filtros, estados, asignación, historial de eventos | `app/admin/index.tsx` | **Ausentes**: CRUD de productos/categorías/usuarios, reportes, pagos (usar consola Appwrite / Stripe Dashboard) | — |
| Permisos Appwrite | Dependen de tu consola | — | **v7: `scripts/verify-appwrite.mjs` (solo lectura)** audita funciones desplegadas, variables (solo nombres), columnas, índices y permisos | ejecútalo tú |
| Índices | `idx_status` agregado a la migración (consultas por estado) | `appwrite-migrate.mjs` | Ejecutar migración | `migrate-selftest.mjs` |
| Credenciales | `.env`/`.env.migration` presentes en el ZIP recibido | — | No se copiaron al patch. Las claves se compartieron por chat: **rótalas** | revisión del patch |

## Funciones de Appwrite: código vs desplegadas vs invocadas
| Función | En código | Invocada por la app | Desplegada |
|---|---|---|---|
| create-order | sí | sí (`EXPO_PUBLIC_FN_CREATE_ORDER`) | **no verificable aquí** (la red del entorno bloquea Appwrite) |
| update-order-status | sí | sí (`EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS`) | idem |
| stripe-webhook | sí | no (la llama Stripe) | idem |
| staff-api, update-driver-location | **no** (eliminadas del código en v4) | **no** (el código ya no usa `EXPO_PUBLIC_FN_STAFF_API` / `..._UPDATE_DRIVER_LOCATION`) | tu `.env` aún tiene sus IDs: si siguen desplegadas, bórralas tú desde la consola tras confirmarlo con `verify-appwrite.mjs` |

Ejecuta `node scripts/verify-appwrite.mjs` para saber el estado real de cada una.
