/** Pago en línea (Stripe Checkout alojado): validaciones y textos. Nunca se tocan datos de tarjeta en la app. */

export type PaymentMethod = "cash_on_delivery" | "online";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
    cash_on_delivery: "Efectivo contra entrega",
    online: "Pago en línea (tarjeta)"
};

/**
 * Solo se abre un enlace https del dominio de Stripe Checkout. Si el enlace fuera
 * alterado (por ejemplo una respuesta manipulada) no se abre.
 */
export function isTrustedCheckoutUrl(url: unknown): url is string {
    if (typeof url !== "string") return false;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return parsed.protocol === "https:" && parsed.hostname === "checkout.stripe.com";
}

export type PaymentStatus = "not_required" | "pending" | "paid" | "failed" | "cancelled" | "refunded";

export interface PaymentSummary {
    label: string;
    /** `true` si el cliente aún puede o debe pagar. */
    actionable: boolean;
    tone: "ok" | "warn" | "neutral";
}

/** Texto de estado de pago para mostrar en pantalla. */
export function describePayment(method: unknown, status: unknown, orderStatus?: unknown): PaymentSummary {
    if (method !== "online") {
        return { label: PAYMENT_LABELS.cash_on_delivery, actionable: false, tone: "neutral" };
    }
    if (status === "refunded") return { label: "Pago reembolsado", actionable: false, tone: "neutral" };
    if (status === "paid") return { label: "Pagado en línea", actionable: false, tone: "ok" };
    if (orderStatus === "cancelled" || status === "cancelled") {
        return { label: "Pedido cancelado (sin pago)", actionable: false, tone: "neutral" };
    }
    if (status === "failed") return { label: "Pago fallido: puedes intentarlo de nuevo", actionable: true, tone: "warn" };
    return { label: "Pago en línea pendiente", actionable: true, tone: "warn" };
}

/** Mensaje para el estado que informa el servidor tras verificar con Stripe. */
export function describeProviderStatus(status: unknown): string {
    switch (status) {
        case "paid":
            return "Pago aprobado.";
        case "unpaid":
        case "open":
        case "pending":
            return "Todavía no vemos el pago completado. Si ya pagaste, vuelve a verificarlo en unos minutos.";
        case "invalid":
            return "El cobro no coincide con el importe del pedido, por eso no se aceptó. Contacta a soporte.";
        case "expired":
        case "cancelled":
            return "La sesión de pago venció o se canceló. Puedes intentarlo de nuevo con “Pagar ahora”.";
        case "failed":
            return "El pago fue rechazado. Puedes intentarlo de nuevo con “Pagar ahora”.";
        case "refunded":
            return "El pago fue reembolsado.";
        default:
            return "Todavía no encontramos un pago para este pedido.";
    }
}
