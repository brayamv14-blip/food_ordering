import { OrderItem } from "./order";
import { MAX_ITEM_QUANTITY, isValidMoney } from "./pricing";

export interface CatalogItem {
    id: string;
    name: string;
    price: number;
    image_url: string;
    available: boolean;
}

export interface CatalogExtra {
    id: string;
    name: string;
    price: number;
    type: string;
}

export interface ReorderLine {
    id: string;
    name: string;
    price: number;
    image_url: string;
    quantity: number;
    customizations: CatalogExtra[];
}

export interface ReorderResult {
    lines: ReorderLine[];
    skipped: { name: string; reason: string }[];
}

/**
 * Reconstruye un pedido anterior con los PRECIOS ACTUALES del catalogo. Los
 * productos agotados, eliminados o con extras que ya no existen se omiten y se
 * informan; nunca se reutilizan precios viejos.
 */
export function buildReorder(
    items: OrderItem[],
    menu: Record<string, CatalogItem | undefined>,
    extras: Record<string, CatalogExtra | undefined>
): ReorderResult {
    const lines: ReorderLine[] = [];
    const skipped: ReorderResult["skipped"] = [];

    for (const item of items) {
        const product = menu[item.menuId];
        if (!product) {
            skipped.push({ name: item.name, reason: "ya no está en el catálogo" });
            continue;
        }
        if (!product.available) {
            skipped.push({ name: product.name, reason: "está agotado" });
            continue;
        }
        if (!isValidMoney(product.price)) {
            skipped.push({ name: product.name, reason: "no tiene un precio válido" });
            continue;
        }
        const current: CatalogExtra[] = [];
        let missing = false;
        for (const e of item.extras) {
            const found = extras[e.id];
            if (!found || !isValidMoney(found.price)) {
                missing = true;
                break;
            }
            current.push(found);
        }
        if (missing) {
            skipped.push({ name: product.name, reason: "uno de sus extras ya no está disponible" });
            continue;
        }
        const quantity = Math.min(Math.max(1, Math.trunc(item.quantity) || 1), MAX_ITEM_QUANTITY);
        lines.push({ id: product.id, name: product.name, price: product.price, image_url: product.image_url, quantity, customizations: current });
    }
    return { lines, skipped };
}
