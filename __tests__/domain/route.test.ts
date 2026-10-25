import { decodePolyline, shouldRefetchRoute } from "@/lib/domain/polyline";
import { fetchRoute, isRouteConfigured } from "@/lib/services/directions";

describe("polyline de Google", () => {
    it("decodifica el ejemplo oficial de la documentación", () => {
        const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
        expect(pts).toHaveLength(3);
        expect(pts[0]).toEqual({ latitude: 38.5, longitude: -120.2 });
        expect(pts[1]).toEqual({ latitude: 40.7, longitude: -120.95 });
        expect(pts[2]).toEqual({ latitude: 43.252, longitude: -126.453 });
    });
    it("devuelve vacío ante texto inválido o truncado", () => {
        expect(decodePolyline("")).toEqual([]);
        expect(decodePolyline(undefined)).toEqual([]);
        expect(decodePolyline(42)).toEqual([]);
        expect(decodePolyline("_p~iF")).toEqual([]); // falta la longitud
        expect(decodePolyline("   ")).toEqual([]);
    });
});

describe("límite de consultas de ruta", () => {
    const A = { latitude: 19.5, longitude: -99.2 };
    const NEAR = { latitude: 19.5003, longitude: -99.2 }; // ~33 m
    const FAR = { latitude: 19.502, longitude: -99.2 }; // ~222 m
    it("consulta la primera vez y no repite sin movimiento", () => {
        expect(shouldRefetchRoute(null, A, 0)).toBe(true);
        expect(shouldRefetchRoute({ origin: A, at: 0 }, NEAR, 30000)).toBe(false);
    });
    it("repite si se movió mucho o pasó un minuto, pero nunca antes de 10 s", () => {
        expect(shouldRefetchRoute({ origin: A, at: 0 }, FAR, 20000)).toBe(true);
        expect(shouldRefetchRoute({ origin: A, at: 0 }, FAR, 5000)).toBe(false);
        expect(shouldRefetchRoute({ origin: A, at: 0 }, NEAR, 61000)).toBe(true);
    });
});

describe("servicio de rutas", () => {
    const A = { latitude: 19.5, longitude: -99.2 };
    const B = { latitude: 19.6, longitude: -99.1 };
    const OLD = process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY;
    afterEach(() => { process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY = OLD; });

    it("sin clave no inventa ruta y no hace ninguna petición", async () => {
        delete process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY;
        const f = jest.fn();
        expect(isRouteConfigured()).toBe(false);
        expect(await fetchRoute(A, B, f as any)).toEqual({ ok: false, reason: "not_configured" });
        expect(f).not.toHaveBeenCalled();
    });

    it("con clave interpreta la respuesta de Google", async () => {
        process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY = "CLAVE_DE_PRUEBA";
        const f = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
            status: "OK",
            routes: [{ overview_polyline: { points: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" }, legs: [{ distance: { value: 1500 }, duration: { value: 360 } }] }]
        }) });
        const r = await fetchRoute(A, B, f as any);
        expect(r).toMatchObject({ ok: true, distanceMeters: 1500, durationSeconds: 360 });
        expect((r as any).points).toHaveLength(3);
        expect(f.mock.calls[0][0]).toContain("origin=19.5,-99.2");
        expect(f.mock.calls[0][0]).toContain("key=CLAVE_DE_PRUEBA");
    });

    it("distingue clave rechazada, sin ruta y fallo de red", async () => {
        process.env.EXPO_PUBLIC_GOOGLE_DIRECTIONS_API_KEY = "K";
        const mk = (data: any, ok = true) => jest.fn().mockResolvedValue({ ok, json: async () => data });
        expect(await fetchRoute(A, B, mk({ status: "REQUEST_DENIED" }) as any)).toEqual({ ok: false, reason: "denied" });
        expect(await fetchRoute(A, B, mk({ status: "ZERO_RESULTS" }) as any)).toEqual({ ok: false, reason: "no_route" });
        expect(await fetchRoute(A, B, mk({ status: "OK", routes: [{ overview_polyline: { points: "x" } }] }) as any)).toEqual({ ok: false, reason: "no_route" });
        expect(await fetchRoute(A, B, mk({}, false) as any)).toEqual({ ok: false, reason: "network" });
        expect(await fetchRoute(A, B, jest.fn().mockRejectedValue(new Error("offline")) as any)).toEqual({ ok: false, reason: "network" });
    });
});
