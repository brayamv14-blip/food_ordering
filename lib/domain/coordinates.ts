/**
 * Coordenadas: distingue "dato ausente" de "ubicación válida".
 * Nunca se usa (0, 0) como valor por omision.
 */

export interface LatLng {
    latitude: number;
    longitude: number;
}

/** Convierte numero o texto numerico a numero finito; cualquier otro caso -> null. */
export function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
        if (value.trim() === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    return null;
}

/**
 * Devuelve un par válido o `null`.
 * Se rechaza (0, 0) porque es el valor típico de "sin dato" y cae en el océano.
 */
export function parseLatLng(lat: unknown, lng: unknown): LatLng | null {
    const latitude = toFiniteNumber(lat);
    const longitude = toFiniteNumber(lng);
    if (latitude === null || longitude === null) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;
    if (latitude === 0 && longitude === 0) return null;
    return { latitude, longitude };
}

/** Distancia aproximada en metros (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
    const R = 6371000;
    const rad = (d: number) => (d * Math.PI) / 180;
    const dLat = rad(b.latitude - a.latitude);
    const dLng = rad(b.longitude - a.longitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Antigüedad legible de una marca de tiempo ISO. */
export function describeAge(iso: string | null | undefined, now: Date = new Date()): string | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const seconds = Math.max(0, Math.round((now.getTime() - t) / 1000));
    if (seconds < 10) return "hace unos segundos";
    if (seconds < 60) return `hace ${seconds} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return new Date(t).toLocaleString("es-MX");
}
