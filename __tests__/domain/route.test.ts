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
    const OLD = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;

    afterEach(() => {
        if (OLD === undefined) {
            delete process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;
        } else {
            process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = OLD;
        }
    });

    it("sin clave no hace ninguna petición", async () => {
        delete process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;
        const f = jest.fn();

        expect(isRouteConfigured()).toBe(false);
        expect(await fetchRoute(A, B, f as any)).toEqual({
            ok: false,
            reason: "not_configured",
        });
        expect(f).not.toHaveBeenCalled();
    });

    it("con clave interpreta una ruta de Geoapify", async () => {
        process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = "CLAVE_DE_PRUEBA";

        const f = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                features: [{
                    properties: {
                        distance: 1500,
                        time: 360,
                    },
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [-99.2, 19.5],
                            [-99.15, 19.55],
                            [-99.1, 19.6],
                        ],
                    },
                }],
            }),
        });

        const r = await fetchRoute(A, B, f as any);

        expect(r).toMatchObject({
            ok: true,
            distanceMeters: 1500,
            durationSeconds: 360,
        });

        if (r.ok) {
            expect(r.points).toHaveLength(3);
            expect(r.points[0]).toEqual({
                latitude: 19.5,
                longitude: -99.2,
            });
        }

        const url = new URL(f.mock.calls[0][0]);
        expect(url.origin).toBe("https://api.geoapify.com");
        expect(url.pathname).toBe("/v1/routing");
        expect(url.searchParams.get("waypoints"))
            .toBe("19.5,-99.2|19.6,-99.1");
        expect(url.searchParams.get("mode")).toBe("drive");
        expect(url.searchParams.get("apiKey")).toBe("CLAVE_DE_PRUEBA");
    });

    it("distingue clave rechazada, límite de consultas, ruta inexistente y fallos de red", async () => {
        process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY = "K";

        const mk = (data: any, status = 200) =>
            jest.fn().mockResolvedValue({
                ok: status >= 200 && status < 300,
                status,
                json: async () => data,
            });

        expect(await fetchRoute(A, B, mk({}, 401) as any))
            .toEqual({ ok: false, reason: "denied" });

        expect(await fetchRoute(A, B, mk({}, 403) as any))
            .toEqual({ ok: false, reason: "denied" });

        expect(await fetchRoute(A, B, mk({}, 429) as any))
            .toEqual({ ok: false, reason: "quota" });

        expect(await fetchRoute(A, B, mk({ features: [] }) as any))
            .toEqual({ ok: false, reason: "no_route" });

        expect(await fetchRoute(A, B, mk({
            features: [{
                properties: {},
                geometry: {
                    type: "LineString",
                    coordinates: [[-99.2, 19.5]],
                },
            }],
        }) as any)).toEqual({ ok: false, reason: "no_route" });

        expect(await fetchRoute(A, B, mk({}, 500) as any))
            .toEqual({ ok: false, reason: "network" });

        expect(await fetchRoute(
            A,
            B,
            jest.fn().mockRejectedValue(new Error("offline")) as any
        )).toEqual({ ok: false, reason: "network" });
    });
});
