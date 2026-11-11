# Inventario y estado real de funcionalidades (v8)

## Reglas de inventario (servidor)
- `menu.stock` (entero ≥ 0). **Vacío/null = el producto no controla existencias** (comportamiento anterior). Umbral de alerta: `menu.lowStockThreshold` (por omisión 5).
- Todo el control exige `INVENTORY_MOVES_TABLE_ID` en las Functions; sin ella queda **desactivado** (nada se descuenta).
- **Reserva al crear el pedido** (efectivo o en línea): descuento atómico con `decrementRowColumn(min: 0)`; si otra compra se llevó la última unidad, el pedido se deshace y responde `409 insufficient_stock`.
- **Liberación** (se devuelve el stock): al **cancelar** (cliente pendiente, personal; un reembolso siempre implica cancelar) y cuando la **sesión de pago vence sin cobro** (el webhook cancela el pedido pendiente sin pagar).
- **No** devuelven stock: entregado, entrega fallida, repartidor que rechaza.
- Estados: pedido en línea sin pagar → mantiene la reserva hasta pagar/vencer/cancelar (tope de 5 sin pagar por usuario). Pago pendiente/fallido → mantiene la reserva (se puede reintentar). Reembolso hecho desde el panel de Stripe sin cancelar el pedido → **no** libera stock (el personal debe cancelar).
- **Idempotencia:** cada movimiento tiene `rowId` determinista (hash de `r|x:pedido:producto`); Appwrite rechaza ids repetidos (409), por lo que reservar/devolver dos veces es imposible. Si devolver falla, no queda constancia y se reintenta.
- **Historial:** tabla `inventory_movements` (reserve, release, adjust, initial). Sin permisos de cliente.
- **Alertas:** al cruzar el umbral se envía push al personal/admin y la lista de productos marca “bajas”.

## Estado de funcionalidades
**Completo en código y probado con dobles (smoke 237 + Jest)**: cuenta, menú, carrito, pedidos idempotentes, cobertura, Stripe (servidor, webhook, reembolsos, tardíos, vencidas), push por evento, seguimiento con frescura de ubicación, ciclo de repartidor completo (disponibilidad, aceptar/rechazar, recogido, en camino, entrega fallida/reintento, historial, autoasignación opcional), panel de pedidos, **admin: productos, stock, usuarios/roles, pagos, reportes**.

**Parcial**: ubicación solo en primer plano; el panel de categorías es de solo selección; reportes limitados a 2,000 pedidos.

**Ausente**: cierres de caja, variantes con stock, cupones, reembolsos parciales, múltiples restaurantes, ubicación en segundo plano.

**Bloqueado por infraestructura (no verificado aquí)**: Appwrite real, Stripe real (modo prueba), Firebase/FCM, GPS en teléfono, `npm install`/Jest/tsc/expo-doctor (ver `AUDITORIA-v8.md`).

## v9

- `stockOf`: valores negativos cuentan como 0 (agotado), nunca como «sin control».
- El descuento ya no depende de `min`: se valida el valor devuelto y se compensa si es negativo.
- `orders.stockReserved` indica si el pedido reservó stock; cancelar/expirar/reembolsar solo devuelve si es `true` y se niega (503) si la función no puede devolver.
- `reconcileInventory` (admin-api, solo admin): devuelve stock de pedidos cancelados y de reservas huérfanas; idempotente.
- `INVENTORY_MOVES_TABLE_ID` y `MENU_TABLE_ID` deben estar en las cuatro funciones o en ninguna.
