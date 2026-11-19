import { estimateEtaMinutes, formatEta } from "@/lib/domain/eta";
import { buildReceipt, receiptText } from "@/lib/domain/receipt";
import { MAX_FAVORITES, parseFavorites, toggleFavorite } from "@/lib/domain/favorites";
import { mapOrderRow } from "@/lib/domain/order";

describe("ETA", () => {
    it("suma preparación y viaje según el estado", () => {
        expect(estimateEtaMinutes({ status: "pending", prepMinutes: 20, routeSeconds: 600 })).toBe(30);
        expect(estimateEtaMinutes({ status: "confirmed", prepMinutes: 20, routeSeconds: 600 })).toBe(30);
        expect(estimateEtaMinutes({ status: "preparing", prepMinutes: 20, routeSeconds: 600 })).toBe(20);
        expect(estimateEtaMinutes({ status: "ready", prepMinutes: 20, routeSeconds: 600 })).toBe(10);
        expect(estimateEtaMinutes({ status: "on_the_way", routeSeconds: 90 })).toBe(2);
    });
    it("usa valores por omisión sin datos y no estima pedidos terminados", () => {
        expect(estimateEtaMinutes({ status: "pending" })).toBe(27);
        expect(estimateEtaMinutes({ status: "on_the_way", routeSeconds: 10 })).toBe(1);
        for (const s of ["delivered", "cancelled", "delivery_failed", null] as const) expect(estimateEtaMinutes({ status: s })).toBeNull();
    });
    it("da texto legible", () => {
        expect(formatEta(12)).toBe("Llega en ~12 min");
        expect(formatEta(1)).toBe("Llega en ~1 min");
        expect(formatEta(null)).toBeNull();
    });
});

describe("recibo", () => {
    const base = { subtotal: 100, deliveryFee: 15, discount: 10.5, tip: 10, total: 114.5, couponCode: "BIENVENIDO", refundedAmount: 0 };
    it("incluye descuento con cupón, propina y total; omite lo que vale 0", () => {
        const lines = buildReceipt(base);
        expect(lines.map((l) => l.label)).toEqual(["Subtotal", "Envío", "Descuento (BIENVENIDO)", "Propina al repartidor", "Total"]);
        expect(lines.find((l) => l.kind === "discount")?.amount).toBe(-10.5);
        expect(buildReceipt({ ...base, discount: 0, tip: 0, couponCode: null }).map((l) => l.label)).toEqual(["Subtotal", "Envío", "Total"]);
        expect(buildReceipt({ ...base, subtotal: null }).some((l) => l.label === "Subtotal")).toBe(false);
        expect(buildReceipt({ ...base, refundedAmount: 114.5 }).at(-1)).toMatchObject({ label: "Reembolsado", amount: -114.5 });
    });
    it("genera texto para compartir", () => {
        const order: any = { ...base, id: "abcdef123456", items: [{ quantity: 2, name: "Burger", lineTotal: 100 }] };
        const txt = receiptText(order, (n) => `$${n.toFixed(2)}`);
        expect(txt).toContain("Pedido #123456");
        expect(txt).toContain("2 x Burger  $100.00");
        expect(txt).toContain("Descuento (BIENVENIDO): -$10.50");
        expect(txt).toContain("Total: $114.50");
    });
});

describe("favoritos", () => {
    it("lee ids válidos (lista o JSON) y descarta basura y duplicados", () => {
        expect(parseFavorites({ favorites: JSON.stringify(["a1", "a1", "b2", 5, "mal id!"]) })).toEqual(["a1", "b2"]);
        expect(parseFavorites({ favorites: ["x"] })).toEqual(["x"]);
        expect(parseFavorites({ favorites: "no json" })).toEqual([]);
        expect(parseFavorites(null)).toEqual([]);
        expect(parseFavorites({})).toEqual([]);
    });
    it("agrega al inicio, quita y respeta el máximo", () => {
        expect(toggleFavorite(["a"], "b")).toEqual(["b", "a"]);
        expect(toggleFavorite(["b", "a"], "b")).toEqual(["a"]);
        const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `id${i}`);
        const next = toggleFavorite(full, "nuevo");
        expect(next).toHaveLength(MAX_FAVORITES);
        expect(next[0]).toBe("nuevo");
    });
});

describe("pedido: campos v14", () => {
    it("lee propina, cupón y calificación; tolera filas viejas sin esas columnas", () => {
        const o = mapOrderRow({ $id: "o1", status: "delivered", total: 50, tip: 5, couponCode: "X", rating: 4, driverRating: 5, ratingComment: "Bien", driverUserId: "demo-driver-1" });
        expect(o).toMatchObject({ tip: 5, couponCode: "X", rating: 4, driverRating: 5, ratingComment: "Bien", driverUserId: "demo-driver-1" });
        expect(mapOrderRow({ $id: "o2", status: "pending" })).toMatchObject({ tip: 0, couponCode: null, rating: null, driverRating: null, ratingComment: null, driverUserId: null });
    });
});
