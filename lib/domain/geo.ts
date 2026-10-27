/** Mapas (Leaflet + OpenStreetMap vía Geoapify) y geocodificación: lógica pura, sin red ni React. */
import { LatLng, parseLatLng } from "@/lib/domain/coordinates";

export interface GeoPlace {
    /** Texto completo de la dirección, listo para guardar. */
    line: string;
    latitude: number;
    longitude: number;
}

/** Centro por omisión (Ciudad de México) solo para abrir el selector; nunca se guarda como dato. */
export const DEFAULT_MAP_CENTER: LatLng = { latitude: 19.4326, longitude: -99.1332 };

export const MAP_ATTRIBUTION = "© OpenStreetMap contributors · Powered by Geoapify";

/** Convierte la respuesta de Geoapify (GeoJSON) en lugares válidos. Lo inválido se descarta. */
export function parseGeoapifyPlaces(data: unknown, limit = 5): GeoPlace[] {
    const features = (data as { features?: unknown })?.features;
    if (!Array.isArray(features)) return [];
    const out: GeoPlace[] = [];
    for (const f of features) {
        const props = (f as { properties?: Record<string, unknown> })?.properties ?? {};
        const line = typeof props.formatted === "string" ? props.formatted.trim().replace(/\s+/g, " ") : "";
        const coords = parseLatLng(props.lat, props.lon);
        if (!line || !coords || line.length > 200) continue;
        out.push({ line, latitude: coords.latitude, longitude: coords.longitude });
        if (out.length >= limit) break;
    }
    return out;
}

export interface MapMarker {
    id: string;
    position: LatLng;
    label?: string;
    /** `destination` (naranja), `driver` (morado), `restaurant` (rojo) o `pick` (el punto elegido). */
    kind: "destination" | "driver" | "pick" | "restaurant";
}

export interface MapData {
    markers: MapMarker[];
    route: LatLng[];
}

export type MapMessage =
    | { type: "ready" }
    | { type: "pick"; latitude: number; longitude: number }
    | { type: "error"; message: string };

/** Interpreta con seguridad un mensaje que viene del WebView (texto JSON no confiable). */
export function parseMapMessage(raw: unknown): MapMessage | null {
    if (typeof raw !== "string" || raw.length > 2000) return null;
    let m: unknown;
    try {
        m = JSON.parse(raw);
    } catch {
        return null;
    }
    const t = (m as { type?: unknown })?.type;
    if (t === "ready") return { type: "ready" };
    if (t === "pick") {
        const c = parseLatLng((m as { latitude?: unknown }).latitude, (m as { longitude?: unknown }).longitude);
        return c ? { type: "pick", ...c } : null;
    }
    if (t === "error") return { type: "error", message: String((m as { message?: unknown }).message ?? "").slice(0, 200) };
    return null;
}

/** Serializa a JSON seguro para incrustarlo dentro de un <script> (evita cerrar la etiqueta). */
export const safeJson = (v: unknown): string =>
    JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028|\u2029/g, "");

export const isValidApiKey = (k: unknown): k is string => typeof k === "string" && /^[A-Za-z0-9]{16,64}$/.test(k);

export interface MapHtmlOptions {
    apiKey: string;
    center: LatLng;
    zoom?: number;
    pickable?: boolean;
    data?: MapData;
}

/**
 * HTML del mapa para el WebView. Leaflet 1.9.4 con teselas de OpenStreetMap servidas por Geoapify
 * (con la atribución obligatoria). Solo dibuja lo que la app le manda: no inventa ubicaciones.
 * Los datos se actualizan sin recargar con `window.setMapData(json)`.
 */
export function buildMapHtml({ apiKey, center, zoom = 15, pickable = false, data = { markers: [], route: [] } }: MapHtmlOptions): string {
    if (!isValidApiKey(apiKey)) throw new Error("Clave de mapas inválida");
    const tiles = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${apiKey}`;
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0;padding:0}.pin{width:18px;height:18px;border-radius:50%;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.5)}</style>
</head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var post = function (m) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
  if (typeof L === 'undefined') { post({ type: 'error', message: 'No se pudo cargar el mapa' }); return; }
  var map = L.map('map', { zoomControl: true }).setView([${center.latitude}, ${center.longitude}], ${Math.round(zoom)});
  var layer = L.tileLayer(${safeJson(tiles)}, { maxZoom: 19, attribution: ${safeJson(MAP_ATTRIBUTION)} }).addTo(map);
  var errors = 0;
  layer.on('tileerror', function () { if (++errors === 4) post({ type: 'error', message: 'No se pudieron cargar las teselas del mapa' }); });
  var COLORS = { destination: '#FE8C00', driver: '#8B5CF6', pick: '#16A34A', restaurant: '#DC2626' };
  var group = L.layerGroup().addTo(map), line = null, fitted = false;
  window.setMapData = function (d, fit) {
    group.clearLayers(); if (line) { map.removeLayer(line); line = null; }
    var pts = [];
    (d.markers || []).forEach(function (m) {
      var icon = L.divIcon({ className: '', html: '<div class="pin" style="background:' + (COLORS[m.kind] || '#555') + '"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      var mk = L.marker([m.position.latitude, m.position.longitude], { icon: icon }).addTo(group);
      if (m.label) mk.bindTooltip(String(m.label));
      pts.push([m.position.latitude, m.position.longitude]);
    });
    if (d.route && d.route.length > 1) {
      var rp = d.route.map(function (p) { return [p.latitude, p.longitude]; });
      line = L.polyline(rp, { color: '#8B5CF6', weight: 4 }).addTo(map);
    }
    if (fit !== false && pts.length) {
      if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 15)); else map.fitBounds(pts, { padding: [50, 50] });
    }
  };
  ${pickable ? "map.on('click', function (e) { post({ type: 'pick', latitude: e.latlng.lat, longitude: e.latlng.lng }); });" : ""}
  window.setMapData(${safeJson(data)}, true);
  post({ type: 'ready' });
})();
</script></body></html>`;
}
