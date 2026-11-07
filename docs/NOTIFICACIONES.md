# Notificaciones push (Firebase Cloud Messaging + Appwrite Messaging)

## Qué token se usa (importante)
La app obtiene el **token FCM nativo** (`Notifications.getDevicePushTokenAsync()`), que es el que entiende el proveedor **FCM** de Appwrite Messaging. **No** se usa el token de Expo (`ExponentPushToken[...]`): es de otro servicio y la app lo rechaza como destino. No hay campo `pushToken` en `users`.

## Arquitectura
- La app registra este dispositivo como **destino push** de la cuenta: `account.createPushTarget({ targetId, identifier: <token FCM>, providerId })`.
- `targetId` = `d` + `Application.getAndroidId()` → **estable por dispositivo**: no se duplican registros; si FCM renueva el token (`addPushTokenListener`) se hace `updatePushTarget`; un 409 al crear se resuelve actualizando.
- El permiso `POST_NOTIFICATIONS` se pide **solo** al activar “Notificaciones de pedidos” en Perfil. Cerrar sesión o desactivar elimina el destino (`deletePushTarget`).
- Las Functions envían con `messaging.createPush({ title, body, users: [cuenta], data })` (solo a la cuenta correspondiente; `data` son textos).
- Eventos: pedido recibido (efectivo), pago recibido/fallido/reembolsado, confirmado, en preparación, en camino, entregado, cancelado (solo si cancela el personal) y “entrega asignada” (al repartidor). Solo se notifica ante cambios **válidos** y sin repetir (los eventos duplicados de Stripe no notifican dos veces). Si Messaging falla, el cambio de estado igual se aplica.
- Primer plano: se muestra como banner (`NotificationHandler`). Al tocarla (app en segundo plano o cerrada) abre el pedido (`/order/[id]`) o `/driver`; los datos se validan antes de navegar.
- Canal Android `orders` (importancia alta) también fijado como `defaultChannel` en `app.json`.

## Configuración (una vez)
1. **Firebase**: proyecto con la app Android `com.jsm.foodordering`; descarga `google-services.json` a la raíz (ya referenciado en `app.json`; **no se versiona**, está en `.gitignore`).
2. **Clave de servicio FCM v1**: Firebase → *Configuración → Cuentas de servicio → Generar clave privada* (JSON). Se sube a **Appwrite** (no a la app): *Messaging → Providers → (proveedor FCM existente “FOOD DELYVERY”) → Service account JSON*. Anota el ID del proveedor.
3. `.env.local`: `EXPO_PUBLIC_APPWRITE_PUSH_PROVIDER_ID=<ID del proveedor>`.
4. Functions `create-order` y `update-order-status`: el API key dinámico necesita el scope `messages.write` además de filas/usuarios. (`stripe-webhook` también.)
5. Compila una **build de desarrollo** o APK: `npx eas-cli build --platform android --profile development` (las push remotas **no funcionan en Expo Go** en Android).

## Probar en un teléfono Android real
1. Instala la build, inicia sesión, Perfil → activa *Notificaciones de pedidos* y acepta el permiso. En Appwrite Console → Auth → tu usuario → *Targets* debe aparecer **un** destino push.
2. Haz un pedido; desde una cuenta `staff` cámbialo a *Confirmado*, *En preparación*… El cliente debe recibir cada aviso. Pruébalo con la app abierta, en segundo plano y cerrada.
3. Desactiva el interruptor → el destino desaparece y deja de recibir avisos.
Si no llega: revisa que el proveedor esté **habilitado**, la clave de servicio, que `google-services.json` sea del mismo proyecto de Firebase, y los logs de la ejecución de la Function.

> Las pruebas automatizadas (Jest y el smoke test) usan dobles: **no** demuestran que FCM entregue en un teléfono. Esa validación real está pendiente hasta que la hagas con tu build.
