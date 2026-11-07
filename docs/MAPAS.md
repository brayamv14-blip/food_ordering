# Mapas, direcciones y rutas (Geoapify + OpenStreetMap + Leaflet)

Se usa **Leaflet 1.9.4 dentro de `react-native-webview`** con teselas OpenStreetMap servidas por Geoapify. Funciona en Expo Go y en builds propios; **no requiere claves nativas ni Google Maps** (se quitó `react-native-maps` y `app.config.js`).

## Piezas
- `components/LeafletMap.tsx` + `lib/domain/geo.ts`: mapa en WebView (marcadores destino/repartidor/punto elegido, ruta, selección por toque). Los datos se actualizan con `setMapData` sin recargar. Atribución visible: “© OpenStreetMap contributors · Powered by Geoapify”.
- `lib/services/geocoding.ts`: autocompletar, geocodificar y geocodificación inversa (Geoapify, México, español).
- `lib/services/directions.ts` + `hooks/useRoute.ts`: ruta por calles repartidor → destino (Geoapify Routing); consultas limitadas.
- `components/AddressPicker.tsx` (Checkout → “Otra dirección” y Editar perfil): buscar dirección, **Usar mi ubicación** (permiso de ubicación solo al tocarlo; se explica el uso) o **Elegir en el mapa**. Siempre guarda texto + coordenadas reales; si se edita el texto a mano, las coordenadas se descartan.
- Seguimiento (`/order/tracking/[id]`): muestra el destino del pedido y la **última ubicación real** que el repartidor compartió (con su antigüedad). No se simula ni se inventa ninguna posición.
- Estados manejados: sin clave, clave rechazada (401/403), cuota (429), sin red, sin resultados, permiso denegado/bloqueado, GPS apagado, señal débil.

## Claves
`EXPO_PUBLIC_GEOAPIFY_API_KEY` en `.env.local` (es una clave **pública** por diseño: viaja en la app). En el panel de Geoapify restríngela (por ejemplo por app/origen) y vigila la cuota gratuita. No uses claves privadas aquí.

## Licencias
Datos © OpenStreetMap contributors (ODbL); servicio Geoapify (respeta sus términos y la atribución, ya incluida en el mapa).

## Restaurante y navegación del repartidor
Con `EXPO_PUBLIC_RESTAURANT_LATITUDE/LONGITUDE/NAME` (opcionales) el seguimiento muestra el marcador del restaurante (rojo) y el repartidor ve “Ir al restaurante”. “Ir con el cliente” abre la app de mapas del teléfono con las coordenadas confirmadas del pedido; sin coordenadas avisa en lugar de inventar un destino.
