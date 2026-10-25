/**
 * Definición única de los estados de un pedido: etiquetas, colores, iconos,
 * orden de la linea de progreso y transiciónes permitidas.
 *
 * IMPORTANTE: este modulo solo describe las reglas. La validación que cuenta
 * (la que impide a un cliente saltarse estados) debe ejecutarse en un backend
 * confiable; ver `appwrite-functions/` y APPWRITE-MIGRACION-Y-PERMISOS.md.
 */

export const ORDER_STATUSES = [
    "pending",
    "confirmed",
    "preparing",
    "on_the_way",
    "delivered",
    "cancelled"
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface StatusMeta {
    label: string;
    /** Nombre de icono de Ionicons. */
    icon: string;
    color: string;
    /** Fondo suave (hex con alfa) para etiquetas. */
    background: string;
    description: string;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
    pending: {
        label: "Pendiente",
        icon: "time-outline",
        color: "#FF9C01",
        background: "#FF9C0122",
        description: "Recibimos tu pedido y está esperando confirmación."
    },
    confirmed: {
        label: "Confirmado",
        icon: "checkmark-circle-outline",
        color: "#3B82F6",
        background: "#3B82F622",
        description: "El restaurante confirmó tu pedido."
    },
    preparing: {
        label: "Preparando",
        icon: "restaurant-outline",
        color: "#F59E0B",
        background: "#F59E0B22",
        description: "Estamos preparando tus alimentos."
    },
    on_the_way: {
        label: "En camino",
        icon: "bicycle-outline",
        color: "#8B5CF6",
        background: "#8B5CF622",
        description: "Tu pedido va hacia tu dirección."
    },
    delivered: {
        label: "Entregado",
        icon: "checkmark-circle",
        color: "#22C55E",
        background: "#22C55E22",
        description: "Pedido entregado. Buen provecho."
    },
    cancelled: {
        label: "Cancelado",
        icon: "close-circle-outline",
        color: "#EF4444",
        background: "#EF444422",
        description: "Este pedido fue cancelado."
    }
};

export const UNKNOWN_STATUS_META: StatusMeta = {
    label: "Estado desconocido",
    icon: "help-circle-outline",
    color: "#6B7280",
    background: "#6B728022",
    description: "No pudimos interpretar el estado de este pedido."
};

/** Transiciones válidas. Los estados finales no tienen salidas. */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["preparing", "cancelled"],
    preparing: ["on_the_way"],
    on_the_way: ["delivered"],
    delivered: [],
    cancelled: []
};

/** Pasos de la linea de progreso (el flujo feliz, sin `cancelled`). */
export const PROGRESS_STEPS: readonly OrderStatus[] = [
    "pending",
    "confirmed",
    "preparing",
    "on_the_way",
    "delivered"
];

/** Estados desde los cuales el CLIENTE puede cancelar su propio pedido. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = ["pending"];

export function isOrderStatus(value: unknown): value is OrderStatus {
    return (
        typeof value === "string" &&
        (ORDER_STATUSES as readonly string[]).includes(value)
    );
}

/** Devuelve el estado normalizado o `null` si el valor no es reconocido. */
export function parseOrderStatus(value: unknown): OrderStatus | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    return isOrderStatus(normalized) ? normalized : null;
}

export function getStatusMeta(value: unknown): StatusMeta {
    const status = parseOrderStatus(value);
    return status ? STATUS_META[status] : UNKNOWN_STATUS_META;
}

export function isTerminalStatus(value: unknown): boolean {
    const status = parseOrderStatus(value);
    return status === "delivered" || status === "cancelled";
}

export function canTransition(from: unknown, to: unknown): boolean {
    const a = parseOrderStatus(from);
    const b = parseOrderStatus(to);
    if (!a || !b) return false;
    return ALLOWED_TRANSITIONS[a].includes(b);
}

/** El cliente solo puede cancelar mientras el pedido siga pendiente. */
export function canCustomerCancel(value: unknown): boolean {
    const status = parseOrderStatus(value);
    return status !== null && CUSTOMER_CANCELLABLE.includes(status);
}

/**
 * Indice del paso actual en `PROGRESS_STEPS`.
 * -1 para cancelado o desconocido (la UI debe mostrarlo aparte).
 */
export function getProgressIndex(value: unknown): number {
    const status = parseOrderStatus(value);
    return status ? PROGRESS_STEPS.indexOf(status) : -1;
}

/** El mapa de seguimiento solo tiene sentido mientras el pedido va en camino. */
export function isTrackable(value: unknown): boolean {
    return parseOrderStatus(value) === "on_the_way";
}

export interface StaffAction {
    to: OrderStatus;
    label: string;
    destructive: boolean;
    /** Si existe, el boton se muestra deshabilitado con este motivo. */
    disabledReason?: string;
}

const ACTION_LABELS: Record<OrderStatus, string> = {
    pending: "Volver a pendiente",
    confirmed: "Confirmar pedido",
    preparing: "Empezar a preparar",
    on_the_way: "Enviar a reparto",
    delivered: "Marcar entregado",
    cancelled: "Cancelar pedido"
};

/**
 * Acciones que el panel de administracion ofrece para un pedido.
 * Solo refleja las transiciones validas; el servidor vuelve a validarlas.
 */
export function getStaffActions(status: unknown, hasDriver: boolean): StaffAction[] {
    const current = parseOrderStatus(status);
    if (!current) return [];
    return ALLOWED_TRANSITIONS[current].map((to) => ({
        to,
        label: ACTION_LABELS[to],
        destructive: to === "cancelled",
        ...(to === "on_the_way" && !hasDriver
            ? { disabledReason: "Asigna un repartidor primero." }
            : {})
    }));
}

/** Estados en los que aun tiene sentido asignar o cambiar repartidor. */
export function canAssignDriverTo(status: unknown): boolean {
    const s = parseOrderStatus(status);
    return s !== null && s !== "delivered" && s !== "cancelled";
}
