import { Order } from "./order";

export interface ReceiptLine {
    label: string;
    amount: number;
    kind: "normal" | "discount" | "total";
}

/** Renglones del recibo, en orden, sin los que valen 0 (salvo subtotal y total). */
export function buildReceipt(order: Pick<Order, "subtotal" | "deliveryFee" | "discount" | "tip" | "total" | "couponCode" | "refundedAmount">): ReceiptLine[] {
    const lines: ReceiptLine[] = [];
    if (order.subtotal !== null) lines.push({ label: "Subtotal", amount: order.subtotal, kind: "normal" });
    lines.push({ label: "Envío", amount: order.deliveryFee, kind: "normal" });
    if (order.discount > 0) lines.push({ label: order.couponCode ? `Descuento (${order.couponCode})` : "Descuento", amount: -order.discount, kind: "discount" });
    if (order.tip > 0) lines.push({ label: "Propina al repartidor", amount: order.tip, kind: "normal" });
    lines.push({ label: "Total", amount: order.total, kind: "total" });
    if (order.refundedAmount > 0) lines.push({ label: "Reembolsado", amount: -order.refundedAmount, kind: "discount" });
    return lines;
}

/** Texto plano del recibo para compartir. */
export function receiptText(order: Order, fmt: (n: number) => string): string {
    const head = [`Pedido #${order.id.slice(-6)}`, ...order.items.map((i) => `${i.quantity} x ${i.name}  ${fmt(i.lineTotal)}`), ""];
    const body = buildReceipt(order).map((l) => `${l.label}: ${l.amount < 0 ? "-" : ""}${fmt(Math.abs(l.amount))}`);
    return [...head, ...body].join("\n");
}

export const TIP_PRESETS = [0, 10, 20, 30] as const;
