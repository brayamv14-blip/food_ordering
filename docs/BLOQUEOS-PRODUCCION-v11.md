# Bloqueos para producción (v11)
1. Nada probado en Android real ni con Appwrite/Stripe/FCM reales.
2. Jest, `tsc`, `expo-doctor`, `expo config`: NO EJECUTADAS (sin npm en el entorno de trabajo).
3. Atomicidad real del candado `rowId` y de `decrement` en Appwrite: validar con carga concurrente real.
4. Realtime en nativo sin activar (solo sondeo); ubicación en segundo plano no implementada.
5. Sin evidencia fotográfica de entrega, sin variantes/subida de imágenes, sin historial de ubicaciones.
6. Sin limitación de tasa (rate limiting) en funciones.
7. Rotar claves expuestas (Stripe, Appwrite, Geoapify); revisar `.env.example` con valores reales en tu historial git.
8. `EXPO_PUBLIC_RECOVERY_URL` placeholder; política de privacidad y términos pendientes.
