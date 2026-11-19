import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { BackendNotConfiguredError } from "@/lib/services/staff.service";
import { RoleKey } from "@/lib/domain/access";

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

export interface AdminCategory { id: string; name: string; description?: string; active?: boolean; /** v16 */ storeId?: string | null; shared?: boolean }
export interface AdminUser {
    id: string; name: string; email: string | null; labels: string[];
    /** v15 (opcionales: un servidor anterior no los envia). */
    role?: RoleKey; storeId?: string | null; active?: boolean; createdAt?: string | null;
}
export interface AdminStore {
    id: string; name: string; description: string; imageUrl: string; address: string; phone: string;
    active: boolean; closed: boolean; openHours: string; latitude: number | null; longitude: number | null;
    deliveryFee: number | null; deliveryFeeBase: number | null; deliveryFeePerKm: number | null; deliveryFeeMax: number | null;
    deliveryRadiusKm: number | null; prepMinutes: number | null; coupons: string; platformPct?: number | null; driverPct?: number | null; createdAt?: string; updatedAt?: string;
}
export type StoreInput = Partial<Pick<AdminStore, "name" | "description" | "imageUrl" | "address" | "phone" | "openHours" | "latitude" | "longitude" | "deliveryFee" | "deliveryFeeBase" | "deliveryFeePerKm" | "deliveryFeeMax" | "deliveryRadiusKm" | "prepMinutes" | "coupons" | "active" | "closed" | "platformPct" | "driverPct">>;
export interface UserFilters { query?: string; role?: RoleKey; storeId?: string }
export interface NewUserInput { name: string; email: string; role: RoleKey; storeId?: string | null; phone?: string; password?: string }
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
    /** v14 (opcionales: un servidor anterior no los envia). */
    tips?: number;
    couponOrders?: number;
    ratings?: {
        count: number; average: number | null; driverAverage: number | null;
        distribution: Record<string, number>;
        recentComments: { orderId: string; rating: number; comment: string; at: string | null }[];
    };
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

export async function listCategories(storeId?: string): Promise<AdminCategory[]> {
    const r = await call<{ categories?: AdminCategory[] }>("listCategories", storeId ? { storeId } : {});
    return Array.isArray(r?.categories) ? r.categories : [];
}

export async function saveProduct(product: ProductInput, productId?: string, storeId?: string): Promise<AdminProduct> {
    const r = await call<{ product: AdminProduct }>("saveProduct", { product, ...(productId ? { productId } : {}), ...(storeId && !productId ? { storeId } : {}) });
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

export async function listUsers(filters: string | UserFilters = {}): Promise<AdminUser[]> {
    const f: UserFilters = typeof filters === "string" ? (filters ? { query: filters } : {}) : filters;
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => !!v));
    const r = await call<{ users?: AdminUser[] }>("listUsers", clean);
    return Array.isArray(r?.users) ? r.users : [];
}

/** Alta de usuario: el servidor crea la cuenta + rol + tienda y revierte todo si algo falla. La contraseña nunca regresa. */
export async function createUser(user: NewUserInput): Promise<{ user: AdminUser; recoveryEmailSent: boolean; passwordSetByAdmin: boolean }> {
    const clean = Object.fromEntries(Object.entries(user).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    return call("createUser", { user: clean });
}
export async function updateUser(userId: string, changes: { name?: string; role?: RoleKey; storeId?: string | null; phone?: string }): Promise<AdminUser> {
    return (await call<{ user: AdminUser }>("updateUser", { userId, changes })).user;
}
/** Envia el correo de recuperacion: el administrador nunca ve ni fija la contraseña. */
export async function resetUserPassword(userId: string): Promise<void> {
    await call("resetPassword", { userId });
}
export async function userHistory(userId: string): Promise<{ id: string; action: string; actorRole: string | null; summary: string; at: string }[]> {
    const r = await call<{ entries?: { id: string; action: string; actorRole: string | null; summary: string; at: string }[] }>("userHistory", { userId });
    return Array.isArray(r?.entries) ? r.entries : [];
}

export async function listAdminStores(): Promise<{ enabled: boolean; stores: AdminStore[] }> {
    const r = await call<{ enabled?: boolean; stores?: AdminStore[] }>("listStores");
    return { enabled: !!r?.enabled, stores: Array.isArray(r?.stores) ? r.stores : [] };
}
/** Sin `storeId` crea (solo superadministrador); con `storeId` edita. */
export async function saveStore(store: StoreInput, storeId?: string, newStoreId?: string): Promise<AdminStore> {
    return (await call<{ store: AdminStore }>("saveStore", { store, ...(storeId ? { storeId } : {}), ...(newStoreId ? { newStoreId } : {}) })).store;
}
export async function setStoreActive(storeId: string, active: boolean): Promise<AdminStore> {
    return (await call<{ store: AdminStore }>("setStoreActive", { storeId, active })).store;
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

export async function getDashboard(range: { from?: string; to?: string; storeId?: string } = {}): Promise<{ dashboard: DashboardData; driversSummary: DriversSummary; truncated: boolean }> {
    const clean = Object.fromEntries(Object.entries(range).filter(([, v]) => !!v));
    return call("dashboard", clean);
}

// ---------------------------------------------------------------- V16: solicitudes de repartidor y finanzas
export interface DriverApplication { id: string; name: string; email: string | null; storeId: string; phone: string | null; vehicle: string | null; note: string | null; appliedAt: string | null; state: string | null }
export async function listDriverApplications(): Promise<DriverApplication[]> {
    const r = await call<{ applications?: DriverApplication[] }>("listDriverApplications");
    return Array.isArray(r?.applications) ? r.applications : [];
}
export async function reviewDriver(userId: string, approve: boolean): Promise<{ state: "approved" | "rejected" }> {
    return call("reviewDriver", { userId, approve });
}
export interface FinanceSummary { orders: number; total: number; platformCommission: number; storeRevenue: number; driverEarning: number; deliveryFee: number; tips: number; refunded: number }
export interface FinanceReport {
    finance: { totals: FinanceSummary; byStore: Record<string, FinanceSummary>; byDriver: Record<string, FinanceSummary & { name: string }>; byDay: Record<string, FinanceSummary> };
    config: { platformPct: number; driverPct: number; perStoreOverrides: string[] }; truncated: boolean; transfers: "not_implemented";
}
export async function getFinanceReport(range: { from?: string; to?: string; storeId?: string } = {}): Promise<FinanceReport> {
    const clean = Object.fromEntries(Object.entries(range).filter(([, v]) => !!v));
    return call("financeReport", clean);
}

export async function saveCategory(category: { name?: string; description?: string; active?: boolean }, categoryId?: string, storeId?: string): Promise<AdminCategory> {
    return (await call<{ category: AdminCategory }>("saveCategory", { category, ...(categoryId ? { categoryId } : {}), ...(storeId && !categoryId ? { storeId } : {}) })).category;
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
