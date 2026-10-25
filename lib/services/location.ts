import * as Location from "expo-location";

import { LatLng, parseLatLng } from "@/lib/domain/coordinates";

export type LocationResult =
    | { ok: true; coords: LatLng }
    | { ok: false; reason: "denied" | "blocked" | "unavailable"; message: string };

/**
 * Pide permiso en primer plano y obtiene la posicion actual una sola vez.
 * No usa segundo plano: no esta configurado ni probado en este proyecto.
 */
export async function getCurrentPosition(): Promise<LocationResult> {
    try {
        const current = await Location.getForegroundPermissionsAsync();
        let status = current.status;
        let canAskAgain = current.canAskAgain;
        if (status !== "granted") {
            const asked = await Location.requestForegroundPermissionsAsync();
            status = asked.status;
            canAskAgain = asked.canAskAgain;
        }
        if (status !== "granted") {
            return canAskAgain
                ? { ok: false, reason: "denied", message: "Necesitamos permiso de ubicación para continuar." }
                : { ok: false, reason: "blocked", message: "El permiso de ubicación está bloqueado. Actívalo desde los ajustes del teléfono." };
        }

        const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced
        });
        const coords = parseLatLng(position.coords.latitude, position.coords.longitude);
        if (!coords) {
            return { ok: false, reason: "unavailable", message: "No se pudo obtener una ubicación válida." };
        }
        return { ok: true, coords };
    } catch {
        return { ok: false, reason: "unavailable", message: "No se pudo obtener tu ubicación. Revisa que el GPS esté activo." };
    }
}
