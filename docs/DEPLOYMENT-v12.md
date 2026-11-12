# Despliegue V12 — permisos (orden obligatorio)

Quitar permisos `any` de las tablas **antes** de dar permisos por fila rompe la app. Orden:
1. **Respaldo**: exporta `orders`, `order_items`, `users`, `menu`, `categories` y guarda tu `appwrite.config.json` actual.
2. Despliega las Functions V11 (`docs/DEPLOYMENT-v11.md`) y publica la app V12 (el perfil nuevo ya nace con permisos por fila).
3. `node scripts/backfill-row-permissions.mjs` (simulación). Revisa el conteo y los “SIN DUEÑO”.
4. `node scripts/backfill-row-permissions.mjs --apply`.
5. Aplica los permisos de tabla del `appwrite.config.json` V12 (consola o `appwrite push tables` — revisa el diff antes; no empujes funciones/buckets a ciegas).
6. `node scripts/verify-appwrite.mjs`: debe terminar sin CRÍTICO.
7. Prueba con una cuenta cliente nueva y una antigua: ver “Mis pedidos”, editar perfil, crear pedido (efectivo y en línea test). Con una segunda cuenta confirma que NO ve pedidos ajenos.
8. Restringe la clave de Geoapify por dominio/app y rota las claves expuestas.
Los builds de producción exigen `EXPO_PUBLIC_FN_CREATE_ORDER`; sin ella el pedido falla con un mensaje claro (nunca escribe directo).
Los scripts de seed (`lib/seed.ts`) ya no funcionan desde la app con estos permisos: úsalos solo con API key desde un script o créalos en consola.
