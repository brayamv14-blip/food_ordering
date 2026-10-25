import { Channel, ID, Query } from "react-native-appwrite";

import {
    appwriteConfig,
    callBackendFunction,
    cancelOrder,
    client,
    databases
} from "@/lib/appwrite";
import { CartItemType } from "@/type";
import { DeliveryAddress, validateDeliveryAddress } from "@/lib/domain/address";
import { Order, mapOrderRow } from "@/lib/domain/order";
import { computeOrderTotals, unitPrice } from "@/lib/domain/pricing";
import { canCustomerCancel } from "@/lib/domain/orderStatus";

const DB = () => appwriteConfig.databaseId;
const ORDERS = () => appwriteConfig.ordersCollectionId;
const ITEMS = () => appwriteConfig.orderItemsCollectionId;

export class OrderServiceError extends Error {
    code: string;
    /** true si se deshizo lo que alcanzo a guardarse (pedido parcial). */
    compensated: boolean;
    constructor(code: string, message: string, compensated = false) {
        super(message);
        this.name = "OrderServiceError";
        this.code = code;
        this.compensated = compensated;
    }
}

export interface CreateOrderInput {
    /** accountId de Appwrite del usuario autenticado. */
    userId: string;
    items: CartItemType[];
    address: Partial<DeliveryAddress> | null;
    contact: { name: string; phone: string };
    /** Identificador de intento: el mismo valor en reintentos evita duplicados. */
    clientRequestId: string;
    paymentMethod?: string;
}

export interface CreateOrderResult {
    orderId: string;
    /** true si el pedido ya existia (reintento de un intento previo exitoso). */
    duplicate: boolean;
}

/** Identificador de intento de checkout (no criptografico; sirve de llave de idempotencia). */
export const newClientRequestId = (): string => `chk_${ID.unique()}`;

const isConflict = (e: any) => e?.code === 409 || e?.type === "row_already_exists";

async function findByRequestId(clientRequestId: string): Promise<string | null> {
    const res = await databases.listRows({
        databaseId: DB(),
        tableId: ORDERS(),
        queries: [Query.equal("clientRequestId", clientRequestId), Query.limit(1)]
    });
    return res.rows[0]?.$id ?? null;
}

/**
 * Crea el pedido y sus articulos.
 *
 * - Con `EXPO_PUBLIC_FN_CREATE_ORDER` configurado, el servidor recalcula precios
 *   contra el menu y fija el estado inicial (modo seguro).
 * - Sin el, se escribe directo en TablesDB (modo desarrollo). TablesDB no es una
 *   transaccion SQL: si falla un articulo, se intenta deshacer lo creado y, si
 *   no se puede borrar, se marca el pedido como cancelado.
 */
export async function createOrderIdempotent(
    input: CreateOrderInput
): Promise<CreateOrderResult> {
    if (input.items.length === 0) {
        throw new OrderServiceError("empty_cart", "Tu carrito esta vacio.");
    }
    const addressCheck = validateDeliveryAddress(input.address);
    if (!addressCheck.valid || !addressCheck.values) {
        throw new OrderServiceError(
            "invalid_address",
            Object.values(addressCheck.errors)[0] ?? "Direccion invalida."
        );
    }
    const address = addressCheck.values;

    const orderItems = input.items.map((item) => ({
        menuId: item.id,
        name: item.name,
        price: unitPrice({ price: item.price, quantity: item.quantity, customizations: item.customizations }),
        quantity: item.quantity,
        customizations: JSON.stringify(item.customizations ?? [])
    }));
    const totals = computeOrderTotals(input.items);

    // ---- Modo seguro: backend de confianza --------------------------------
    if (appwriteConfig.functions.createOrder) {
        const result = await callBackendFunction<{ orderId: string; duplicate?: boolean }>(
            appwriteConfig.functions.createOrder,
            {
                clientRequestId: input.clientRequestId,
                address,
                contact: input.contact,
                paymentMethod: input.paymentMethod ?? "cash_on_delivery",
                items: input.items.map((i) => ({
                    menuId: i.id,
                    quantity: i.quantity,
                    customizationIds: (i.customizations ?? []).map((c) => c.id)
                }))
            }
        );
        if (!result?.orderId) {
            throw new OrderServiceError("bad_response", "Respuesta incompleta del servidor.");
        }
        return { orderId: result.orderId, duplicate: !!result.duplicate };
    }

    // ---- Modo desarrollo: escritura directa --------------------------------
    const existing = await findByRequestId(input.clientRequestId);
    if (existing) return { orderId: existing, duplicate: true };

    let orderId: string;
    try {
        const order = await databases.createRow({
            databaseId: DB(),
            tableId: ORDERS(),
            rowId: ID.unique(),
            data: {
                userId: input.userId,
                status: "pending",
                subtotal: totals.subtotal,
                total: totals.total,
                deliveryFee: totals.deliveryFee,
                discount: totals.discount,
                paymentMethod: input.paymentMethod ?? "cash_on_delivery",
                clientRequestId: input.clientRequestId,
                customerName: input.contact.name,
                customerPhone: input.contact.phone,
                deliveryAddress: address.line,
                deliveryAddressLabel: address.label,
                deliveryLatitude: address.latitude,
                deliveryLongitude: address.longitude
            }
        });
        orderId = order.$id;
    } catch (error) {
        // Si otro intento con la misma llave gano la carrera, se reutiliza.
        if (isConflict(error)) {
            const dup = await findByRequestId(input.clientRequestId);
            if (dup) return { orderId: dup, duplicate: true };
        }
        throw new OrderServiceError("order_failed", "No se pudo guardar el pedido.");
    }

    const created: string[] = [];
    try {
        for (const item of orderItems) {
            const row = await databases.createRow({
                databaseId: DB(),
                tableId: ITEMS(),
                rowId: ID.unique(),
                data: { orderId, ...item }
            });
            created.push(row.$id);
        }
        if (created.length !== orderItems.length) {
            throw new Error("articulos incompletos");
        }
        return { orderId, duplicate: false };
    } catch {
        let compensated = true;
        for (const id of created) {
            try {
                await databases.deleteRow({ databaseId: DB(), tableId: ITEMS(), rowId: id });
            } catch {
                compensated = false;
            }
        }
        try {
            await databases.deleteRow({ databaseId: DB(), tableId: ORDERS(), rowId: orderId });
        } catch {
            try {
                await databases.updateRow({
                    databaseId: DB(),
                    tableId: ORDERS(),
                    rowId: orderId,
                    data: { status: "cancelled" }
                });
            } catch {
                compensated = false;
            }
        }
        throw new OrderServiceError(
            "items_failed",
            "No se pudieron guardar todos los productos del pedido.",
            compensated
        );
    }
}

async function loadItems(orderId: string) {
    const items = await databases.listRows({
        databaseId: DB(),
        tableId: ITEMS(),
        queries: [Query.equal("orderId", orderId), Query.limit(100)]
    });
    return items.rows as unknown as Record<string, unknown>[];
}

export async function fetchOrder(orderId: string, userId?: string): Promise<Order> {
    const row = (await databases.getRow({
        databaseId: DB(),
        tableId: ORDERS(),
        rowId: orderId
    })) as unknown as Record<string, unknown>;

    // Defensa en profundidad: la barrera real son los permisos de la tabla.
    if (userId && row.userId !== userId) {
        throw new OrderServiceError("forbidden", "No tienes acceso a este pedido.");
    }
    return mapOrderRow(row, await loadItems(orderId));
}

export async function fetchMyOrders(userId: string): Promise<Order[]> {
    const res = await databases.listRows({
        databaseId: DB(),
        tableId: ORDERS(),
        queries: [
            Query.equal("userId", userId),
            Query.orderDesc("$createdAt"),
            Query.limit(50)
        ]
    });
    const rows = res.rows as unknown as Record<string, unknown>[];
    return Promise.all(
        rows
            .filter((r) => r.userId === userId)
            .map(async (r) => mapOrderRow(r, await loadItems(String(r.$id))))
    );
}

export async function cancelMyOrder(order: Pick<Order, "id" | "status">): Promise<void> {
    if (!canCustomerCancel(order.status)) {
        throw new OrderServiceError("not_cancellable", "Este pedido ya no se puede cancelar.");
    }
    // cancelOrder valida de nuevo en servidor (o con lectura previa en modo desarrollo).
    await cancelOrder(order.id);
}

/** Suscripcion en tiempo real a una fila de pedido. Devuelve la funcion de cierre. */
export function subscribeToOrder(orderId: string, onEvent: () => void): () => void {
    const channel = Channel.tablesdb(DB()).table(ORDERS()).row(orderId).toString();
    return client.subscribe(channel, () => onEvent());
}
