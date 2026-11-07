/** Ubicación del restaurante (opcional) y enlaces de navegación externa. Nada se inventa: sin variables, no hay marcador. */
import { LatLng, parseLatLng } from "@/lib/domain/coordinates";

export interface Restaurant {
    name: string;
    location: LatLng;
}

/** Lee EXPO_PUBLIC_RESTAURANT_LATITUDE/LONGITUDE/NAME. Devuelve null si falta o es inválida. */
export function getRestaurant(env: Record<string, string | undefined> = process.env): Restaurant | null {
    const location = parseLatLng(env.EXPO_PUBLIC_RESTAURANT_LATITUDE, env.EXPO_PUBLIC_RESTAURANT_LONGITUDE);
    if (!location) return null;
    const name = (env.EXPO_PUBLIC_RESTAURANT_NAME ?? "").trim().slice(0, 60);
    return { name: name || "Restaurante", location };
}

/** Enlace para abrir la navegación (app de mapas del teléfono) hacia unas coordenadas reales. */
export function buildNavigationUrl(dest: unknown): string | null {
    const c = dest && typeof dest === "object" ? parseLatLng((dest as LatLng).latitude, (dest as LatLng).longitude) : null;
    return c ? `https://www.google.com/maps/dir/?api=1&destination=${c.latitude},${c.longitude}&travelmode=driving` : null;
}

/** Mensaje claro para errores conocidos de validación del servidor al crear un pedido. */
const SERVER_MESSAGE_CODES = new Set(["out_of_coverage", "coverage_unverified", "bad_address", "bad_coordinates", "payment_unavailable", "bad_phone"]);
export function friendlyServerError(error: unknown): string | null {
    const e = error as { code?: unknown; message?: unknown } | null;
    return e && typeof e.code === "string" && SERVER_MESSAGE_CODES.has(e.code) && typeof e.message === "string" ? e.message : null;
}
