import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { CartItemType } from "@/type";
import { DeliveryAddress } from "@/lib/domain/address";

export interface StoreInfo {
    open: boolean;
    hours: string;
    reason?: string;
    prepMinutes: number;
    tipMax: number;
    couponsEnabled: boolean;
}

export interface Quote {
    subtotal: number;
    deliveryFee: number;
    discount: number;
    tip: number;
    total: number;
    couponCode: string | null;
    distanceKm: number | null;
    store: StoreInfo;
}

/** Horario, tiempo de preparacion y limites; null si el servidor no esta configurado o no responde. */
/** Tienda visible para el cliente (vista publica: sin configuracion interna). */
export interface PublicStore { id: string; name: string; description: string; imageUrl: string; address: string; phone: string; active: boolean; open?: boolean; hours?: string }

/** Tiendas activas. `enabled=false` => el servidor no tiene multitienda (una sola tienda, como en V14). */
export async function listStores(): Promise<{ enabled: boolean; defaultStoreId: string; stores: PublicStore[] }> {
    try {
        const fn = appwriteConfig?.functions?.createOrder;
        if (!fn) return { enabled: false, defaultStoreId: "main", stores: [] };
        const r = await callBackendFunction<{ enabled?: boolean; defaultStoreId?: string; stores?: PublicStore[] }>(fn, { action: "listStores" });
        return { enabled: !!r?.enabled, defaultStoreId: r?.defaultStoreId ?? "main", stores: Array.isArray(r?.stores) ? r.stores : [] };
    } catch {
        return { enabled: false, defaultStoreId: "main", stores: [] };
    }
}

export async function getStoreInfo(storeId?: string | null): Promise<StoreInfo | null> {
    try {
        const fn = appwriteConfig?.functions?.createOrder;
        if (!fn) return null;
        const r = await callBackendFunction<StoreInfo>(fn, { action: "storeInfo", ...(storeId ? { storeId } : {}) });
        return r && typeof r.open === "boolean" ? r : null;
    } catch {
        return null;
    }
}

/** Cotizacion calculada por el servidor (envio por distancia, cupon, propina). Los importes del cliente no cuentan. */
export async function getQuote(input: { storeId?: string | null; items: CartItemType[]; address: Partial<DeliveryAddress> | null; couponCode?: string; tip?: number }): Promise<Quote> {
    const fn = appwriteConfig?.functions?.createOrder;
    if (!fn) throw Object.assign(new Error("Servidor de pedidos no configurado."), { code: "backend_missing" });
    return callBackendFunction<Quote>(fn, {
        action: "quote",
        ...(input.storeId ? { storeId: input.storeId } : {}),
        address: input.address,
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
        ...(input.tip && input.tip > 0 ? { tip: input.tip } : {}),
        items: input.items.map((i) => ({ menuId: i.id, quantity: i.quantity, customizationIds: (i.customizations ?? []).map((c) => c.id) }))
    });
}
