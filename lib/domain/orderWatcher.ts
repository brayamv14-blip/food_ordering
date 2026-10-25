/**
 * Vigila un pedido combinando suscripción en tiempo real (si esta disponible)
 * con consulta periódica de respaldo. No depende de React ni de Appwrite:
 * recibe sus dependencias por parametro para poder probarlo con relojes falsos.
 */

export interface OrderWatcherOptions<T> {
    /** Obtiene el estado actual del pedido. */
    fetch: () => Promise<T>;
    /**
     * Abre la suscripción en tiempo real. Debe devolver la funcion que la cierra.
     * Si lanza o `undefined`, el vigilante sigue solo con consulta periódica.
     */
    subscribe?: (onEvent: () => void) => (() => void) | undefined;
    onUpdate: (value: T) => void;
    onError: (error: unknown) => void;
    /** Intervalo de consulta (ms). Por omision 10 s. Minimo 2 s. */
    pollMs?: number;
    /** Si devuelve true, el vigilante se detiene solo (p. ej. pedido finalizado). */
    shouldStop?: (value: T) => boolean;
}

export interface OrderWatcher {
    stop: () => void;
    refresh: () => Promise<void>;
}

const MIN_POLL_MS = 2000;

export function startOrderWatcher<T>(options: OrderWatcherOptions<T>): OrderWatcher {
    const pollMs = Math.max(MIN_POLL_MS, options.pollMs ?? 10000);
    let stopped = false;
    let inFlight = false;
    let pending = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | undefined;

    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
        try {
            unsubscribe?.();
        } catch {
            /* la suscripción ya estaba cerrada */
        }
        unsubscribe = undefined;
    };

    const refresh = async (): Promise<void> => {
        if (stopped) return;
        // Evita solapar consultas: si llega otra mientras hay una en curso,
        // se repite una sola vez al terminar.
        if (inFlight) {
            pending = true;
            return;
        }
        inFlight = true;
        try {
            const value = await options.fetch();
            if (stopped) return;
            options.onUpdate(value);
            if (options.shouldStop?.(value)) stop();
        } catch (error) {
            if (!stopped) options.onError(error);
        } finally {
            inFlight = false;
            if (pending && !stopped) {
                pending = false;
                void refresh();
            }
        }
    };

    try {
        unsubscribe = options.subscribe?.(() => void refresh());
    } catch (error) {
        options.onError(error);
    }

    timer = setInterval(() => void refresh(), pollMs);
    void refresh();

    return { stop, refresh };
}
