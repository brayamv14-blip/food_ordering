# Bloqueos para producción (v10) — añade a `BLOQUEOS-PRODUCCION-v9.md`

| # | Bloqueante | Acción |
|---|---|---|
| N1 | Confirmar que la función `create-order` desplegada es la v10 (`diag`) | Redeploy desde `plan-gratuito/` y ejecutar `diag`. Hasta entonces el bug del pago **no está resuelto**, solo detectable. |
| N2 | Webhook de Stripe real en `update-order-status` | Configurar `STRIPE_WEBHOOK_SECRET` y probar un evento. |
| N3 | Pruebas Jest/tsc/doctor en tu PC | Ejecutar y enviarme errores literales. |
| N4 | Rotar claves (Stripe, Appwrite, Geoapify) y no compartir `.env`/`google-services.json` | — |
| N5 | `EXPO_PUBLIC_RECOVERY_URL` con marcador | Poner valor real o quitar la función de recuperación. |
| N6 | Sin categorías editables, sin confirmación de recepción, sin ubicación en segundo plano, sin reembolso parcial | Funciones no implementadas; decidir si son necesarias. |
| N7 | Notificaciones push sin validar | Probar en dispositivo con FCM configurado. |
