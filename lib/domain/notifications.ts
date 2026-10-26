/** Notificaciones push: validacion de tokens y destino al tocar una notificacion. */

const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

/**
 * Token NATIVO de FCM (el que entrega `getDevicePushTokenAsync` en Android). Appwrite Messaging con
 * el proveedor FCM envia a este token; NO es el token de Expo ("ExponentPushToken[...]"), que solo
 * sirve para el servicio de push de Expo y nunca debe guardarse como destino de Appwrite.
 */
export const isFcmToken = (t: unknown): t is string =>
    typeof t === "string" && /^[A-Za-z0-9_:\-]{100,4096}$/.test(t) && !t.startsWith("ExponentPushToken") && !t.startsWith("ExpoPushToken");

/** Un token de Expo (para detectarlo y rechazarlo como destino de Appwrite). */
export const isExpoPushToken = (t: unknown): t is string =>
    typeof t === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/.test(t);

/**
 * Id del destino push de Appwrite para ESTE dispositivo. Es estable (mismo dispositivo => mismo id), asi
 * que renovar el token actualiza el destino en vez de crear otro, y no se duplican dispositivos.
 * Appwrite acepta ids de hasta 36 caracteres [a-zA-Z0-9_.-] que no empiecen por simbolo.
 */
export function deviceTargetId(deviceId: unknown): string | null {
    if (typeof deviceId !== "string") return null;
    const clean = deviceId.replace(/[^A-Za-z0-9]/g, "").slice(0, 34);
    return clean.length >= 8 ? `d${clean}` : null;
}

/** El `$id` de un destino push que ya existe en la cuenta (de `account.get().targets`). */
export function findPushTarget(targets: unknown, targetId: string): { identifier: string } | null {
    if (!Array.isArray(targets)) return null;
    const hit = targets.find(
        (x) => x && typeof x === "object" && (x as { $id?: unknown }).$id === targetId && (x as { providerType?: unknown }).providerType === "push"
    ) as { identifier?: unknown } | undefined;
    return hit ? { identifier: typeof hit.identifier === "string" ? hit.identifier : "" } : null;
}

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
    // Estado del pedido y avisos de pago (pago recibido / fallido / reembolso) abren el pedido.
    if (type === "order_status" && typeof orderId === "string" && ORDER_ID_RE.test(orderId)) {
        return { pathname: "/order/[id]", params: { id: orderId } };
    }
    return null;
}
