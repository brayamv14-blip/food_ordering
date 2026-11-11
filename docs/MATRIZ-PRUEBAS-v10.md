# Matriz de pruebas v10

Tipos: **Auto-Jest** (suite del proyecto), **Simulación** (Functions reales contra un doble en memoria de Appwrite/Stripe), **Appwrite real**, **Stripe test real**, **Dispositivo**.
Estados: ✅ ejecutada y aprobada · ⛔ NO EJECUTADA.

| Prueba | Tipo | Estado | Evidencia / motivo |
|---|---|---|---|
| `npm test` (Jest, todas las suites) | Auto-Jest | ⛔ | npm bloqueado (403) en mi entorno. Ejecútalo: incluye los 3 tests nuevos de `commerce.test.ts`. |
| `npx tsc --noEmit` | Auto | ⛔ | sin dependencias. Solo verifiqué **sintaxis** de los 5 archivos TS/TSX editados con el compilador (transpile): sin errores de sintaxis; **no es comprobación de tipos**. |
| `npx expo-doctor`, `npx expo config --type public` | Auto | ⛔ | sin npm/red. |
| `git diff --check` | Auto | ⛔ sobre tu repo | |
| 305 escenarios de Functions (`run.sh` / `run-smoke.mjs`) | Simulación | ✅ 305 OK, 0 fallas | incluye 8 nuevos: contrato de pago, reintento, efectivo, `diag`, `listOrders` con ubicación, permisos |
| Webhooks (firma, duplicados, fuera de orden, expirado, reembolso) | Simulación | ✅ | no es Stripe real |
| Pedidos duplicados / `clientRequestId` | Simulación | ✅ | |
| Permisos cliente/repartidor/staff/admin | Simulación | ✅ | |
| Asignación simultánea | Simulación | ✅ (no prueba atomicidad real) | |
| Registro/inicio de sesión | Auto-Jest | ⛔ | `auth.test.ts` existe; sin ejecutar |
| Pantallas (checkout, admin, driver) | Auto-Jest | ⛔ | |
| **Pago en línea de punta a punta** | Stripe test real | ⛔ | requiere tu cuenta/despliegue |
| Webhook real de Stripe | Stripe test real | ⛔ | |
| Recuperación del pago (deep link `fastfood://orders`) | Dispositivo | ⛔ | |
| Atomicidad del inventario y de la asignación | Appwrite real | ⛔ | |
| Mapas, permisos GPS, GPS apagado, sin red | Dispositivo | ⛔ | |
| Push FCM (cliente/repartidor/admin) | Dispositivo + Appwrite real | ⛔ | |
| Seguimiento del repartidor en mapa (cliente y admin) | Dispositivo | ⛔ | |
