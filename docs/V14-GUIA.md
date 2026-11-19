# V14 — Experiencia completa (cliente, restaurante, repartidor) · guía de instalación y entrega

> No se declara lista para producción. En el entorno donde se escribió **no se ejecutaron** `tsc`, Jest, la app en un celular, Stripe real, FCM ni Appwrite real. Lo que sí se corrió: prueba de humo del servidor en memoria (`node appwrite-functions/smoke-test/run-smoke.mjs`, **447 ok / 0 fallas**), revisión de sintaxis y un mini-corredor de pruebas puras. Todo lo demás está en la lista **NO EJECUTADA** al final.

## 1. Qué hay
| Área | Qué hace | Dónde se decide |
|---|---|---|
| Calificar | 1–5 estrellas al pedido, repartidor (opcional) y comentario, una sola vez, solo pedido entregado | Function `rateOrder` |
| Recibo | Subtotal, envío, descuento/cupón, propina, total, forma de pago, reembolso; botón Compartir | App (`lib/domain/receipt.ts`) |
| Pedir de nuevo | Ya existía; ahora también en el detalle del pedido (entregado/cancelado) con precios actuales | App |
| Propina | Chips $0/10/20/30, límite `TIP_MAX` | Function `create-order` valida |
| Cupones | Código en el checkout; vigentes en la variable `COUPONS` | Function (nunca el cliente) |
| Envío por distancia | base + $/km con tope; sin configurar usa `DELIVERY_FEE` fijo | Function |
| Cotización | `quote` devuelve los totales reales antes de pagar | Function |
| Horario / cerrado | Bloquea pedidos fuera de horario o con cierre manual; aviso en el checkout | Function (`409 restaurant_closed`) |
| Tiempo de preparación | `PREP_MINUTES`, usado en el ETA | Function → app |
| ETA | "Llega en ~N min (estimado)" en detalle y seguimiento | App (`lib/domain/eta.ts`) |
| Cancelar | Cliente cancela en Pendiente o Confirmado; si ya pagó con tarjeta, **reembolso automático** en Stripe | Function |
| Favoritos | Corazón en el producto + fila "Tus favoritos" en Inicio; se guardan en las preferencias de la cuenta | App + Appwrite Account |
| Reportes | Tablero admin: ventas, pedidos, más vendidos, propinas, cupones, calificación promedio y comentarios | Function `dashboard` |
| Repartidores reales | La simulación solo toca pedidos sin repartidor o con `demo-driver-N`; si hay un repartidor real, **no interviene** | Function |

Ya existían (no se tocaron): direcciones casa/trabajo en el perfil y selector de dirección en el mapa, agotar productos (interruptor en Admin → Productos), ventas por día, notificaciones push por cambio de estado (requieren FCM probado).

## 2. Modo demostración — sin cambios de comportamiento
Se conserva tu `status.js` desplegado (origen de respaldo = destino − 0.012 cuando no hay `RESTAURANT_*`). Cambios mínimos y seguros:
- Antes de escribir un paso, la Function relee el pedido; si alguien lo canceló o cambió mientras tanto, **no lo pisa**.
- Si el pedido ya tiene un repartidor **real**, la simulación se pausa (`paused: real_driver`).
- No se usa la columna `note` en `order_events`.
- La app detecta el viaje demo por `driverUserId` que empieza con `demo-driver-` (antes por el nombre).

## 3. Base de datos — migración
Columnas nuevas en **orders** (las escriben solo las Functions; la app no las puede escribir):
| Columna | Tipo | Tamaño / rango |
|---|---|---|
| `tip` | Double | 0 – 1000 |
| `couponCode` | String | 24 |
| `rating` | Integer | 1 – 5 |
| `driverRating` | Integer | 1 – 5 |
| `ratingComment` | String | 300 |
| `ratedAt` | Datetime | — |

Automático (revisa primero, luego aplica; usa tu API key **solo en la terminal**, nunca en el chat):
```
node scripts\appwrite-migrate.mjs
node scripts\appwrite-migrate.mjs --apply
```
Manual (si no quieres usar el script): Appwrite → Databases → tu base → tabla de pedidos → Columns → Create column, una por cada fila de arriba, **sin** marcarlas "required".
Sin migrar: pedidos, propina cero, cupón vacío y todo lo anterior siguen funcionando (las columnas opcionales solo se envían si se usan). Calificar sin la migración responde `needs_migration`; propina/cupón con valor fallarían al guardar hasta migrar → **migra antes de usarlos**.

## 4. Variables de entorno
**App (`.env`)** — no hay variables nuevas obligatorias. Ya existentes que se usan más: `EXPO_PUBLIC_FN_CREATE_ORDER`, `EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS`, `EXPO_PUBLIC_DEMO_AUTOPILOT` (solo demo).

**Function `create-order`** (todas opcionales):
| Variable | Ejemplo | Efecto |
|---|---|---|
| `OPEN_HOURS` | `09:00-22:00` | Horario; vacío = siempre abierto. Admite `22:00-02:00` |
| `RESTAURANT_UTC_OFFSET` | `-6` | Zona horaria del restaurante (CDMX = -6) |
| `RESTAURANT_CLOSED` | `true` | Cierre manual inmediato |
| `PREP_MINUTES` | `20` | Tiempo de preparación para el ETA |
| `DELIVERY_FEE_BASE` / `DELIVERY_FEE_PER_KM` / `DELIVERY_FEE_MAX` | `15` / `5` / `60` | Envío por distancia. Requiere `RESTAURANT_LATITUDE/LONGITUDE` y una dirección con coordenadas |
| `COUPONS` | `BIENVENIDO:percent:10:0;ENVIO:freeship:0:100;MENOS20:amount:20:150` | `CODIGO:tipo:valor:mínimo`; tipos `percent`, `amount`, `freeship` |
| `TIP_MAX` | `200` | Propina máxima |
Tras cambiar variables hay que **redesplegar** la función.

**Function `update-order-status`**: sin variables nuevas (`rateOrder` y cancelación usan las existentes). Para la demo: `DEMO_AUTOPILOT=true`, `ORDER_EVENTS_TABLE_ID`.

## 4.1 Subir las Functions
1. Empaca (CMD, desde la raíz del proyecto):
```
node appwrite-functions\sync-shared.mjs
node appwrite-functions\build-2-functions.mjs
tar -czf update-order-status.tar.gz -C appwrite-functions\plan-gratuito\update-order-status package.json src
tar -czf create-order.tar.gz -C appwrite-functions\plan-gratuito\create-order package.json src
```
2. Appwrite → Functions → cada función → Deployments → Create deployment → Upload el `.tar.gz` correspondiente. **Sube las dos** (comparten `rules.js`). Espera "Ready".

## 5. Seguridad (qué se valida en el servidor)
- Total, envío, cupón y propina se calculan en la Function; los importes que mande el cliente se ignoran (hay prueba).
- Calificar: solo el dueño del pedido, solo entregado, una vez (candado atómico).
- Cancelar: dueño + Pendiente/Confirmado; el reembolso lo ejecuta la Function con llave de idempotencia (no se reembolsa dos veces).
- Favoritos: preferencias de **tu propia cuenta**; no hay tabla pública.
- Las columnas nuevas de `orders` no tienen permisos de escritura para clientes (`orders` sigue sin permisos de tabla + `rowSecurity`).
- Ninguna llave en la app ni en el ZIP; `.env`, `google-services.json` y API keys quedan fuera del paquete.

## 6. Generar el APK/AAB (EAS Build)
```
npm install -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview      :: APK para instalar y probar
eas build -p android --profile production   :: AAB para Play Store
```
- `app.json` ya tiene `package: com.jsm.foodordering`, `versionCode: 1`. Sube `versionCode` en cada entrega nueva.
- `google-services.json` debe existir en la raíz antes de compilar (FCM). Si no está en el repo, súbelo como secreto de EAS: `eas secret:create --name GOOGLE_SERVICES_JSON --type file --value .\google-services.json` (y apúntalo desde `app.config`) o compílalo en una máquina que lo tenga.
- Las variables `EXPO_PUBLIC_*` se toman del `.env` local en cada build. Para builds en la nube defínelas con `eas env:create` (o en el panel de EAS). **Nunca** pongas llaves secretas (Stripe/Appwrite API) en variables `EXPO_PUBLIC_*`.
- Deja `EXPO_PUBLIC_DEMO_AUTOPILOT=false` en el build de entrega real; en una demo/entrega académica puede ir en `true`.

## 7. Checklist final de pruebas manuales (marca cada una)
**Cliente**
- [ ] Registro / inicio de sesión / cerrar sesión
- [ ] Inicio: banners, categorías, novedades; corazón en un producto → aparece "Tus favoritos"
- [ ] Carrito → checkout: propina $10 sube el total; cupón válido baja el total; cupón inventado muestra error
- [ ] Efectivo: pedido queda Pendiente → (demo) avanza hasta Entregado
- [ ] Tarjeta 4242…: paga en Stripe, regresa, **Pagado** y el pedido avanza solo
- [ ] Tarjeta rechazada 4000 0000 0000 0002: no se crea cobro, mensaje claro
- [ ] Seguimiento: mapa, repartidor "(demo)" se mueve por calles, ETA visible
- [ ] Entregado: calificar (1–5, comentario) una sola vez; "Pedir de nuevo" llena el carrito
- [ ] Recibo: subtotal/envío/descuento/propina/total correctos y "Compartir recibo"
- [ ] Cancelar un pedido Pendiente (efectivo) y uno **pagado con tarjeta**: Stripe muestra el reembolso
- [ ] Con `RESTAURANT_CLOSED=true` el checkout avisa "cerrado" y no deja pedir
- [ ] Sin internet: mensajes de error claros, sin pantallas en blanco
**Admin / personal**
- [ ] Tablero: ventas, propinas, cupones, calificación promedio y comentarios
- [ ] Productos: agotar/reactivar un producto y verlo reflejado en la app
- [ ] Pedidos: cambiar estado, asignar repartidor, reembolsar
**Repartidor real** (con cuenta etiquetada `driver`)
- [ ] Disponible → acepta pedido → recoge → en camino → entrega con ubicación real (no verificado en dispositivo)
**Calidad**
- [ ] `npx tsc --noEmit` sin errores · `npx jest` en verde · `node appwrite-functions\smoke-test\run-smoke.mjs` 0 fallas
- [ ] Rotadas las llaves que alguna vez se pegaron en chats (Appwrite API key, Stripe, Geoapify)

## 8. Qué NO está / NO se probó
- **NO EJECUTADA**: `tsc`, Jest, app en celular, Stripe real (reembolso, webhook), FCM (push), Realtime nativo, GPS real, EAS Build.
- No hay modo sin conexión con cola de pedidos (sin `netinfo`); la app muestra errores claros y reintenta, nada más.
- Cupones y horarios se administran con **variables de la Function**, no desde una pantalla (evita crear tablas nuevas); cambiarlos requiere redesplegar.
- Los favoritos del Inicio solo muestran los productos que cargan en la lista inicial (40 más recientes).
- Fotos de evidencia de entrega, ubicación en segundo plano, historial de ubicaciones y promociones administrables: **no hechos**.
- Webhook de Stripe: sigue sin dominio público en tu plan; el pago se confirma consultando a Stripe (flujo actual).
