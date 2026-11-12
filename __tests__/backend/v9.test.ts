// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");
import { Query, fakeDb, hash } from "./helpers/fakeInventoryDb";

const setup = (stocks: Record<string, number> = { m1: 5 }) => {
    const db = fakeDb();
    for (const [id, stock] of Object.entries(stocks)) db.tables.menu.push({ $id: id, name: `P-${id}`, stock, lowStockThreshold: 1 });
    const inv = rules.makeInventory({ db, DB: "db", MENU: "menu", MOVES: "moves", Query, hash });
    const menuById = () => Object.fromEntries(db.tables.menu.map((m: any) => [m.$id, { ...m }]));
    const stock = (id = "m1") => db.tables.menu.find((m: any) => m.$id === id).stock;
    return { db, inv, menuById, stock };
};

describe("v9: reserva de inventario sin depender de `min`", () => {
    it.each([[true], [false]])("última unidad entre 3 compradores simultáneos (columna con mínimo 0 = %s)", async (min0) => {
        const { db, inv, menuById, stock } = setup({ m1: 1 });
        db.columnMin0 = min0;
        const results = await Promise.all(["a", "b", "c"].map((o) => inv.reserve({ orderId: o, totals: { m1: 1 }, menuById: menuById() })));
        expect(results.filter((r: any) => r.ok)).toHaveLength(1);
        expect(stock()).toBe(0); // nunca negativo: la sobreventa se compensa al instante
    });

    it("stock negativo en la base = agotado, nunca 'sin control'", () => {
        expect(rules.stockOf({ stock: -3 })).toBe(0);
        expect(rules.stockOf({ stock: 4 })).toBe(4);
        expect(rules.stockOf({})).toBeNull();
        expect(rules.stockOf({ stock: null })).toBeNull();
        expect(rules.stockOf({ stock: 2.5 })).toBeNull();
        expect(rules.checkStock([{ menuId: "m1", quantity: 1 }], { m1: { name: "X", stock: -3 } })).toMatchObject({ ok: false, code: "insufficient_stock" });
    });

    it("fallo a mitad de la reserva: se devuelve lo ya descontado y queda historial", async () => {
        const { db, inv, menuById, stock } = setup({ m1: 5, m2: 5 });
        db.failDecrementFor = "m2";
        await expect(inv.reserve({ orderId: "o1", totals: { m1: 2, m2: 1 }, menuById: menuById() })).rejects.toThrow();
        expect(stock("m1")).toBe(5);
        expect(stock("m2")).toBe(5);
        expect(db.tables.moves.map((m: any) => m.type)).toEqual(["reserve", "release"]);
        expect(db.tables.moves.reduce((s: number, m: any) => s + m.delta, 0)).toBe(0); // el historial cuadra
    });

    it("si la devolución del rollback también falla, queda una reserva SIN devolución que la reconciliación puede reparar", async () => {
        const { db, inv, menuById, stock } = setup({ m1: 5, m2: 5 });
        db.failDecrementFor = "m2";
        db.failIncrement = true;
        await expect(inv.reserve({ orderId: "o1", totals: { m1: 2, m2: 1 }, menuById: menuById() })).rejects.toThrow();
        expect(stock("m1")).toBe(3); // retenido, pero con huella
        expect(db.tables.moves.filter((m: any) => m.type === "reserve")).toHaveLength(1);
        expect(db.tables.moves.filter((m: any) => m.type === "release")).toHaveLength(0);
        db.failIncrement = false;
        db.failDecrementFor = null;
        await inv.release("o1", "reconcile_orphan"); // lo que hace admin-api: reconcileInventory
        expect(stock("m1")).toBe(5);
        await inv.release("o1", "reconcile_orphan"); // repetir no devuelve dos veces
        expect(stock("m1")).toBe(5);
    });

    it("el mismo pedido reservado dos veces a la vez descuenta una sola vez", async () => {
        const { inv, menuById, stock } = setup({ m1: 5 });
        await Promise.all([
            inv.reserve({ orderId: "o1", totals: { m1: 2 }, menuById: menuById() }),
            inv.reserve({ orderId: "o1", totals: { m1: 2 }, menuById: menuById() })
        ]);
        expect(stock()).toBe(3);
    });

    it("alerta de existencias bajas según el valor atómico resultante", async () => {
        const { inv, menuById } = setup({ m1: 3 }); // umbral 1
        const a = await inv.reserve({ orderId: "o1", totals: { m1: 1 }, menuById: menuById() });
        expect(a.low).toEqual([]);
        const b = await inv.reserve({ orderId: "o2", totals: { m1: 1 }, menuById: menuById() });
        expect(b.low).toEqual([{ menuId: "m1", name: "P-m1", stock: 1 }]);
    });
});

describe("v9: estados y pagos sin callejones", () => {
    const t = (o: any) => rules.canActorTransition({ isOwner: false, hasDriver: true, ...o });

    it("desde 'recogido' se puede reportar fallo (repartidor y personal)", () => {
        expect(t({ actor: "driver", from: "picked_up", to: "delivery_failed" }).ok).toBe(true);
        expect(t({ actor: "staff", from: "picked_up", to: "delivery_failed" }).ok).toBe(true);
        expect(t({ actor: "customer", isOwner: true, from: "picked_up", to: "delivery_failed" }).ok).toBe(false);
    });

    it("todo estado no terminal tiene al menos una salida", () => {
        for (const [from, outs] of Object.entries(rules.TRANSITIONS as Record<string, string[]>)) {
            if (from === "delivered" || from === "cancelled") expect(outs).toHaveLength(0);
            else expect(outs.length).toBeGreaterThan(0);
        }
        // y todo estado no terminal puede llegar a uno terminal siguiendo las transiciones
        const reach = (s: string, seen = new Set<string>()): boolean => {
            if (s === "delivered" || s === "cancelled") return true;
            if (seen.has(s)) return false;
            seen.add(s);
            return (rules.TRANSITIONS[s] as string[]).some((n) => reach(n, seen));
        };
        for (const s of Object.keys(rules.TRANSITIONS)) expect(reach(s)).toBe(true);
    });

    it("el cliente nunca puede pasar a estados reservados al personal o al repartidor", () => {
        for (const to of ["confirmed", "preparing", "ready", "picked_up", "on_the_way", "delivered", "delivery_failed"]) {
            for (const from of Object.keys(rules.TRANSITIONS)) {
                expect(t({ actor: "customer", isOwner: true, from, to }).ok).toBe(false);
            }
        }
    });

    it("un repartidor que no aceptó no puede recoger ni salir", () => {
        for (const to of ["picked_up", "on_the_way"]) {
            expect(t({ actor: "driver", from: "ready", to, driverAccepted: false })).toMatchObject({ ok: false, code: "assignment_pending" });
        }
    });

    it("pagos: el reembolso adelantado deja el pago reembolsado y el pagado tardío no lo revierte", () => {
        expect(rules.movePaymentStatus("pending", "refunded")).toMatchObject({ ok: true, changed: true });
        expect(rules.movePaymentStatus("refunded", "paid").ok).toBe(false);
        expect(rules.movePaymentStatus("cancelled", "refunded")).toMatchObject({ ok: true, changed: true });
        expect(rules.movePaymentStatus("paid", "pending").ok).toBe(false);
    });
});
