import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");

describe("reglas del backend (Appwrite Functions)", () => {
    const base = { isOwner: true };

    it("el cliente solo puede cancelar su pedido pendiente", () => {
        expect(rules.canActorTransition({ actor: "customer", ...base, from: "pending", to: "cancelled" }).ok).toBe(true);
        expect(rules.canActorTransition({ actor: "customer", ...base, from: "confirmed", to: "cancelled" }).ok).toBe(false);
        expect(rules.canActorTransition({ actor: "customer", ...base, from: "on_the_way", to: "delivered" })).toMatchObject({ ok: false, code: "forbidden" });
        expect(rules.canActorTransition({ actor: "customer", isOwner: false, from: "pending", to: "cancelled" }).ok).toBe(false);
    });

    it("el repartidor solo avanza a en camino / entregado", () => {
        expect(rules.canActorTransition({ actor: "driver", isOwner: false, from: "preparing", to: "on_the_way" }).ok).toBe(true);
        expect(rules.canActorTransition({ actor: "driver", isOwner: false, from: "on_the_way", to: "delivered" }).ok).toBe(true);
        expect(rules.canActorTransition({ actor: "driver", isOwner: false, from: "pending", to: "cancelled" }).ok).toBe(false);
    });

    it("el personal sigue el flujo pero no salta estados", () => {
        expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed" }).ok).toBe(true);
        expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "delivered" })).toMatchObject({ ok: false, code: "invalid_transition" });
        expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "delivered", to: "pending" }).ok).toBe(false);
    });

    const menu = { m1: { $id: "m1", name: "Burger", price: 10 } };
    const extras = { c1: { $id: "c1", name: "Queso", price: 1.5, type: "t" } };

    it("recalcula importes con precios del servidor e ignora lo que envíe el cliente", () => {
        const r = rules.priceOrder({
            items: [{ menuId: "m1", quantity: 2, customizationIds: ["c1", "c1"], price: 0.01, total: 0 }],
            menuById: menu, extrasById: extras
        });
        expect(r).toMatchObject({ ok: true, subtotal: 23, deliveryFee: 5, discount: 0.5, total: 27.5 });
        expect(JSON.parse(r.lines[0].customizations)).toHaveLength(1); // sin doble cargo
    });

    it("rechaza productos, extras o cantidades inválidos", () => {
        const call = (items: any) => rules.priceOrder({ items, menuById: menu, extrasById: extras });
        expect(call([])).toMatchObject({ ok: false, code: "empty_cart" });
        expect(call([{ menuId: "zzz", quantity: 1 }])).toMatchObject({ code: "unknown_menu" });
        expect(call([{ menuId: "m1", quantity: 1, customizationIds: ["zzz"] }])).toMatchObject({ code: "unknown_extra" });
        expect(call([{ menuId: "m1", quantity: -1 }])).toMatchObject({ code: "bad_quantity" });
        expect(call([{ menuId: "m1", quantity: 1.5 }])).toMatchObject({ code: "bad_quantity" });
    });

    it("valida posiciones del repartidor", () => {
        expect(rules.validateDriverPosition({ latitude: 19.5, longitude: -99.2 }).ok).toBe(true);
        expect(rules.validateDriverPosition({ latitude: 0, longitude: 0 }).code).toBe("bad_coordinates");
        expect(rules.validateDriverPosition({ latitude: 91, longitude: 0 }).code).toBe("bad_coordinates");
        expect(rules.validateDriverPosition({ latitude: "x", longitude: 1 }).code).toBe("bad_coordinates");
        expect(rules.validateDriverPosition({ latitude: 19.5, longitude: -99.2, now: 1000, lastUpdateMs: 500 }).code).toBe("rate_limited");
    });

    it("las transiciones del servidor coinciden con las de la app", () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { ALLOWED_TRANSITIONS } = require("@/lib/domain/orderStatus");
        expect(rules.TRANSITIONS).toEqual(JSON.parse(JSON.stringify(ALLOWED_TRANSITIONS)));
    });

    it("solo existen las dos funciones permitidas", () => {
        const root = path.join(__dirname, "../../appwrite-functions");
        const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "src/main.js"))).map((d) => d.name).sort();
        expect(dirs).toEqual(["create-order", "update-order-status"]);
    });

    it("las copias de rules.js dentro de cada función están sincronizadas", () => {
        const root = path.join(__dirname, "../../appwrite-functions");
        // Se normaliza CRLF -> LF para que la prueba funcione igual en Windows y Linux.
        const lf = (txt: string) => txt.replace(/\r\n/g, "\n");
        const shared = lf(fs.readFileSync(path.join(root, "shared/rules.js"), "utf8"));
        const expected = shared.replace(/module\.exports = \{([\s\S]*?)\};\s*$/, "export {$1};\n");
        for (const fn of ["create-order", "update-order-status"]) {
            const copy = lf(fs.readFileSync(path.join(root, fn, "src/rules.js"), "utf8"));
            expect(copy.endsWith(expected)).toBe(true);
        }
    });

    it("exige repartidor asignado para enviar a reparto", () => {
        expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "preparing", to: "on_the_way", hasDriver: false })).toMatchObject({ ok: false, code: "driver_required" });
        expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "preparing", to: "on_the_way", hasDriver: true }).ok).toBe(true);
    });

    it("solo acepta extras que pertenecen al producto", () => {
        const call = (allowed: any) => rules.priceOrder({
            items: [{ menuId: "m1", quantity: 1, customizationIds: ["c1"] }],
            menuById: menu, extrasById: extras, allowedExtrasByMenu: allowed
        });
        expect(call({ m1: new Set(["c1"]) }).ok).toBe(true);
        expect(call({ m1: new Set(["c9"]) })).toMatchObject({ ok: false, code: "extra_not_allowed" });
        expect(call({})).toMatchObject({ ok: false, code: "extra_not_allowed" });
    });

    it("valida dirección y teléfono recibidos del cliente", () => {
        const base = { line: "Av. Reforma 123, Centro", label: "home" };
        expect(rules.validateAddressInput({ ...base, latitude: 19.5, longitude: -99.2 })).toMatchObject({ ok: true, label: "home", latitude: 19.5 });
        expect(rules.validateAddressInput(base)).toMatchObject({ ok: true, latitude: null, longitude: null });
        expect(rules.validateAddressInput({ ...base, label: "x" })).toMatchObject({ ok: true, label: "manual" });
        expect(rules.validateAddressInput({ line: "corta" }).ok).toBe(false);
        expect(rules.validateAddressInput({ line: "12345678" }).ok).toBe(false);
        expect(rules.validateAddressInput(null).ok).toBe(false);
        expect(rules.validateAddressInput({ ...base, latitude: 19.5 }).code).toBe("bad_coordinates");
        expect(rules.validateAddressInput({ ...base, latitude: 0, longitude: 0 }).ok).toBe(false);
        expect(rules.validatePhone("55 1234-5678")).toMatchObject({ ok: true, phone: "5512345678" });
        expect(rules.validatePhone("12")).toMatchObject({ ok: false, code: "bad_phone" });
        expect(rules.validatePhone(undefined).ok).toBe(false);
    });

    it("solo asigna repartidor a pedidos no finalizados y no expone el userId", () => {
        expect(rules.canAssignDriver("preparing")).toBe(true);
        expect(rules.canAssignDriver("delivered")).toBe(false);
        expect(rules.canAssignDriver("raro")).toBe(false);
        const view = rules.toStaffOrderView({ $id: "o1", userId: "secreto", status: "pending", total: 5 }, [{ name: "X", quantity: 2, price: 9 }]);
        expect(view).not.toHaveProperty("userId");
        expect(view.items).toEqual([{ name: "X", quantity: 2 }]);
    });

    it("rechaza productos no disponibles y cantidades manipuladas", () => {
        const m = { ...menu, m9: { $id: "m9", name: "Agotado", price: 5, available: false } };
        expect(rules.priceOrder({ items: [{ menuId: "m9", quantity: 1 }], menuById: m, extrasById: extras })).toMatchObject({ ok: false, code: "unavailable" });
        expect(rules.priceOrder({ items: [{ menuId: "m1", quantity: -1 }], menuById: m, extrasById: extras }).code).toBe("bad_quantity");
        expect(rules.priceOrder({ items: [{ menuId: "m1", quantity: 51 }], menuById: m, extrasById: extras }).code).toBe("bad_quantity");
        expect(rules.priceOrder({ items: [{ menuId: "m1", quantity: "2" }], menuById: m, extrasById: extras }).code).toBe("bad_quantity");
        expect(rules.isMenuAvailable({ available: false })).toBe(false);
        expect(rules.isMenuAvailable({ available: true })).toBe(true);
        expect(rules.isMenuAvailable({})).toBe(true);
        expect(rules.isMenuAvailable(undefined)).toBe(true);
    });

    it("detecta pedidos modificados por otra persona (concurrencia optimista)", () => {
        const order = { status: "pending", $updatedAt: "T1" };
        expect(rules.checkExpected(order, {}).ok).toBe(true);
        expect(rules.checkExpected(order, { expectedStatus: "pending", expectedUpdatedAt: "T1" }).ok).toBe(true);
        expect(rules.checkExpected(order, { expectedStatus: "confirmed" })).toMatchObject({ ok: false, code: "stale_order" });
        expect(rules.checkExpected(order, { expectedUpdatedAt: "T0" })).toMatchObject({ ok: false, code: "stale_order" });
        expect(rules.checkExpected(order)).toEqual({ ok: true });
    });

    it("valida rangos de fecha y búsqueda por id", () => {
        expect(rules.parseDateRange({})).toEqual({ ok: true });
        expect(rules.parseDateRange({ from: "2026-01-01T00:00:00Z" })).toEqual({ ok: true, from: "2026-01-01T00:00:00.000Z" });
        expect(rules.parseDateRange({ from: "basura" }).code).toBe("bad_date");
        expect(rules.parseDateRange({ from: 5 }).code).toBe("bad_date");
        expect(rules.parseDateRange({ from: "2026-02-01", to: "2026-01-01" }).code).toBe("bad_date");
        expect(rules.matchesOrderQuery("abcdef123456", "#123456")).toBe(true);
        expect(rules.matchesOrderQuery("abcdef123456", "ABCDEF123456")).toBe(true);
        expect(rules.matchesOrderQuery("abcdef123456", "12")).toBe(false);
        expect(rules.matchesOrderQuery("abcdef123456", "")).toBe(false);
        expect(rules.matchesOrderQuery("abcdef123456", undefined)).toBe(false);
    });

    it("arma eventos de historial sin datos sensibles", () => {
        const ev = rules.buildOrderEvent({ orderId: "o1", type: "status", from: "pending", to: "confirmed", actorId: "u1", actorRole: "staff" });
        expect(ev).toEqual({ orderId: "o1", type: "status", fromStatus: "pending", toStatus: "confirmed", actorId: "u1", actorRole: "staff", driverUserId: null });
        expect(Object.keys(ev)).not.toEqual(expect.arrayContaining(["customerPhone", "deliveryAddress"]));
    });

    describe("pago en línea", () => {
        const base = { isOwner: true, from: "pending" as const };
        it("valida el método de pago", () => {
            expect(rules.validatePaymentMethod(undefined)).toEqual({ ok: true, method: "cash_on_delivery" });
            expect(rules.validatePaymentMethod("online")).toEqual({ ok: true, method: "online" });
            expect(rules.validatePaymentMethod("cash_on_delivery").ok).toBe(true);
            for (const bad of ["bitcoin", "", 5, {}, "ONLINE"]) expect(rules.validatePaymentMethod(bad)).toMatchObject({ ok: false, code: "bad_payment_method" });
        });
        it("no confirma un pedido en línea hasta que el pago esté verificado", () => {
            const online = (status: any) => ({ method: "online", status });
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed", payment: online("pending") })).toMatchObject({ ok: false, code: "payment_required" });
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed", payment: online(null) }).code).toBe("payment_required");
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed", payment: online("paid") }).ok).toBe(true);
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed", payment: { method: "cash_on_delivery", status: "not_required" } }).ok).toBe(true);
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "confirmed" }).ok).toBe(true);
        });
        it("el cliente no cancela por su cuenta un pedido pagado (reembolso fuera de la app)", () => {
            expect(rules.canActorTransition({ actor: "customer", ...base, to: "cancelled", payment: { method: "online", status: "paid" } })).toMatchObject({ ok: false, code: "refund_needed" });
            expect(rules.canActorTransition({ actor: "customer", ...base, to: "cancelled", payment: { method: "online", status: "pending" } }).ok).toBe(true);
            expect(rules.canActorTransition({ actor: "staff", isOwner: false, from: "pending", to: "cancelled", payment: { method: "online", status: "paid" } }).ok).toBe(true);
        });
        it("arma la preferencia con el total del servidor", () => {
            const b = rules.buildPreferenceBody({ orderId: "abc123456789", total: 28.5, returnUrl: "https://x.io/p.html" });
            expect(b).toMatchObject({ external_reference: "abc123456789", auto_return: "approved", back_urls: { success: "https://x.io/p.html" } });
            expect(b.items).toEqual([{ id: "abc123456789", title: "Pedido Delivery #456789", quantity: 1, unit_price: 28.5, currency_id: "MXN" }]);
        });
        it("solo acepta un pago aprobado con importe y moneda exactos", () => {
            const pay = (o: any) => ({ id: 1, status: "approved", transaction_amount: 28.5, currency_id: "MXN", ...o });
            expect(rules.pickApprovedPayment([pay({})], { total: 28.5 })).toMatchObject({ id: 1 });
            expect(rules.pickApprovedPayment([pay({ transaction_amount: 28.49 })], { total: 28.5 })).toBeNull();
            expect(rules.pickApprovedPayment([pay({ status: "pending" }), pay({ status: "rejected" })], { total: 28.5 })).toBeNull();
            expect(rules.pickApprovedPayment([pay({ currency_id: "USD" })], { total: 28.5 })).toBeNull();
            expect(rules.pickApprovedPayment([pay({ transaction_amount: 0.1 + 0.2 })], { total: 0.3 })).not.toBeNull(); // sin error de flotantes
            expect(rules.pickApprovedPayment(undefined, { total: 1 })).toBeNull();
            expect(rules.pickApprovedPayment([null, 5], { total: 1 })).toBeNull();
            expect(rules.latestPaymentStatus([{ status: "rejected", date_created: "2026-01-01" }, { status: "pending", date_created: "2026-02-01" }])).toBe("pending");
            expect(rules.latestPaymentStatus([])).toBeNull();
        });
    });

    describe("notificaciones push", () => {
        it("reconoce tokens de Expo y rechaza basura", () => {
            expect(rules.isExpoPushToken("ExponentPushToken[abcdefghijklmnopqrstuv]")).toBe(true);
            expect(rules.isExpoPushToken("ExpoPushToken[abcdefghij_klm-n]")).toBe(true);
            for (const bad of ["", "abc", "ExponentPushToken[]", "ExponentPushToken[<script>alert(1)</script>]", null, undefined, 5]) expect(rules.isExpoPushToken(bad)).toBe(false);
        });
        it("el mensaje al cliente no incluye datos personales", () => {
            const n = rules.buildStatusNotification("on_the_way", "ord123456");
            expect(n).toMatchObject({ title: "¡Tu pedido va en camino!", data: { orderId: "ord123456", status: "on_the_way" } });
            expect(JSON.stringify(n)).not.toMatch(/direcci|tel[eé]fono|\d{10}/i);
            expect(rules.buildStatusNotification("pending", "o")).toBeNull();
            expect(rules.buildStatusNotification("raro", "o")).toBeNull();
            expect(rules.buildAssignmentNotification("abcdef123456").body).toContain("#123456");
        });
        it("detecta qué tokens purgar según la respuesta de Expo", () => {
            const resp = { data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }, { status: "error", details: { error: "MessageTooBig" } }] };
            expect(rules.tokensToPurge(resp, ["a", "b", "c"])).toEqual(["b"]);
            expect(rules.tokensToPurge(null, ["a"])).toEqual([]);
            expect(rules.tokensToPurge({ data: "x" }, ["a"])).toEqual([]);
        });
    });
});
