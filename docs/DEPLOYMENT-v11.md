# Despliegue v11 (pasos manuales; nada se despliega automáticamente)

1. **Migración** (revisa primero, no destructiva, idempotente): `node scripts/appwrite-migrate.mjs` con tus variables locales (`.env.migration`, nunca se versiona). Agrega: `orders.receivedAt`, `orders.refundedAmount`, `order_events.note`, `categories.active` (tabla `APPWRITE_CATEGORIES_TABLE_ID`), tabla `audit_log` (`APPWRITE_AUDIT_TABLE_ID`). Sin permisos de cliente en `order_events` ni `audit_log`.
2. **Variables de la función `update-order-status`** (nuevas): `ORDER_EVENTS_TABLE_ID` (**obligatoria** para el candado atómico), `AUDIT_TABLE_ID`, `RESTAURANT_LATITUDE`, `RESTAURANT_LONGITUDE`, `MAX_ACTIVE_PER_DRIVER` (def. 3), `AUTO_ASSIGN_DRIVER` (opcional). Más las existentes (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MENU_TABLE_ID`, `PAYMENT_RETURN_URL`, …). Scopes de la API key: tablas/filas lectura-escritura, `users.read`, `users.write`, mensajería.
3. **Desplegar** solo `plan-gratuito/create-order` y `plan-gratuito/update-order-status` (regenerar con `node appwrite-functions/build-2-functions.mjs` si cambias el código). Ejecución de `update-order-status`: Any (el webhook de Stripe lo necesita; la identidad se valida dentro).
4. **Stripe**: el webhook debe incluir `charge.refunded` además de `checkout.session.completed`/`expired`.
5. **App**: `EXPO_PUBLIC_FN_*` apuntan a `update-order-status` (excepto `CREATE_ORDER`). `npx expo start -c`.
6. **Verificar**: `node scripts/verify-appwrite.mjs` (marca CRÍTICO si hay permisos de cliente indebidos).
7. En tu PC: `npm ci`, `npx tsc --noEmit`, `npx jest`, `npx expo-doctor` — **no se ejecutaron aquí**.
8. Prueba real mínima en Android: dos repartidores aceptando el mismo pedido; GPS apagado; permiso denegado; pago con app cerrada; reembolso parcial en Stripe test.
