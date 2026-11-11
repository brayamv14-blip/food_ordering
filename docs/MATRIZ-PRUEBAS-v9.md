# Matriz de pruebas v9

**Tipos:** *Simulación* = Functions reales contra un doble en memoria de `node-appwrite` y de Stripe (no son servicios reales). *Unitaria* = reglas puras / servicios con mocks. *Real* = contra Appwrite/Stripe/Firebase/dispositivo.
**Estados:** ✅ EJECUTADA y aprobada · ❌ ejecutada y fallida · ⛔ **NO EJECUTADA** (motivo indicado).

> Entorno de esta auditoría: el proxy de red devuelve 403 al registro de npm → no hay `node_modules`, así que **Jest, `tsc`, `expo` y `expo-doctor` no pudieron ejecutarse**. No se sustituyen por otro ejecutor: los resultados de Jest son ⛔ hasta que los corras tú.

## 1. Comandos exigidos
| Comando | Estado | Evidencia / motivo |
|---|---|---|
| `npm test` (Jest, 28+ suites incl. `.tsx`) | ⛔ NO EJECUTADA | sin npm (403). Debes correrlo en tu PC. |
| `npx tsc --noEmit` | ⛔ NO EJECUTADA | sin dependencias de tipos. Solo revisé **sintaxis** con un `tsc` global (no es equivalente). |
| `npx expo config --type public` | ⛔ NO EJECUTADA | sin `expo`. `app.json` solo cambió en v8 (`versionCode`). |
| `npx expo-doctor` | ⛔ NO EJECUTADA | sin npm ni red a los servicios del doctor. |
| `git diff --check` | ✅ parcial | ejecutado en un repo temporal con v6 + patch (ver `BLOQUEOS` §«Resultado de git diff --check»); sobre tu repo: ⛔. |
| `node --check` de funciones y scripts | ✅ | sin errores. |
| `bash appwrite-functions/smoke-test/run.sh` / `node …/run-smoke.mjs` | ✅ Simulación | **288 OK, 0 fallas** |
| `node scripts/migrate-selftest.mjs` (doble de node-appwrite) | ✅ Simulación | plan v8/v9 correcto, idempotente, rollback limpio |

## 2. Cobertura exigida → pruebas
| Requisito | Prueba (nombre del escenario / test) | Tipo | Estado |
|---|---|---|---|
| Transiciones válidas/inválidas | smoke «invalid_transition…», «desde recogido…», «entregado no se cancela»; Jest `v9.test.ts` (sin callejones, cliente nunca a estados reservados), `orderStatus.test.ts`, `rules.test.ts` | Sim + Unit | Sim ✅ / Jest ⛔ |
| Permisos por rol | smoke «cliente/repartidor/staff…403» (≈60 casos), `admin: …403` | Sim | ✅ |
| Dos compras de la última unidad | smoke «última unidad (columna con mínimo 0 / que admite negativos)», `inventario: compras simultáneas`; Jest `v9.test.ts` | Sim + Unit | Sim ✅ / Jest ⛔ |
| Webhooks duplicados / fuera de orden | smoke «reembolso antes del pago», «eventos duplicados no repiten…», «pago tardío: un solo reembolso», «firma falsa → 400» | Sim | ✅ |
| Cancelaciones, expiraciones, reembolsos | smoke «vencida + devolución fallida», «REINTENTO de Stripe completa…», «reembolso + cancelación devuelve stock una vez» | Sim | ✅ |
| Reservas/devoluciones duplicadas | smoke «cancelar dos veces no devuelve dos veces», «reconciliar de nuevo…», «dos solicitudes simultáneas del mismo intento» | Sim + Unit | Sim ✅ / Jest ⛔ |
| Dos repartidores / asignación simultánea | smoke «asignación simultánea… solo una gana», «dos repartidores aceptan a la vez», «aceptar mientras se reasigna» (3 repeticiones) | Sim | ✅ (**no prueba atomicidad real**, ver riesgo R2) |
| Acceso administrativo no autorizado | smoke «cliente/repartidor → 403», «staff no crea productos / no se da admin», «staff no reconcilia» | Sim | ✅ |
| Errores de red, datos inválidos, fallos parciales | smoke «fallo en el 2.º producto», «devolución también falla», «JSON inválido», «precio negativo/imagen no https», `failItem`, `failPush`, `failEvents` | Sim | ✅ |
| Regresiones de flujos previos | los 237 escenarios de v8 siguen pasando; Jest `staff.service`, `panels`, `orderStatus`… | Sim + Unit | Sim ✅ / Jest ⛔ |
| Pantallas (aceptar/rechazar, recogido, fallo desde recogido, disponibilidad) | `panels.test.tsx` | Unit (RN Testing Library) | ⛔ |
| Servicio admin / frescura de ubicación | `admin.service.test.ts`, `order.test.ts` | Unit | ⛔ |

## 3. Arnés mínimo (NO es Jest)
Para no entregar reglas sin ejecutar nada, corrí `v8.test.ts` y `v9.test.ts` (solo lógica pura, sin React) con un ejecutor mínimo que implementa `describe/it/expect` básicos: **27 + 12 pasan, 0 fallan**. Es una comprobación mía de sanidad; **no equivale a Jest** y no se cuenta como tal.

## 4. Pruebas reales pendientes (necesitan tus servicios)
Todas ⛔ NO EJECUTADAS: atomicidad real de `decrementRowColumn`/`incrementRowColumn` y su error al violar `min` (ver riesgo R1), concurrencia real de asignaciones (R2), cobro en Stripe modo prueba + webhook, push por FCM, GPS en teléfono, permisos reales de tablas. Lista en `DEPLOYMENT-v9.md` §9.
