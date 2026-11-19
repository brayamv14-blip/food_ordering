# Informe de auditoría V15

Fecha: 2026-11-12. Alcance: proyecto Fast Food (food_ordering) + V14, ahora acumulado con V15.

> Regla de este informe: en **A** solo hay cosas que **yo ejecuté** y vi pasar. Lo demás no se declara terminado.

## Hallazgos de la auditoría inicial

| # | Hallazgo | Gravedad | Estado |
|---|---|---|---|
| 1 | **No existía creación de usuarios en el servidor** (causa de "no puedo crear usuarios"): `admin-api` solo listaba usuarios y cambiaba etiquetas. | Alta | Corregido (`createUser` con reversión) |
| 2 | Todo el sistema asumía **una sola tienda** (productos, pedidos, inventario, horarios, cupones, tarifas globales). | Alta | Implementado multitienda (opt-in) |
| 3 | `setRole` permitía a cualquier admin dar `admin` a cualquiera; el rol `staff` veía todo. | Alta | `setRole` solo global; alta/edición por `createUser`/`updateUser` con reglas |
| 4 | Un admin podía operar pedidos, productos, stock, pagos y reembolsos de **cualquier** pedido por ID. | Alta | Aislamiento por tienda en admin-api y update-order-status |
| 5 | Notificaciones de stock bajo / rechazos llegaban a **todo** el personal. | Media | Solo personal de la tienda del pedido |
| 6 | Repartidores sin tienda: se podía asignar/reclamar cualquier pedido. | Media | Asignación y reclamo limitados a la tienda; repartidor desactivado no se asigna |
| 7 | Categorías son un catálogo común (no por tienda). | Baja | **Limitación documentada**: solo alcance global las edita |
| 8 | Las preferencias (`prefs`) de Auth las edita el propio usuario → no sirven para rol/tienda. | Alta (diseño) | Rol y tienda en **etiquetas** (solo servidor) |
| 9 | Diferencias Functions locales vs desplegadas (V14): el `status.js` desplegado era distinto. | Media | `plan-gratuito` se regenera y se comprueba contra las fuentes (`cmp`); sube los `.tar.gz` nuevos; `diag` debe decir `v15` |
| 10 | Permisos de tablas de Appwrite, claves reales: **no se pudo auditar** (no tengo acceso a tu proyecto). | — | Ver C |

## A. TERMINADO Y COMPROBADO (ejecutado por mí)

- `node appwrite-functions/smoke-test/run-smoke.mjs` → **V14: 447 ok / 0 fallas** y **V15: 130 ok / 0 fallas** (simulación en memoria de Appwrite, **no** es Appwrite real). Cubre:
  - Usuarios: crear cliente, admin de tienda, encargado, repartidor; correo duplicado; rol no autorizado; sin tienda; tienda inexistente/inactiva; contraseña corta; reversión si falla el rol; correo de recuperación (y su fallo); editar, cambiar rol/tienda, desactivar, reactivar, restablecer contraseña; historial; no cambiar el propio rol; nadie concede superadmin.
  - Multitienda: dos tiendas con usuarios; cada admin ve solo lo suyo (usuarios, pagos, reportes, dashboard, productos, movimientos); pedidos de otra tienda → 404; inventarios separados; producto de otra tienda → 422 sin tocar stock; tienda inactiva/cerrada → rechazo; horario, tarifa, radio y cupón **por tienda**.
  - Repartidores: asignación solo dentro de la tienda, inactivo rechazado, reclamo y listado por tienda, historial ajeno vacío.
  - Seguridad: sin sesión (401), rol incorrecto (403), cambiar el ID de tienda o de producto ajeno, elevar privilegios, modificar pedidos ajenos.
  - V14 sobre multitienda: cancelación del cliente con devolución de stock a su tienda, calificación.
  - Paquete de plan gratuito (2 funciones) enruta las acciones nuevas.
- `node --check` de todas las Functions y scripts; `plan-gratuito` regenerado y comparado con las fuentes.
- `scripts/migrate-selftest.mjs` (con servidor simulado): vista previa sin escrituras, aplicación, idempotencia y reversión.
- `scripts/v15-setup.mjs` (superadmin): vista previa, aplicar, idempotente, correo inexistente (con servidor simulado).
- Lógica pura de roles de la app (`lib/domain/access.ts`): 20 aserciones en un ejecutor mínimo (**no es Jest**).

## B. IMPLEMENTADO PERO NO VALIDADO

Requiere tu equipo, credenciales o dispositivo:

1. `npx tsc --noEmit`, `npx jest` (incluye las 2 suites V15 nuevas y las 3 de V14), `npm run lint`, `expo-doctor`, build EAS: **NO EJECUTADAS** (no tengo `npm` aquí). Si aparece algún error de tipos en las pantallas nuevas, mándame la salida.
2. Pantallas nuevas (`app/admin/users.tsx`, `app/admin/stores.tsx`, `components/StorePicker.tsx`) y los cambios de Home/Checkout: **sin probar en dispositivo**.
3. Creación real de usuarios en Appwrite (códigos de error reales de `users.create`, correo de recuperación real, SMTP).
4. Migración real (`--apply`) sobre tu proyecto: solo probada con simulador.
5. Pago en línea y reembolso con Stripe por tienda (la lógica es la de V14; no hay llaves aquí).
6. Consulta `Query.or([equal, isNull])` del menú de la tienda `main` en `react-native-appwrite` real.
7. Notificaciones push por tienda; ubicación del repartidor en segundo plano.

## C. PENDIENTE (no implementado)

- Categorías por tienda (hoy son comunes; solo alcance global las edita).
- Selector de tienda en el dashboard del superadmin (la API ya acepta `storeId`; la UI no lo expone todavía).
- Pantalla de repartidores con filtro por tienda y vista de "propinas/ganancias" por repartidor (el servidor ya filtra por tienda).
- Persistir la tienda elegida del cliente entre sesiones (hoy se vuelve a elegir al abrir).
- Auditoría de **permisos de tablas** del proyecto real de Appwrite y rotación de llaves expuestas (hazlo tú): las llaves de Appwrite/Stripe/Geoapify que se mostraron en el chat deben rotarse.
- Backfill opcional de `storeId` en pedidos/productos antiguos (no hace falta: sin valor = `main`).
- Pruebas de componentes (Jest) para las pantallas nuevas.

## Checklist de implementación

- [ ] Rotar llaves expuestas (Appwrite, Stripe, Geoapify)
- [ ] `tar -xf food_ordering_V14_V15_ACUMULADO.zip` sobre el proyecto
- [ ] `npx tsc --noEmit` y `npx jest` → corregir/enviarme errores
- [ ] `node scripts\appwrite-migrate.mjs` → revisar → `--apply`
- [ ] `node scripts\v15-setup.mjs seed-store ... --apply`
- [ ] `node scripts\v15-setup.mjs superadmin --email ... --apply`
- [ ] Variables de Functions: `STORES_TABLE_ID`, `RECOVERY_URL`, `INVENTORY_MOVES_TABLE_ID`
- [ ] Subir los 2 `.tar.gz` y verificar `diag` = `v15`
- [ ] Probar: crear tienda B, admin B, encargado y repartidor; pedido en cada tienda; aislamiento
- [ ] Capturar stock inicial por producto
- [ ] Build EAS
