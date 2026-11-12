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

export interface AdminCategory { id: string; name: string; description?: string; active?: boolean }
export interface AdminUser { id: string; name: string; email: string | null; labels: string[] }
export interface AdminPayment { orderId: string; total: number; paymentMethod?: string; paymentStatus: string; orderStatus: string; refundedAmount?: number; reference: string | null; at: string }
export interface AdminCustomer { id: string; name: string; email: string | null; active: boolean; createdAt: string | null }
export interface CustomerOrder { id: string; status: string; total: number; paymentMethod: string; paymentStatus: string | null; createdAt: string }
export interface AuditEntry { id: string; action: string; actorId: string; actorRole: string | null; targetType: string | null; targetId: string | null; summary: string; at: string }
export interface DashboardData {
    orders: number; delivered: number; cancelled: number; sales: number; averageTicket: number; cancellationRate: number; refunded: number;
    todayOrders: number; discounts: number; deliveryFees: number; partialRefunds: number; unpaidOnlineOrders: number;
    revenueByMethod: { cash: number; online: number };
    pipeline: { pending: number; accepted: number; preparing: number; onTheWay: number; delivered: number };
    topProducts: { menuId: string; name: string; quantity: number; sales: number }[];
    salesByDay: { day: string; sales: number }[]; salesByWeek: { day: string; sales: number }[]; salesByMonth: { day: string; sales: number }[];
    paymentCounts: Record<string, number>;
    drivers: { driverUserId: string; name: string; delivered: number; failed: number; cancelled: number; active: number }[];
}
export interface DriversSummary { total: number; available: number; busy: number; offline: number }
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
    return (await call<{ product: AdminProduct }>("setProductAvailability", { productId, available })).product;
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

export async function listPayments(filters: { paymentStatus?: string; paymentMethod?: "online" | "cash_on_delivery"; from?: string; to?: string } = {}): Promise<AdminPayment[]> {
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => !!v));
    const r = await call<{ payments?: AdminPayment[] }>("listPayments", clean);
    return Array.isArray(r?.payments) ? r.payments : [];
}

export async function getReport(range: { from?: string; to?: string } = {}, csv = false): Promise<{ report: SalesReport; truncated: boolean; csv?: string }> {
    const clean = Object.fromEntries(Object.entries(range).filter(([, v]) => !!v));
    return call("report", { ...clean, ...(csv ? { format: "csv" } : {}) });
}

export async function getDashboard(range: { from?: string; to?: string } = {}): Promise<{ dashboard: DashboardData; driversSummary: DriversSummary; truncated: boolean }> {
    const clean = Object.fromEntries(Object.entries(range).filter(([, v]) => !!v));
    return call("dashboard", clean);
}

export async function saveCategory(category: { name?: string; description?: string; active?: boolean }, categoryId?: string): Promise<AdminCategory> {
    return (await call<{ category: AdminCategory }>("saveCategory", { category, ...(categoryId ? { categoryId } : {}) })).category;
}
export async function setCategoryActive(categoryId: string, active: boolean): Promise<AdminCategory> {
    return (await call<{ category: AdminCategory }>("setCategoryActive", { categoryId, active })).category;
}
export async function deleteCategory(categoryId: string): Promise<void> {
    await call("deleteCategory", { categoryId });
}

export async function listCustomers(query?: string): Promise<AdminCustomer[]> {
    const r = await call<{ customers?: AdminCustomer[] }>("listCustomers", query ? { query } : {});
    return Array.isArray(r?.customers) ? r.customers : [];
}
/** Las direcciones son datos personales: solo se piden si hace falta y queda registro en la auditoria. */
export async function getCustomerOrders(customerId: string, includeAddresses = false): Promise<{ orders: CustomerOrder[]; spent: number; addresses?: string[] }> {
    return call("customerOrders", { customerId, ...(includeAddresses ? { includeAddresses: true } : {}) });
}
export async function setUserActive(userId: string, active: boolean): Promise<void> {
    await call("setUserStatus", { userId, active });
}
export async function listAudit(): Promise<{ enabled: boolean; entries: AuditEntry[] }> {
    const r = await call<{ enabled?: boolean; entries?: AuditEntry[] }>("listAudit");
    return { enabled: !!r?.enabled, entries: Array.isArray(r?.entries) ? r.entries : [] };
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
