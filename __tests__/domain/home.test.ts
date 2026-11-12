import { categoryIcon, filterProducts, firstName, greetingFor, pickNewest } from "@/lib/domain/home";

describe("pantalla principal: utilidades", () => {
    it("saludo segun la hora", () => {
        expect(greetingFor(8)).toBe("Buenos días");
        expect(greetingFor(15)).toBe("Buenas tardes");
        expect(greetingFor(23)).toBe("Buenas noches");
        expect(greetingFor(3)).toBe("Buenas noches");
    });
    it("primer nombre tolera vacios y espacios", () => {
        expect(firstName("  Brayan Montoya ")).toBe("Brayan");
        expect(firstName("")).toBe("");
        expect(firstName(undefined)).toBe("");
    });
    it("icono por categoria con respaldo", () => {
        expect(categoryIcon("Pizzas")).toBe("pizza-outline");
        expect(categoryIcon("Hamburguesas")).toBe("fast-food-outline");
        expect(categoryIcon("Otra cosa")).toBe("grid-outline");
    });
    it("novedades: disponibles primero y mas recientes", () => {
        const items = [
            { id: "a", available: false, $createdAt: "2026-11-09T00:00:00Z" },
            { id: "b", available: true, $createdAt: "2026-11-01T00:00:00Z" },
            { id: "c", available: true, $createdAt: "2026-11-05T00:00:00Z" }
        ];
        expect(pickNewest(items, 2).map((i) => i.id)).toEqual(["c", "b"]);
        expect(pickNewest(items, 0)).toEqual([]);
    });
    it("filtra sin distinguir acentos ni mayusculas", () => {
        const items = [{ name: "Café helado", description: "" }, { name: "Pizza", description: "queso" }];
        expect(filterProducts(items, "CAFE").length).toBe(1);
        expect(filterProducts(items, "").length).toBe(2);
    });
});

import { landingRouteFor } from "@/lib/domain/home";
describe("aterrizaje por rol", () => {
    it("admin > personal > repartidor > cliente", () => {
        expect(landingRouteFor({ admin: true, staff: true, driver: true })).toBe("/admin/dashboard");
        expect(landingRouteFor({ admin: false, staff: true, driver: false })).toBe("/admin");
        expect(landingRouteFor({ admin: false, staff: false, driver: true })).toBe("/driver");
        expect(landingRouteFor({ admin: false, staff: false, driver: false })).toBeNull();
    });
});
