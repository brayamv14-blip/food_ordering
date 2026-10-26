/** Pago en línea, notificaciones push y pedir de nuevo con servicios externos simulados. */
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-notifications", () => ({
    setNotificationChannelAsync: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    AndroidImportance: { HIGH: 4 }
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "proj-123" } } }, easConfig: undefined } }));
jest.mock("react-native-appwrite", () => ({
    ID: { unique: () => "idx" },
    Query: { equal: (f: string, v: any) => `equal(${f},${v})`, limit: (n: number) => `limit(${n})` }
}));
const mockCall = jest.fn();
jest.mock("@/lib/appwrite", () => {
    const mocks = { databases: { updateRow: jest.fn(), listRows: jest.fn() }, config: {
        databaseId: "db", userCollectionId: "users", menuCollectionId: "menu", customizationsCollectionId: "cust",
        ordersCollectionId: "orders", orderItemsCollectionId: "items", functions: { createOrder: "fnCreate", updateOrderStatus: "fnOps" } } };
    return {
        __esModule: true, __mocks: mocks,
        get databases() { return mocks.databases; },
        get appwriteConfig() { return mocks.config; },
        callBackendFunction: (...a: any[]) => mockCall(...a)
    };
});

import * as WebBrowser from "expo-web-browser";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";

import { PaymentError, isOnlinePaymentEnabled, openCheckout, syncPayment } from "@/lib/services/payments.service";
import { registerForPush, unregisterPush } from "@/lib/services/notifications.service";
import { reorderToCart } from "@/lib/services/reorder.service";
import { OrderServiceError, createOrderIdempotent } from "@/lib/services/orders.service";
import { useCartStore } from "@/store/cart.store";

const { databases, config } = jest.requireMock("@/lib/appwrite").__mocks;
const N = Notifications as any;

beforeEach(() => {
    jest.clearAllMocks();
    config.functions = { createOrder: "fnCreate", updateOrderStatus: "fnOps" };
    process.env.EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT = "true";
    databases.updateRow.mockResolvedValue({});
});

describe("pago en línea (servicio)", () => {
    it("solo se ofrece con el interruptor y las dos Functions", () => {
        expect(isOnlinePaymentEnabled()).toBe(true);
        process.env.EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT = "false";
        expect(isOnlinePaymentEnabled()).toBe(false);
        process.env.EXPO_PUBLIC_ENABLE_ONLINE_PAYMENT = "true";
        config.functions.createOrder = "";
        expect(isOnlinePaymentEnabled()).toBe(false);
        config.functions.createOrder = "fnCreate"; config.functions.updateOrderStatus = "";
        expect(isOnlinePaymentEnabled()).toBe(false);
    });
    it("abre solo enlaces de Mercado Pago", async () => {
        await openCheckout("https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1");
        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
        await expect(openCheckout("https://evil.io/pay")).rejects.toMatchObject({ code: "untrusted_url" });
        await expect(openCheckout("javascript:alert(1)")).rejects.toBeInstanceOf(PaymentError);
        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
    });
    it("la verificación la hace el servidor (action syncPayment) y exige respuesta completa", async () => {
        mockCall.mockResolvedValue({ paymentStatus: "paid" });
        await expect(syncPayment("o1")).resolves.toEqual({ paymentStatus: "paid" });
        expect(mockCall).toHaveBeenCalledWith("fnOps", { action: "syncPayment", orderId: "o1" });
        mockCall.mockResolvedValue({});
        await expect(syncPayment("o1")).rejects.toMatchObject({ code: "bad_response" });
        mockCall.mockRejectedValue(new Error("Network request failed"));
        await expect(syncPayment("o1")).rejects.toThrow("Network request failed");
        config.functions.updateOrderStatus = "";
        await expect(syncPayment("o1")).rejects.toMatchObject({ code: "not_configured" });
    });
});

describe("creación de pedido con pago en línea", () => {
    const base = { userId: "u1", items: [{ id: "m1", name: "Burger", price: 10, image_url: "x", quantity: 1, customizations: [] }], address: { label: "home" as const, line: "Av. Reforma 123, Centro", latitude: null, longitude: null }, contact: { name: "B", phone: "5512345678" }, clientRequestId: "chk_abcdefgh" };

    it("envía el método de pago y devuelve el enlace; nunca envía importes", async () => {
        mockCall.mockResolvedValue({ orderId: "o9", checkoutUrl: "https://www.mercadopago.com.mx/x" });
        const r = await createOrderIdempotent({ ...base, paymentMethod: "online" });
        expect(r).toEqual({ orderId: "o9", duplicate: false, checkoutUrl: "https://www.mercadopago.com.mx/x" });
        const [, payload] = mockCall.mock.calls[0];
        expect(payload.paymentMethod).toBe("online");
        expect(JSON.stringify(payload)).not.toMatch(/total|subtotal|"price"/);
    });
    it("sin servidor el pago en línea se rechaza antes de escribir nada", async () => {
        config.functions.createOrder = "";
        await expect(createOrderIdempotent({ ...base, paymentMethod: "online" })).rejects.toMatchObject({ code: "payment_unavailable" });
        expect(databases.updateRow).not.toHaveBeenCalled();
    });
    it("un enlace que no sea texto se ignora", async () => {
        mockCall.mockResolvedValue({ orderId: "o9", checkoutUrl: 5 });
        expect(await createOrderIdempotent({ ...base, paymentMethod: "online" })).toEqual({ orderId: "o9", duplicate: false });
        expect(OrderServiceError).toBeDefined();
    });
});

describe("notificaciones push (servicio)", () => {
    const OK_TOKEN = "ExponentPushToken[abcdefghijklmnopqrstuv]";
    beforeEach(() => {
        N.getPermissionsAsync.mockResolvedValue({ status: "granted" });
        N.getExpoPushTokenAsync.mockResolvedValue({ data: OK_TOKEN });
    });

    it("registra el token en el perfil tras obtener permiso", async () => {
        expect(await registerForPush("row1")).toEqual({ status: "registered", token: OK_TOKEN });
        expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-123" });
        expect(databases.updateRow).toHaveBeenCalledWith(expect.objectContaining({ rowId: "row1", data: { pushToken: OK_TOKEN } }));
    });
    it("pide el permiso si falta y respeta la negativa", async () => {
        N.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
        N.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
        expect(await registerForPush("row1")).toEqual({ status: "denied" });
        expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(databases.updateRow).not.toHaveBeenCalled();
        N.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
        expect((await registerForPush("row1")).status).toBe("registered");
    });
    it("sin projectId de EAS avisa que falta configurar", async () => {
        const saved = (Constants as any).expoConfig;
        (Constants as any).expoConfig = { extra: {} };
        expect(await registerForPush("row1")).toEqual({ status: "not_configured" });
        (Constants as any).expoConfig = saved;
    });
    it("tolera tokens inválidos y errores del servicio sin lanzar", async () => {
        N.getExpoPushTokenAsync.mockResolvedValue({ data: "basura" });
        expect(await registerForPush("row1")).toEqual({ status: "unavailable" });
        N.getExpoPushTokenAsync.mockRejectedValue(new Error("FCM no configurado"));
        expect(await registerForPush("row1")).toEqual({ status: "unavailable" });
        N.getExpoPushTokenAsync.mockResolvedValue({ data: OK_TOKEN });
        databases.updateRow.mockRejectedValue(new Error("403"));
        expect(await registerForPush("row1")).toEqual({ status: "unavailable" });
    });
    it("desactivar borra el token y no falla si no hay red", async () => {
        expect(await unregisterPush("row1")).toBe(true);
        expect(databases.updateRow).toHaveBeenCalledWith(expect.objectContaining({ data: { pushToken: null } }));
        databases.updateRow.mockRejectedValue(new Error("offline"));
        expect(await unregisterPush("row1")).toBe(false);
    });
});

describe("pedir de nuevo (servicio)", () => {
    const order = { items: [{ id: "i1", menuId: "m1", name: "Burger", unitPrice: 11.5, quantity: 2, extras: [{ id: "c1", name: "Queso", price: 1.5, type: "t" }], lineTotal: 23 }, { id: "i2", menuId: "m2", name: "Pizza", unitPrice: 12, quantity: 1, extras: [], lineTotal: 12 }] };
    beforeEach(() => useCartStore.setState({ items: [] }));

    it("agrega al carrito con precios actuales y respeta cantidades", async () => {
        databases.listRows.mockImplementation(async ({ tableId }: any) => tableId === "menu"
            ? { rows: [{ $id: "m1", name: "Burger", price: 12, image_url: "u1" }, { $id: "m2", name: "Pizza", price: 13, image_url: "u2", available: false }] }
            : { rows: [{ $id: "c1", name: "Queso", price: 2, type: "t" }] });
        const r = await reorderToCart(order as any);
        expect(r.lines).toHaveLength(1);
        expect(r.skipped).toEqual([{ name: "Pizza", reason: "está agotado" }]);
        const items = useCartStore.getState().items;
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ id: "m1", price: 12, quantity: 2, customizations: [{ id: "c1", price: 2 }] });
        expect(useCartStore.getState().getTotalPrice()).toBe(2 * (12 + 2));
    });
    it("si el catálogo no responde no toca el carrito", async () => {
        databases.listRows.mockRejectedValue(new Error("Network request failed"));
        await expect(reorderToCart(order as any)).rejects.toThrow();
        expect(useCartStore.getState().items).toHaveLength(0);
    });
    it("un pedido sin productos no consulta nada", async () => {
        expect(await reorderToCart({ items: [] } as any)).toEqual({ lines: [], skipped: [] });
        expect(databases.listRows).not.toHaveBeenCalled();
    });
});
