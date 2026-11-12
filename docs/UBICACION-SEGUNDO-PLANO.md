# Ubicación en segundo plano (Android) — análisis, NO implementado

Estado actual: la app envía ubicación solo en **primer plano** y se detiene al salir de la app (decisión de privacidad y de simplicidad).

Para seguir en segundo plano haría falta:
1. `expo-location` + `expo-task-manager` con `Location.startLocationUpdatesAsync` y **servicio en primer plano** (notificación persistente visible).
2. Permisos Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, y `POST_NOTIFICATIONS` (Android 13+). Se declaran en `app.json`/plugin; requiere **nuevo build nativo** (no sirve Expo Go).
3. Flujo de permisos en dos pasos (primero “al usar la app”, luego “permitir siempre” desde Ajustes en Android 11+).
4. Google Play: la ubicación en segundo plano exige formulario de **declaración de permisos**, política de privacidad y justificación (entrega en curso); puede ser rechazada.
5. Batería: fabricantes (Xiaomi, Huawei, Samsung) matan servicios; se recomienda pedir exclusión de optimización de batería.
6. Privacidad: compartir solo con pedido en camino y detener al entregar.
Sin esto, el cliente verá la ubicación “desactualizada” si el repartidor bloquea el teléfono. No se declara resuelto.
