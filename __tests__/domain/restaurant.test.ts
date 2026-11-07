import { buildNavigationUrl, friendlyServerError, getRestaurant } from "@/lib/domain/restaurant";

describe("restaurante y navegación (dominio)", () => {
    it("lee el restaurante solo con coordenadas válidas (nunca inventa uno)", () => {
        expect(getRestaurant({})).toBeNull();
        expect(getRestaurant({ EXPO_PUBLIC_RESTAURANT_LATITUDE: "19.43", EXPO_PUBLIC_RESTAURANT_LONGITUDE: "-99.13" })).toEqual({ name: "Restaurante", location: { latitude: 19.43, longitude: -99.13 } });
        expect(getRestaurant({ EXPO_PUBLIC_RESTAURANT_LATITUDE: "19.43", EXPO_PUBLIC_RESTAURANT_LONGITUDE: "-99.13", EXPO_PUBLIC_RESTAURANT_NAME: " Mi Local " })?.name).toBe("Mi Local");
        for (const bad of [{ EXPO_PUBLIC_RESTAURANT_LATITUDE: "0", EXPO_PUBLIC_RESTAURANT_LONGITUDE: "0" }, { EXPO_PUBLIC_RESTAURANT_LATITUDE: "abc", EXPO_PUBLIC_RESTAURANT_LONGITUDE: "1" }, { EXPO_PUBLIC_RESTAURANT_LATITUDE: "99", EXPO_PUBLIC_RESTAURANT_LONGITUDE: "1" }]) expect(getRestaurant(bad)).toBeNull();
    });
    it("arma el enlace de navegación solo con coordenadas reales", () => {
        expect(buildNavigationUrl({ latitude: 19.43, longitude: -99.13 })).toBe("https://www.google.com/maps/dir/?api=1&destination=19.43,-99.13&travelmode=driving");
        for (const bad of [null, undefined, {}, { latitude: 0, longitude: 0 }, { latitude: "x", longitude: 1 }, 5]) expect(buildNavigationUrl(bad)).toBeNull();
    });
    it("muestra el mensaje del servidor solo para errores de validación conocidos", () => {
        expect(friendlyServerError({ code: "out_of_coverage", message: "Fuera de zona" })).toBe("Fuera de zona");
        expect(friendlyServerError({ code: "coverage_unverified", message: "Elige en el mapa" })).toBe("Elige en el mapa");
        for (const bad of [{ code: "boom", message: "interno" }, { code: 500, message: "x" }, null, undefined, "texto"]) expect(friendlyServerError(bad)).toBeNull();
    });
});
