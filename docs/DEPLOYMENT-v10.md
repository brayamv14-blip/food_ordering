# Despliegue v10 (2 funciones) — manual, nada se despliega solo

Sigue `docs/DEPLOYMENT-v9.md` (permisos de tablas, migración, rotación de claves) **con estas diferencias**:

1. **Funciones:** despliega solo `appwrite-functions/plan-gratuito/create-order` → función `create-order`, y `appwrite-functions/plan-gratuito/update-order-status` → función `update-order-status`. Elimina del flujo `stripe-webhook` y `admin-api` (no borres funciones ya desplegadas sin comprobar que nada las usa).
2. **Variables** (consola, por función; después **Redeploy**): ver tabla en `docs/PLAN-GRATUITO.md`. Imprescindibles para pagos: `STRIPE_SECRET_KEY`, `PAYMENT_RETURN_URL` (en las dos) y `STRIPE_WEBHOOK_SECRET` (en `update-order-status`).
   `PAYMENT_RETURN_URL=https://brayamv14-blip.github.io/food_ordering/recovery-bridge/payment-return.html` (la página debe estar publicada en GitHub Pages; abre `fastfood://orders`).
3. **Ejecución** de `update-order-status`: `Any` (Stripe no tiene sesión); es seguro porque el webhook exige firma HMAC y todo lo demás exige sesión (401). `create-order`: usuarios.
4. **App (`.env.local`):** `EXPO_PUBLIC_FN_CREATE_ORDER=create-order`; `EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS`, `…_STAFF_API`, `…_ADMIN_API`, `…_UPDATE_DRIVER_LOCATION` = `update-order-status`. Para el marcador del restaurante: `EXPO_PUBLIC_RESTAURANT_LATITUDE/LONGITUDE/NAME`. Reinicia con `npx expo start -c`.

## Verificación del despliegue (antes de probar pagos)
1. Consola → Functions → `create-order` → Execute: POST `{"action":"diag"}` → debe devolver `"backend":"v10"` y `stripeKey:true`, `returnUrl:true`, `inventoryMoves:true`, `menuTable:true`. Cualquier `false` = variable faltante (¿hiciste Redeploy?).
2. `node scripts/verify-appwrite.mjs` (solo lectura) → corrige todo CRÍTICO.
3. Stripe (modo prueba) → Webhooks → apunta al dominio de `update-order-status`; envía un evento de prueba: debe responder 200 (y 400 si la firma es falsa).
4. Pedido en línea de prueba (`4242 4242 4242 4242`): en Appwrite `paymentMethod=online`, `stripeSessionId=cs_test_…`, y tras pagar `paymentStatus=paid`.
5. Pruebas de la app: `docs/MATRIZ-PRUEBAS-v10.md` (columna «Real»).

## Aplicar el patch (Windows, PowerShell, en la raíz del repo)
```powershell
git status                 # revisa qué hay antes
git switch -c integrar-food-ordering-v10
git apply --check --whitespace=nowarn ..\food-ordering-v10.patch
git apply --whitespace=nowarn ..\food-ordering-v10.patch
```
El patch es **incremental sobre el ZIP que subiste el 7-nov (v9 aplicada)**, no sobre v6. Si `--check` falla, usa el ZIP completo `food-ordering-v10.zip` en una carpeta nueva y copia tu `.env`/`google-services.json`. Sin `git reset --hard` ni `git clean`.
