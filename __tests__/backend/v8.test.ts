// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");
import { Query, fakeDb, hash } from "./helpers/fakeInventoryDb";

const setup = (stock = 5) => {
    const db = fakeDb();
    db.tables.menu.push({ $id: "m1", name: "Wrap", stock, lowStockThreshold: 2 });
    const inv = rules.makeInventory({ db, DB: "db", MENU: "menu", MOVES: "moves", Query, hash });
    const menuById = () => ({ m1: { ...db.tables.menu[0] } });
    return { db, inv, menuById, stock: () => db.tables.menu[0].stock };
};

describe("inventario (reglas v8)", () => {
    it("reserva descuenta una vez y es idempotente por pedido", async () => {
        const { inv, menuById, stock } = setup(5);
        const a = await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        expect(a.ok).toBe(true);
        expect(stock()).toBe(2);
        await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        expect(stock()).toBe(2);
    });

    it("sin existencias suficientes falla y no deja huellas", async () => {
        const { db, inv, menuById, stock } = setup(2);
        const r = await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        expect(r).toMatchObject({ ok: false, code: "insufficient_stock" });
        expect(stock()).toBe(2);
        expect(db.tables.moves).toHaveLength(0);
    });

    it("compras simultaneas: solo gana la que cabe y el stock nunca es negativo", async () => {
        const { inv, menuById, stock } = setup(2);
        const results = await Promise.all(["a", "b", "c"].map((o) => inv.reserve({ orderId: o, totals: { m1: 2 }, menuById: menuById() })));
        expect(results.filter((r: any) => r.ok)).toHaveLength(1);
        expect(stock()).toBe(0);
    });

    it("liberar devuelve el stock una sola vez (cancelación repetida)", async () => {
        const { inv, menuById, stock } = setup(5);
        await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        await inv.release("o1");
        await inv.release("o1");
        expect(stock()).toBe(5);
    });

    it("si devolver falla no queda constancia y el reintento sí devuelve", async () => {
        const { db, inv, menuById, stock } = setup(5);
        await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        db.failIncrement = true;
        await expect(inv.release("o1")).rejects.toThrow();
        expect(db.tables.moves.some((m: any) => m.type === "release")).toBe(false);
        db.failIncrement = false;
        await inv.release("o1");
        expect(stock()).toBe(5);
    });

    it("avisa de existencias bajas solo al cruzar el umbral", async () => {
        const { inv, menuById } = setup(5);
        const first = await inv.reserve({ orderId: "o1", totals: { m1: 3 }, menuById: menuById() });
        expect(first.low).toEqual([{ menuId: "m1", name: "Wrap", stock: 2 }]);
        const second = await inv.reserve({ orderId: "o2", totals: { m1: 1 }, menuById: { m1: { $id: "m1", name: "Wrap", stock: 2, lowStockThreshold: 2 } } });
        expect(second.low).toEqual([]);
    });

    it("sin tabla de movimientos el control queda desactivado", async () => {
        const db = fakeDb();
        const inv = rules.makeInventory({ db, DB: "db", MENU: "menu", MOVES: "", Query, hash });
        expect(inv.enabled).toBe(false);
        expect(await inv.reserve({ orderId: "o1", totals: { m1: 1 }, menuById: {} })).toMatchObject({ ok: true });
    });

    it("productos sin control de stock siempre alcanzan", () => {
        expect(rules.checkStock([{ menuId: "m1", quantity: 99 }], { m1: { name: "X" } }).ok).toBe(true);
        expect(rules.checkStock([{ menuId: "m1", quantity: 2 }, { menuId: "m1", quantity: 2 }], { m1: { name: "X", stock: 3 } })).toMatchObject({ ok: false, code: "insufficient_stock" });
    });
});

describe("validación de productos, stock y roles (admin)", () => {
    it("acepta un producto válido y descarta campos no permitidos", () => {
        const r = rules.validateProductInput({ name: " Taco  al pastor ", price: 25.5, image_url: "https://x.io/a.png", isAdmin: true, $permissions: ["any"] });
        expect(r.ok).toBe(true);
        expect(r.data).toEqual({ name: "Taco al pastor", price: 25.5, image_url: "https://x.io/a.png" });
    });

    it.each([
        [{ name: "A", price: 5 }],
        [{ name: "Taco", price: 0 }],
        [{ name: "Taco", price: -1 }],
        [{ name: "Taco", price: 12.345 }],
        [{ name: "Taco", price: 5, image_url: "javascript:alert(1)" }],
        [{ name: "Taco", price: 5, image_url: "http://inseguro.test/a.png" }],
        [{ name: "Taco", price: 5, stock: -1 }],
        [{ name: "Taco", price: 5, stock: 1.5 }],
        [{ name: "Taco", price: 5, categories: "../hack" }],
        [{ name: "Taco", price: 5, available: "si" }]
    ])("rechaza %j", (input) => {
        expect(rules.validateProductInput(input).ok).toBe(false);
    });

    it("la edición parcial solo valida lo enviado y stock vacío = sin control", () => {
        expect(rules.validateProductInput({ price: 30 }, { partial: true })).toMatchObject({ ok: true, data: { price: 30 } });
        expect(rules.validateProductInput({ stock: "" }, { partial: true }).data).toEqual({ stock: null });
    });

    it("ajustes de stock nunca dejan negativo", () => {
        expect(rules.planStockAdjust(3, { delta: -5 })).toMatchObject({ ok: false });
        expect(rules.planStockAdjust(3, { delta: -3 })).toMatchObject({ ok: true, next: 0, delta: -3 });
        expect(rules.planStockAdjust(3, { set: 10 })).toMatchObject({ ok: true, next: 10, delta: 7 });
        expect(rules.planStockAdjust(3, {})).toMatchObject({ ok: false });
    });

    it("roles: solo etiquetas conocidas y el admin no se quita su propio rol", () => {
        expect(rules.validateRoleChange({ actorId: "a", targetId: "b", labels: ["superuser"] }).ok).toBe(false);
        expect(rules.validateRoleChange({ actorId: "a", targetId: "a", labels: ["staff"], targetCurrent: ["admin"] })).toMatchObject({ ok: false, code: "self_demote" });
        expect(rules.validateRoleChange({ actorId: "a", targetId: "b", labels: ["driver"], targetCurrent: ["otra"] })).toMatchObject({ ok: true, labels: ["driver", "otra"] });
    });
});

describe("reportes y exportación", () => {
    const orders = [
        { $id: "o1", status: "delivered", total: 100, $createdAt: "2026-10-01T10:00:00Z", paymentStatus: "paid" },
        { $id: "o2", status: "delivered", total: 50.5, $createdAt: "2026-10-02T10:00:00Z", paymentStatus: "not_required" },
        { $id: "o3", status: "cancelled", total: 80, $createdAt: "2026-10-02T11:00:00Z", paymentStatus: "refunded" },
        { $id: "o4", status: "pending", total: 20, $createdAt: "2026-10-03T11:00:00Z", paymentStatus: "pending" }
    ];
    const items = { o1: [{ menuId: "m1", name: "Burger", quantity: 2, price: 40 }, { menuId: "m2", name: "Pizza", quantity: 1, price: 20 }], o2: [{ menuId: "m1", name: "Burger", quantity: 1, price: 40 }] };

    it("suma solo pedidos entregados y calcula cancelaciones, ticket y top", () => {
        const r = rules.aggregateReport(orders, items);
        expect(r).toMatchObject({ orders: 4, delivered: 2, cancelled: 1, sales: 150.5, averageTicket: 75.25, cancellationRate: 25, refunded: 80 });
        expect(r.topProducts[0]).toEqual({ menuId: "m1", name: "Burger", quantity: 3, sales: 120 });
        expect(r.salesByDay).toEqual([{ day: "2026-10-01", sales: 100 }, { day: "2026-10-02", sales: 50.5 }]);
    });

    it("sin pedidos devuelve ceros, no inventa datos", () => {
        expect(rules.aggregateReport([], {})).toMatchObject({ orders: 0, sales: 0, averageTicket: 0, cancellationRate: 0, topProducts: [] });
    });

    it("CSV escapa comillas y neutraliza fórmulas", () => {
        const csv = rules.toCsv([{ a: "=1+1", b: 'di "hola", ok' }], ["a", "b"]);
        expect(csv).toBe("a,b\n'=1+1,\"di \"\"hola\"\", ok\"");
    });
});

describe("ciclo del repartidor (reglas v8)", () => {
    it("picked_up es un estado propio y exige aceptar la asignación", () => {
        const t = (o: any) => rules.canActorTransition({ isOwner: false, hasDriver: true, ...o });
        expect(t({ actor: "driver", from: "ready", to: "picked_up" }).ok).toBe(true);
        expect(t({ actor: "driver", from: "picked_up", to: "on_the_way" }).ok).toBe(true);
        expect(t({ actor: "driver", from: "picked_up", to: "delivered" }).ok).toBe(false);
        expect(t({ actor: "staff", from: "ready", to: "picked_up", driverAccepted: false })).toMatchObject({ ok: false, code: "assignment_pending" });
        expect(t({ actor: "driver", from: "delivery_failed", to: "on_the_way" }).ok).toBe(true);
        expect(t({ actor: "driver", from: "on_the_way", to: "cancelled" }).ok).toBe(false);
    });

    it("asignación automática: disponible, con cupo y menos carga; empate por id", () => {
        const picked = rules.pickDriver([
            { id: "d3", available: false, active: 0 },
            { id: "d2", available: true, active: 1 },
            { id: "d1", available: true, active: 1 },
            { id: "d4", available: true, active: 3 }
        ]);
        expect(picked.id).toBe("d1");
        expect(rules.pickDriver([{ id: "d", available: true, active: 3 }])).toBeNull();
        expect(rules.pickDriver([])).toBeNull();
    });
});
