import { describePayment, describeProviderStatus, isTrustedCheckoutUrl } from "@/lib/domain/payment";
import { deviceTargetId, findPushTarget, isExpoPushToken, isFcmToken, routeFromNotificationData } from "@/lib/domain/notifications";
import { buildReorder } from "@/lib/domain/reorder";
import { mapOrderRow } from "@/lib/domain/order";

describe("pago en línea (dominio)", () => {
    it("solo abre enlaces https de Stripe Checkout", () => {
        expect(isTrustedCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test_a1#fidkdWxOYHwnPyd1")).toBe(true);
        for (const bad of [
            "http://checkout.stripe.com/x", "https://checkout.stripe.com.evil.io/x", "https://evilcheckout.stripe.com.io/x",
            "https://evil.io/checkout.stripe.com", "https://www.mercadopago.com.mx/x", "javascript:alert(1)", "fastfood://orders", "no es url", "", null, undefined, 5
        ]) expect(isTrustedCheckoutUrl(bad)).toBe(false);
    });
    it("describe el pago según método y estado", () => {
        expect(describePayment("cash_on_delivery", "not_required")).toMatchObject({ label: "Efectivo contra entrega", actionable: false });
        expect(describePayment(undefined, null)).toMatchObject({ actionable: false });
        expect(describePayment("online", "paid")).toMatchObject({ label: "Pagado en línea", tone: "ok", actionable: false });
        expect(describePayment("online", "pending", "pending")).toMatchObject({ actionable: true, tone: "warn" });
        expect(describePayment("online", null, "pending").actionable).toBe(true);
        expect(describePayment("online", "pending", "cancelled")).toMatchObject({ actionable: false });
        expect(describePayment("online", "failed", "pending")).toMatchObject({ actionable: true, tone: "warn" });
        expect(describePayment("online", "cancelled", "cancelled")).toMatchObject({ actionable: false });
        expect(describePayment("online", "refunded", "cancelled")).toMatchObject({ label: "Pago reembolsado", actionable: false });
    });
    it("traduce el estado que informa el servidor tras verificar con Stripe", () => {
        expect(describeProviderStatus("paid")).toMatch(/aprobado/);
        expect(describeProviderStatus("unpaid")).toMatch(/Todavía no vemos el pago/);
        expect(describeProviderStatus("invalid")).toMatch(/no coincide/);
        expect(describeProviderStatus("expired")).toMatch(/venció/);
        expect(describeProviderStatus("failed")).toMatch(/rechazado/);
        expect(describeProviderStatus("refunded")).toMatch(/reembolsado/);
        expect(describeProviderStatus(null)).toMatch(/Todavía no encontramos/);
        expect(describeProviderStatus("algo_raro")).toMatch(/Todavía no encontramos/);
    });
    it("el mapeo de pedidos conserva el estado de pago, no guarda enlaces y tolera pedidos anteriores", () => {
        expect(mapOrderRow({ $id: "o1", paymentMethod: "online", paymentStatus: "pending", paymentUrl: "https://checkout.stripe.com/x" })).toMatchObject({ paymentMethod: "online", paymentStatus: "pending" });
        expect(mapOrderRow({ $id: "o1", paymentMethod: "online", paymentStatus: "pending" })).not.toHaveProperty("paymentUrl");
        expect(mapOrderRow({ $id: "o2" })).toMatchObject({ paymentMethod: "cash_on_delivery", paymentStatus: null });
    });
});

describe("notificaciones (dominio)", () => {
    const FCM = "dQw4w9WgXcQ:APA91b" + "x".repeat(140);
    it("distingue el token FCM nativo del token de Expo (no se confunden)", () => {
        expect(isFcmToken(FCM)).toBe(true);
        expect(isFcmToken("ExponentPushToken[abcdefghijklmnopqrstuv]")).toBe(false);
        for (const bad of ["", "abc", "x".repeat(99), "a b".repeat(60), "<script>".repeat(20), null, undefined, 1]) expect(isFcmToken(bad)).toBe(false);
        expect(isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]")).toBe(true);
        expect(isExpoPushToken(FCM)).toBe(false);
        for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[<b>x</b>]", null, undefined, 1]) expect(isExpoPushToken(bad)).toBe(false);
    });
    it("el id del destino push es estable por dispositivo y válido para Appwrite", () => {
        expect(deviceTargetId("a1b2c3d4e5f60718")).toBe("da1b2c3d4e5f60718");
        expect(deviceTargetId("a1b2c3d4e5f60718")).toBe(deviceTargetId("a1b2c3d4e5f60718"));
        expect(deviceTargetId("x".repeat(100))!.length).toBeLessThanOrEqual(36);
        expect(deviceTargetId("a-b_c.d$e!f#12345678")).toMatch(/^[A-Za-z0-9]+$/);
        for (const bad of ["", "abc", null, undefined, 5]) expect(deviceTargetId(bad)).toBeNull();
    });
    it("encuentra solo destinos push propios ya registrados", () => {
        const targets = [{ $id: "dAAAAAAAA", providerType: "push", identifier: "tok" }, { $id: "dBBBBBBBB", providerType: "email", identifier: "a@b.c" }];
        expect(findPushTarget(targets, "dAAAAAAAA")).toEqual({ identifier: "tok" });
        expect(findPushTarget(targets, "dBBBBBBBB")).toBeNull();
        expect(findPushTarget(targets, "dZZZZZZZZ")).toBeNull();
        expect(findPushTarget(undefined, "dAAAAAAAA")).toBeNull();
        expect(findPushTarget([null, 5], "x")).toBeNull();
    });
    it("convierte datos de notificación en rutas y rechaza datos sospechosos", () => {
        expect(routeFromNotificationData({ type: "order_status", orderId: "64f1a2b3c4d5e6f7" })).toEqual({ pathname: "/order/[id]", params: { id: "64f1a2b3c4d5e6f7" } });
        expect(routeFromNotificationData({ type: "driver_assigned", orderId: "x" })).toEqual({ pathname: "/driver" });
        // aviso de pago: mismo tipo, abre el pedido
        expect(routeFromNotificationData({ type: "order_status", orderId: "64f1a2b3c4d5e6f7", payment: "paid" })).toEqual({ pathname: "/order/[id]", params: { id: "64f1a2b3c4d5e6f7" } });
        for (const bad of [
            null, undefined, "texto", 5, {}, { type: "order_status" }, { type: "order_status", orderId: "../../admin" },
            { type: "order_status", orderId: "a b" }, { type: "order_status", orderId: 123456 }, { type: "otro", orderId: "64f1a2b3c4d5e6f7" }
        ]) expect(routeFromNotificationData(bad)).toBeNull();
    });
});

describe("pedir de nuevo (dominio)", () => {
    const items = (over: any = {}) => [{ id: "i1", menuId: "m1", name: "Burger", unitPrice: 11.5, quantity: 2, extras: [{ id: "c1", name: "Queso", price: 1.5, type: "t" }], lineTotal: 23, ...over }];
    const menu = { m1: { id: "m1", name: "Burger", price: 12, image_url: "x", available: true } };
    const extras = { c1: { id: "c1", name: "Queso", price: 2, type: "t" } };

    it("usa precios y extras ACTUALES del catálogo, no los del pedido viejo", () => {
        const r = buildReorder(items(), menu, extras);
        expect(r.skipped).toEqual([]);
        expect(r.lines).toEqual([{ id: "m1", name: "Burger", price: 12, image_url: "x", quantity: 2, customizations: [{ id: "c1", name: "Queso", price: 2, type: "t" }] }]);
    });
    it("omite productos eliminados, agotados o con extras que ya no existen", () => {
        expect(buildReorder(items(), {}, extras).skipped[0].reason).toMatch(/catálogo/);
        expect(buildReorder(items(), { m1: { ...menu.m1, available: false } }, extras).skipped[0].reason).toMatch(/agotado/);
        expect(buildReorder(items(), menu, {}).skipped[0].reason).toMatch(/extras/);
        expect(buildReorder(items(), { m1: { ...menu.m1, price: -1 } }, extras).skipped[0].reason).toMatch(/precio/);
        expect(buildReorder(items(), menu, { c1: { ...extras.c1, price: NaN } }).skipped).toHaveLength(1);
    });
    it("limita las cantidades a 1–50 y mezcla líneas válidas con omitidas", () => {
        expect(buildReorder(items({ quantity: 500 }), menu, extras).lines[0].quantity).toBe(50);
        expect(buildReorder(items({ quantity: 0 }), menu, extras).lines[0].quantity).toBe(1);
        const mix = buildReorder([...items(), ...items({ id: "i2", menuId: "zzz", name: "Fantasma" })], menu, extras);
        expect(mix.lines).toHaveLength(1);
        expect(mix.skipped).toEqual([{ name: "Fantasma", reason: "ya no está en el catálogo" }]);
        expect(buildReorder([], menu, extras)).toEqual({ lines: [], skipped: [] });
    });
});
