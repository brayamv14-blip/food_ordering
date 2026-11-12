# Despliegue v9 (guía; nada se despliega automáticamente)

Ningún paso de este documento se ejecutó contra tu proyecto. Todo es manual y revisable.

## 1. Aplicar el patch desde Windows (PowerShell, en la raíz del repo)
```powershell
git status                       # debe estar limpio y en la rama integrar-food-ordering-v5 (commit bdd48d2 = v6)
git switch -c integrar-food-ordering-v9
git apply --check --whitespace=nowarn ..\food-ordering-v9-acumulado.patch
git apply --whitespace=nowarn ..\food-ordering-v9-acumulado.patch
git status
```
- Si `--check` falla, **no fuerces**: tu árbol no coincide con la v6 base; usa el ZIP en una carpeta aparte y compara.
- No uses `git reset --hard` ni `git clean`. No hagas commit hasta correr los tests (§8).
- Si antes aplicaste v7 u v8, el patch no aplicará limpio: parte de la v6 limpia.

## 2. Funciones (4; el plan gratuito permite 5)
`create-order`, `update-order-status`, `stripe-webhook`, `admin-api` (nueva; crearla en la consola, runtime Node, `src/main.js`). Después de tocar `appwrite-functions/shared/rules.js` ejecuta `bash appwrite-functions/sync-shared.sh` y vuelve a desplegar **las cuatro**.

### Variables (nombres; los valores los pones tú en la consola, nunca en el repo)
| Variable | create-order | update-order-status | stripe-webhook | admin-api |
|---|---|---|---|---|
| `APPWRITE_FUNCTION_API_ENDPOINT` / `APPWRITE_FUNCTION_PROJECT_ID` | auto | auto | auto | auto |
| `DATABASE_ID`, `ORDERS_TABLE_ID` | ✔ | ✔ | ✔ | ✔ |
| `MENU_TABLE_ID` | ✔ | ✔ | ✔ | ✔ |
| `INVENTORY_MOVES_TABLE_ID` | ✔ | ✔ | ✔ | ✔ |
| `ORDER_ITEMS_TABLE_ID` / `USERS_TABLE_ID` (si ya los usabas) | como v6 | como v6 | como v6 | — |
| `STRIPE_SECRET_KEY` | ✔ | ✔ (reembolsos) | ✔ | — |
| `STRIPE_WEBHOOK_SECRET` | — | — | ✔ | — |
| `AUTO_ASSIGN_DRIVER` (`true`/`false`, opcional) | — | ✔ | — | — |
| `MAX_ACTIVE_PER_DRIVER` (opcional) | — | ✔ | — | — |

**Regla crítica:** `INVENTORY_MOVES_TABLE_ID` y `MENU_TABLE_ID` van en **todas** las funciones o en **ninguna**. v9 se niega a cancelar un pedido con stock reservado si la función no puede devolverlo, y `verify-appwrite.mjs` marca CRÍTICO la configuración inconsistente.

### Scopes de la API key dinámica de cada función
- `create-order`: `databases/tables rows read+write`, `users.read` (staff/admin para avisos), `messages.write` (push).
- `update-order-status`: lo anterior + **`users.write`** (guarda `driverAvailable` en prefs).
- `stripe-webhook`: `rows read+write`, `users.read`, `messages.write`.
- `admin-api`: `rows read+write`, **`users.read` + `users.write`** (roles). Ejecución: solo usuarios autenticados.
- Ninguna función lleva `Any`/`Guests` como permiso de ejecución, salvo `stripe-webhook` (es llamado por Stripe; la firma HMAC es la autenticación).

## 3. Migración (repetible, no destructiva)
```powershell
# .env.migration (NO se versiona) con endpoint, project, API key temporal de scopes mínimos de bases de datos
node scripts/appwrite-migrate.mjs            # vista previa: no cambia nada
node scripts/appwrite-migrate.mjs --apply    # crea solo lo que falta
node scripts/migrate-selftest.mjs            # opcional: autoprueba con un doble
```
Crea (si no existen): `orders.stockReserved` (bool, default false), `orders.driverResponse`, `menu.stock`, `menu.lowStockThreshold`, tabla `inventory_movements` (+ índices) **sin permisos de cliente**. Copia el id de la tabla nueva a `INVENTORY_MOVES_TABLE_ID`. Una corrida interrumpida se puede repetir. `--rollback` solo borra lo que el propio script creó y pide confirmación; no lo uses en producción con datos.
Los pedidos anteriores a v9 no tienen `stockReserved` (se interpreta `false`): no devolverán stock al cancelar, lo cual es correcto porque tampoco lo reservaron.

## 4. Permisos de tablas (lo verifica el script)
- `orders`: sin `read/create/update/delete` a nivel de tabla para `any/users/guests`; lectura por fila al dueño/repartidor asignado (la ponen las Functions).
- `menu`: lectura pública sí; **escritura solo por Functions** (cualquier permiso de escritura a clientes permite alterar stock/precios).
- `inventory_movements`: sin permisos de cliente.
## 5. Roles
Etiquetas de Auth: `admin`, `staff`, `driver`. El primer `admin` se pone a mano en la consola (Auth → usuario → Labels); después solo un admin concede roles desde la app.

## 6. Webhook de Stripe
Endpoint: URL de ejecución de `stripe-webhook`. Eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`. Copia el `whsec_…` a `STRIPE_WEBHOOK_SECRET`. Usa solo claves de **prueba** hasta cerrar `BLOQUEOS-PRODUCCION-v9.md`.

## 7. App (Expo)
Nueva variable pública: `EXPO_PUBLIC_FN_ADMIN_API` (id de la función `admin-api`; no es secreto). Nunca pongas `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` en `EXPO_PUBLIC_*`. `.env.example` solo trae valores falsos.

## 8. Orden recomendado
1. Aplicar patch → `npm install` → `npm test`, `npx tsc --noEmit`, `npx expo config --type public`, `npx expo-doctor`, `git diff --check`; `node appwrite-functions/smoke-test/run-smoke.mjs`.
2. Migración en vista previa → aplicar → configurar variables en las 4 funciones → desplegar funciones.
3. `node scripts/verify-appwrite.mjs` (solo lectura): corrige todo **CRÍTICO**.
4. Pruebas manuales (§9) en un proyecto de pruebas/clon, no en producción.
5. Rotar las claves expuestas.

## 9. Validación real que falta (ninguna ejecutada)
- **Appwrite:** `decrementRowColumn` realmente atómico con dos clientes simultáneos sobre `stock=1`; qué ocurre al pasar de 0 (rechazo o negativo; v9 soporta ambos). Si ves stock negativo persistente, ejecuta `reconcileInventory` y avísame.
- **Concurrencia de asignación** con dos cuentas staff reales.
- **Stripe (modo prueba):** pago aprobado, rechazado (`4000 0000 0000 0002`), sesión expirada, reembolso desde el panel; reintentos del webhook.
- **Firebase/FCM:** push a cliente, staff (stock bajo) y repartidor en dispositivo físico.
- **Android real:** permiso de ubicación en primer plano, GPS apagado, sin señal, ubicación vencida.
- **Reconciliación:** `reconcileInventory` sobre datos de prueba (no hay botón en la app: se invoca por la acción `reconcileInventory` de `admin-api`).
