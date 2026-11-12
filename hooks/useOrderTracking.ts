import { useEffect, useState } from "react";

import { Order } from "@/lib/domain/order";
import { isTerminalStatus } from "@/lib/domain/orderStatus";
import { startOrderWatcher } from "@/lib/domain/orderWatcher";
import { fetchOrder, subscribeToOrder } from "@/lib/services/orders.service";
import { advanceDemo, isDemoAutopilotEnabled } from "@/lib/services/payments.service";

export interface OrderTrackingState {
    order: Order | null;
    loading: boolean;
    error: string | null;
    /** true si la ultima consulta fallo pero hay datos previos en pantalla. */
    stale: boolean;
}

/**
 * Mantiene el pedido actualizado: suscripcion en tiempo real + consulta
 * periodica de respaldo (10 s). Se limpia al salir de la pantalla y se detiene
 * solo cuando el pedido llega a un estado final.
 */
export function useOrderTracking(orderId: string | undefined, userId?: string): OrderTrackingState {
    const [state, setState] = useState<OrderTrackingState>({
        order: null,
        loading: true,
        error: null,
        stale: false
    });

    useEffect(() => {
        if (!orderId) {
            setState({ order: null, loading: false, error: "Pedido no especificado.", stale: false });
            return;
        }
        setState({ order: null, loading: true, error: null, stale: false });

        const watcher = startOrderWatcher<Order>({
            fetch: () => fetchOrder(orderId, userId),
            subscribe: (onEvent) => subscribeToOrder(orderId, onEvent),
            pollMs: 10000,
            shouldStop: (o) => isTerminalStatus(o.status),
            onUpdate: (order) =>
                setState({ order, loading: false, error: null, stale: false }),
            onError: (e: any) =>
                setState((prev) => ({
                    order: prev.order,
                    loading: false,
                    stale: prev.order !== null,
                    error:
                        e?.code === "forbidden"
                            ? "No tienes acceso a este pedido."
                            : "No pudimos actualizar el pedido. Revisa tu conexión."
                }))
        });

        // MODO DEMOSTRACION (apagado por omision): cada 4 s pide al servidor avanzar la simulacion y refresca.
        let demoTimer: ReturnType<typeof setInterval> | null = null;
        if (isDemoAutopilotEnabled()) {
            let busy = false;
            demoTimer = setInterval(async () => {
                if (busy) return;
                busy = true;
                try {
                    const r = await advanceDemo(orderId);
                    if (r.done && demoTimer) clearInterval(demoTimer);
                    const fresh = await fetchOrder(orderId, userId);
                    setState({ order: fresh, loading: false, error: null, stale: false });
                } catch {
                    /* mejor esfuerzo: el siguiente ciclo reintenta */
                } finally {
                    busy = false;
                }
            }, 4000);
        }

        return () => {
            watcher.stop();
            if (demoTimer) clearInterval(demoTimer);
        };
    }, [orderId, userId]);

    return state;
}
