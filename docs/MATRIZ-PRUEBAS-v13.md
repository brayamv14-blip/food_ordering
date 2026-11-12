# Matriz de pruebas V13 — resultados reales

| Prueba | Tipo | Resultado |
|---|---|---|
| `npm ci` | automatizada | **NO EJECUTADA** (sin acceso a npm en este entorno) |
| `npx tsc --noEmit` | automatizada | **NO EJECUTADA** |
| `npx jest` (suite completa) | automatizada | **NO EJECUTADA** |
| `npx expo-doctor` / `expo config --type public` | automatizada | **NO EJECUTADA** |
| `git diff --check` | automatizada | **NO EJECUTADA** (el repositorio del usuario no está aquí; el parche tiene finales CRLF heredados) |
| Reglas puras con ejecutor mínimo propio (no es Jest): `v11.test.ts` + `home.test.ts` | automatizada parcial | 14 ok, 0 fallas |
| Revisión sintáctica TS/TSX (transpilación) y `node --check` de funciones/scripts | estática | 0 errores (no es chequeo de tipos) |
| Simulación del backend en memoria (`appwrite-functions/smoke-test`) | simulada | 414 ok, 0 fallas — **no prueba comportamiento real** |
| Pedido en línea real con Stripe test (verifica `paymentMethod=online`) | real | **NO EJECUTADA** |
| Webhook real, reembolso total/parcial real | real | **NO EJECUTADA** |
| Pago con app cerrada / recuperación | real | **NO EJECUTADA** |
| FCM real (abierta/cerrada/segundo plano) | real | **NO EJECUTADA** |
| GPS, permisos, rutas/ETA, Realtime nativo en Android físico | real | **NO EJECUTADA** |
| Tres roles end‑to‑end en Appwrite real; permisos reales (`verify-appwrite.mjs`) | real | **NO EJECUTADA** |
| Pantallas en distintos tamaños de Android | real | **NO EJECUTADA** (diseño con layouts flexibles y anchos relativos; sin captura en dispositivo) |
| APK/AAB (`eas build`) | real | **NO EJECUTADA** |
