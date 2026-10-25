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
