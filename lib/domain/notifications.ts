/** Notificaciones push: validacion de tokens y destino al tocar una notificacion. */

const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

export const isExpoPushToken = (t: unknown): t is string => typeof t === "string" && EXPO_TOKEN_RE.test(t);

export type NotificationRoute =
    | { pathname: "/order/[id]"; params: { id: string } }
    | { pathname: "/driver" };

/**
 * Convierte los datos de una notificacion en una ruta de la app. Los datos vienen
 * de fuera: solo se aceptan tipos conocidos y un orderId con formato valido.
 */
export function routeFromNotificationData(data: unknown): NotificationRoute | null {
    if (!data || typeof data !== "object") return null;
    const { type, orderId } = data as { type?: unknown; orderId?: unknown };
    if (type === "driver_assigned") return { pathname: "/driver" };
    if (type === "order_status" && typeof orderId === "string" && ORDER_ID_RE.test(orderId)) {
        return { pathname: "/order/[id]", params: { id: orderId } };
    }
    return null;
}
