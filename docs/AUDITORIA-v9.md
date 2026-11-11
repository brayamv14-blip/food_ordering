# Auditoría v9 (revisión de v8 y correcciones)

**Alcance:** código completo de v8 (4 Functions, reglas compartidas, scripts, cliente). **Método:** lectura de código + escenarios adversariales ejecutados contra las Functions con un *doble en memoria* de Appwrite y de Stripe (simulación, no servicios reales). Los hallazgos marcados **[reproducido]** fallaron al ejecutar la misma prueba contra el código de v8 antes de corregirlo.

> **Veredicto:** v9 corrige los defectos de integridad que pude demostrar, pero **no está lista para producción** (ver `BLOQUEOS-PRODUCCION-v9.md`): no se han ejecutado Jest, `tsc`, `expo-doctor` ni ninguna prueba contra Appwrite, Stripe, Firebase o un teléfono reales.

## Base y archivos
- Base declarada: **v6 limpia** (`integrar-food-ordering-v5`, commit `bdd48d2`). El patch `food-ordering-v9-acumulado.patch` es **acumulativo contra v6** e incluye v7 y v8 (no apliques v7/v8 antes).
- No puedo ver tu repositorio: asumo que tu v6 es idéntica al ZIP v6 que me enviaste. **Comprueba con `git apply --check`** (ver `DEPLOYMENT-v9.md`).
- v7/v8 existían solo como patches generados aquí; no sé si aplicaste alguno.

## Hallazgos y correcciones

### Críticos
| # | Hallazgo en v8 | Evidencia | Corrección v9 |
|---|---|---|---|
| C1 | **Sobreventa**: el descuento dependía de `decrementRowColumn(..., min: 0)`, pero la documentación de Appwrite no dice si violar el límite *rechaza* o *recorta*. Con una columna que admite negativos, 3 compradores de la última unidad compraron los 3 (stock −2). **[reproducido]** | smoke: «última unidad (columna que admite negativos)» | Ya no se usa `min`. Se lee el valor atómico que devuelve la operación; si es negativo se compensa al instante y se responde 409. Si la columna rechaza (400/409) también es «sin existencias»; errores de red/5xx se propagan (nunca se interpretan como «sin stock»). |
| C2 | **Stock negativo = ventas ilimitadas**: `stockOf` devolvía `null` («no controla inventario») para valores negativos. **[reproducido]** | smoke: «stock negativo… agotado» | `stockOf` trata negativos como 0. |
| C3 | **Fuga de existencias por configuración parcial**: si `INVENTORY_MOVES_TABLE_ID` faltaba en `update-order-status` o `stripe-webhook`, se reservaba en `create-order` pero **cancelar no devolvía nada, en silencio**. | smoke: «sin INVENTORY_MOVES_TABLE_ID no se cancela… (503)» | Cada pedido guarda `stockReserved`. Cancelar/expirar/reembolsar se **niega (503/500) antes de tocar dinero o estado** si no puede devolver. `verify-appwrite.mjs` detecta la configuración inconsistente. |
| C4 | **Rollback que pierde stock sin rastro**: si fallaba la devolución durante el rollback de una reserva a medias, el error se tragaba y la huella se borraba. **[reproducido]** | smoke: «si la devolución también falla…» | El rollback usa `release` (deja huella). Si también falla, queda una *reserva sin devolución* detectable; nueva acción admin `reconcileInventory` la repara (idempotente). |

### Altos
| # | Hallazgo en v8 | Corrección |
|---|---|---|
| H1 | `checkout.session.expired`: si liberar stock fallaba, el pedido ya estaba cancelado y el **reintento de Stripe no volvía a liberar**. | La liberación se reintenta en cada entrega del evento mientras el pedido esté cancelado (idempotente). |
| H2 | **Mismo intento enviado dos veces a la vez** (doble toque): un 500 y/o doble descuento por la carrera con el índice único. **[reproducido]** | Se reserva antes de crear el pedido (id decidido de antemano); la copia perdedora devuelve su reserva y responde con el pedido ganador. |
| H3 | **Eventos de Stripe fuera de orden**: `charge.refunded` antes de `completed` dejaba el pedido `pending` y luego «pagado» pese al reembolso. | `pending/failed → refunded` permitido; pedido pendiente reembolsado se cancela y devuelve stock; el «pagado» tardío no revierte. |
| H4 | `respondAssignment` aceptaba/rechazaba **pedidos terminados**: rechazar uno entregado borraba al repartidor del historial. | Exige pedido no terminado (409 `not_assignable`). |
| H5 | **Asignación concurrente**: dos empleados asignando a repartidores distintos recibían ambos 200 y se notificaba a quien ya no tenía el pedido; una aceptación podía caer sobre *otro* repartidor. | Verificación posterior a la escritura (409 `assignment_conflict` / `assignment_changed`). **Mitigación, no garantía** (ver riesgos). |
| H6 | `picked_up` solo salía a `on_the_way`: un cliente ilocalizable dejaba el pedido sin salida directa. | `picked_up → delivery_failed` (repartidor y personal). Prueba: todo estado no terminal alcanza uno terminal. |

### Medios
| # | Hallazgo | Corrección |
|---|---|---|
| M1 | Cancelar con devolución fallida respondía éxito sin avisar. | Respuesta `stockRelease: "pending"` + evento `stock_release_failed` + reconciliación. |
| M2 | `listProducts` (límite 200), `listPayments` y reportes **truncaban sin avisar**. | Paginación (hasta 1000 productos / 2000 pedidos) y bandera `truncated`. |
| M3 | `verify-appwrite.mjs` no revisaba permisos de `menu` ni lectura a nivel de tabla de `orders`. | Nuevos controles (solo lectura): escritura de clientes en `menu` y lectura abierta en `orders` se marcan **CRÍTICO**. |
| M4 | La simulación de las Functions no corría con `npm test`. | `run-smoke.mjs` multiplataforma + `__tests__/backend/functions.smoke.test.ts`. |
| M5 | Documentación decía que `update-order-status` solo necesita `users.read`; `setAvailability` usa `users.updatePrefs` (**users.write**). | Corregido en `DEPLOYMENT-v9.md`. |

### Bajos / informativos
- Sin límite de solicitudes por usuario en las Functions (solo el tope de 5 pedidos en línea sin pagar y 1 envío de ubicación por intervalo). Ver bloqueos.
- `adjustStock` con `set` es exacto solo sin compras simultáneas (se aplica como delta sobre una lectura).
- Archivos nuevos con finales de línea LF en un repositorio mayormente CRLF (`git diff --check` los marcará según tu `core.autocrlf`).
- Sin cierres de caja, variantes con stock ni ubicación en segundo plano (no se implementaron; ver `docs/AUDITORIA-v8.md` §7 para requisitos).

## Revisión por área (resultado)
- **Estados y roles:** autorización 100 % en servidor (`canActorTransition`). Cliente: solo cancela su pedido pendiente; no puede fijar `status`, `paymentStatus`, `total` ni `stockReserved` (probado). Repartidor: solo sus pedidos y solo transiciones de reparto, y solo tras aceptar. Staff/admin: transiciones válidas; pedidos en línea sin pagar no se confirman.
- **Inventario:** ver C1–C4/H1–H2. Reserva antes del pedido, liberación al cancelar/expirar/reembolsar, no al fallar la entrega. Historial reconstruible (reserve/release/adjust/initial con motivo y actor).
- **Pagos:** firma HMAC con cuerpo crudo y tolerancia de 5 min; importe/moneda/pedido revalidados; idempotencia (`checkout-…`, `refund-…`, `expire-…`); pago tardío sobre pedido cancelado se reembolsa una vez; no hay forma de que el cliente marque pagado.
- **Administración:** `admin-api` valida etiqueta en servidor; staff no escala privilegios (probado); solo admin concede/quita roles, sin auto-degradación ni quedarse sin admins; lista blanca de campos; imágenes solo `https`; reportes agregados sin PII (los pedidos listados llevan solo id y totales).
- **Repartidores:** ver H4–H6; ubicación solo del repartidor asignado, en `on_the_way`, con limitación de frecuencia; el cliente ve la ubicación por permiso de lectura de su fila.
- **Appwrite/despliegue:** migración repetible y no destructiva (vista previa por omisión, `--rollback` explícito); `verify-appwrite.mjs` es de solo lectura y nunca imprime valores de variables. CORS: las Functions de la app se invocan por SDK autenticado; `stripe-webhook` es servidor-a-servidor (no habilites CORS ni dominios públicos para las demás).

## Claves que deben rotarse
Las claves pegadas en conversaciones anteriores (Stripe `sk_`/`pk_` de prueba, API key de Appwrite `standard_…`, clave de Geoapify) **deben considerarse expuestas**: rótalas. No se reproducen aquí. Usa una API key de Appwrite con scopes mínimos solo para migraciones y bórrala después.
