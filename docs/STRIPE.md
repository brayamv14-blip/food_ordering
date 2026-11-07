# Pagos con Stripe (Checkout alojado)

La app **no maneja datos de tarjeta**. El cliente abre la página de pago de Stripe (`checkout.stripe.com`) en el navegador del sistema; el cobro se confirma **solo en el servidor**.

## Flujo
1. `create-order` (Appwrite Function) calcula el total con precios del catálogo (ignora importes del cliente), crea el pedido con `paymentStatus = pending` y pide a Stripe una *Checkout Session* (MXN, importe en centavos, vence en ~31 min, clave de idempotencia `checkout-<pedido>-1`). Guarda `stripeSessionId` (la URL no se guarda). Si Stripe falla, el pedido se revierte (502).
2. La app abre la URL devuelta (solo se acepta `https://checkout.stripe.com/...`).
3. Stripe llama al **webhook** `stripe-webhook` (firma `Stripe-Signature` HMAC-SHA256, tolerancia 5 min, comparación en tiempo constante). La función **vuelve a validar** pedido, importe y moneda contra la base de datos y marca `paid` (idempotente: un evento repetido no cambia nada ni notifica dos veces).
4. Al volver a la app, “Verificar pago” (`syncPayment`) consulta la sesión directamente a Stripe desde el servidor. **Volver de la página de pago nunca marca un pedido como pagado.**
5. “Pagar ahora” (`payOrder`, solo el dueño): reutiliza la sesión abierta o crea una nueva (clave `checkout-<pedido>-after-<sesión anterior>`).

## Estados del pago (`orders.paymentStatus`)
`not_required` (efectivo) · `pending` → `paid` | `failed` | `cancelled`; `failed` → `paid` (reintento); `paid` → `refunded`; `cancelled` → `refunded` (pago tardío). `refunded` es final.

- Cancelar un pedido **pendiente/fallido** cierra la sesión de Stripe (`cancelled`). 
- Cancelar un pedido **pagado** (solo personal; el cliente recibe `refund_needed`) emite el reembolso **antes** de cancelar, con idempotencia `refund-<pedido>`: repetir la cancelación no reembolsa dos veces. Si Stripe rechaza el reembolso, el pedido **no** se cancela (502).
- Si un pago llega tarde a un pedido ya cancelado, el webhook lo reembolsa una sola vez.

## Variables (solo en las Functions de Appwrite → *Settings → Variables*; NUNCA `EXPO_PUBLIC_*`)
| Variable | Funciones | Valor |
|---|---|---|
| `STRIPE_SECRET_KEY` | create-order, update-order-status, stripe-webhook | `sk_test_...` (prueba) o `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | `whsec_...` del endpoint del webhook |
| `PAYMENT_RETURN_URL` | create-order, update-order-status | https de `recovery-bridge/payment-return.html` |
| `DATABASE_ID`, `ORDERS_TABLE_ID`, `ORDER_EVENTS_TABLE_ID` (opc.), `USERS_TABLE_ID`… | según función | IDs de Appwrite |

En la app solo: `EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT=true` (+ los IDs de las Functions). La clave publicable `pk_test_...` **no se necesita** con Checkout alojado.

## Configurar el webhook
1. Despliega `stripe-webhook` (Execute access: **Any**, porque Stripe no tiene sesión de Appwrite; la autenticidad la da la firma). Copia su URL de ejecución.
2. Stripe Dashboard (modo prueba) → *Developers → Webhooks → Add endpoint* con esa URL y los eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
3. Copia el *Signing secret* (`whsec_...`) a `STRIPE_WEBHOOK_SECRET`.
4. Prueba local con la CLI: `stripe listen --forward-to <url>` y `stripe trigger checkout.session.completed` (el pedido no existirá → responde 200 y se ignora; para una prueba completa paga un pedido real de prueba).

## Tarjetas de prueba (modo prueba, cualquier fecha futura, CVC y CP)
- `4242 4242 4242 4242` → pago exitoso
- `4000 0000 0000 9995` → fondos insuficientes (rechazo)
- `4000 0025 0000 3155` → requiere autenticación 3D Secure
- Documentación: https://docs.stripe.com/testing

## Modo real
Cambia `STRIPE_SECRET_KEY` por la `sk_live_...`, crea el webhook en modo real y actualiza `STRIPE_WEBHOOK_SECRET`. Activa la cuenta de Stripe (datos fiscales/bancarios). Prueba primero con un importe pequeño. **Rota cualquier clave que se haya compartido en chats o capturas.**
