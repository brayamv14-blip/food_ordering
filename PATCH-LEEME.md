# Food Ordering — patch final (Sprints 2 y 3)

## 1. Aplicar el patch (Windows, PowerShell)
Hay dos patches; usa **uno**:
- `food-ordering-incremental.patch` → si **ya aplicaste** el patch anterior (`food-ordering-sprints-2-3.patch`).
- `food-ordering-acumulado.patch` → si partes del proyecto **original** del Sprint 1.

```powershell
cd C:\Users\braya\Documents\food_ordering
git status                                   # árbol limpio; crea rama: git checkout -b sprint-final
git apply --check <patch>                    # prueba en seco
git apply <patch>
npm install                                  # el patch cambia package.json / package-lock.json
npm test ; npx tsc --noEmit
```
Si `git apply` se queja de saltos de línea (CRLF), repite con `git apply --ignore-whitespace <patch>`. Revertir: `git apply -R <patch>`.
Alternativa: extrae el ZIP sobre el proyecto (sobrescribe archivos; respalda antes).

⚠ `app/order/[id].tsx` no venía en el ZIP que recibí (los archivos con corchetes se pierden al comprimir). El patch acumulado lo **crea**; si ya tienes el tuyo, muévelo fuera de `app/` antes de aplicar y compáralo después. `app/product/[id].tsx` no se toca.

## 2. Cambios en Appwrite (en este orden; no quites permisos antes del paso 5)
1. **Esquema:** `npm i --no-save node-appwrite@22.1.1`, define `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` (clave de servidor, nunca en la app) y ejecuta `node scripts/appwrite-migrate.mjs` (vista previa) y luego `--apply`. Revertir: `--rollback --apply` (borra esas columnas).
   Confirma a mano que `users` tiene `phone, address1, address2, accountId, avatar` y que `orders.status` acepta `pending, confirmed, preparing, on_the_way, delivered, cancelled`.
2. **Functions** (carpeta `appwrite-functions/`, runtime Node, entrypoint `src/main.js`, build `npm install`, *Execute access: Users*): `create-order`, `update-order-status`, `update-driver-location`, `staff-api`. Antes: `bash appwrite-functions/sync-shared.sh`.
   Variables de cada función: `DATABASE_ID`, `ORDERS_TABLE_ID`, `ORDER_ITEMS_TABLE_ID`; y solo en `create-order`: `MENU_TABLE_ID`, `CUSTOMIZATIONS_TABLE_ID`, `MENU_CUSTOMIZATIONS_TABLE_ID` (opcional `DELIVERY_FEE`, `DISCOUNT`). Scopes de la API key dinámica: filas (leer/escribir) y usuarios (leer); verifica los nombres en tu consola.
3. **Etiquetas** (Auth → usuario → Labels): `staff` para administradores y `driver` para repartidores.
4. **Foto de perfil:** el bucket de imágenes debe permitir crear archivos a usuarios autenticados (las fotos se suben con lectura pública del archivo).
5. **Cuando TODO lo anterior funcione** (prueba 1–3 de la sección 4), quita Create/Update/Delete a *Users* en `orders` y `order_items` y activa seguridad por fila. Si algo falla, restaura esos permisos. Mientras sigan abiertos, **los pedidos no están protegidos**.

## 3. Variables de entorno (`.env.local`, copia de `.env.example`)
`EXPO_PUBLIC_APPWRITE_ENDPOINT`, `EXPO_PUBLIC_APPWRITE_PROJECT_ID` · `EXPO_PUBLIC_FN_CREATE_ORDER`, `EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS`, `EXPO_PUBLIC_FN_UPDATE_DRIVER_LOCATION`, `EXPO_PUBLIC_FN_STAFF_API` (IDs de las Functions; sin `FN_CREATE_ORDER` la app escribe directo = solo desarrollo) · `GOOGLE_MAPS_ANDROID_API_KEY` (Maps SDK for Android; se lee al compilar; restringe por paquete `com.jsm.foodordering` + SHA-1) · `EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY` (**opcional**: sin ella no se dibuja ruta; es visible en el cliente, restríngela a Directions API y vigila la cuota).

## 4. Ejecutar y probar
```powershell
npm test                      # 115 pruebas (Appwrite simulado)
npx tsc --noEmit
bash appwrite-functions/smoke-test/run.sh   # 46 escenarios de las Functions con doble en memoria (Git Bash/WSL)
npx expo start                # desarrollo
npx eas-cli build --platform android --profile preview    # APK (o: npx expo prebuild --platform android; cd android; .\gradlew assembleRelease)
```
Prueba manual mínima (requiere Appwrite real y dispositivo): (1) cliente hace un pedido → aparece en *Mis pedidos*; (2) cuenta `staff` → Perfil → *Administrar pedidos*: asigna repartidor y avanza estados; (3) cuenta `driver` → *Mis entregas*: “Compartir ubicación” → el cliente ve el marcador en el seguimiento; (4) tras el paso 5, un cliente no puede editar `orders` directamente.

## 5. Qué NO se pudo verificar
Appwrite real (Functions desplegadas, permisos, migración, realtime) · mapa y GPS en dispositivo · APK (sin Android SDK aquí) · ruta real (requiere tu clave) · instalación en Windows (probado en Linux) · `expo-doctor` completo (sin red: 18/21; falla además un `expo-file-system` duplicado que ya existía).
Límites: GPS solo en primer plano (se detiene si la app sale de primer plano); sin geocodificación ni selector de coordenadas en mapa; el correo no se edita (es el de la cuenta).
