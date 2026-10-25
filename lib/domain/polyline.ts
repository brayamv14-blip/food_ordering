import { LatLng, distanceMeters } from "./coordinates";

/** Decodifica un polyline codificado de Google (precision 1e5). Devuelve [] si es invalido. */
export function decodePolyline(encoded: unknown): LatLng[] {
    if (typeof encoded !== "string" || encoded.length === 0) return [];
    const points: LatLng[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    const readValue = (): number | null => {
        let result = 0;
        let shift = 0;
        let byte: number;
        do {
            if (index >= encoded.length) return null;
            byte = encoded.charCodeAt(index++) - 63;
            if (byte < 0 || byte > 63) return null;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        return result & 1 ? ~(result >> 1) : result >> 1;
    };

    while (index < encoded.length) {
        const dLat = readValue();
        const dLng = readValue();
        if (dLat === null || dLng === null) return [];
        lat += dLat;
        lng += dLng;
        points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
    return points;
}

export interface RouteRequestState {
    origin: LatLng;
    at: number;
}

/**
 * Evita llamar al servicio de rutas (con costo/cuota) en cada actualizacion:
 * solo si no hay ruta previa, el repartidor se movio mas de `minMoveMeters`
 * o paso `minIntervalMs` desde la ultima consulta.
 */
export function shouldRefetchRoute(
    prev: RouteRequestState | null,
    origin: LatLng,
    now: number,
    opts: { minMoveMeters?: number; minIntervalMs?: number } = {}
): boolean {
    if (!prev) return true;
    const minMove = opts.minMoveMeters ?? 100;
    const minInterval = opts.minIntervalMs ?? 60000;
    if (now - prev.at < 10000) return false; // nunca mas de una consulta cada 10 s
    return distanceMeters(prev.origin, origin) >= minMove || now - prev.at >= minInterval;
}
