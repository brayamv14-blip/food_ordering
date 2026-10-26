import { describePayment, describeProviderStatus, isTrustedCheckoutUrl } from "@/lib/domain/payment";
import { isExpoPushToken, routeFromNotificationData } from "@/lib/domain/notifications";
import { buildReorder } from "@/lib/domain/reorder";
import { mapOrderRow } from "@/lib/domain/order";

describe("pago en línea (dominio)", () => {
    it("solo abre enlaces https de Mercado Pago", () => {
        expect(isTrustedCheckoutUrl("https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1")).toBe(true);
        expect(isTrustedCheckoutUrl("https://mercadopago.com.ar/x")).toBe(true);
        for (const bad of [
            "http://www.mercadopago.com.mx/x", "https://mercadopago.com.evil.io/x", "https://evilmercadopago.com/x",
            "https://www.mercadopago.com.mx.evil.io/", "javascript:alert(1)", "fastfood://orders", "no es url", "", null, undefined, 5
        ]) expect(isTrustedCheckoutUrl(bad)).toBe(false);
    });
    it("describe el pago según método y estado", () => {
        expect(describePayment("cash_on_delivery", "not_required")).toMatchObject({ label: "Efectivo contra entrega", actionable: false });
        expect(describePayment(undefined, null)).toMatchObject({ actionable: false });
        expect(describePayment("online", "paid")).toMatchObject({ label: "Pagado en línea", tone: "ok", actionable: false });
        expect(describePayment("online", "pending", "pending")).toMatchObject({ actionable: true, tone: "warn" });
        expect(describePayment("online", null, "pending").actionable).toBe(true);
        expect(describePayment("online", "pending", "cancelled")).toMatchObject({ actionable: false });
    });
    it("traduce el estado que informa Mercado Pago", () => {
        expect(describeProviderStatus("approved")).toMatch(/aprobado/);
        expect(describeProviderStatus("in_process")).toMatch(/en proceso/);
        expect(describeProviderStatus("rejected")).toMatch(/rechazado/);
        expect(describeProviderStatus("refunded")).toMatch(/devuelto/);
        expect(describeProviderStatus(null)).toMatch(/Todavía no encontramos/);
        expect(describeProviderStatus("algo_raro")).toMatch(/Todavía no encontramos/);
    });
    it("el mapeo de pedidos conserva el estado de pago y tolera pedidos anteriores", () => {
        expect(mapOrderRow({ $id: "o1", paymentMethod: "online", paymentStatus: "pending", paymentUrl: "https://www.mercadopago.com.mx/x" })).toMatchObject({ paymentMethod: "online", paymentStatus: "pending", paymentUrl: "https://www.mercadopago.com.mx/x" });
        expect(mapOrderRow({ $id: "o2" })).toMatchObject({ paymentMethod: "cash_on_delivery", paymentStatus: null, paymentUrl: null });
    });
});

describe("notificaciones (dominio)", () => {
    it("valida tokens de Expo", () => {
        expect(isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]")).toBe(true);
        for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[<b>x</b>]", null, undefined, 1]) expect(isExpoPushToken(bad)).toBe(false);
    });
    it("convierte datos de notificación en rutas y rechaza datos sospechosos", () => {
        expect(routeFromNotificationData({ type: "order_status", orderId: "64f1a2b3c4d5e6f7" })).toEqual({ pathname: "/order/[id]", params: { id: "64f1a2b3c4d5e6f7" } });
        expect(routeFromNotificationData({ type: "driver_assigned", orderId: "x" })).toEqual({ pathname: "/driver" });
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
