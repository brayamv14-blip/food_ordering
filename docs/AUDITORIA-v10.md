# Auditoría v10 — estado real del proyecto

**Base auditada:** el ZIP `food_ordering_completo.zip` que subiste (7-nov-2026): es la **v9 aplicada** (+ tu edición de `app/checkout.tsx` con `requestPaymentUrl`, y `setAvailability` en admin). No pude ver tu rama Git ni tu `git status`: compruébalos tú (`git status`, `git log -3`).
**Qué NO pude hacer aquí:** ejecutar Jest, `tsc`, `expo-doctor`, `expo config` (el registro npm está bloqueado por la red), ni hablar con tu Appwrite, Stripe, Firebase ni un teléfono. Por tanto **nada de lo de abajo está probado contra servicios reales**. Las comprobaciones son lectura de código + simulación en memoria (`run.mjs`).

## 1. El bug: pago en línea guardado como `cash_on_delivery` / `not_required` / sin `stripeSessionId`
**Lo que comprobé en el código (tu ZIP):**
- `checkout.tsx` guarda `payment` en estado y lo envía como `paymentMethod`; el botón «En línea» solo aparece si `EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT=true` (tu `.env` lo tiene `true`) y existen las dos funciones. → **la app envía `online` correctamente.**
- `create-order` (código actual) valida `paymentMethod`, y si es `online` **sin** `STRIPE_SECRET_KEY` o `PAYMENT_RETURN_URL` responde **503** (no guarda nada); si es `online` guarda `paymentMethod: 'online'`, `paymentStatus: 'pending'` y `stripeSessionId`. → **con este código no puede salir `cash_on_delivery` + `not_required` cuando se pidió `online`.**
- Conclusión: el resultado que describes solo lo produce una **versión antigua de `create-order` desplegada en Appwrite** (que ignora `paymentMethod`), o un despliegue que no es el de esta carpeta. No puedo confirmarlo desde aquí: **no es un hecho comprobado, es la única causa coherente con el código.** Otras causas descartables: app con bundle viejo en caché (reiniciar con `npx expo start -c`), pedido creado con otro intento.

**Qué cambié para que no vuelva a pasar en silencio (v10):**
1. `create-order` ahora devuelve `paymentMethod`, `paymentStatus` y `backend: "v10"` (también en reintentos duplicados).
2. La app **verifica el contrato**: si pediste pago en línea y el servidor no confirma `paymentMethod: "online"`, falla con `backend_outdated` y un mensaje claro (en vez de mostrar «Pedido confirmado» como efectivo).
3. Nueva acción `{"action":"diag"}` en `create-order`: devuelve `backend` y **solo booleanos** (`stripeKey`, `returnUrl`, `inventoryMoves`, `menuTable`, `coverage`); nunca valores. Ejecútala desde la consola de Appwrite (Functions → create-order → Execute, método POST, cuerpo `{"action":"diag"}`, con sesión) o desde la app. **Si la respuesta no trae `"backend":"v10"` (o falla con `unknown`/crea un pedido), la función desplegada no es esta.**
4. Pruebas: 8 escenarios nuevos (simulación) y 3 tests Jest nuevos en `commerce.test.ts` (sin ejecutar).

**Cómo cerrarlo (manual):** despliega la carpeta correcta (ver `DEPLOYMENT-v10.md`), **Redeploy tras cambiar variables**, ejecuta `diag`, y haz un pedido de prueba en línea con tarjeta `4242 4242 4242 4242`. Después revisa en Appwrite: `paymentMethod=online`, `paymentStatus=pending→paid`, `stripeSessionId=cs_test_…`.

## 2. Arquitectura de funciones (tu objetivo: 2)
Tu ZIP trae las 4 carpetas (`create-order`, `update-order-status`, `stripe-webhook`, `admin-api`) y tu `.env` apunta **todo** (`STAFF_API`, `ADMIN_API`, `UPDATE_DRIVER_LOCATION`) a `update-order-status`. Con solo 2 funciones desplegadas, **el webhook de Stripe y las acciones de administración no tienen quién las atienda** (la `update-order-status` de tu ZIP no las contiene). v10 incluye `appwrite-functions/plan-gratuito/{create-order,update-order-status}` (generado por `build-2-functions.mjs`): `update-order-status` enruta webhook (por cabecera `stripe-signature`, firma HMAC), administración (exige etiqueta `admin`/`staff`) y estados. **Despliega esas dos carpetas**, no las cuatro. Detalle en `docs/PLAN-GRATUITO.md`.
Además renombré la acción admin `setAvailability` → `setProductAvailability` porque chocaba con la acción homónima del repartidor al unir las funciones (el cliente `admin.service.ts` ya la usa).

## 3. Estado por área
| Área | Estado | Notas |
|---|---|---|
| Pagos Stripe (sesión, webhook, expiración, reembolso, idempotencia, `payOrder`, recuperación) | Implementado; simulado | Real: pendiente (B4). |
| Efectivo vs. en línea | Corregido el contrato (v10) | ver §1 |
| Catálogo, carrito, checkout, historial, cancelación | Implementado | Sin cambios. No hay «confirmación de recepción» del cliente (el repartidor marca entregado) — **no implementado**. |
| Mapas (Leaflet + Geoapify): selector, GPS, permisos, rutas, ETA, cobertura | Implementado | Cobertura en servidor requiere `RESTAURANT_LATITUDE/LONGITUDE`, `DELIVERY_RADIUS_KM`; el marcador del restaurante requiere `EXPO_PUBLIC_RESTAURANT_*`. **Tu `.env` no tiene `EXPO_PUBLIC_RESTAURANT_*`** → sin marcador de restaurante. Probar GPS/permisos en teléfono: pendiente. |
| Repartidores: disponibilidad, aceptar/rechazar, asignación segura, estados, historial, navegación externa, ubicación | Implementado (v8–v9) | Disponibilidad es disponible/no disponible (+ «ocupado» calculado por entregas activas); no hay estado «conectado» separado. Sin ubicación en segundo plano. |
| **Admin: seguimiento en mapa** | **Añadido en v10** | Botón «Mapa» en pedidos `picked_up`/`on_the_way`: destino, restaurante (si configurado) y última ubicación del repartidor con frescura; «Actualizar» recarga (no es tiempo real continuo). |
| Admin: productos, categorías (solo lectura), usuarios/roles, pagos, reportes, inventario | Implementado | Crear/editar **categorías**: no hay pantalla (solo `listCategories`). Reembolsos: se hacen cancelando el pedido pagado (reembolso automático); no hay botón de reembolso parcial. |
| Notificaciones (Appwrite Messaging + FCM) | Implementadas en código | Eventos: pedido, aceptado/asignado, recogido, en camino, entregado, pago, cancelación, stock bajo, rechazo de repartidor. **Funcionamiento real: sin verificar** (requiere `google-services.json` propio, proveedor FCM en Appwrite y dispositivo físico). |
| Seguridad Appwrite | Revisada en v9 | `verify-appwrite.mjs` (solo lectura) comprueba permisos de tablas y variables. Ejecútalo. |

## 4. Hallazgos de configuración en tu ZIP (sin imprimir valores)
- ⚠ **`.env` y `google-services.json` iban dentro del ZIP que subiste**: no los incluyo en ningún entregable. No los subas a Git ni los compartas; el `.gitignore` ya los ignora.
- `EXPO_PUBLIC_RECOVERY_URL` sigue con el **marcador `TU-USUARIO…`** → la recuperación de contraseña dará «Falta configurar». La URL de retorno de pagos **no** va ahí: es la variable `PAYMENT_RETURN_URL` de las Functions (`https://brayamv14-blip.github.io/food_ordering/recovery-bridge/payment-return.html`). Para `EXPO_PUBLIC_RECOVERY_URL` usa la URL de tu página de recuperación de contraseña, si existe.
- Claves expuestas en conversaciones anteriores (Stripe, Appwrite, Geoapify): **rótalas**.
- Tu `rules.test.ts` espera `delivery_failed → on_the_way = true` para repartidor; el de v10 mantiene lo que dicta `rules.js` actual. Si falla en tu Jest, dímelo con el mensaje exacto.

## 5. Lo que sigue sin resolver
Ver `BLOQUEOS-PRODUCCION-v10.md` y `MATRIZ-PRUEBAS-v10.md`.
