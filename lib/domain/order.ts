import { parseLatLng, toFiniteNumber, LatLng } from "./coordinates";
import { OrderStatus, parseOrderStatus } from "./orderStatus";
import { DeliveryAddress } from "./address";

export interface OrderExtra {
    id: string;
    name: string;
    price: number;
    type: string;
}

export interface OrderItem {
    id: string;
    menuId: string;
    name: string;
    /** Precio unitario ya con extras incluidos (como se guarda en Appwrite). */
    unitPrice: number;
    quantity: number;
    extras: OrderExtra[];
    lineTotal: number;
}

export interface Order {
    id: string;
    userId: string;
    /** Estado normalizado; `null` si el valor guardado no se reconoce. */
    status: OrderStatus | null;
    /** Valor crudo, por si hay que mostrarlo en un aviso de estado desconocido. */
    rawStatus: string;
    subtotal: number | null;
    deliveryFee: number;
    discount: number;
    total: number;
    paymentMethod: string;
    createdAt: string;
    updatedAt: string | null;
    deliveryAddress: DeliveryAddress | null;
    /** Coordenadas del destino, o null si no existen / no son validas. */
    deliveryLocation: LatLng | null;
    driverName: string | null;
    driverLocation: LatLng | null;
    driverUpdatedAt: string | null;
    items: OrderItem[];
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown, fallback = 0): number => toFiniteNumber(v) ?? fallback;

/** Interpreta el JSON de extras guardado como texto. Nunca lanza. */
export function parseExtras(raw: unknown): OrderExtra[] {
    let value: unknown = raw;
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(value)) return [];
    return value
        .filter((e): e is Row => !!e && typeof e === "object")
        .map((e) => ({
            id: str(e.id),
            name: str(e.name),
            price: num(e.price),
            type: str(e.type)
        }))
        .filter((e) => e.name !== "");
}

export function mapOrderItemRow(row: Row): OrderItem {
    const quantity = Math.max(0, Math.trunc(num(row.quantity)));
    const unitPrice = num(row.price);
    return {
        id: str(row.$id),
        menuId: str(row.menuId),
        name: str(row.name) || "Producto",
        unitPrice,
        quantity,
        extras: parseExtras(row.customizations),
        lineTotal: Math.round(unitPrice * quantity * 100) / 100
    };
}

/** Lee la copia historica de la direccion guardada en el pedido. */
export function parseStoredAddress(row: Row): DeliveryAddress | null {
    const line = str(row.deliveryAddress).trim();
    if (!line) return null;
    const coords = parseLatLng(row.deliveryLatitude, row.deliveryLongitude);
    const label = row.deliveryAddressLabel;
    return {
        label: label === "home" || label === "work" ? label : "manual",
        line,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null
    };
}

/** Convierte una fila de Appwrite en un `Order` tolerante a datos incompletos. */
export function mapOrderRow(row: Row, itemRows: Row[] = []): Order {
    const address = parseStoredAddress(row);
    return {
        id: str(row.$id),
        userId: str(row.userId),
        status: parseOrderStatus(row.status),
        rawStatus: str(row.status),
        subtotal: toFiniteNumber(row.subtotal),
        deliveryFee: num(row.deliveryFee),
        discount: num(row.discount),
        total: num(row.total),
        paymentMethod: str(row.paymentMethod) || "cash_on_delivery",
        createdAt: str(row.$createdAt),
        updatedAt: str(row.$updatedAt) || null,
        deliveryAddress: address,
        deliveryLocation: address ? parseLatLng(address.latitude, address.longitude) : null,
        driverName: str(row.driverName).trim() || null,
        driverLocation: parseLatLng(row.driverLatitude, row.driverLongitude),
        driverUpdatedAt: str(row.driverUpdatedAt) || null,
        items: itemRows.map(mapOrderItemRow)
    };
}
