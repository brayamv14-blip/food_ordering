import { PricingError, computeOrderTotals, extrasTotal, lineTotal, unitPrice, formatMoney } from "@/lib/domain/pricing";

describe("cálculo de importes", () => {
    it("suma extras sin errores de punto flotante", () => {
        expect(extrasTotal([{ price: 0.1 }, { price: 0.2 }])).toBe(0.3);
        expect(unitPrice({ price: 10.1, quantity: 1, customizations: [{ price: 0.2 }] })).toBe(10.3);
    });

    it("convierte artículos y extras a total de línea", () => {
        expect(lineTotal({ price: 8.5, quantity: 3, customizations: [{ price: 1.25 }, { price: 0.75 }] })).toBe(31.5);
    });

    it("calcula subtotal, envío, descuento y total", () => {
        const t = computeOrderTotals([
            { price: 10, quantity: 2 },
            { price: 5.5, quantity: 1, customizations: [{ price: 1 }] }
        ]);
        expect(t).toEqual({ subtotal: 26.5, deliveryFee: 5, discount: 0.5, total: 31 });
    });

    it("el descuento nunca deja un total negativo", () => {
        const t = computeOrderTotals([{ price: 1, quantity: 1 }], { deliveryFee: 0, discount: 50 });
        expect(t.total).toBe(0);
        expect(t.discount).toBe(1);
    });

    it("carrito vacío devuelve ceros", () => {
        expect(computeOrderTotals([])).toEqual({ subtotal: 0, deliveryFee: 0, discount: 0, total: 0 });
    });

    it("rechaza datos incompletos o inválidos", () => {
        expect(() => lineTotal({ price: 5, quantity: 0 })).toThrow(PricingError);
        expect(() => lineTotal({ price: 5, quantity: 1.5 })).toThrow(PricingError);
        expect(() => unitPrice({ price: NaN, quantity: 1 })).toThrow(PricingError);
        expect(() => unitPrice({ price: -1, quantity: 1 })).toThrow(PricingError);
        expect(() => extrasTotal([{ price: undefined as any }])).toThrow(PricingError);
    });

    it("formatea importes y tolera valores no numéricos", () => {
        expect(formatMoney(3)).toBe("$3.00");
        expect(formatMoney("abc")).toBe("$0.00");
        expect(formatMoney(undefined)).toBe("$0.00");
    });
});
