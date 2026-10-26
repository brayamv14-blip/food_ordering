import * as WebBrowser from "expo-web-browser";

import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { isTrustedCheckoutUrl } from "@/lib/domain/payment";

export class PaymentError extends Error {
    code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "PaymentError";
        this.code = code;
    }
}

/**
 * El pago en linea solo se ofrece si se activa por entorno Y existen las dos
 * Functions (el cobro y la verificacion siempre se hacen en el servidor).
 */
export const isOnlinePaymentEnabled = (): boolean =>
    process.env.EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT === "true" &&
    !!appwriteConfig.functions.createOrder &&
    !!appwriteConfig.functions.updateOrderStatus;

/** Abre el pago de Mercado Pago en el navegador del sistema. Devuelve al cerrarlo. */
export async function openCheckout(url: string): Promise<void> {
    if (!isTrustedCheckoutUrl(url)) {
        throw new PaymentError("untrusted_url", "El enlace de pago no es válido.");
    }
    await WebBrowser.openBrowserAsync(url);
}

export interface PaymentSync {
    paymentStatus: string;
    providerStatus?: string | null;
}

/** Pide al servidor que verifique el pago con Mercado Pago (el cliente no decide si se pago). */
export async function syncPayment(orderId: string): Promise<PaymentSync> {
    const fn = appwriteConfig.functions.updateOrderStatus;
    if (!fn) throw new PaymentError("not_configured", "Falta configurar EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS.");
    const res = await callBackendFunction<PaymentSync>(fn, { action: "syncPayment", orderId });
    if (!res || typeof res.paymentStatus !== "string") {
        throw new PaymentError("bad_response", "Respuesta incompleta del servidor.");
    }
    return res;
}
