import { LatLng, distanceMeters } from "./coordinates";

export interface DriverBroadcasterOptions {
    /** Obtiene la posicion actual (GPS real). Debe lanzar si no hay posicion. */
    getPosition: () => Promise<LatLng>;
    /** Envia la posicion al backend autorizado. */
    send: (position: LatLng) => Promise<void>;
    onSent?: (position: LatLng) => void;
    onError: (error: unknown, fatal: boolean) => void;
    /** Intervalo entre lecturas (ms). 5 s por omision, minimo 2 s. */
    intervalMs?: number;
    /** No se envia si el movimiento es menor a esto (m)... */
    minMoveMeters?: number;
    /** ...salvo que hayan pasado estos ms desde el ultimo envio (latido). */
    heartbeatMs?: number;
    now?: () => number;
}

/** Codigos HTTP/del backend tras los cuales reintentar no tiene sentido. */
const FATAL_CODES = new Set([401, 403, 404, 409, "forbidden", "not_on_the_way", "unauthenticated"]);

export const isFatalBackendError = (e: any): boolean => FATAL_CODES.has(e?.code);

export function startDriverBroadcaster(options: DriverBroadcasterOptions) {
    const intervalMs = Math.max(2000, options.intervalMs ?? 5000);
    const minMove = options.minMoveMeters ?? 5;
    const heartbeat = options.heartbeatMs ?? 30000;
    const now = options.now ?? Date.now;

    let stopped = false;
    let busy = false;
    let last: { position: LatLng; at: number } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
    };

    const tick = async () => {
        if (stopped || busy) return; // sin solapamientos
        busy = true;
        try {
            const position = await options.getPosition();
            if (stopped) return;
            if (last) {
                const moved = distanceMeters(last.position, position);
                if (moved < minMove && now() - last.at < heartbeat) return;
            }
            await options.send(position);
            if (stopped) return;
            last = { position, at: now() };
            options.onSent?.(position);
        } catch (error) {
            const fatal = isFatalBackendError(error);
            if (!stopped) options.onError(error, fatal);
            if (fatal) stop();
        } finally {
            busy = false;
        }
    };

    timer = setInterval(() => void tick(), intervalMs);
    void tick();
    return { stop, isRunning: () => !stopped };
}
