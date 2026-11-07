/** Pago en línea, notificaciones push y pedir de nuevo con servicios externos simulados. */
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("expo-notifications", () => ({
    setNotificationChannelAsync: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getDevicePushTokenAsync: jest.fn(),
    AndroidImportance: { HIGH: 4 }
}));
jest.mock("expo-application", () => ({ getAndroidId: jest.fn() }));
jest.mock("react-native-appwrite", () => ({
    ID: { unique: () => "idx" },
    Query: { equal: (f: string, v: any) => `equal(${f},${v})`, limit: (n: number) => `limit(${n})` }
}));
const mockCall = jest.fn();
jest.mock("@/lib/appwrite", () => {
    const mocks = {
        databases: { updateRow: jest.fn(), listRows: jest.fn() },
        account: {
            get: jest.fn(),
            createPushTarget: jest.fn(),
            updatePushTarget: jest.fn(),
            deletePushTarget: jest.fn()
        },
        config: {
            pushProviderId: "prov1",
            databaseId: "db",
            userCollectionId: "users",
            menuCollectionId: "menu",
            customizationsCollectionId: "cust",
            ordersCollectionId: "orders",
            orderItemsCollectionId: "items",
            functions: { createOrder: "fnCreate", updateOrderStatus: "fnOps" }
        }
    };
    return {
        __esModule: true,
        __mocks: mocks,
        get databases() { return mocks.databases; },
        get account() { return mocks.account; },
        get appwriteConfig() { return mocks.config; },
        callBackendFunction: (...a: any[]) => mockCall(...a)
    };
});

import * as WebBrowser from "expo-web-browser";
import * as Notifications from "expo-notifications";
import * as Application from "expo-application";
import { Platform } from "react-native";

import {
    PaymentError,
    isOnlinePaymentEnabled,
    openCheckout,
    requestPaymentUrl,
    syncPayment
} from "@/lib/services/payments.service";
import {
    isPushRegistered,
    refreshPushToken,
    registerForPush,
    unregisterPush
} from "@/lib/services/notifications.service";
import { reorderToCart } from "@/lib/services/reorder.service";
import {
    OrderServiceError,
    createOrderIdempotent
} from "@/lib/services/orders.service";
import { useCartStore } from "@/store/cart.store";

const { databases, account, config } = jest.requireMock("@/lib/appwrite").__mocks;
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

        config.functions.createOrder = "fnCreate";
        config.functions.updateOrderStatus = "";
        expect(isOnlinePaymentEnabled()).toBe(false);
    });

    it("abre solo enlaces de Stripe Checkout", async () => {
        await openCheckout("https://checkout.stripe.com/c/pay/cs_test_a1#frag");
        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);

        await expect(openCheckout("https://evil.io/pay"))
            .rejects.toMatchObject({ code: "untrusted_url" });

        await expect(openCheckout("javascript:alert(1)"))
            .rejects.toBeInstanceOf(PaymentError);

        // Stripe Checkout es un dominio legítimo y debe poder abrirse.
        await expect(openCheckout("https://checkout.stripe.com/c/pay/cs_test_a1"))
            .resolves.toBeUndefined();

        expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(2);
    });

    it("la verificación la hace el servidor (action syncPayment) y exige respuesta completa", async () => {
        mockCall.mockResolvedValue({ paymentStatus: "paid" });

        await expect(syncPayment("o1"))
            .resolves.toEqual({ paymentStatus: "paid" });

        expect(mockCall).toHaveBeenCalledWith("fnOps", {
            action: "syncPayment",
            orderId: "o1"
        });

        mockCall.mockResolvedValue({});
        await expect(syncPayment("o1"))
            .rejects.toMatchObject({ code: "bad_response" });

        mockCall.mockRejectedValue(new Error("Network request failed"));
        await expect(syncPayment("o1"))
            .rejects.toThrow("Network request failed");

        config.functions.updateOrderStatus = "";
        await expect(syncPayment("o1"))
            .rejects.toMatchObject({ code: "not_configured" });
    });
});

describe("reintento de pago (servicio)", () => {
    it("pide al servidor el enlace (action payOrder) y solo acepta enlaces de Stripe", async () => {
        mockCall.mockResolvedValue({
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1#f"
        });

        await expect(requestPaymentUrl("o1"))
            .resolves.toBe("https://checkout.stripe.com/c/pay/cs_test_a1#f");

        expect(mockCall).toHaveBeenCalledWith("fnOps", {
            action: "payOrder",
            orderId: "o1"
        });

        mockCall.mockResolvedValue({ checkoutUrl: "https://evil.io/pay" });
        await expect(requestPaymentUrl("o1"))
            .rejects.toMatchObject({ code: "untrusted_url" });

        mockCall.mockResolvedValue({});
        await expect(requestPaymentUrl("o1"))
            .rejects.toMatchObject({ code: "untrusted_url" });

        config.functions.updateOrderStatus = "";
        await expect(requestPaymentUrl("o1"))
            .rejects.toMatchObject({ code: "not_configured" });
    });
});

describe("creación de pedido con pago en línea", () => {
    const base = {
        userId: "u1",
        items: [{
            id: "m1",
            name: "Burger",
            price: 10,
            image_url: "x",
            quantity: 1,
            customizations: []
        }],
        address: {
            label: "home" as const,
            line: "Av. Reforma 123, Centro",
            latitude: null,
            longitude: null
        },
        contact: { name: "B", phone: "5512345678" },
        clientRequestId: "chk_abcdefgh"
    };

    it("envía el método de pago y devuelve el enlace; nunca envía importes", async () => {
        mockCall.mockResolvedValue({
            orderId: "o9",
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1"
        });

        const r = await createOrderIdempotent({ ...base, paymentMethod: "online" });

        expect(r).toEqual({
            orderId: "o9",
            duplicate: false,
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1"
        });

        const [, payload] = mockCall.mock.calls[0];
        expect(payload.paymentMethod).toBe("online");
        expect(JSON.stringify(payload)).not.toMatch(/total|subtotal|"price"/);
    });

    it("sin servidor el pago en línea se rechaza antes de escribir nada", async () => {
        config.functions.createOrder = "";

        await expect(createOrderIdempotent({ ...base, paymentMethod: "online" }))
            .rejects.toMatchObject({ code: "payment_unavailable" });

        expect(databases.updateRow).not.toHaveBeenCalled();
    });

    it("un enlace que no sea texto se ignora", async () => {
        mockCall.mockResolvedValue({ orderId: "o9", checkoutUrl: 5 });

        expect(await createOrderIdempotent({ ...base, paymentMethod: "online" }))
            .toEqual({ orderId: "o9", duplicate: false });

        expect(OrderServiceError).toBeDefined();
    });
});

describe("notificaciones push (servicio, Appwrite Messaging + token FCM nativo)", () => {
    const FCM = "dQw4w9WgXcQ:APA91b" + "x".repeat(140);
    const TARGET = "da1b2c3d4e5f60718";

    beforeEach(() => {
        (Platform as any).OS = "android";
        config.pushProviderId = "prov1";
        (Application.getAndroidId as jest.Mock).mockReturnValue("a1b2c3d4e5f60718");
        N.getPermissionsAsync.mockResolvedValue({ status: "granted" });
        N.getDevicePushTokenAsync.mockResolvedValue({ type: "android", data: FCM });
        account.createPushTarget.mockResolvedValue({});
        account.updatePushTarget.mockResolvedValue({});
        account.deletePushTarget.mockResolvedValue({});
        account.get.mockResolvedValue({ targets: [] });
    });

    it("registra el token FCM nativo como destino push con el proveedor configurado", async () => {
        expect(await registerForPush())
            .toEqual({ status: "registered", targetId: TARGET });

        expect(account.createPushTarget).toHaveBeenCalledWith({
            targetId: TARGET,
            identifier: FCM,
            providerId: "prov1"
        });

        expect(N.setNotificationChannelAsync)
            .toHaveBeenCalledWith("orders", expect.anything());
    });

    it("nunca guarda un token de Expo como destino de Appwrite", async () => {
        N.getDevicePushTokenAsync.mockResolvedValue({
            type: "android",
            data: "ExponentPushToken[abcdefghijklmnopqrstuv]"
        });

        expect(await registerForPush()).toEqual({ status: "unavailable" });
        expect(account.createPushTarget).not.toHaveBeenCalled();
    });

    it("no duplica dispositivos: si el destino ya existe (409) solo actualiza el token", async () => {
        account.createPushTarget.mockRejectedValue({ code: 409 });

        expect(await registerForPush())
            .toEqual({ status: "registered", targetId: TARGET });

        expect(account.updatePushTarget).toHaveBeenCalledWith({
            targetId: TARGET,
            identifier: FCM
        });

        expect(account.createPushTarget).toHaveBeenCalledTimes(1);
    });

    it("pide el permiso si falta y respeta la negativa", async () => {
        N.getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
        N.requestPermissionsAsync.mockResolvedValue({ status: "denied" });

        expect(await registerForPush()).toEqual({ status: "denied" });
        expect(N.getDevicePushTokenAsync).not.toHaveBeenCalled();
        expect(account.createPushTarget).not.toHaveBeenCalled();

        N.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
        expect((await registerForPush()).status).toBe("registered");
    });

    it("sin proveedor configurado o fuera de Android lo indica sin tocar nada", async () => {
        config.pushProviderId = "";
        expect(await registerForPush()).toEqual({ status: "not_configured" });

        config.pushProviderId = "prov1";
        (Platform as any).OS = "ios";
        expect(await registerForPush()).toEqual({ status: "unsupported" });
        expect(N.getDevicePushTokenAsync).not.toHaveBeenCalled();
    });

    it("tolera errores de FCM, de red y de Appwrite sin lanzar", async () => {
        N.getDevicePushTokenAsync.mockRejectedValue(
            new Error("FIS_AUTH_ERROR / Firebase no configurado")
        );
        expect(await registerForPush()).toEqual({ status: "unavailable" });

        N.getDevicePushTokenAsync.mockResolvedValue({ type: "android", data: FCM });
        account.createPushTarget.mockRejectedValue(new Error("Network request failed"));
        expect(await registerForPush()).toEqual({ status: "offline" });

        account.createPushTarget.mockRejectedValue({ code: 401, message: "unauthorized" });
        expect(await registerForPush()).toEqual({ status: "unavailable" });
    });

    it("sabe si este dispositivo ya está registrado leyendo los destinos reales de la cuenta", async () => {
        expect(await isPushRegistered()).toBe(false);

        account.get.mockResolvedValue({
            targets: [{ $id: TARGET, providerType: "push", identifier: FCM }]
        });
        expect(await isPushRegistered()).toBe(true);

        account.get.mockRejectedValue(new Error("offline"));
        expect(await isPushRegistered()).toBe(false);
    });

    it("al renovarse el token solo actualiza si el dispositivo estaba registrado", async () => {
        expect(await refreshPushToken(FCM)).toBe(false);
        expect(account.updatePushTarget).not.toHaveBeenCalled();

        account.get.mockResolvedValue({
            targets: [{ $id: TARGET, providerType: "push", identifier: "viejo" }]
        });
        expect(await refreshPushToken(FCM)).toBe(true);

        expect(account.updatePushTarget).toHaveBeenCalledWith({
            targetId: TARGET,
            identifier: FCM
        });

        expect(await refreshPushToken("basura")).toBe(false);
    });

    it("desactivar elimina el destino; si ya no existía (404) cuenta como hecho; sin red devuelve false", async () => {
        expect(await unregisterPush()).toBe(true);
        expect(account.deletePushTarget).toHaveBeenCalledWith({ targetId: TARGET });

        account.deletePushTarget.mockRejectedValue({ code: 404 });
        expect(await unregisterPush()).toBe(true);

        account.deletePushTarget.mockRejectedValue(new Error("offline"));
        expect(await unregisterPush()).toBe(false);
    });
});

describe("pedir de nuevo (servicio)", () => {
    const order = {
        items: [
            {
                id: "i1",
                menuId: "m1",
                name: "Burger",
                unitPrice: 11.5,
                quantity: 2,
                extras: [{ id: "c1", name: "Queso", price: 1.5, type: "t" }],
                lineTotal: 23
            },
            {
                id: "i2",
                menuId: "m2",
                name: "Pizza",
                unitPrice: 12,
                quantity: 1,
                extras: [],
                lineTotal: 12
            }
        ]
    };

    beforeEach(() => useCartStore.setState({ items: [] }));

    it("agrega al carrito con precios actuales y respeta cantidades", async () => {
        databases.listRows.mockImplementation(async ({ tableId }: any) =>
            tableId === "menu"
                ? {
                    rows: [
                        { $id: "m1", name: "Burger", price: 12, image_url: "u1" },
                        { $id: "m2", name: "Pizza", price: 13, image_url: "u2", available: false }
                    ]
                }
                : { rows: [{ $id: "c1", name: "Queso", price: 2, type: "t" }] }
        );

        const r = await reorderToCart(order as any);
        expect(r.lines).toHaveLength(1);
        expect(r.skipped).toEqual([{ name: "Pizza", reason: "está agotado" }]);

        const items = useCartStore.getState().items;
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: "m1",
            price: 12,
            quantity: 2,
            customizations: [{ id: "c1", price: 2 }]
        });

        expect(useCartStore.getState().getTotalPrice()).toBe(2 * (12 + 2));
    });

    it("si el catálogo no responde no toca el carrito", async () => {
        databases.listRows.mockRejectedValue(new Error("Network request failed"));

        await expect(reorderToCart(order as any)).rejects.toThrow();
        expect(useCartStore.getState().items).toHaveLength(0);
    });

    it("un pedido sin productos no consulta nada", async () => {
        expect(await reorderToCart({ items: [] } as any))
            .toEqual({ lines: [], skipped: [] });

        expect(databases.listRows).not.toHaveBeenCalled();
    });
});
