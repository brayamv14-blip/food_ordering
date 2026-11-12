# Auditoría v11 — complemento (repartidores, mapas, administrador)

> **Estado honesto:** el sistema de mapas y el de repartidores **NO se declaran terminados**. Lo implementado se verificó con sintaxis, una simulación en memoria del backend (414 escenarios, 0 fallas) y revisión de código. **No** se ha probado en un Android real ni contra tu Appwrite/Stripe/Firebase reales. Tampoco se ejecutaron Jest, `tsc`, `expo-doctor` ni `expo config` (el entorno de trabajo no tiene `npm`): **NO EJECUTADAS**. La app **no está lista para producción**.

## 1. Qué se implementó (backend + app)

| Área | Implementación |
|---|---|
| Estados del repartidor | `offline / available / busy` + `connected` (señal ≤10 min). Offline solo si se apaga manualmente o la cuenta está desactivada; busy si lleva un pedido en camino o llegó a `MAX_ACTIVE_PER_DRIVER`. Los de señal vieja se excluyen de la auto‑asignación. |
| Pool de pedidos | Acción `availableOrders` (sin nombre/teléfono/dirección; zona redondeada a ~1 km). Pestaña **Disponibles** en la app. |
| Aceptación sin doble toma | `claimOrder`: *fila‑candado* con `rowId` determinista en `order_events` (Appwrite no tiene escritura condicional). El segundo recibe 409 `already_taken`. Requiere `ORDER_EVENTS_TABLE_ID`; sin ella cae a verificación posterior (más débil). |
| Asignación manual / reasignación | `assignDriver` usa el mismo candado (`assignment_conflict`); el admin ve estado/carga de cada repartidor. Rechazo o cancelación liberan el pedido; la cancelación avisa al repartidor. |
| Historial / trazabilidad | `order_events` guarda quién aceptó, recogió y entregó, con `note` (motivo). `driverHistory` por repartidor (estadísticas + últimos 50). |
| Flujo de entrega | Recogido → en camino → entregado; no se puede entregar sin haber salido; **confirmación de recepción del cliente** (`confirmReceipt`), **reporte de problema** (`reportIssue`, una vez), entrega fallida con **motivo obligatorio**. |
| Cancelaciones | Staff: motivo 3–200 caracteres obligatorio; devuelve stock una sola vez; reembolsa solo el remanente si ya hubo reembolso parcial. |
| Reembolsos | `refundOrder` (solo admin): total o parcial, en centavos, nunca más de lo pagado, llave de idempotencia en Stripe; webhook `charge.refunded` sincroniza `refundedAmount`. No existe “marcar como pagado” manual (a propósito). |
| Admin | Dashboard (ventas, pipeline, efectivo vs Stripe, top productos, repartidores por estado, periodos), categorías CRUD/activar (el cliente solo ve activas), clientes (direcciones solo bajo petición y auditado), activar/desactivar cuentas (no a uno mismo, no al último admin), pagos/reembolsos, bitácora `audit_log`, mapa operativo, historial con motivos. |

Pantallas nuevas: `app/admin/{dashboard,map,drivers,categories,customers,payments,audit}.tsx`, `components/{AdminShell,ReasonModal}.tsx`; modificadas: `app/driver/index.tsx`, `app/admin/index.tsx`, `app/order/[id].tsx`, `app/(tabs)/profile.tsx`.

## 2. Mapa y “tiempo real”
- Cliente: Realtime en web + sondeo cada 10 s; **en nativo solo sondeo** (`subscribeToOrder` no suscribe). Admin: **sondeo cada 15 s** con hora de última consulta visible. Nunca se presenta un botón de refrescar como tiempo real.
- Appwrite Realtime (WebSocket) es viable para nativo, pero **no se activó** porque no se pudo verificar en dispositivo; sería el siguiente paso, conservando el sondeo como respaldo.
- Ubicación del repartidor: solo **primer plano** (~5 s) mientras comparte; se detiene al salir de la app. Ver `UBICACION-SEGUNDO-PLANO.md`.
- Ruta/ETA: la app calcula distancia y estimación local; navegación externa por URL de mapas. Sin permiso GPS o con GPS apagado se muestra el error y se reintenta.

## 3. Matriz

Leyenda: **I** implementado · **S** probado en simulación en memoria / lectura de código · **R** probado en entorno real · **C** requiere configuración externa. **R = NO en ningún caso** (nada se probó en Android/Appwrite reales).

| Función | I | S | R | C |
|---|---|---|---|---|
| Estados offline/available/busy/connected | sí | sí | **NO** | migración + `MAX_ACTIVE_PER_DRIVER` |
| Pool + aceptar/rechazar | sí | sí | **NO** | `ORDER_EVENTS_TABLE_ID` |
| Doble aceptación simultánea | sí | sí (5 rondas) | **NO** | tabla `order_events` sin permisos de cliente |
| Asignación/reasignación manual | sí | sí | **NO** | — |
| Historial por repartidor | sí | sí | **NO** | — |
| Mapa admin (sondeo 15 s) | sí | parcial (datos del servidor) | **NO** | `RESTAURANT_LATITUDE/LONGITUDE`, clave Geoapify |
| Seguimiento cliente | sí (previo) | previo | **NO** | — |
| Ubicación en segundo plano | **NO** | — | — | ver doc dedicado |
| Foto/evidencia de entrega | **NO** | — | — | bucket de Storage + permisos |
| Confirmación de recepción / reporte | sí | sí | **NO** | columna `orders.receivedAt` |
| Cancelación con motivo + stock único | sí | sí | **NO** | — |
| Reembolso total/parcial | sí | sí (Stripe simulado) | **NO** | `STRIPE_SECRET_KEY`, webhook con `charge.refunded` |
| Dashboard / categorías / clientes / bitácora | sí | sí | **NO** | tabla `audit_log`, columna `categories.active` |
| Roles y privacidad (driver no ve pedidos ajenos, cliente no altera precios/estados) | sí | sí | **NO** | etiquetas Auth |
| Variantes / subida de imágenes admin | **NO** (solo URL https) | — | — | Storage |
| Historial de ubicaciones | **NO** | — | — | tabla nueva y política de privacidad |
| Jest / tsc / expo-doctor | — | **NO EJECUTADAS** | — | `npm ci` en tu PC |

## 4. Pruebas específicas solicitadas
Dos repartidores y mismo pedido (simulado, un ganador); repartidor pierde conexión (señal vieja → no auto‑asignable, `connected:false`); GPS apagado/permiso denegado (manejado en cliente, **sin probar en Android**); ubicación vieja (etiqueta “desactualizada”); cancelado tras asignar (repartidor notificado, stock devuelto una vez); entregado + confirmación del cliente; pago aprobado con app cerrada (el webhook actualiza el pedido, simulado); webhook repetido (idempotente); stock descontado/devuelto una vez; repartidor modificando pedido ajeno (rechazado). Todas en simulación. **Ninguna con servicios reales.**

## 5. Seguridad
Roles por etiquetas Auth validados en servidor en cada acción; el cliente solo envía ids/motivos, nunca precios, estados de pago ni totales; precios y envío se recalculan en `create-order`. Falta: limitación de tasa (rate limiting), y revisar permisos reales de tablas con `scripts/verify-appwrite.mjs` (ahora marca CRÍTICO si `order_events`/`categories`/`audit_log` aceptan escritura de clientes).

## 6. Qué desplegar
Solo `appwrite-functions/plan-gratuito/create-order` y `plan-gratuito/update-order-status`. Las cuatro carpetas originales son fuente/compartido. La de `update-order-status` enruta: estados y acciones de repartidor, **webhook de Stripe** (firma) y **todas las acciones de admin** (se comprobó que la lista cubre las 20 acciones de `admin-api`). No se pierde ninguna acción.
Nota de negocio: no se puede cancelar durante preparing/ready/en camino; para ese caso: `delivery_failed → cancelled`.

## 7. Claves
Las claves pegadas en conversaciones (Stripe sk/pk de prueba, Appwrite `standard_…`, Geoapify) deben **rotarse**. No están en ningún archivo entregado.
