# Plan gratuito de Appwrite: 2 funciones

El plan gratuito permite 2 funciones aquí. En vez de 4, se despliegan **dos**:

| Función (ID) | Qué atiende | Carpeta a desplegar |
|---|---|---|
| `create-order` | crear pedidos + sesión de Stripe | `appwrite-functions/plan-gratuito/create-order` |
| `update-order-status` | estados, repartidores, **webhook de Stripe** y **administración** | `appwrite-functions/plan-gratuito/update-order-status` |

`update-order-status` enruta solo: cabecera `stripe-signature` → webhook; acciones de administración → admin (exige etiqueta `admin`/`staff` en el servidor); lo demás → estados. Se regenera con `bash appwrite-functions/sync-shared.sh && node appwrite-functions/build-2-functions.mjs`.

## Variables
**create-order**: `DATABASE_ID`, `ORDERS_TABLE_ID`, `ORDER_ITEMS_TABLE_ID`, `MENU_TABLE_ID`, `CUSTOMIZATIONS_TABLE_ID`, `MENU_CUSTOMIZATIONS_TABLE_ID`, `DISCOUNT`, `DELIVERY_FEE`, `STRIPE_SECRET_KEY` + **`PAYMENT_RETURN_URL`** + **`INVENTORY_MOVES_TABLE_ID`** (nuevas) + opcionales `ORDER_EVENTS_TABLE_ID`, `RESTAURANT_LATITUDE`, `RESTAURANT_LONGITUDE`, `DELIVERY_RADIUS_KM`.

**update-order-status**: `DATABASE_ID`, `ORDERS_TABLE_ID`, `STRIPE_SECRET_KEY`, `PAYMENT_RETURN_URL` + **`ORDER_ITEMS_TABLE_ID`, `MENU_TABLE_ID`, `INVENTORY_MOVES_TABLE_ID`, `CATEGORIES_TABLE_ID`, `STRIPE_WEBHOOK_SECRET`** (nuevas) + opcionales `ORDER_EVENTS_TABLE_ID`, `AUTO_ASSIGN_DRIVER`, `MAX_ACTIVE_PER_DRIVER`.

`MENU_TABLE_ID` e `INVENTORY_MOVES_TABLE_ID` deben estar en **ambas**.

## Permisos de ejecución de `update-order-status`
Settings → Execute access: **Any** (Stripe no tiene sesión de Appwrite). Es seguro porque el webhook valida la firma HMAC y todo lo demás exige sesión (401 sin ella).

## Webhook de Stripe
Dominio de la función (pestaña Domains) → Stripe: Developers → Webhooks → Add destination → Webhook endpoint → esa URL; eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. El `whsec_…` va en `STRIPE_WEBHOOK_SECRET`.

## App
`.env.local`: `EXPO_PUBLIC_FN_ADMIN_API=update-order-status` (la misma función). Tras cambiar variables, **Redeploy** en la consola.
