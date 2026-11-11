# Bloqueos para producción (v9)

La app **no debe salir a producción** hasta cerrar los puntos «Bloqueante».

| # | Estado | Elemento | Qué falta |
|---|---|---|---|
| B1 | Bloqueante | Jest, `tsc`, `expo config`, `expo-doctor` | No ejecutados (sin acceso a npm en mi entorno). Correr en tu PC y corregir lo que salga. |
| B2 | Bloqueante | Claves expuestas | Rotar Stripe `sk_`/`pk_` de prueba, API key de Appwrite `standard_…` y Geoapify (pegadas en conversaciones). Revisar el historial de git por si se subieron. |
| B3 | Bloqueante | Pruebas reales de Appwrite | Atomicidad de `decrementRowColumn` y comportamiento al cruzar `min`/0 (R1). |
| B4 | Bloqueante | Pruebas reales de Stripe | Flujo completo en modo prueba con webhook real; luego modo producción con cuenta verificada. |
| B5 | Bloqueante | Permisos de tablas | Correr `verify-appwrite.mjs` y resolver todo CRÍTICO (menu escribible por clientes, orders legible). |
| B6 | Bloqueante | Consistencia de variables | `MENU_TABLE_ID`/`INVENTORY_MOVES_TABLE_ID` en las 4 funciones. |
| B7 | Alto | Push/FCM | Validar en dispositivo físico (google-services.json propio, fuera del repo). |
| B8 | Alto | GPS en Android | Probar permisos, GPS apagado, sin red. |
| B9 | Alto | Limitación de uso | Appwrite no ofrece rate limiting por usuario en Functions; solo hay el tope de 5 pedidos en línea sin pagar y la limitación de ubicación. Evaluar WAF/umbrales de Appwrite o Cloudflare. |
| B10 | Medio | R2: asignación sin compare-and-set | La verificación posterior estrecha la carrera pero no la elimina (ventana de milisegundos). Aceptable si se acepta el riesgo; detectar con eventos `assignment_conflict`. |
| B11 | Medio | Sin botón de reconciliación en la app | `reconcileInventory` existe en `admin-api` pero no tiene pantalla; ejecútala manualmente o pídeme la pantalla. |
| B12 | Medio | `adjustStock` modo `set` | Exacto solo sin compras concurrentes; preferir ajustes por delta. |
| B13 | Medio | Observabilidad | Sentry: revisar DSN, replays y que no se envíen datos personales; alertas de `LEAK`/`stock_release_failed` en los logs de las funciones. |
| B14 | Bajo | No implementado | Ubicación en segundo plano, cierres de caja, variantes con stock. |
| B15 | Bajo | Assets | `adaptive-icon.png` y `splash-icon.png` pesan lo mismo (posible duplicado). |
| B16 | Bajo | Finales de línea | Archivos nuevos en LF; tu repo usa CRLF en Windows. |

## Resultado de git diff --check
Ejecutado en un repositorio temporal (v6 confirmada + patch): `git apply --check` y la aplicación pasan, y el árbol resultante es idéntico al ZIP. `git diff --check` reporta advertencias solo por **retornos de carro (CRLF)** en archivos con finales de línea de Windows; con `core.whitespace=cr-at-eol` el resultado es **0 problemas**. Sobre **tu** repositorio: NO EJECUTADO.
