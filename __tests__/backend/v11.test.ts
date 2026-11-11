// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");

describe("v11: estado del repartidor", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    it("apagado manual = offline; en camino u ocupado por límite = busy; si no available", () => {
        expect(rules.driverState({ available: false, now }).status).toBe("offline");
        expect(rules.driverState({ available: true, inTransit: 1, now }).status).toBe("busy");
        expect(rules.driverState({ available: true, active: 3, maxActive: 3, now }).status).toBe("busy");
        expect(rules.driverState({ available: true, active: 1, now }).status).toBe("available");
    });
    it("señal vieja (>10 min) = no conectado/stale; reciente = conectado", () => {
        expect(rules.driverState({ available: true, lastSeenAt: "2026-11-07T11:59:00Z", now })).toMatchObject({ connected: true, stale: false });
        expect(rules.driverState({ available: true, lastSeenAt: "2026-11-07T11:00:00Z", now })).toMatchObject({ connected: false, stale: true });
        expect(rules.driverState({ available: true, now })).toMatchObject({ connected: false, stale: false, lastSeenAt: null });
    });
});

describe("v11: motivos, reembolsos, categorías, cuentas", () => {
    it("normalizeReason exige mínimo y limpia caracteres de control", () => {
        expect(rules.normalizeReason("", { required: true }).ok).toBe(false);
        expect(rules.normalizeReason("ab", { required: true }).ok).toBe(false);
        expect(rules.normalizeReason("  Sin\tstock \n", { required: true })).toEqual({ ok: true, reason: "Sin stock" });
        expect(rules.normalizeReason(undefined)).toEqual({ ok: true, reason: null });
        expect(rules.normalizeReason(5).ok).toBe(false);
    });
    it("planRefund: solo online pagado, no excede lo restante, importes inválidos rechazados", () => {
        const order = { paymentMethod: "online", paymentStatus: "paid", total: 100.1, refundedAmount: 0 };
        expect(rules.planRefund({ order: { ...order, paymentMethod: "cash_on_delivery" }, reason: "Cortesía" }).code).toBe("not_online");
        expect(rules.planRefund({ order: { ...order, paymentStatus: "pending" }, reason: "Cortesía" }).code).toBe("not_paid");
        expect(rules.planRefund({ order, amount: 200, reason: "Cortesía" }).code).toBe("amount_exceeds");
        expect(rules.planRefund({ order, amount: -1, reason: "Cortesía" }).code).toBe("bad_amount");
        expect(rules.planRefund({ order, amount: "5" as any, reason: "Cortesía" }).code).toBe("bad_amount");
        expect(rules.planRefund({ order: { ...order, refundedAmount: 100.1 }, reason: "Cortesía" }).code).toBe("already_refunded");
        expect(rules.planRefund({ order, amount: 40, reason: "Cortesía" }).ok).toBe(true);
        expect(rules.planRefund({ order, reason: "Cortesía" }).ok).toBe(true);
    });
    it("validateCategoryInput", () => {
        expect(rules.validateCategoryInput({ name: "A" }).ok).toBe(false);
        expect(rules.validateCategoryInput({ name: " Pizzas ", active: true })).toMatchObject({ ok: true });
        expect(rules.validateCategoryInput({ active: "si" }, { partial: true }).ok).toBe(false);
        expect(rules.validateCategoryInput([]).ok).toBe(false);
    });
    it("validateUserStatusChange: no a uno mismo ni al último admin", () => {
        expect(rules.validateUserStatusChange({ actorId: "a", targetId: "a", active: false }).code).toBe("self_disable");
        expect(rules.validateUserStatusChange({ actorId: "a", targetId: "b", active: false, targetLabels: ["admin"], otherActiveAdmins: 0 }).code).toBe("last_admin");
        expect(rules.validateUserStatusChange({ actorId: "a", targetId: "b", active: false, targetLabels: ["driver"] }).ok).toBe(true);
        expect(rules.validateUserStatusChange({ actorId: "a", targetId: "b", active: "x" as any }).ok).toBe(false);
    });
    it("groupSales agrupa por semana (lunes) y mes", () => {
        const perDay = { "2026-11-02": 100, "2026-11-08": 50, "2026-11-09": 10, "2026-12-01": 5 };
        expect(rules.groupSales(perDay, "week")).toEqual({ "2026-11-02": 150, "2026-11-09": 10, "2026-11-30": 5 });
        expect(rules.groupSales(perDay, "month")).toEqual({ "2026-11": 160, "2026-12": 5 });
    });
});

describe("v11: vista del pool no filtra datos personales", () => {
    it("redondea la zona y omite nombre, teléfono y dirección", () => {
        const view = rules.toPoolView({ $id: "o1", status: "ready", $createdAt: "T", total: 90, deliveryLatitude: 19.43267, deliveryLongitude: -99.13321, customerName: "Ana", customerPhone: "555", deliveryAddress: "Calle 1" }, [{ quantity: 2 }, { quantity: 1 }], 3.456);
        expect(view).toMatchObject({ itemsCount: 3, areaLatitude: 19.43, areaLongitude: -99.13, distanceKm: 3.5 });
        expect(JSON.stringify(view)).not.toMatch(/Ana|555|Calle 1/);
    });
});
