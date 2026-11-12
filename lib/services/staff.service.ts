import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { OrderStatus } from "@/lib/domain/orderStatus";

/**
 * Cliente de la Function `update-order-status` (cambios de estado, panel de
 * personal, repartidor y ubicacion). Una sola funcion, distinguida por `action`.
 */
export interface StaffOrder {
    id: string;
    status: string;
    total: number;
    createdAt: string;
    /** Fecha de ultima actualizacion; se devuelve al servidor para detectar cambios ajenos. */
    updatedAt: string | null;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    /** Coordenadas reales de entrega (si el cliente las confirmó); null si no hay. */
    deliveryLatitude?: number | null;
    deliveryLongitude?: number | null;
    driverUserId: string | null;
    driverName: string | null;
    /** pending = asignado sin responder | accepted | null si no hay repartidor. */
    driverResponse?: "pending" | "accepted" | null;
    /** Ultima ubicacion compartida por el repartidor (null si no hay). */
    driverLatitude?: number | null;
    driverLongitude?: number | null;
    driverUpdatedAt?: string | null;
    /** Momento en que el cliente confirmo la recepcion (null si aun no). */
    receivedAt?: string | null;
    refundedAmount?: number;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    items: { name: string; quantity: number }[];
}

/** offline = desconectado | available = disponible | busy = ocupado (en transito o en su maximo). */
export type DriverStatus = "offline" | "available" | "busy";

export interface DriverOption {
    id: string;
    name: string;
    /** false si el repartidor se marco no disponible. */
    available?: boolean;
    /** Entregas activas que ya tiene. */
    activeOrders?: number;
    status?: DriverStatus;
    /** Ultima senal de su app reciente (informativo). */
    connected?: boolean;
    lastSeenAt?: string | null;
    inTransit?: number;
    userActive?: boolean;
}

/** Pedido sin repartidor visible para repartidores: SIN datos personales del cliente. */
export interface PoolOrder {
    id: string;
    status: string;
    createdAt: string;
    total: number;
    paymentMethod: "cash_on_delivery" | "online";
    itemsCount: number;
    /** Zona aproximada (~1 km), no la direccion. */
    areaLatitude: number | null;
    areaLongitude: number | null;
    distanceKm: number | null;
}

export interface MapPoint {
    id: string;
    status: string;
    driverUserId: string | null;
    deliveryAddress: string;
    deliveryLatitude: number | null;
    deliveryLongitude: number | null;
    driverLatitude: number | null;
    driverLongitude: number | null;
    driverUpdatedAt: string | null;
}

export interface DriversMap {
    restaurant: { latitude: number; longitude: number } | null;
    drivers: DriverOption[];
    orders: MapPoint[];
    unassigned: MapPoint[];
    at: string;
}

export interface OrderEvent {
    type: string;
    from: string | null;
    to: string | null;
    actorRole: string | null;
    actorId?: string | null;
    driverUserId?: string | null;
    /** Motivo o comentario (cancelaciones, rechazos, incidencias). */
    note?: string | null;
    at: string;
}

export interface OrderFilters {
    status?: OrderStatus;
    /** ISO 8601 */
    from?: string;
    to?: string;
    /** Id completo o ultimos caracteres (minimo 4). */
    query?: string;
}

/** Lo que el usuario vio al decidir; el servidor rechaza si el pedido cambio. */
export interface ExpectedState {
    expectedStatus?: string;
    expectedUpdatedAt?: string | null;
}

export class BackendNotConfiguredError extends Error {
    constructor(name: string) {
        super(`Falta configurar ${name} en el archivo .env.local.`);
        this.name = "BackendNotConfiguredError";
    }
}

const fn = (): string => {
    const id = appwriteConfig.functions.updateOrderStatus;
    if (!id) throw new BackendNotConfiguredError("EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS");
    return id;
};

export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = { offline: "Desconectado", available: "Disponible", busy: "Ocupado" };
export const DRIVER_STATUS_COLOR: Record<DriverStatus, string> = { offline: "#9CA3AF", available: "#16A34A", busy: "#F59E0B" };

const call = <T>(action: string, payload: Record<string, unknown> = {}) =>
    callBackendFunction<T>(fn(), { action, ...payload });

const clean = <T extends Record<string, unknown>>(o: T): Partial<T> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;

export async function listStaffOrders(filters: OrderFilters = {}): Promise<StaffOrder[]> {
    const res = await call<{ orders?: StaffOrder[] }>("listOrders", clean({ ...filters }));
    return Array.isArray(res?.orders) ? res.orders : [];
}

export async function listDrivers(): Promise<DriverOption[]> {
    const res = await call<{ drivers?: DriverOption[] }>("listDrivers");
    return Array.isArray(res?.drivers) ? res.drivers : [];
}

export async function assignDriver(orderId: string, driverUserId: string, expected: ExpectedState = {}): Promise<void> {
    await call("assignDriver", clean({ orderId, driverUserId, ...expected }));
}

export async function listMyDeliveries(history = false): Promise<StaffOrder[]> {
    const res = await call<{ orders?: StaffOrder[] }>("myDeliveries", history ? { history: true } : undefined);
    return Array.isArray(res?.orders) ? res.orders : [];
}

export async function getOrderHistory(orderId: string): Promise<{ enabled: boolean; events: OrderEvent[] }> {
    const res = await call<{ enabled?: boolean; events?: OrderEvent[] }>("orderHistory", { orderId });
    return { enabled: !!res?.enabled, events: Array.isArray(res?.events) ? res.events : [] };
}

/** Cambio de estado; el servidor decide si el usuario y la transicion son validos. */
export async function changeOrderStatus(orderId: string, status: OrderStatus, expected: ExpectedState = {}, reason?: string): Promise<void> {
    await call("updateStatus", clean({ orderId, status, ...expected, reason }));
}

/** Ubicacion del repartidor (solo repartidor asignado y pedido en camino). */
export async function sendDriverLocation(orderId: string, latitude: number, longitude: number): Promise<void> {
    await call("updateLocation", { orderId, latitude, longitude });
}

/** El repartidor acepta o rechaza el pedido que se le asigno. */
export async function respondAssignment(orderId: string, accept: boolean, reason?: string): Promise<void> {
    await call("respondAssignment", clean({ orderId, accept, reason }));
}

/** Pedidos sin repartidor que un repartidor conectado puede tomar (sin datos personales). */
export async function listAvailableOrders(): Promise<{ orders: PoolOrder[]; offline: boolean }> {
    const res = await call<{ orders?: PoolOrder[]; offline?: boolean }>("availableOrders");
    return { orders: Array.isArray(res?.orders) ? res.orders : [], offline: !!res?.offline };
}

/** Reclama un pedido de la bolsa. El servidor garantiza que solo UN repartidor lo obtenga (409 already_taken al otro). */
export async function claimOrder(orderId: string): Promise<void> {
    await call("claimOrder", { orderId });
}

/** El cliente confirma que recibio su pedido entregado. */
export async function confirmReceipt(orderId: string): Promise<string | null> {
    const res = await call<{ receivedAt?: string }>("confirmReceipt", { orderId });
    return res?.receivedAt ?? null;
}

/** El cliente avisa de un problema con su pedido (una vez por pedido). */
export async function reportOrderIssue(orderId: string, reason: string): Promise<void> {
    await call("reportIssue", { orderId, reason });
}

/** Solo administrador. Sin `amount` reembolsa lo que falte; con `amount` es parcial. El importe lo valida el servidor. */
export async function refundOrder(orderId: string, reason: string, amount?: number): Promise<{ refundedAmount: number; full: boolean }> {
    const res = await call<{ refundedAmount: number; full: boolean }>("refundOrder", clean({ orderId, reason, amount }));
    return { refundedAmount: res.refundedAmount, full: !!res.full };
}

/** Personal: repartidores con su estado, pedidos activos con ubicacion y pedidos sin asignar. */
export async function getDriversMap(): Promise<DriversMap> {
    const res = await call<Partial<DriversMap>>("driversMap");
    return {
        restaurant: res?.restaurant ?? null,
        drivers: Array.isArray(res?.drivers) ? res.drivers : [],
        orders: Array.isArray(res?.orders) ? res.orders : [],
        unassigned: Array.isArray(res?.unassigned) ? res.unassigned : [],
        at: res?.at ?? new Date().toISOString()
    };
}

export async function getDriverHistory(driverUserId: string): Promise<{ stats: { delivered: number; failed: number; cancelled: number; active: number }; orders: StaffOrder[] }> {
    const res = await call<{ stats?: { delivered: number; failed: number; cancelled: number; active: number }; orders?: StaffOrder[] }>("driverHistory", { driverUserId });
    return { stats: res?.stats ?? { delivered: 0, failed: 0, cancelled: 0, active: 0 }, orders: Array.isArray(res?.orders) ? res.orders : [] };
}

/** El repartidor indica si esta disponible para recibir asignaciones. */
export async function setDriverAvailability(available: boolean): Promise<boolean> {
    const res = await call<{ available?: boolean }>("setAvailability", { available });
    return res?.available === true;
}

/** true si el servidor rechazo porque el pedido cambio desde que se cargo la lista. */
export const isStaleOrderError = (e: unknown): boolean => (e as { code?: unknown })?.code === "stale_order";

/** Traduce errores del backend a mensajes para el usuario. */
export function describeBackendError(e: unknown): string {
    const err = e as { message?: string; code?: unknown };
    if (e instanceof BackendNotConfiguredError) return e.message;
    if (typeof err?.message === "string" && err.message && !/network|fetch|timeout/i.test(err.message)) return err.message;
    return "No pudimos completar la operación. Revisa tu conexión e inténtalo de nuevo.";
}
