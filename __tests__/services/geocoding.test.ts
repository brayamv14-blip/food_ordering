import { autocompleteAddress, geocodeAddress, geoFailureMessage, isGeoConfigured, reverseGeocode } from "@/lib/services/geocoding";

const KEY = "0123456789abcdef0123456789abcdef";
const ok = (features: any[]) => ({ ok: true, status: 200, json: async () => ({ features }) }) as any;
const place = { properties: { formatted: "Av. Reforma 123, Centro, CDMX", lat: 19.43, lon: -99.13 } };

describe("geocodificación (servicio)", () => {
    const saved = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;
    beforeEach(() => {
        process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = KEY;
    });
    afterAll(() => {
        process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = saved;
    });

    it("sin clave no consulta la red y lo indica", async () => {
        process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = "";
        const f = jest.fn();
        expect(isGeoConfigured()).toBe(false);
        expect(await autocompleteAddress("Reforma 123", f)).toEqual({ ok: false, reason: "not_configured" });
        expect(f).not.toHaveBeenCalled();
    });
    it("autocompleta limitado a México con la clave y en español", async () => {
        const f = jest.fn().mockResolvedValue(ok([place]));
        const r = await autocompleteAddress("Reforma 123", f);
        expect(r).toEqual({ ok: true, value: [{ line: "Av. Reforma 123, Centro, CDMX", latitude: 19.43, longitude: -99.13 }] });
        const url = new URL(f.mock.calls[0][0]);
        expect(url.pathname).toBe("/v1/geocode/autocomplete");
        expect(url.searchParams.get("filter")).toBe("countrycode:mx");
        expect(url.searchParams.get("lang")).toBe("es");
        expect(url.searchParams.get("apiKey")).toBe(KEY);
    });
    it("no consulta con textos demasiado cortos o largos", async () => {
        const f = jest.fn();
        expect((await autocompleteAddress("ab", f)).ok).toBe(false);
        expect((await geocodeAddress("x".repeat(250), f)).ok).toBe(false);
        expect(f).not.toHaveBeenCalled();
    });
    it("geocodifica y hace geocodificación inversa", async () => {
        const f = jest.fn().mockResolvedValue(ok([place]));
        expect(await geocodeAddress("Av. Reforma 123", f)).toMatchObject({ ok: true });
        const r = await reverseGeocode(19.43, -99.13, f);
        expect(r).toEqual({ ok: true, value: { line: "Av. Reforma 123, Centro, CDMX", latitude: 19.43, longitude: -99.13 } });
        const url = new URL(f.mock.calls[1][0]);
        expect(url.pathname).toBe("/v1/geocode/reverse");
        expect(url.searchParams.get("lat")).toBe("19.43");
        expect(url.searchParams.get("lon")).toBe("-99.13");
        expect((await reverseGeocode(NaN, 1, f)).ok).toBe(false);
    });
    it("distingue sin resultados, clave rechazada, cuota y red caída", async () => {
        expect(await geocodeAddress("Calle inexistente 999", jest.fn().mockResolvedValue(ok([])))).toEqual({ ok: false, reason: "no_results" });
        expect(await geocodeAddress("Calle 123 x", jest.fn().mockResolvedValue({ ok: false, status: 401 }))).toEqual({ ok: false, reason: "denied" });
        expect(await geocodeAddress("Calle 123 x", jest.fn().mockResolvedValue({ ok: false, status: 429 }))).toEqual({ ok: false, reason: "quota" });
        expect(await geocodeAddress("Calle 123 x", jest.fn().mockResolvedValue({ ok: false, status: 500 }))).toEqual({ ok: false, reason: "network" });
        expect(await geocodeAddress("Calle 123 x", jest.fn().mockRejectedValue(new Error("offline")))).toEqual({ ok: false, reason: "network" });
        for (const r of ["not_configured", "denied", "quota", "no_results", "network"]) expect(geoFailureMessage(r).length).toBeGreaterThan(10);
    });
});
