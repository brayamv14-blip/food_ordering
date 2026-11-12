# Appwrite: esquema, Functions y permisos

## Esquema
`node scripts/appwrite-migrate.mjs` (vista previa) y `--apply`. Crea/asegura columnas de `orders` incluyendo `paymentStatus` (not_required|pending|paid|failed|cancelled|refunded), `paymentId` (PaymentIntent `pi_...`) y `stripeSessionId` (128). La URL de pago no se guarda. La columna `users.pushToken` de versiones anteriores ya **no se usa** (los destinos push viven en Auth → Targets); puedes borrarla con calma.

## Functions (Node 22, entrypoint `src/main.js`, build `npm install`)
Antes de desplegar: `bash appwrite-functions/sync-shared.sh` (copia `shared/rules.js` a cada función).
| Función | Execute access | Variables |
|---|---|---|
| `create-order` | Users | `DATABASE_ID, ORDERS_TABLE_ID, ORDER_ITEMS_TABLE_ID, MENU_TABLE_ID, CUSTOMIZATIONS_TABLE_ID, MENU_CUSTOMIZATIONS_TABLE_ID`, opc. `ORDER_EVENTS_TABLE_ID, DELIVERY_FEE, DISCOUNT`, `STRIPE_SECRET_KEY`, `PAYMENT_RETURN_URL` |
| `update-order-status` | Users | `DATABASE_ID, ORDERS_TABLE_ID, ORDER_ITEMS_TABLE_ID`, opc. `ORDER_EVENTS_TABLE_ID, USERS_TABLE_ID`, `STRIPE_SECRET_KEY`, `PAYMENT_RETURN_URL` |
| `stripe-webhook` | Any (la firma de Stripe autentica) | `DATABASE_ID, ORDERS_TABLE_ID`, opc. `ORDER_EVENTS_TABLE_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

API key dinámica: filas (leer/escribir), usuarios (leer) y mensajes (`messages.write`).

## Seguridad / permisos
- Importes, estado de pago, roles y estados privilegiados solo los cambian las Functions (validan transiciones, propiedad y rol). El cliente no manda precios.
- Cuando todo funcione, quita Create/Update/Delete a *Users* en `orders`/`order_items` y activa seguridad por fila (ver PATCH-LEEME §3). Mientras sigan abiertos, los pedidos no están protegidos.
- Etiquetas `staff` y `driver` en Auth → usuario → Labels.

## Cobertura de entrega (opcional, en el servidor)
En `create-order` define `RESTAURANT_LATITUDE`, `RESTAURANT_LONGITUDE` y `DELIVERY_RADIUS_KM`. Con las tres, un pedido cuya dirección quede fuera del radio se rechaza (`422 out_of_coverage`) y una dirección sin coordenadas no se puede verificar (`422 coverage_unverified`: el cliente debe elegirla en el mapa). Sin ellas no se restringe nada.

## Cuota del plan gratuito
Appwrite Cloud Free permite **5 funciones por proyecto** (fuente: https://appwrite.io/docs/advanced/billing/free). Este proyecto usa 3 (`create-order`, `update-order-status`, `stripe-webhook`). Si todavía tienes desplegadas `staff-api` o `update-driver-location` de versiones anteriores, **elimínalas** (ya no se usan) para no agotar la cuota.

## Repartidor
`myDeliveries` devuelve las entregas activas del repartidor autenticado; con `history: true`, sus entregas terminadas (entregado/cancelado). Las vistas de pedido para personal/repartidor incluyen `deliveryLatitude/deliveryLongitude` solo si el cliente confirmó coordenadas.

## v7: estados nuevos, tope anti-abuso y auditoría de solo lectura
- Estados `ready` y `delivery_failed`: `orders.status` es texto (varchar 255), **no hay migración de columna**. Transiciones: `preparing → ready | on_the_way`, `ready → on_the_way`, `on_the_way → delivered | delivery_failed`, `delivery_failed → on_the_way | cancelled` (solo personal; cancelar reembolsa si estaba pagado).
- Índice nuevo `idx_status` en `orders`: `node scripts/appwrite-migrate.mjs` (vista previa) y luego `--apply`.
- `create-order` rechaza con 429 (`too_many_open_orders`) al usuario con 5 pedidos en línea sin pagar.
- `node scripts/verify-appwrite.mjs` (solo lectura) informa qué funciones están desplegadas, sus variables (solo nombres), columnas, índices y permisos reales.

## v8: inventario, ciclo del repartidor y administración
- **Migración** (`node scripts/appwrite-migrate.mjs` = vista previa; `--apply` aplica; no borra datos): `orders.driverResponse` (varchar 12), `menu.stock` (int, null = sin control), `menu.lowStockThreshold` (int) y **tabla nueva `inventory_movements`** (sin permisos de cliente; índices `idx_orderId_type`, `idx_menuId`). Cambia el id con `APPWRITE_INVENTORY_MOVES_TABLE_ID` si prefieres otro. Verificación posterior: `node scripts/verify-appwrite.mjs` (solo lectura). `--rollback --apply` elimina lo agregado (pierdes sus datos).
- **Variables nuevas** en `create-order`, `update-order-status` y `stripe-webhook`: `INVENTORY_MOVES_TABLE_ID` y `MENU_TABLE_ID` (esta última también en `update-order-status` y `stripe-webhook`). Opcionales en `update-order-status`: `AUTO_ASSIGN_DRIVER=true` (asigna automáticamente al pasar a *preparando*; por omisión apagado) y `MAX_ACTIVE_PER_DRIVER` (3).
- **Cuarta función `admin-api`**: ver `docs/ADMIN.md` (usas 4 de 5).
- **Disponibilidad del repartidor:** se guarda en las *prefs* de su cuenta de Auth (`driverAvailable`), sin columna nueva. Sin valor = disponible.
- **Estados:** `picked_up` (recogido) entre listo y en camino; `orders.status` es varchar: sin migración de columna.
- **Importante antes de desplegar:** comprueba que el SDK `node-appwrite ~22.1.1` de las Functions expone `tablesDB.decrementRowColumn/incrementRowColumn` (el verificador lo comprueba en local) y que el permiso de tabla `menu` permite lectura a usuarios (las filas nuevas las crea la Function sin permisos por fila).
