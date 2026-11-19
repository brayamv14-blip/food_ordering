import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";

export interface RatingInput {
    orderId: string;
    rating: number;
    driverRating?: number | null;
    comment?: string;
}

/** Califica un pedido entregado (una sola vez). Lo valida y guarda el servidor. */
export async function rateOrder({ orderId, rating, driverRating, comment }: RatingInput): Promise<void> {
    const fn = appwriteConfig.functions.updateOrderStatus;
    if (!fn) throw Object.assign(new Error("Falta configurar EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS."), { code: "not_configured" });
    await callBackendFunction(fn, {
        action: "rateOrder",
        orderId,
        rating,
        ...(driverRating ? { driverRating } : {}),
        ...(comment && comment.trim() ? { comment: comment.trim() } : {})
    });
}
