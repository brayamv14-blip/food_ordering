# Auditoría V16

## 0. Conservación del módulo de repartidor (comparación V15 → V16)
- Acciones de `update-order-status`: V15 = 20, V16 = 25, **perdidas = 0**. `admin-api`: 27 → 30, perdidas = 0.
- Exports de `staff.service.ts` y funciones de `rules.js`: **perdidos = 0**.
- Archivos de repartidor sin cambios: `app/admin/drivers.tsx`, `app/admin/map.tsx`, `lib/domain/driverBroadcaster.ts`, `lib/services/location.ts`, `lib/domain/restaurant.ts`, `create-order`.
- `app/driver/index.tsx`: +30/−8 líneas; las líneas retiradas son firmas ampliadas (p. ej. `changeOrderStatus(..., deliveryCode?)`, una pestaña más). Disponibilidad, asignación, aceptar/rechazar, recogida, entrega, ubicación, historial y demo siguen igual.
- Todo lo nuevo es opcional/apagado por omisión (OTP, tiempo límite, comisiones): sin configurar, el comportamiento es el de V15.

## A. Verificado (simulación en memoria, NO Appwrite ni Stripe reales)
`node appwrite-functions/smoke-test/run-smoke.mjs`: V14 447 ok · V15 147 ok · V16 63 ok · 0 fallas (incluye paquete de 2 Functions del plan gratuito). Cubre: aislamiento de categorías por tienda, alta/aprobación (un cliente no se auto-aprueba, admin de otra tienda no ve ni aprueba), OTP (dueño, terceros, bloqueo tras 5 fallos, cierre por personal), ganancias por rol, finanzas (centavos, reembolsos, rangos, comisión por tienda solo superadmin), tiempo límite (idempotente, solo su tienda).
También: `node --check` de las Functions y revisión de sintaxis TypeScript de todos los archivos tocados.

## B. Implementado, NO ejecutado
- `__tests__/services/v16.test.ts` (Jest) y las pantallas nuevas: no se pudieron correr aquí (sin acceso a npm). **Debes correr `npx tsc --noEmit` y `npx jest`**; pueden aparecer errores de tipos.
- Migración `--apply` en tu Appwrite, subida de Functions, prefs de cuenta para la tienda persistente, dispositivos Android/iOS, Stripe real.

## C. Pendiente / no implementado
- Retiros o transferencias a tiendas y repartidores (no hay integración; solo reportes).
- Chat cliente–repartidor, evidencia fotográfica de entrega, entregas fallidas con política de devolución extendida, solicitudes simultáneas a varios repartidores con carrera, panel de incidencias con estados, rating de tienda separado, geocodificación/selección de dirección en mapa (revisar lo ya existente de V14/V15), seguimiento en segundo plano nativo.
- Filtro por tienda del superadmin en Productos y Pedidos, y cobertura por radio para elegir tienda según dirección del cliente (solo hay selector manual de tienda).
- Rotar llaves expuestas en el chat (Appwrite, Stripe, Geoapify).
