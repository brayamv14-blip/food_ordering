# Administración (función `admin-api`)

Cuarta Function del proyecto (el plan gratuito permite 5; usas 4). Opcional: sin ella la app funciona, pero las pantallas **Productos e inventario**, **Reportes y pagos** y **Usuarios y roles** avisan que falta configurarla.

## Despliegue
1. `bash appwrite-functions/sync-shared.sh` (copia `shared/rules.js` a las 4 funciones).
2. Appwrite → Functions → crear `admin-api` (Node 22, entrypoint `src/main.js`, build `npm install`), **Execute access: Users**, scopes de la API key dinámica: filas (leer/escribir) y usuarios (leer/escribir: `users.write` para cambiar roles).
3. Variables: `DATABASE_ID, ORDERS_TABLE_ID, ORDER_ITEMS_TABLE_ID, MENU_TABLE_ID, INVENTORY_MOVES_TABLE_ID`, opcional `CATEGORIES_TABLE_ID` (id de la tabla de categorías).
4. En la app: `EXPO_PUBLIC_FN_ADMIN_API=<id de la función>` y reconstruir.

## Roles (etiquetas de Auth → usuario → Labels)
| Acción | `staff` | `admin` |
|---|---|---|
| Ver productos/stock/alertas, activar-desactivar, ajustar stock, ver movimientos | ✔ | ✔ |
| Ver pagos en línea y reportes (+ exportar CSV) | ✔ | ✔ |
| Crear/editar productos (precio, imagen, categoría, datos) | ✘ | ✔ |
| Ver usuarios y cambiar roles | ✘ | ✔ |
| Pedidos y repartidores (`update-order-status`) | ✔ | ✔ (admin cuenta como personal) |

**Primer administrador:** no hay forma de crearlo desde la app (a propósito). Ponle la etiqueta `admin` a tu cuenta en la consola de Appwrite. Después podrás dar roles desde la app. El servidor impide quitarse el propio rol de admin y dejar el sistema sin administradores.

## Qué hace el servidor
- Lista blanca de campos de producto; precio > 0 con máximo 2 decimales; imagen solo `https`; categoría debe existir; el stock **no** se cambia con `saveProduct` (solo con `adjustStock`, atómico y con historial).
- Reportes: ventas = suma de pedidos **entregados** del periodo; cancelaciones, ticket promedio, reembolsado y más vendidos salen de los pedidos reales. Máximo 2,000 pedidos por reporte (`truncated: true` si se alcanza).
- Pagos: solo pedidos en línea; la referencia de Stripe se muestra truncada (`…abc123`).
- CSV con protección contra fórmulas (`=`, `+`, `-`, `@`).

## No implementado
- **Cierres de caja y diferencias:** no existe modelo de caja; no se inventó. Requeriría tablas de turnos/arqueos (diseño pendiente).
- **Variantes de producto:** el modelo actual usa *extras* (customizations), sin stock propio.
- **Eliminar productos:** se desactivan (no se pierden pedidos históricos). Gestión de categorías: solo lectura/selección.
- **Límite de solicitudes (rate limit):** Appwrite Functions no lo trae; ver `docs/AUDITORIA-v8.md`.
