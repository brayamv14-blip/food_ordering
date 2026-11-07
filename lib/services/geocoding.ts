import { GeoPlace, isValidApiKey, parseGeoapifyPlaces } from "@/lib/domain/geo";

export type GeoResult<T> = { ok: true; value: T } | { ok: false; reason: "not_configured" | "denied" | "quota" | "network" | "no_results" };

/** Clave PÚBLICA de Geoapify (restringe su uso por app/dominio en el panel de Geoapify). */
export const geoKey = (): string => process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY ?? "";
export const isGeoConfigured = (): boolean => isValidApiKey(geoKey());

async function call(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<GeoResult<GeoPlace[]>> {
    const key = geoKey();
    if (!isValidApiKey(key)) return { ok: false, reason: "not_configured" };
    const qs = new URLSearchParams({ ...params, lang: "es", apiKey: key });
    try {
        const res = await fetchImpl(`https://api.geoapify.com/v1/geocode/${path}?${qs.toString()}`);
        if (res.status === 401 || res.status === 403) return { ok: false, reason: "denied" };
        if (res.status === 429) return { ok: false, reason: "quota" };
        if (!res.ok) return { ok: false, reason: "network" };
        const places = parseGeoapifyPlaces(await res.json());
        return places.length ? { ok: true, value: places } : { ok: false, reason: "no_results" };
    } catch {
        return { ok: false, reason: "network" };
    }
}

/** Sugerencias de dirección mientras se escribe (México). Exige al menos 3 caracteres. */
export function autocompleteAddress(text: string, fetchImpl: typeof fetch = fetch): Promise<GeoResult<GeoPlace[]>> {
    const q = (text ?? "").trim().replace(/\s+/g, " ");
    if (q.length < 3 || q.length > 150) return Promise.resolve({ ok: false, reason: "no_results" });
    return call("autocomplete", { text: q, limit: "5", filter: "countrycode:mx" }, fetchImpl);
}

/** Coordenadas de una dirección escrita completa. */
export function geocodeAddress(text: string, fetchImpl: typeof fetch = fetch): Promise<GeoResult<GeoPlace[]>> {
    const q = (text ?? "").trim().replace(/\s+/g, " ");
    if (q.length < 3 || q.length > 200) return Promise.resolve({ ok: false, reason: "no_results" });
    return call("search", { text: q, limit: "1", filter: "countrycode:mx" }, fetchImpl);
}

/** Dirección de unas coordenadas (al elegir un punto en el mapa o usar el GPS). */
export async function reverseGeocode(latitude: number, longitude: number, fetchImpl: typeof fetch = fetch): Promise<GeoResult<GeoPlace>> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, reason: "no_results" };
    const r = await call("reverse", { lat: String(latitude), lon: String(longitude), limit: "1" }, fetchImpl);
    return r.ok ? { ok: true, value: r.value[0] } : r;
}

export const geoFailureMessage = (reason: string): string =>
    reason === "not_configured" ? "El buscador de direcciones no está configurado (EXPO_PUBLIC_GEOAPIFY_API_KEY)."
    : reason === "denied" ? "El servicio de mapas rechazó la clave. Revisa su configuración."
    : reason === "quota" ? "Se alcanzó el límite del servicio de mapas. Inténtalo más tarde."
    : reason === "no_results" ? "No encontramos esa dirección. Prueba con más detalle."
    : "No pudimos consultar el mapa. Revisa tu conexión.";
