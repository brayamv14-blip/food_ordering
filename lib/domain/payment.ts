/** Pago en linea (Mercado Pago Checkout Pro): validaciones y textos. */

export type PaymentMethod = "cash_on_delivery" | "online";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
    cash_on_delivery: "Efectivo contra entrega",
    online: "Pago en línea (Mercado Pago)"
};

/**
 * Solo se abre un enlace de pago https de un dominio de Mercado Pago. Si el
 * enlace fuera alterado (por ejemplo una respuesta manipulada) no se abre.
 */
export function isTrustedCheckoutUrl(url: unknown): url is string {
    if (typeof url !== "string") return false;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:") return false;
    return /(^|\.)mercadopago\.(com|com\.mx|com\.ar|com\.br|cl|com\.co|com\.pe|com\.uy)$/i.test(parsed.hostname);
}

export interface PaymentSummary {
    label: string;
    /** `true` si el cliente aun puede o debe pagar. */
    actionable: boolean;
    tone: "ok" | "warn" | "neutral";
}

/** Texto de estado de pago para mostrar en pantalla. */
export function describePayment(method: unknown, status: unknown, orderStatus?: unknown): PaymentSummary {
    if (method !== "online") {
        return { label: PAYMENT_LABELS.cash_on_delivery, actionable: false, tone: "neutral" };
    }
    if (status === "paid") return { label: "Pagado en línea", actionable: false, tone: "ok" };
    if (orderStatus === "cancelled") return { label: "Pedido cancelado (sin pago)", actionable: false, tone: "neutral" };
    return { label: "Pago en línea pendiente", actionable: true, tone: "warn" };
}

/** Mensaje para el estado que informa Mercado Pago tras verificar. */
export function describeProviderStatus(status: unknown): string {
    switch (status) {
        case "approved":
            return "Pago aprobado.";
        case "pending":
        case "in_process":
        case "authorized":
            return "Tu pago sigue en proceso. Vuelve a verificarlo en unos minutos.";
        case "rejected":
            return "El pago fue rechazado. Puedes intentarlo de nuevo con “Pagar ahora”.";
        case "cancelled":
        case "refunded":
        case "charged_back":
            return "El pago fue cancelado o devuelto.";
        default:
            return "Todavía no encontramos un pago para este pedido.";
    }
}
