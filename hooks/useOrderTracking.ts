import { useEffect, useState } from "react";

import { Order } from "@/lib/domain/order";
import { isTerminalStatus } from "@/lib/domain/orderStatus";
import { startOrderWatcher } from "@/lib/domain/orderWatcher";
import { fetchOrder, subscribeToOrder } from "@/lib/services/orders.service";

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

        return () => watcher.stop();
    }, [orderId, userId]);

    return state;
}
