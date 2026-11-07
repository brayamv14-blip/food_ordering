import { DEFAULT_MAP_CENTER, MAP_ATTRIBUTION, buildMapHtml, isValidApiKey, parseGeoapifyPlaces, parseMapMessage, safeJson } from "@/lib/domain/geo";

const KEY = "0123456789abcdef0123456789abcdef";

describe("geocodificación (dominio)", () => {
    const feature = (formatted: any, lat: any, lon: any) => ({ properties: { formatted, lat, lon } });

    it("convierte la respuesta de Geoapify en lugares válidos y descarta lo inválido", () => {
        const places = parseGeoapifyPlaces({
            features: [
                feature("  Av. Reforma 123,   Centro, CDMX ", 19.43, -99.13),
                feature("", 19.4, -99.1),
                feature("Sin coordenadas", null, null),
                feature("Océano (0,0)", 0, 0),
                feature("Fuera de rango", 95, -99),
                feature("x".repeat(201), 19.4, -99.1),
                null
            ]
        });
        expect(places).toEqual([{ line: "Av. Reforma 123, Centro, CDMX", latitude: 19.43, longitude: -99.13 }]);
    });
    it("respeta el límite y tolera respuestas raras", () => {
        const many = { features: Array.from({ length: 9 }, (_, i) => feature(`Calle ${i} número 10`, 19 + i / 100, -99)) };
        expect(parseGeoapifyPlaces(many, 3)).toHaveLength(3);
        for (const bad of [null, undefined, {}, { features: "x" }, 5, "texto"]) expect(parseGeoapifyPlaces(bad)).toEqual([]);
    });
});

describe("mapa Leaflet (dominio)", () => {
    it("valida el formato de la clave pública", () => {
        expect(isValidApiKey(KEY)).toBe(true);
        for (const bad of ["", "corta", "con espacios y simbolos!!", "a".repeat(65), null, undefined, 5]) expect(isValidApiKey(bad)).toBe(false);
    });
    it("genera un HTML con Leaflet, teselas de Geoapify y la atribución de OpenStreetMap", () => {
        const html = buildMapHtml({ apiKey: KEY, center: DEFAULT_MAP_CENTER });
        expect(html).toContain("leaflet@1.9.4");
        expect(html).toContain(`maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${KEY}`);
        expect(html).toContain(MAP_ATTRIBUTION);
        expect(html).toContain("OpenStreetMap");
        expect(html).not.toContain("map.on('click'");
    });
    it("solo permite elegir un punto cuando el mapa es seleccionable", () => {
        expect(buildMapHtml({ apiKey: KEY, center: DEFAULT_MAP_CENTER, pickable: true })).toContain("map.on('click'");
    });
    it("rechaza una clave inválida en vez de armar un mapa roto", () => {
        expect(() => buildMapHtml({ apiKey: "mala", center: DEFAULT_MAP_CENTER })).toThrow();
    });
    it("los datos incrustados no pueden cerrar el <script> (inyección)", () => {
        const html = buildMapHtml({
            apiKey: KEY,
            center: DEFAULT_MAP_CENTER,
            data: { markers: [{ id: "a", kind: "destination", position: { latitude: 19.4, longitude: -99.1 }, label: "</script><img src=x onerror=alert(1)>" }], route: [] }
        });
        expect(html).not.toContain("</script><img");
        expect(html).toContain("\\u003c/script\\u003e");
        expect(safeJson({ a: "<&>" })).toBe('{"a":"\\u003c\\u0026\\u003e"}');
    });
    it("no dibuja nada que no reciba: sin marcadores ni ruta por omisión", () => {
        const html = buildMapHtml({ apiKey: KEY, center: DEFAULT_MAP_CENTER });
        expect(html).toContain('window.setMapData({"markers":[],"route":[]}, true)');
    });
});

describe("mensajes del WebView (no confiables)", () => {
    it("acepta ready, pick válido y error", () => {
        expect(parseMapMessage('{"type":"ready"}')).toEqual({ type: "ready" });
        expect(parseMapMessage('{"type":"pick","latitude":19.43,"longitude":-99.13}')).toEqual({ type: "pick", latitude: 19.43, longitude: -99.13 });
        expect(parseMapMessage('{"type":"error","message":"fallo"}')).toEqual({ type: "error", message: "fallo" });
    });
    it("rechaza coordenadas inválidas, tipos desconocidos, JSON roto y mensajes enormes", () => {
        for (const bad of [
            '{"type":"pick","latitude":999,"longitude":0}', '{"type":"pick","latitude":0,"longitude":0}', '{"type":"pick"}',
            '{"type":"otro"}', "no json", "", "x".repeat(3000), null, undefined, 5
        ]) expect(parseMapMessage(bad)).toBeNull();
    });
});
