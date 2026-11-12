// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../../appwrite-functions/shared/rules.js");

describe("modo demostración (simulación)", () => {
    it("sigue la cadena pending -> confirmed -> preparing -> ready -> picked_up -> on_the_way -> delivered", () => {
        const chain = ["pending", "confirmed", "preparing", "ready", "picked_up", "on_the_way"];
        const seq = chain.map((s) => rules.demoNextStep(s, 90).to);
        expect(seq).toEqual(["confirmed", "preparing", "ready", "picked_up", "on_the_way", "delivered"]);
        expect(rules.demoNextStep("pending").delay).toBe(0);
        expect(rules.demoNextStep("on_the_way", 120).delay).toBe(120);
        expect(rules.demoNextStep("delivered")).toBeNull();
    });
    it("el repartidor ficticio es estable por pedido y se identifica como demo", () => {
        const a = rules.demoDriverFor("order123");
        expect(rules.demoDriverFor("order123")).toEqual(a);
        expect(a.id).toMatch(/^demo-driver-\d$/);
        expect(a.name).toMatch(/demo/);
    });
    it("la posición recorre del restaurante al destino y es null sin restaurante", () => {
        const restaurant = { latitude: 19.5, longitude: -99.2 };
        const destination = { latitude: 19.6, longitude: -99.1 };
        expect(rules.demoPosition({ status: "on_the_way", progress: 0, restaurant, destination })).toEqual(restaurant);
        expect(rules.demoPosition({ status: "on_the_way", progress: 1, restaurant, destination })).toEqual(destination);
        const mid = rules.demoPosition({ status: "on_the_way", progress: 0.5, restaurant, destination });
        expect(mid.latitude).toBeCloseTo(19.55);
        expect(rules.demoPosition({ status: "on_the_way", progress: 0.5, restaurant: null, destination })).toBeNull();
        expect(rules.demoPosition({ status: "pending", progress: 0, restaurant, destination })).toBeNull();
    });
});
