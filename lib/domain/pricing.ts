/**
 * Cálculo de importes. Se trabaja en centavos enteros para evitar errores de
 * punto flotante (por ejemplo 0.1 + 0.2).
 */

export const DEFAULT_DELIVERY_FEE = 5;
/** Descuento fijo heredado del Sprint 1. El backend lo recalcula. */
export const DEFAULT_DISCOUNT = 0.5;

export class PricingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PricingError";
    }
}

export interface PricedExtra {
    price: number;
}

export interface PricedItem {
    price: number;
    quantity: number;
    customizations?: PricedExtra[] | null;
}

export interface OrderTotals {
    subtotal: number;
    deliveryFee: number;
    discount: number;
    total: number;
}

export const toCents = (amount: number): number =>
    Math.round((amount + Number.EPSILON) * 100);

export const fromCents = (cents: number): number => cents / 100;

function assertMoney(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new PricingError(`${label} inválido`);
    }
    return value;
}

/** Suma de los extras de un artículo (precio por unidad). */
export function extrasTotal(extras?: PricedExtra[] | null): number {
    if (!extras || extras.length === 0) return 0;
    const cents = extras.reduce(
        (sum, extra) => sum + toCents(assertMoney(extra.price, "Precio de extra")),
        0
    );
    return fromCents(cents);
}

/** Precio unitario = precio base + extras. */
export function unitPrice(item: PricedItem): number {
    const base = toCents(assertMoney(item.price, "Precio"));
    return fromCents(base + toCents(extrasTotal(item.customizations)));
}

export function lineTotal(item: PricedItem): number {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new PricingError("Cantidad invalida");
    }
    return fromCents(toCents(unitPrice(item)) * item.quantity);
}

export function computeSubtotal(items: PricedItem[]): number {
    return fromCents(
        items.reduce((sum, item) => sum + toCents(lineTotal(item)), 0)
    );
}

export function computeOrderTotals(
    items: PricedItem[],
    options: { deliveryFee?: number; discount?: number } = {}
): OrderTotals {
    if (items.length === 0) {
        return { subtotal: 0, deliveryFee: 0, discount: 0, total: 0 };
    }

    const subtotalCents = toCents(computeSubtotal(items));
    const feeCents = toCents(
        assertMoney(options.deliveryFee ?? DEFAULT_DELIVERY_FEE, "Envío")
    );
    const requestedDiscount = toCents(
        assertMoney(options.discount ?? DEFAULT_DISCOUNT, "Descuento")
    );
    // El descuento nunca puede superar lo que se va a cobrar.
    const discountCents = Math.min(requestedDiscount, subtotalCents + feeCents);
    const totalCents = subtotalCents + feeCents - discountCents;

    return {
        subtotal: fromCents(subtotalCents),
        deliveryFee: fromCents(feeCents),
        discount: fromCents(discountCents),
        total: fromCents(totalCents)
    };
}

/** Importe con dos decimales para mostrar en pantalla. */
export const formatMoney = (amount: unknown): string => {
    const n = Number(amount);
    return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
};
