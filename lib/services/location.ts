import * as Location from "expo-location";

import { LatLng, parseLatLng } from "@/lib/domain/coordinates";

/** Por encima de este error (metros) la posicion no es util para una entrega. */
export const MAX_ACCEPTABLE_ACCURACY_M = 100;

export type LocationFailure = "denied" | "blocked" | "disabled" | "low_accuracy" | "unavailable";

export type LocationResult =
    | { ok: true; coords: LatLng; accuracy: number | null }
    | { ok: false; reason: LocationFailure; message: string };

/** Permiso rechazado de forma definitiva: reintentar no sirve hasta que el usuario cambie ajustes. */
export const isPermissionFailure = (reason: LocationFailure): boolean =>
    reason === "denied" || reason === "blocked";

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

        if (!(await Location.hasServicesEnabledAsync())) {
            return { ok: false, reason: "disabled", message: "El GPS está desactivado. Actívalo para continuar." };
        }

        const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
        });
        const coords = parseLatLng(position.coords.latitude, position.coords.longitude);
        if (!coords) {
            return { ok: false, reason: "unavailable", message: "No se pudo obtener una ubicación válida." };
        }
        const accuracy = typeof position.coords.accuracy === "number" ? position.coords.accuracy : null;
        if (accuracy !== null && accuracy > MAX_ACCEPTABLE_ACCURACY_M) {
            return {
                ok: false,
                reason: "low_accuracy",
                message: `Señal GPS débil (margen de ±${Math.round(accuracy)} m). Sal a un lugar abierto e inténtalo de nuevo.`
            };
        }
        return { ok: true, coords, accuracy };
    } catch {
        return { ok: false, reason: "unavailable", message: "No se pudo obtener tu ubicación. Revisa que el GPS esté activo." };
    }
}
