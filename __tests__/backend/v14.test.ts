// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");

describe("v14: horario de apertura", () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 10, 11, h, m);
    it("sin horario configurado siempre está abierto", () => {
        expect(rules.isOpenNow({ hours: "", now: at(3) }).open).toBe(true);
    });
    it("respeta la zona horaria del restaurante (CDMX = UTC-6)", () => {
        // 18:00 UTC = 12:00 en CDMX
        expect(rules.isOpenNow({ hours: "09:00-22:00", utcOffsetHours: -6, now: at(18) }).open).toBe(true);
        // 05:00 UTC = 23:00 del día anterior en CDMX -> cerrado
        expect(rules.isOpenNow({ hours: "09:00-22:00", utcOffsetHours: -6, now: at(5) })).toMatchObject({ open: false, reason: "outside_hours" });
    });
    it("soporta horarios que cruzan la medianoche y los límites (abre en el inicio, cierra en el fin)", () => {
        expect(rules.isOpenNow({ hours: "22:00-02:00", now: at(23, 30) }).open).toBe(true);
        expect(rules.isOpenNow({ hours: "22:00-02:00", now: at(1, 59) }).open).toBe(true);
        expect(rules.isOpenNow({ hours: "22:00-02:00", now: at(2, 0) }).open).toBe(false);
        expect(rules.isOpenNow({ hours: "09:00-22:00", now: at(9, 0) }).open).toBe(true);
        expect(rules.isOpenNow({ hours: "09:00-22:00", now: at(22, 0) }).open).toBe(false);
    });
    it("el cierre manual gana y un horario mal escrito no bloquea la tienda", () => {
        expect(rules.isOpenNow({ hours: "", forceClosed: true })).toMatchObject({ open: false, reason: "closed_manually" });
        expect(rules.isOpenNow({ hours: "mañana", now: at(3) })).toMatchObject({ open: true, reason: "bad_hours_config" });
    });
});

describe("v14: envío por distancia", () => {
    it("base + por km con tope; sin tarifa por km usa la fija", () => {
        expect(rules.computeDeliveryFee({ km: 3, base: 15, perKm: 5, max: 50 })).toBe(30);
        expect(rules.computeDeliveryFee({ km: 20, base: 15, perKm: 5, max: 50 })).toBe(50);
        expect(rules.computeDeliveryFee({ km: 0, base: 15, perKm: 5, max: 50 })).toBe(15);
        expect(rules.computeDeliveryFee({ km: 3, fallback: 7 })).toBe(7);
        expect(rules.computeDeliveryFee({ km: null, base: 15, perKm: 5, fallback: 7 })).toBe(7);
    });
});

describe("v14: cupones", () => {
    const coupons = rules.parseCoupons("BIENVENIDO:percent:10:0; ENVIO:freeship:0:100 ;MENOS20:amount:20:150;MALO:percent:500;X:otro:1");
    it("lee solo cupones válidos (ignora tipos raros y porcentajes > 100)", () => {
        expect(Object.keys(coupons).sort()).toEqual(["BIENVENIDO", "ENVIO", "MENOS20"]);
    });
    it("porcentaje sobre el subtotal, monto fijo y envío gratis", () => {
        expect(rules.applyCoupon({ code: "bienvenido", coupons, subtotal: 120, deliveryFee: 20 })).toMatchObject({ ok: true, code: "BIENVENIDO", discount: 12 });
        expect(rules.applyCoupon({ code: "MENOS20", coupons, subtotal: 200, deliveryFee: 20 }).discount).toBe(20);
        expect(rules.applyCoupon({ code: "ENVIO", coupons, subtotal: 150, deliveryFee: 25 }).discount).toBe(25);
    });
    it("rechaza inexistentes, mal formados y por debajo del mínimo; vacío = sin cupón", () => {
        expect(rules.applyCoupon({ code: "NOPE", coupons, subtotal: 100, deliveryFee: 10 })).toMatchObject({ ok: false, code: "coupon_invalid" });
        expect(rules.applyCoupon({ code: "no vale!", coupons, subtotal: 100, deliveryFee: 10 })).toMatchObject({ ok: false, code: "coupon_invalid" });
        expect(rules.applyCoupon({ code: "ENVIO", coupons, subtotal: 50, deliveryFee: 10 })).toMatchObject({ ok: false, code: "coupon_min" });
        expect(rules.applyCoupon({ code: "", coupons, subtotal: 50, deliveryFee: 10 })).toMatchObject({ ok: true, code: null, discount: 0 });
    });
    it("el descuento nunca supera lo que se paga", () => {
        const big = rules.parseCoupons("TODO:amount:999:0");
        expect(rules.applyCoupon({ code: "TODO", coupons: big, subtotal: 30, deliveryFee: 5 }).discount).toBe(35);
    });
});

describe("v14: propina y totales", () => {
    it("valida propina: ausente = 0, negativa/no numérica/sobre el máximo se rechaza", () => {
        expect(rules.validateTip(undefined)).toEqual({ ok: true, tip: 0 });
        expect(rules.validateTip(15.5).tip).toBe(15.5);
        for (const bad of [-1, "10", NaN, Infinity, 201]) expect(rules.validateTip(bad)).toMatchObject({ ok: false, code: "bad_tip" });
        expect(rules.validateTip(50, { max: 40 }).ok).toBe(false);
    });
    it("total = subtotal + envío - descuentos (con tope) + propina, en centavos exactos", () => {
        expect(rules.finalizeTotals({ subtotal: 100, deliveryFee: 15, baseDiscount: 0.5, couponDiscount: 10, tip: 10 })).toEqual({ subtotal: 100, deliveryFee: 15, discount: 10.5, tip: 10, total: 114.5 });
        expect(rules.finalizeTotals({ subtotal: 10, deliveryFee: 5, baseDiscount: 0.1, couponDiscount: 0.2, tip: 0 }).discount).toBe(0.3);
        expect(rules.finalizeTotals({ subtotal: 10, deliveryFee: 5, couponDiscount: 100, tip: 3 }).total).toBe(3);
    });
});

describe("v14: calificaciones", () => {
    it("exige 1-5 enteros; repartidor y comentario opcionales", () => {
        expect(rules.validateRating({ rating: 5 })).toMatchObject({ ok: true, rating: 5, driverRating: null, comment: "" });
        expect(rules.validateRating({ rating: 4, driverRating: 3, comment: "  Muy   rico " })).toMatchObject({ ok: true, driverRating: 3, comment: "Muy rico" });
        for (const bad of [{}, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: "5" }, { rating: 5, driverRating: 9 }, { rating: 5, comment: "x".repeat(301) }, null]) {
            expect(rules.validateRating(bad)).toMatchObject({ ok: false, code: "bad_rating" });
        }
    });
    it("resume promedio, distribución y comentarios recientes", () => {
        const s = rules.summarizeRatings([
            { $id: "a", rating: 5, driverRating: 4, ratingComment: "Rico", ratedAt: "2026-11-10T10:00:00Z" },
            { $id: "b", rating: 3, ratedAt: "2026-11-11T10:00:00Z", ratingComment: "Tardó" },
            { $id: "c" }, { $id: "d", rating: 9 }
        ]);
        expect(s).toMatchObject({ count: 2, average: 4, driverAverage: 4, distribution: { 3: 1, 5: 1 } });
        expect(s.recentComments[0].orderId).toBe("b");
        expect(rules.summarizeRatings([])).toMatchObject({ count: 0, average: null });
    });
    it("el tablero suma propinas y cupones y trae calificaciones", () => {
        const d = rules.buildDashboard([
            { $id: "1", status: "delivered", total: 120, tip: 10, couponCode: "X", rating: 5, $createdAt: "2026-11-11T10:00:00Z" },
            { $id: "2", status: "delivered", total: 80, $createdAt: "2026-11-11T11:00:00Z" }
        ]);
        expect(d).toMatchObject({ tips: 10, couponOrders: 1, ratings: { count: 1, average: 5 } });
    });
});

describe("v14: simulación y repartidores reales", () => {
    it("los repartidores demo se reconocen por el prefijo demo-driver-", () => {
        expect(rules.demoDriverFor("abc").id).toMatch(/^demo-driver-/);
    });
});
