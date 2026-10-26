import { LatLng } from "@/lib/domain/coordinates";
import { decodePolyline } from "@/lib/domain/polyline";

export type RouteResult =
    | { ok: true; points: LatLng[]; distanceMeters: number | null; durationSeconds: number | null }
    | { ok: false; reason: "not_configured" | "no_route" | "denied" | "quota" | "network" };

/** Clave opcional de Google Directions API. Es publica en el cliente: restringela. */
export const directionsKey = (): string => process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY ?? "";

export const isRouteConfigured = (): boolean => directionsKey().length > 0;

/**
 * Pide una ruta real por calles a la Directions API. Sin clave NO se inventa
 * ninguna ruta: devuelve `not_configured`.
 */
export async function fetchRoute(
    origin: LatLng,
    destination: LatLng,
    fetchImpl: typeof fetch = fetch
): Promise<RouteResult> {
    const key = directionsKey();
    if (!key) return { ok: false, reason: "not_configured" };

    const url =
        "https://maps.googleapis.com/maps/api/directions/json" +
        `?origin=${origin.latitude},${origin.longitude}` +
        `&destination=${destination.latitude},${destination.longitude}` +
        `&mode=driving&language=es&key=${encodeURIComponent(key)}`;

    try {
        const res = await fetchImpl(url);
        if (!res.ok) return { ok: false, reason: "network" };
        const data: any = await res.json();
        if (data?.status === "OVER_QUERY_LIMIT" || data?.status === "OVER_DAILY_LIMIT") {
            return { ok: false, reason: "quota" };
        }
        if (data?.status === "REQUEST_DENIED") {
            return { ok: false, reason: "denied" };
        }
        if (data?.status !== "OK") return { ok: false, reason: "no_route" };
        const route = data.routes?.[0];
        const points = decodePolyline(route?.overview_polyline?.points);
        if (points.length < 2) return { ok: false, reason: "no_route" };
        const leg = route.legs?.[0];
        return {
            ok: true,
            points,
            distanceMeters: typeof leg?.distance?.value === "number" ? leg.distance.value : null,
            durationSeconds: typeof leg?.duration?.value === "number" ? leg.duration.value : null
        };
    } catch {
        return { ok: false, reason: "network" };
    }
}
