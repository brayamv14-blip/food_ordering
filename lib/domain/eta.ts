import { OrderStatus } from "./orderStatus";

/** Minutos de viaje que se suponen si aun no hay ruta calculada. */
export const DEFAULT_TRAVEL_MINUTES = 12;
export const DEFAULT_PREP_MINUTES = 15;

export interface EtaInput {
    status: OrderStatus | null;
    /** Tiempo de preparacion configurado por el restaurante (minutos). */
    prepMinutes?: number | null;
    /** Duracion de la ruta por calles (segundos) cuando ya se conoce. */
    routeSeconds?: number | null;
}

/**
 * Tiempo estimado de llegada en minutos (estimacion, no promesa). Devuelve null si el pedido ya termino.
 * Pendiente/confirmado: preparacion completa + viaje; preparando: mitad de la preparacion + viaje; listo/recogido: viaje;
 * en camino: lo que falte de ruta (minimo 1).
 */
export function estimateEtaMinutes({ status, prepMinutes, routeSeconds }: EtaInput): number | null {
    if (!status || status === "delivered" || status === "cancelled" || status === "delivery_failed") return null;
    const prep = Math.max(0, Math.round(prepMinutes && prepMinutes > 0 ? prepMinutes : DEFAULT_PREP_MINUTES));
    const travel = routeSeconds && routeSeconds > 0 ? Math.ceil(routeSeconds / 60) : DEFAULT_TRAVEL_MINUTES;
    switch (status) {
        case "pending":
        case "confirmed":
            return prep + travel;
        case "preparing":
            return Math.ceil(prep / 2) + travel;
        default:
            return Math.max(1, travel);
    }
}

export const formatEta = (minutes: number | null): string | null =>
    minutes === null ? null : minutes <= 1 ? "Llega en ~1 min" : `Llega en ~${minutes} min`;
