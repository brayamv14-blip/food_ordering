# V15 — Usuarios, roles y multitienda (acumulado V14 + V15)

Este paquete **incluye todo V14** y agrega V15. Se aplica **una sola vez** sobre tu proyecto base (el ZIP `food_ordering_completo_IA` que me diste). No hace falta aplicar V14 antes.

## 0. Causa raíz del problema "no puedo crear usuarios"

El backend **no tenía ninguna acción para crear usuarios**: `admin-api` solo podía *listar* usuarios y *cambiar etiquetas* de cuentas que ya existían, y la pantalla "Usuarios y roles" no tenía botón de alta. No era un error de permisos ni de variables: la función no existía. (Las cuentas solo se podían crear con el registro público de la app.)

V15 agrega `createUser` en el servidor, con estas garantías:

| Garantía | Cómo |
|---|---|
| Sin cuentas a medias | Auth es la **única fuente de verdad**: rol = etiqueta (`admin`/`staff`/`driver`), tienda = etiqueta `st<idTienda>`. No hay fila de perfil que pueda quedar huérfana: el perfil de la app se crea solo en el primer inicio de sesión (recuperación que ya existía en `getCurrentUser`). |
| Reversión | Si falla asignar rol/tienda, el servidor **borra la cuenta recién creada** (si el borrado también fallara, la desactiva y lo deja en la auditoría). |
| Sin elevar privilegios | Superadmin crea admin/encargado/repartidor/cliente. Admin de tienda crea encargado/repartidor/cliente **solo en su tienda**. Nadie crea superadmins desde la app. |
| Sin usuarios sin tienda | admin/encargado/repartidor exigen tienda existente y activa. |
| Correo duplicado | 409 `email_taken` (también si Appwrite lo detecta en la carrera). |
| Contraseña | Opcional. Sin contraseña: se genera una aleatoria que nadie conoce y se envía el **correo de recuperación**. Con contraseña: se usa, **nunca se registra ni se devuelve**. |
| Los roles no son editables por el usuario | Se usan **etiquetas** (solo el servidor las escribe), no `prefs` (el usuario las puede editar). |

## 1. Qué se conservó de V14 (todo)

Calificaciones, recibos, pedir de nuevo, propinas, cupones, envío por distancia, ETA, favoritos, cancelación + reembolso Stripe, horarios/cierre manual, preparación, estadísticas, simulación demo, detección por `driverUserId`, protección de carreras y de repartidores reales. Las 447 comprobaciones de V14 siguen pasando (`node appwrite-functions\smoke-test\run-smoke.mjs`).

**Compatibilidad:** sin `STORES_TABLE_ID` el sistema se comporta **exactamente como V14** (una sola tienda). Con multitienda activa, lo anterior a V15 pertenece a la tienda `main`:
- productos y pedidos sin `storeId` → tienda `main`;
- personal y repartidores V14 sin etiqueta de tienda → tienda `main`;
- un `admin` V14 sin etiqueta de tienda sigue siendo **administrador global** (ve todo). Para que sea administrador de una sola tienda, edítalo en la app y asígnale tienda; o conviértete en **superadministrador** (paso 5).

## 2. Qué se agregó

- **Roles:** superadmin (global) · admin de tienda · encargado · repartidor · cliente. Permisos en frontend (solo muestra/oculta) y **backend** (decide).
- **Multitienda:** tabla `stores` (nombre, descripción, imagen, dirección, teléfono, activa, horario, cierre manual, coordenadas, envío fijo/por km/máximo/radio, preparación, cupones propios). Cada tienda tiene sus **productos, precios, existencias, movimientos, pedidos, empleados, repartidores, horarios y reportes**.
- **Cliente:** selector de tienda (solo si hay multitienda y más de una tienda activa). Cambiar de tienda vacía el carrito. Tienda inactiva o cerrada no recibe pedidos. Cupones, envío, radio y horario se aplican **de la tienda del pedido**.
- **Administración de usuarios** (`/admin/users`): crear, buscar (nombre/correo), filtrar por rol y tienda, editar, cambiar rol/tienda (según permisos), activar/desactivar, restablecer contraseña por correo, historial.
- **Tiendas** (`/admin/stores`): superadmin crea/edita/activa/desactiva todas; admin de tienda edita solo la suya.
- **Repartidores:** solo se asignan los de la tienda del pedido y activos; un repartidor solo ve/reclama pedidos de su tienda; los de demostración (`demo-driver-N`) siguen separados de los reales y la simulación sigue pausándose con repartidores reales.
- **Inventario:** stock por producto (cada producto es de una tienda); validación al pedir y descuento solo en esa tienda; ajuste manual con motivo y responsable; sin stock negativo; movimientos filtrados por tienda.

## 3. Cómo aplicar el patch (Windows, CMD)

```bat
cd C:\ruta\a\tu\proyecto
tar -xf C:\ruta\food_ordering_V14_V15_ACUMULADO.zip
```
(`tar -xf` sobrescribe los archivos del paquete y no toca tu `.env`, `.env.migration`, `.env.respaldo` ni `google-services.json`: no vienen en el ZIP.)

Luego: `npm install` (no se agregaron dependencias) y comprueba con el paso 11.

## 4. Migración de Appwrite

Con tus variables de migración (las mismas de V14; la API key **solo** en tu `.env.migration`, nunca en el chat):

```bat
node scripts\appwrite-migrate.mjs            (vista previa: no escribe nada)
node scripts\appwrite-migrate.mjs --apply
```
Agrega (sin borrar nada): tabla `stores` (id por omisión `stores`, configurable con `APPWRITE_STORES_TABLE_ID`), columna `storeId` en `orders`, `menu` y `inventory_moves`, e índices. Es repetible: una segunda ejecución no cambia nada. **Hazlo antes de activar `STORES_TABLE_ID`.**

La tabla `stores` se crea **sin permisos de cliente** (solo las Functions la usan). No pongas permisos públicos de escritura en ninguna tabla.

## 5. Superadministrador inicial y tienda base (seguro)

Con las mismas variables (`APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` desde tu entorno local):

```bat
node scripts\v15-setup.mjs seed-store --name "Mi restaurante" --address "..." --phone "55..." --hours 09:00-22:00
node scripts\v15-setup.mjs seed-store --name "Mi restaurante" --apply
node scripts\v15-setup.mjs superadmin --email tu@correo.com
node scripts\v15-setup.mjs superadmin --email tu@correo.com --apply
```
- `seed-store` crea la tienda **`main`** (la de tus productos y pedidos anteriores). Si ya existe, no la toca.
- `superadmin` agrega la etiqueta a una **cuenta existente** (regístrala antes en la app). Es el **único camino** para crear un superadmin: la app y las Functions nunca lo conceden. Cierra sesión y vuelve a entrar.

## 6. Variables de las Functions (Appwrite → Functions → Settings → Variables)

Plan gratuito (2 Functions): pon las nuevas en **las dos**.

| Variable | Función | Para qué |
|---|---|---|
| `STORES_TABLE_ID` | create-order y update-order-status | **Activa la multitienda.** Id de la tabla `stores` (`stores` por omisión). Sin ella = V14. |
| `RECOVERY_URL` | update-order-status | Misma URL que `EXPO_PUBLIC_RECOVERY_URL` (https). Se usa para el correo de recuperación al crear usuarios / restablecer contraseña. |
| `INVENTORY_MOVES_TABLE_ID` | ambas | (pendiente V14) tabla `inventory_moves` creada por la migración. |
| Las de V14 (`OPEN_HOURS`, `DELIVERY_FEE*`, `COUPONS`, `RESTAURANT_*`, …) | create-order | Quedan como **valores por omisión**; lo que defina cada tienda en su fila manda. |

El hostname de `RECOVERY_URL` debe estar en Appwrite → Overview → Platforms (Web).

## 7. Desplegar las Functions

Sube **solo** los dos `.tar.gz` de `subir\` (ya generados desde `plan-gratuito`): `create-order.tar.gz` y `update-order-status.tar.gz` (Activate deployment). Si cambias código: `node appwrite-functions\sync-shared.mjs`, `node appwrite-functions\build-2-functions.mjs` y vuelve a empaquetar. Las funciones desplegadas **deben** coincidir con estas (V14 falló antes por usar una versión distinta): comprueba la versión con la acción `diag` (debe decir `v15`).

## 8. Crear tiendas, administradores y empleados

1. Entra como superadmin → **Tiendas → + Nueva** (nombre obligatorio; horario `HH:MM-HH:MM`; envío, radio y cupones opcionales).
2. **Usuarios → + Nuevo** → rol "Administrador de tienda" + tienda. Le llega un correo para fijar su contraseña (o escribe una tú; no se vuelve a mostrar).
3. El admin de tienda entra y crea sus **encargados y repartidores** (se asignan a su tienda automáticamente).
4. **Productos:** cada admin crea los suyos (quedan en su tienda). Los anteriores a V15 quedan en `main`.

## 9. Asignar repartidores

Admin/encargado abre un pedido → asignar repartidor: solo aparecen los de **esa tienda** y activos. Para cambiar a un repartidor de tienda: superadmin → Usuarios → Editar → tienda.

## 10. Inventario por tienda

`INVENTORY_MOVES_TABLE_ID` configurado + la migración aplicada. El stock inicial **lo capturas tú** (Productos → Ajustar stock con motivo "Inventario inicial"); no se inventa ningún dato. Productos sin stock capturado no controlan inventario (como en V14).

## 11. Pruebas (en tu máquina)

```bat
npx tsc --noEmit
npx jest
npm run lint
node appwrite-functions\smoke-test\run-smoke.mjs
node scripts\migrate-selftest.mjs
```
Suites nuevas V15: `__tests__/domain/v15.test.ts`, `__tests__/services/v15.test.ts`. Backend (simulación en memoria): `appwrite-functions/smoke-test/run15.mjs` (130 comprobaciones: usuarios, roles, multitienda, aislamiento, inventario, plan gratuito).

## 12. EAS Build

Sin cambios de dependencias ni de `app.json`. `npx expo-doctor` y `eas build --platform android --profile preview` como en V14 (ver `docs/V14-GUIA.md`). Variables públicas de la app: las mismas; **no hay llaves secretas en `EXPO_PUBLIC_*`**.

## 13. Qué queda pendiente de validar

Ver `docs/AUDITORIA-v15.md` (apartados A, B y C).
