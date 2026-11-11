import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { BackendNotConfiguredError } from "@/lib/services/staff.service";

/**
 * Cliente de la Function `admin-api` (productos, inventario, usuarios/roles, pagos y reportes).
 * Toda autorizacion se decide en el servidor con las etiquetas `staff` / `admin`.
 */
export interface AdminProduct {
    id: string;
    name: string;
    price: number;
    description: string;
    image_url: string;
    type: string | null;
    categories: string | null;
    available: boolean;
    /** null = el producto no controla inventario. */
    stock: number | null;
    tracked: boolean;
    lowStock: boolean;
    lowStockThreshold: number;
}

export interface ProductInput {
    name?: string;
    price?: number;
    description?: string;
    image_url?: string;
    type?: string;
    categories?: string;
    available?: boolean;
    /** Solo al crear. Para cambiarlo despues usa `adjustStock`. null/"" => sin control de inventario. */
    stock?: number | null;
}

export interface AdminCategory { id: string; name: string }
export interface AdminUser { id: string; name: string; email: string | null; labels: string[] }
export interface AdminPayment { orderId: string; total: number; paymentStatus: string; orderStatus: string; reference: string | null; at: string }
export interface StockMovement { id: string; menuId: string; orderId: string; type: string; delta: number; reason: string | null; at: string }

export interface SalesReport {
    orders: number;
    delivered: number;
    cancelled: number;
    byStatus: Record<string, number>;
    sales: number;
    averageTicket: number;
    cancellationRate: number;
    refunded: number;
    topProducts: { menuId: string | null; name: string; quantity: number; sales: number }[];
    salesByDay: { day: string; sales: number }[];
}

const fn = (): string => {
    const id = appwriteConfig.functions.adminApi;
    if (!id) throw new BackendNotConfiguredError("EXPO_PUBLIC_FN_ADMIN_API");
    return id;
};
const call = <T>(action: string, payload: Record<string, unknown> = {}) =>
    callBackendFunction<T>(fn(), { action, ...payload });

export const isAdminApiConfigured = (): boolean => !!appwriteConfig.functions.adminApi;

export async function listProducts(query?: string): Promise<{ products: AdminProduct[]; lowStock: number; inventoryEnabled: boolean }> {
    const r = await call<{ products?: AdminProduct[]; lowStock?: number; inventoryEnabled?: boolean }>("listProducts", query ? { query } : {});
    return { products: Array.isArray(r?.products) ? r.products : [], lowStock: r?.lowStock ?? 0, inventoryEnabled: !!r?.inventoryEnabled };
}

export async function listCategories(): Promise<AdminCategory[]> {
    const r = await call<{ categories?: AdminCategory[] }>("listCategories");
    return Array.isArray(r?.categories) ? r.categories : [];
}

export async function saveProduct(product: ProductInput, productId?: string): Promise<AdminProduct> {
    const r = await call<{ product: AdminProduct }>("saveProduct", { product, ...(productId ? { productId } : {}) });
    return r.product;
}

export async function setProductAvailability(productId: string, available: boolean): Promise<AdminProduct> {
    return (await call<{ product: AdminProduct }>("setAvailability", { productId, available })).product;
}

/** `clientRequestId` evita aplicar dos veces el mismo ajuste si se reintenta por mala conexion. */
export async function adjustStock(productId: string, change: { set?: number; delta?: number }, reason: string, clientRequestId: string): Promise<AdminProduct> {
    return (await call<{ product: AdminProduct }>("adjustStock", { productId, ...change, reason, clientRequestId })).product;
}

export async function stockMovements(productId?: string): Promise<StockMovement[]> {
    const r = await call<{ movements?: StockMovement[] }>("stockMovements", productId ? { productId } : {});
    return Array.isArray(r?.movements) ? r.movements : [];
}

export async function listUsers(query?: string): Promise<AdminUser[]> {
    const r = await call<{ users?: AdminUser[] }>("listUsers", query ? { query } : {});
    return Array.isArray(r?.users) ? r.users : [];
}

export async function setUserRoles(userId: string, labels: string[]): Promise<string[]> {
    return (await call<{ labels: string[] }>("setRole", { userId, labels })).labels;
}

export async function listPayments(filters: { paymentStatus?: string; from?: string; to?: string } = {}): Promise<AdminPayment[]> {
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => !!v));
    const r = await call<{ payments?: AdminPayment[] }>("listPayments", clean);
    return Array.isArray(r?.payments) ? r.payments : [];
}

export async function getReport(range: { from?: string; to?: string } = {}, csv = false): Promise<{ report: SalesReport; truncated: boolean; csv?: string }> {
    const clean = Object.fromEntries(Object.entries(range).filter(([, v]) => !!v));
    return call("report", { ...clean, ...(csv ? { format: "csv" } : {}) });
}

/** Periodos predefinidos para reportes (inicio del dia en hora local). */
export type ReportPeriod = "today" | "7d" | "30d" | "all";
export function periodRange(period: ReportPeriod, now: Date = new Date()): { from?: string; to?: string } {
    if (period === "all") return {};
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (period === "7d") start.setDate(start.getDate() - 6);
    if (period === "30d") start.setDate(start.getDate() - 29);
    return { from: start.toISOString(), to: now.toISOString() };
}
