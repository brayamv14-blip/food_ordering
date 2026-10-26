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
    driverUserId: string | null;
    driverName: string | null;
    items: { name: string; quantity: number }[];
}

export interface DriverOption {
    id: string;
    name: string;
}

export interface OrderEvent {
    type: string;
    from: string | null;
    to: string | null;
    actorRole: string | null;
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

export async function listMyDeliveries(): Promise<StaffOrder[]> {
    const res = await call<{ orders?: StaffOrder[] }>("myDeliveries");
    return Array.isArray(res?.orders) ? res.orders : [];
}

export async function getOrderHistory(orderId: string): Promise<{ enabled: boolean; events: OrderEvent[] }> {
    const res = await call<{ enabled?: boolean; events?: OrderEvent[] }>("orderHistory", { orderId });
    return { enabled: !!res?.enabled, events: Array.isArray(res?.events) ? res.events : [] };
}

/** Cambio de estado; el servidor decide si el usuario y la transicion son validos. */
export async function changeOrderStatus(orderId: string, status: OrderStatus, expected: ExpectedState = {}): Promise<void> {
    await call("updateStatus", clean({ orderId, status, ...expected }));
}

/** Ubicacion del repartidor (solo repartidor asignado y pedido en camino). */
export async function sendDriverLocation(orderId: string, latitude: number, longitude: number): Promise<void> {
    await call("updateLocation", { orderId, latitude, longitude });
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
