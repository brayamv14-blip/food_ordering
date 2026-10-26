import { useCartStore } from "@/store/cart.store";

const burger = { id: "m1", name: "Burger", price: 10, image_url: "x" };
const cheese = { id: "c1", name: "Queso", price: 1.5, type: "topping" };
const bacon = { id: "c2", name: "Tocino", price: 2, type: "topping" };

describe("carrito", () => {
    beforeEach(() => useCartStore.setState({ items: [] }));

    it("agrega, suma cantidades de la misma configuración y calcula total", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger, customizations: [cheese] });
        s.addItem({ ...burger, customizations: [cheese] });
        expect(useCartStore.getState().items).toHaveLength(1);
        expect(useCartStore.getState().getTotalItems()).toBe(2);
        expect(useCartStore.getState().getTotalPrice()).toBe(23);
    });

    it("trata distintas personalizaciones como líneas distintas", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger, customizations: [cheese] });
        s.addItem({ ...burger, customizations: [bacon] });
        s.addItem({ ...burger });
        expect(useCartStore.getState().items).toHaveLength(3);
    });

    it("el orden de las personalizaciones no genera duplicados ni doble cargo", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger, customizations: [cheese, bacon] });
        s.addItem({ ...burger, customizations: [bacon, cheese] });
        expect(useCartStore.getState().items).toHaveLength(1);
        expect(useCartStore.getState().getTotalPrice()).toBe(2 * (10 + 1.5 + 2));
    });

    it("sube, baja y elimina al llegar a cero", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger });
        s.increaseQty("m1", []);
        expect(useCartStore.getState().items[0].quantity).toBe(2);
        s.decreaseQty("m1", []);
        s.decreaseQty("m1", []);
        expect(useCartStore.getState().items).toHaveLength(0);
    });

    it("modifica personalizaciones conservando la cantidad y sin duplicar", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger, customizations: [cheese] });
        s.increaseQty("m1", [cheese]);
        s.updateItem("m1", [cheese], { ...burger, customizations: [bacon] });
        const items = useCartStore.getState().items;
        expect(items).toHaveLength(1);
        expect(items[0].quantity).toBe(2);
        expect(items[0].customizations).toEqual([bacon]);
        expect(useCartStore.getState().getTotalPrice()).toBe(24);
    });

    it("quita un artículo y vacía el carrito", () => {
        const s = useCartStore.getState();
        s.addItem({ ...burger });
        s.addItem({ ...burger, customizations: [cheese] });
        s.removeItem("m1", []);
        expect(useCartStore.getState().items).toHaveLength(1);
        s.clearCart();
        expect(useCartStore.getState().items).toHaveLength(0);
    });
});

describe("carrito: datos inválidos o manipulados", () => {
    beforeEach(() => useCartStore.setState({ items: [] }));
    const base = { id: "m1", name: "Burger", price: 10, image_url: "x" };

    it("ignora artículos con precio negativo, NaN, texto o sin id", () => {
        const s = useCartStore.getState();
        s.addItem({ ...base, price: -5 });
        s.addItem({ ...base, price: NaN });
        s.addItem({ ...base, price: "10" as any });
        s.addItem({ ...base, price: Infinity });
        s.addItem({ ...base, id: "" });
        s.addItem({ ...base, id: undefined as any });
        expect(useCartStore.getState().items).toHaveLength(0);
        expect(useCartStore.getState().getTotalPrice()).toBe(0);
    });

    it("ignora extras con precio negativo (no pueden abaratar el pedido)", () => {
        const s = useCartStore.getState();
        s.addItem({ ...base, customizations: [{ id: "c1", name: "Descuento", price: -9, type: "t" }] });
        expect(useCartStore.getState().items).toHaveLength(0);
    });

    it("limita la cantidad por línea a 50", () => {
        const s = useCartStore.getState();
        s.addItem({ ...base });
        for (let i = 0; i < 80; i++) useCartStore.getState().increaseQty("m1", []);
        expect(useCartStore.getState().items[0].quantity).toBe(50);
        for (let i = 0; i < 80; i++) useCartStore.getState().addItem({ ...base });
        expect(useCartStore.getState().items[0].quantity).toBe(50);
    });

    it("no permite actualizar un artículo con datos inválidos", () => {
        const s = useCartStore.getState();
        s.addItem({ ...base });
        s.updateItem("m1", [], { ...base, price: -1 });
        expect(useCartStore.getState().items[0].price).toBe(10);
    });

    it("el total nunca es negativo ni NaN con carrito válido", () => {
        const s = useCartStore.getState();
        s.addItem({ ...base });
        const total = useCartStore.getState().getTotalPrice();
        expect(Number.isFinite(total) && total >= 0).toBe(true);
    });
});
