import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { OrderStatus } from "@/lib/domain/orderStatus";

export interface StaffOrder {
    id: string;
    status: string;
    total: number;
    createdAt: string;
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

export class BackendNotConfiguredError extends Error {
    constructor(name: string) {
        super(`Falta configurar ${name} en el archivo .env.local.`);
        this.name = "BackendNotConfiguredError";
    }
}

const staffFn = () => {
    const id = appwriteConfig.functions.staffApi;
    if (!id) throw new BackendNotConfiguredError("EXPO_PUBLIC_FN_STAFF_API");
    return id;
};

const statusFn = () => {
    const id = appwriteConfig.functions.updateOrderStatus;
    if (!id) throw new BackendNotConfiguredError("EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS");
    return id;
};

export async function listStaffOrders(status?: OrderStatus): Promise<StaffOrder[]> {
    const res = await callBackendFunction<{ orders?: StaffOrder[] }>(staffFn(), {
        action: "listOrders",
        ...(status ? { status } : {})
    });
    return Array.isArray(res?.orders) ? res.orders : [];
}

export async function listDrivers(): Promise<DriverOption[]> {
    const res = await callBackendFunction<{ drivers?: DriverOption[] }>(staffFn(), { action: "listDrivers" });
    return Array.isArray(res?.drivers) ? res.drivers : [];
}

export async function assignDriver(orderId: string, driverUserId: string): Promise<void> {
    await callBackendFunction(staffFn(), { action: "assignDriver", orderId, driverUserId });
}

export async function listMyDeliveries(): Promise<StaffOrder[]> {
    const res = await callBackendFunction<{ orders?: StaffOrder[] }>(staffFn(), { action: "myDeliveries" });
    return Array.isArray(res?.orders) ? res.orders : [];
}

/** Cambio de estado; el servidor decide si el usuario y la transicion son validos. */
export async function changeOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    await callBackendFunction(statusFn(), { orderId, status });
}

/** Traduce errores del backend a mensajes para el usuario. */
export function describeBackendError(e: unknown): string {
    const err = e as { message?: string; code?: unknown };
    if (e instanceof BackendNotConfiguredError) return e.message;
    if (typeof err?.message === "string" && err.message && !/network|fetch|timeout/i.test(err.message)) return err.message;
    return "No pudimos completar la operación. Revisa tu conexión e inténtalo de nuevo.";
}
