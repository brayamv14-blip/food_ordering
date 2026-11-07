import { Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/lib/appwrite";
import { Order } from "@/lib/domain/order";
import { CatalogExtra, CatalogItem, ReorderResult, buildReorder } from "@/lib/domain/reorder";
import { useCartStore } from "@/store/cart.store";

const asNumber = (v: unknown) => (typeof v === "number" ? v : Number.NaN);

/**
 * Agrega al carrito los productos de un pedido anterior usando precios y
 * disponibilidad ACTUALES del catalogo. Devuelve lo agregado y lo omitido.
 */
export async function reorderToCart(order: Pick<Order, "items">): Promise<ReorderResult> {
    const menuIds = [...new Set(order.items.map((i) => i.menuId).filter(Boolean))];
    const extraIds = [...new Set(order.items.flatMap((i) => i.extras.map((e) => e.id)).filter(Boolean))];

    const [menuRes, extraRes] = await Promise.all([
        menuIds.length
            ? databases.listRows({ databaseId: appwriteConfig.databaseId, tableId: appwriteConfig.menuCollectionId, queries: [Query.equal("$id", menuIds), Query.limit(100)] })
            : Promise.resolve({ rows: [] as any[] }),
        extraIds.length
            ? databases.listRows({ databaseId: appwriteConfig.databaseId, tableId: appwriteConfig.customizationsCollectionId, queries: [Query.equal("$id", extraIds), Query.limit(100)] })
            : Promise.resolve({ rows: [] as any[] })
    ]);

    const menu: Record<string, CatalogItem> = {};
    for (const r of menuRes.rows as any[]) {
        menu[r.$id] = { id: r.$id, name: String(r.name ?? ""), price: asNumber(r.price), image_url: String(r.image_url ?? ""), available: r.available !== false };
    }
    const extras: Record<string, CatalogExtra> = {};
    for (const r of extraRes.rows as any[]) {
        extras[r.$id] = { id: r.$id, name: String(r.name ?? ""), price: asNumber(r.price), type: String(r.type ?? "") };
    }

    const result = buildReorder(order.items, menu, extras);
    const store = useCartStore.getState();
    for (const line of result.lines) {
        store.addItem({ id: line.id, name: line.name, price: line.price, image_url: line.image_url, customizations: line.customizations });
        for (let i = 1; i < line.quantity; i++) useCartStore.getState().increaseQty(line.id, line.customizations);
    }
    return result;
}
