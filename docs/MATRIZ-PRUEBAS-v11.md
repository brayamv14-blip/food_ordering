# Matriz de pruebas v11
| Prueba | Resultado |
|---|---|
| Simulación backend en memoria (`appwrite-functions/smoke-test`, run.sh y run-smoke.mjs) | 414 ok, 0 fallas (no equivale a Appwrite real) |
| `node --check` de todas las funciones y scripts | OK |
| Transpilación sintáctica de TS/TSX editados | 0 errores (no es chequeo de tipos) |
| `migrate-selftest` con stub | OK, idempotente |
| Jest (`__tests__/backend/v11.test.ts`, servicios, panels actualizados) | escritos; **NO EJECUTADA** (sin npm) |
| `tsc --noEmit`, `expo-doctor`, `expo config` | **NO EJECUTADA** |
| Android real / Appwrite real / Stripe / FCM | **NO EJECUTADA** |
