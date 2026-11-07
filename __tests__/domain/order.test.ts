import { describeAge, parseLatLng, toFiniteNumber } from "@/lib/domain/coordinates";
import { mapOrderRow, parseExtras } from "@/lib/domain/order";

describe("coordenadas", () => {
    it("distingue ausentes de válidas y no usa 0,0", () => {
        expect(parseLatLng(null, null)).toBeNull();
        expect(parseLatLng(undefined, 10)).toBeNull();
        expect(parseLatLng("", "")).toBeNull();
        expect(parseLatLng(0, 0)).toBeNull();
        expect(parseLatLng(19.55, -99.2)).toEqual({ latitude: 19.55, longitude: -99.2 });
        expect(parseLatLng("19.55", "-99.2")).toEqual({ latitude: 19.55, longitude: -99.2 });
        expect(parseLatLng(91, 10)).toBeNull();
        expect(parseLatLng(10, 181)).toBeNull();
        expect(parseLatLng(NaN, 1)).toBeNull();
        expect(toFiniteNumber({})).toBeNull();
    });
    it("describe la antigüedad", () => {
        const now = new Date("2026-10-20T12:00:00Z");
        expect(describeAge("2026-10-20T11:59:58Z", now)).toBe("hace unos segundos");
        expect(describeAge("2026-10-20T11:58:00Z", now)).toBe("hace 2 min");
        expect(describeAge("no-fecha", now)).toBeNull();
        expect(describeAge(null, now)).toBeNull();
    });
});

describe("mapeo de pedidos", () => {
    it("convierte artículos y extras (JSON en texto)", () => {
        expect(parseExtras('[{"id":"1","name":"Queso","price":1.5,"type":"topping"}]')).toEqual([{ id: "1", name: "Queso", price: 1.5, type: "topping" }]);
        expect(parseExtras("no es json")).toEqual([]);
        expect(parseExtras(null)).toEqual([]);
        expect(parseExtras('{"a":1}')).toEqual([]);
        expect(parseExtras([{ name: "" }, { name: "Tocino", price: "2" }])).toHaveLength(1);
    });

    it("mapea un pedido completo con coordenadas", () => {
        const o = mapOrderRow(
            {
                $id: "o1", userId: "u1", status: "on_the_way", subtotal: 20, total: 24.5, deliveryFee: 5, discount: 0.5,
                $createdAt: "2026-10-20T10:00:00Z", $updatedAt: "2026-10-20T10:05:00Z",
                deliveryAddress: "Calle 1 #2", deliveryAddressLabel: "home", deliveryLatitude: 19.5, deliveryLongitude: -99.2,
                driverName: "Luis", driverLatitude: "19.51", driverLongitude: "-99.21", driverUpdatedAt: "2026-10-20T10:04:55Z"
            },
            [{ $id: "i1", menuId: "m1", name: "Burger", price: 10, quantity: 2, customizations: "[]" }]
        );
        expect(o.status).toBe("on_the_way");
        expect(o.deliveryLocation).toEqual({ latitude: 19.5, longitude: -99.2 });
        expect(o.driverLocation).toEqual({ latitude: 19.51, longitude: -99.21 });
        expect(o.items[0].lineTotal).toBe(20);
    });

    it("tolera pedidos sin coordenadas, sin dirección y con estado desconocido", () => {
        const o = mapOrderRow({ $id: "o2", status: "raro", driverLatitude: 0, driverLongitude: 0 });
        expect(o.status).toBeNull();
        expect(o.rawStatus).toBe("raro");
        expect(o.driverLocation).toBeNull();
        expect(o.deliveryAddress).toBeNull();
        expect(o.deliveryLocation).toBeNull();
        expect(o.driverName).toBeNull();
        expect(o.total).toBe(0);
        expect(o.items).toEqual([]);
    });
});
