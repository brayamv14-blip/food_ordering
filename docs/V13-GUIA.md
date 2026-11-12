# V13 — Guía de instalación, configuración y estado

> **No se declara terminada ni lista para producción.** Aquí no hay `npm`, Android, Stripe, Firebase ni acceso a tu Appwrite: **no ejecuté** `npm ci`, `tsc`, Jest, `expo-doctor`, `expo config`, ni un pedido real de prueba (ver `MATRIZ-PRUEBAS-v13.md`). Lo que sí hice está marcado como “simulación/revisión”.

## 1. Qué cambió en V13
- **Pantalla principal del cliente** (`app/(tabs)/index.tsx`) rediseñada conservando lo anterior (banners, dirección, carrito): saludo con tu nombre, dirección de entrega real del perfil (toca para editarla), buscador, acceso a “Mis pedidos”, tarjeta de **pedido activo** (y aviso de pago pendiente), banners, **categorías** y **novedades/menú** reales de Appwrite (nombre, precio, descripción, imagen, agotado), botón agregar, carrito con contador, pull‑to‑refresh y estados de carga, error con reintento y vacío. Pestañas en español.
  - Los **banners** (`constants/offers`) siguen siendo contenido fijo tuyo: no existe una tabla de promociones. Para promociones administrables falta crear esa tabla y su pantalla admin (no hecho). No hay sección “más vendidos” porque no existe ese dato para clientes; se usa “Novedades” (los más recientes) en lugar de inventar popularidad.
- **Recuperación de pago**: al volver la app a primer plano con un pedido en línea pendiente, la app pregunta al servidor, que consulta a Stripe (la app nunca decide si se pagó). Además existen “Pagar ahora” y “Verificar pago” en Mis pedidos (V10).
- **Realtime** de seguimiento activado también en Android/iOS (antes solo web). **No verificado en un dispositivo**; el sondeo de 10 s sigue siempre activo como respaldo. Mientras no lo pruebes en físico, no lo llames “tiempo real garantizado”.
- **Anti‑abuso**: `create-order` rechaza (429 `rate_limited`) más de 8 pedidos por usuario en 10 min, además del límite de pedidos en línea sin pagar.

## 2. Decisiones sobre pendientes (¿necesario? ¿viable? ¿seguro?)
| Función | Decisión |
|---|---|
| Realtime nativo | Implementado (sin verificar en físico), con respaldo de sondeo. |
| Limitación de solicitudes | Implementado en `create-order` (por usuario). Otras acciones: solo validación de rol; un límite general requiere una tabla/contador (no hecho). |
| Confirmación de recepción, reembolsos parciales, categorías, recuperación de pago | Implementados (V11/V13); sin prueba real. |
| Evidencia fotográfica | Viable y recomendable, **no implementada**: necesita bucket nuevo, permiso de cámara (hoy bloqueado en `app.json`), acción servidor que valide el archivo y fije permisos de lectura, y prueba en dispositivo. |
| Ubicación en segundo plano | Viable solo con build nativo, servicio en primer plano y declaración en Google Play (`UBICACION-SEGUNDO-PLANO.md`). No implementada. |
| Historial de ubicaciones | No necesario para operar; añade riesgo de privacidad. No implementado; si lo quieres: tabla, retención ≤30 días, lectura solo admin. |
| Subida/administración de imágenes, variantes | No implementadas (URL https en el producto). Requieren bucket y pantalla admin. |
| Pago con tarjeta | Se usa **Stripe Checkout alojado** (la tarjeta nunca toca la app ni tu servidor: menor riesgo PCI). Tarjetas guardadas o hoja de pago dentro de la app exigirían Stripe React Native + PaymentIntents + cliente Stripe: cambio de arquitectura, no hecho. |

## 3. Instalación en tu PC (Windows)
1. `git apply --whitespace=nowarn food-ordering-v13.patch` (o descomprime el ZIP) y copia tu `.env` desde `env.example.v13` con tus valores reales (nunca lo subas a git).
2. `npm ci`
3. `npx tsc --noEmit` · `npx jest` · `npx expo-doctor` · `npx expo config --type public` · `git diff --check` → **guárdame los resultados/errores y pásalos**.
4. `npx expo start -c`.

## 4. Appwrite (orden seguro, sin bloquear usuarios)
Sigue `DEPLOYMENT-v11.md` y `DEPLOYMENT-v12.md`: respaldo → migración de columnas/tablas → desplegar las 2 funciones (`plan-gratuito/*`) con sus variables → publicar la app → `backfill-row-permissions.mjs` (simulación, luego `--apply`) → permisos de tabla → `verify-appwrite.mjs` sin CRÍTICO. **No cambies permisos de producción antes del respaldo.** Para recuperar: restaura desde tu exportación y redespliega la versión anterior de la función desde la consola.

## 5. Stripe (modo test)
Variables de la función (nunca `EXPO_PUBLIC_*`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_RETURN_URL`. Webhook → URL de ejecución de `update-order-status` con eventos `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`. Prueba: pedido en línea con tarjeta `4242 4242 4242 4242`; verifica en Appwrite `paymentMethod=online` (el error “en línea guardado como efectivo” se atribuyó a una función desplegada antigua; `create-order` ahora devuelve `backend:'v10'` y la app avisa con `backend_outdated`). **Esta comprobación con un pedido real la tienes que hacer tú.** Pago con la app cerrada: el webhook marca pagado; al abrir, la app lo refleja.

## 6. Mapas y repartidores
Cliente: seguimiento con Realtime (nativo sin verificar) + sondeo 10 s. Admin: mapa por sondeo 15 s. Repartidor: GPS en primer plano cada ~5 s mientras comparte. Mapas Leaflet con teselas/geocodificación de Geoapify (restringe tu clave por app/dominio). Restaurante: `RESTAURANT_LATITUDE/LONGITUDE` en la función. Detalles: `AUDITORIA-v11.md`, `UBICACION-SEGUNDO-PLANO.md`.

## 7. APK y AAB (EAS)
Ya existe `eas.json`: `preview` → **APK** (pruebas), `production` → **AAB** (Google Play). Paquete: `com.jsm.foodordering` (cámbialo por el tuyo **antes** de publicar: no se puede cambiar después en Play). Pasos: `npm i -g eas-cli` → `eas login` → define variables por perfil (`eas env:create`, todas las `EXPO_PUBLIC_*` de `.env.example`) → `eas build -p android --profile preview` (APK) / `--profile production` (AAB). Firma: EAS administra el keystore (guarda una copia con `eas credentials`). FCM: pon `google-services.json` en la raíz (no versionado) y sube la clave de servicio FCM v1 en `eas credentials`.
Puntos a revisar antes de publicar: nombre visible (`fast_food`), `version`/`versionCode`, icono y splash propios, y el plugin de **Sentry**: apunta a `organization: jsmpro` / `project: jsm_reactnative_food-ordering` (de un tutorial); usa tu cuenta o quítalo, o el build pedirá `SENTRY_AUTH_TOKEN`.

## 8. Configuración externa que aún te toca
1. Rotar las claves pegadas en el chat (Stripe, Appwrite, Geoapify). 2. Respaldo + migración + backfill + permisos (sección 4). 3. Variables y despliegue de las 2 funciones. 4. Webhook de Stripe con `charge.refunded`. 5. Firebase: proyecto, `google-services.json`, clave FCM v1 y proveedor FCM en Appwrite Messaging (+ prueba con app abierta/cerrada/segundo plano). 6. Teléfono Android físico con depuración USB o APK de `preview` para probar GPS/permisos/Realtime. 7. Cuentas con etiqueta `admin`/`driver`/`staff` en Auth. 8. Política de privacidad y términos (Play los pide). 9. Cambiar paquete/nombre/iconos y Sentry.

## V13.1 — Modo demostración (pedidos automáticos con repartidores FICTICIOS)

SIMULACIÓN para presentar la app: no hay repartidores ni GPS reales. Está apagada por omisión.

Qué hace: tras pagar (Stripe lo confirma el servidor al consultarlo) el pedido pasa solo a
`confirmed` → `preparing` (se asigna un repartidor "(demo)") → `ready` → `picked_up` → `on_the_way`
(el punto se mueve en línea recta del restaurante al cliente) → `delivered`. Avanza mientras el cliente
tiene abierta la pantalla de seguimiento (cada 4 s).

Activar:
1. Function `update-order-status` → Variables: `DEMO_AUTOPILOT=true`, `ORDER_EVENTS_TABLE_ID=order_events`,
   `RESTAURANT_LATITUDE`, `RESTAURANT_LONGITUDE` (sin ellas no hay recorrido). Opcional `DEMO_TRIP_SECONDS` (90).
2. Subir `update-order-status.tar.gz` y redesplegar.
3. App `.env`: `EXPO_PUBLIC_DEMO_AUTOPILOT=true` y reiniciar con `npx expo start -c`.
Desactivar: `DEMO_AUTOPILOT=false` / `EXPO_PUBLIC_DEMO_AUTOPILOT=false`. No usar en producción real.
