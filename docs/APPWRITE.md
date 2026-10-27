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
