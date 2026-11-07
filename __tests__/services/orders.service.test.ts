
/** Pruebas del servicio de pedidos con Appwrite simulado (sin credenciales reales). */
import { Platform } from "react-native";

const mockDb = {
    listRows: jest.fn(),
    createRow: jest.fn(),
    updateRow: jest.fn(),
    deleteRow: jest.fn(),
    getRow: jest.fn(),
};

const mockConfig = {
    databaseId: "db",
    ordersCollectionId: "orders",
    orderItemsCollectionId: "items",
    userCollectionId: "users",
    functions: {
        createOrder: "",
        updateOrderStatus: "",
        updateDriverLocation: "",
    },
};

const mockCall = jest.fn();
const mockClient = { subscribe: jest.fn() };
const mockCancel = jest.fn();

jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() {
        return mockConfig;
    },
    get databases() {
        return mockDb;
    },
    get client() {
        return mockClient;
    },
    callBackendFunction: (...a: any[]) => mockCall(...a),
    cancelOrder: (...a: any[]) => mockCancel(...a),
}));

jest.mock("react-native-appwrite", () => {
    let n = 0;

    const chain: any = (path: string) => ({
        table: (t: string) => chain(`${path}.${t}`),
        row: (r: string) => chain(`${path}.${r}`),
        toString: () => path,
    });

    return {
        ID: {
            unique: () => `id${++n}`,
        },
        Query: {
            equal: (f: string, v: any) => `equal(${f},${v})`,
            limit: (n: number) => `limit(${n})`,
            orderDesc: (f: string) => `orderDesc(${f})`,
        },
        Channel: {
            tablesdb: (d: string) => chain(d),
        },
    };
});

import {
    OrderServiceError,
    cancelMyOrder,
    createOrderIdempotent,
    fetchMyOrders,
    fetchOrder,
    subscribeToOrder,
} from "@/lib/services/orders.service";

const cart = [
    {
        id: "m1",
        name: "Burger",
        price: 10,
        image_url: "x",
        quantity: 2,
        customizations: [
            {
                id: "c1",
                name: "Queso",
                price: 1.5,
                type: "topping",
            },
        ],
    },
    {
        id: "m2",
        name: "Papas",
        price: 4,
        image_url: "x",
        quantity: 1,
        customizations: [],
    },
];

const address = {
    label: "home" as const,
    line: "Av. Reforma 123, Col. Centro",
    latitude: 19.5,
    longitude: -99.2,
};

const base = {
    userId: "u1",
    items: cart,
    address,
    contact: {
        name: "Bryan",
        phone: "5512345678",
    },
    clientRequestId: "chk_abc12345",
};

beforeEach(() => {
    jest.clearAllMocks();

    mockConfig.functions.createOrder = "";
    mockDb.listRows.mockResolvedValue({ rows: [] });

    let n = 0;

    mockDb.createRow.mockImplementation(
        async ({ tableId }: any) => ({
            $id: `${tableId}-${++n}`,
        })
    );

    mockDb.deleteRow.mockResolvedValue({});
    mockDb.updateRow.mockResolvedValue({});
});

describe("createOrderIdempotent (modo desarrollo)", () => {
    it("guarda el pedido con totales, dirección histórica y todos los artículos", async () => {
        const r = await createOrderIdempotent(base);

        expect(r.duplicate).toBe(false);

        const orderCall = mockDb.createRow.mock.calls.find(
            ([a]) => a.tableId === "orders"
        )![0];

        expect(orderCall.data).toMatchObject({
            userId: "u1",
            status: "pending",
            subtotal: 27,
            deliveryFee: 5,
            discount: 0.5,
            total: 31.5,
            deliveryAddress: address.line,
            deliveryAddressLabel: "home",
            deliveryLatitude: 19.5,
            clientRequestId: "chk_abc12345",
        });

        const itemCalls = mockDb.createRow.mock.calls
            .filter(([a]) => a.tableId === "items")
            .map(([a]) => a.data);

        expect(itemCalls).toHaveLength(2);

        expect(itemCalls[0]).toMatchObject({
            menuId: "m1",
            price: 11.5,
            quantity: 2,
        });

        expect(JSON.parse(itemCalls[0].customizations)).toHaveLength(1);
    });

    it("un reintento con el mismo identificador devuelve el pedido existente", async () => {
        mockDb.listRows.mockResolvedValue({
            rows: [{ $id: "orders-77" }],
        });

        const r = await createOrderIdempotent(base);

        expect(r).toEqual({
            orderId: "orders-77",
            duplicate: true,
        });

        expect(mockDb.createRow).not.toHaveBeenCalled();
    });

    it("si un artículo falla, deshace lo creado y reporta compensación", async () => {
        let items = 0;

        mockDb.createRow.mockImplementation(
            async ({ tableId }: any) => {
                if (tableId === "items" && ++items === 2) {
                    throw new Error("red");
                }

                return { $id: `${tableId}-${items}` };
            }
        );

        const err = await createOrderIdempotent(base).catch((e) => e);

        expect(err).toBeInstanceOf(OrderServiceError);
        expect(err.code).toBe("items_failed");
        expect(err.compensated).toBe(true);

        const deleted = mockDb.deleteRow.mock.calls.map(
            ([a]) => a.tableId
        );

        expect(deleted).toEqual(["items", "orders"]);
    });

    it("si no se puede borrar el pedido, lo marca como cancelado", async () => {
        mockDb.createRow.mockImplementation(
            async ({ tableId }: any) => {
                if (tableId === "items") {
                    throw new Error("fallo");
                }

                return { $id: "o1" };
            }
        );

        mockDb.deleteRow.mockRejectedValue(
            new Error("sin permiso")
        );

        const err = await createOrderIdempotent(base).catch((e) => e);

        expect(mockDb.updateRow).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { status: "cancelled" },
            })
        );

        expect(err.compensated).toBe(true);
    });

    it("rechaza carrito vacío y dirección inválida sin escribir nada", async () => {
        await expect(
            createOrderIdempotent({
                ...base,
                items: [],
            })
        ).rejects.toMatchObject({
            code: "empty_cart",
        });

        await expect(
            createOrderIdempotent({
                ...base,
                address: { line: "x" } as any,
            })
        ).rejects.toMatchObject({
            code: "invalid_address",
        });

        await expect(
            createOrderIdempotent({
                ...base,
                address: null as any,
            })
        ).rejects.toMatchObject({
            code: "invalid_address",
        });

        expect(mockDb.createRow).not.toHaveBeenCalled();
    });

    it("un fallo al crear el pedido principal no deja artículos", async () => {
        mockDb.createRow.mockRejectedValue(new Error("red"));

        await expect(
            createOrderIdempotent(base)
        ).rejects.toMatchObject({
            code: "order_failed",
        });

        expect(mockDb.createRow).toHaveBeenCalledTimes(1);
    });
});

describe("createOrderIdempotent (modo servidor)", () => {
    it("delega en la función y envía solo ids/cantidades, no importes", async () => {
        mockConfig.functions.createOrder = "fn1";
        mockCall.mockResolvedValue({ orderId: "o9" });

        const r = await createOrderIdempotent(base);

        expect(r).toEqual({
            orderId: "o9",
            duplicate: false,
        });

        const [, payload] = mockCall.mock.calls[0];

        expect(JSON.stringify(payload)).not.toMatch(
            /total|subtotal|price/
        );

        expect(payload.items[0]).toEqual({
            menuId: "m1",
            quantity: 2,
            customizationIds: ["c1"],
        });

        expect(mockDb.createRow).not.toHaveBeenCalled();
    });

    it("propaga el error del servidor y exige respuesta completa", async () => {
        mockConfig.functions.createOrder = "fn1";
        mockCall.mockResolvedValue({});

        await expect(
            createOrderIdempotent(base)
        ).rejects.toMatchObject({
            code: "bad_response",
        });

        mockCall.mockRejectedValue(new Error("red caída"));

        await expect(
            createOrderIdempotent(base)
        ).rejects.toThrow("red caída");
    });
});

describe("historial y detalle", () => {
    const rows = [
        {
            $id: "a",
            userId: "u1",
            status: "pending",
            total: 10,
            $createdAt: "2026-10-20T10:00:00Z",
        },
        {
            $id: "b",
            userId: "otro",
            status: "pending",
            total: 99,
            $createdAt: "2026-10-20T11:00:00Z",
        },
    ];

    it("recupera solo los pedidos del usuario correcto (filtro en consulta y en cliente)", async () => {
        mockDb.listRows.mockImplementation(
            async ({ tableId }: any) =>
                tableId === "orders"
                    ? { rows }
                    : {
                          rows: [
                              {
                                  $id: "i1",
                                  menuId: "m",
                                  name: "X",
                                  price: 5,
                                  quantity: 2,
                                  customizations: "[]",
                              },
                          ],
                      }
        );

        const orders = await fetchMyOrders("u1");

        expect(orders.map((o) => o.id)).toEqual(["a"]);
        expect(orders[0].items[0].lineTotal).toBe(10);

        const q = mockDb.listRows.mock.calls[0][0].queries;

        expect(q).toContain("equal(userId,u1)");
    });

    it("el detalle rechaza pedidos de otro usuario y tolera datos incompletos", async () => {
        mockDb.getRow.mockResolvedValue({
            $id: "b",
            userId: "otro",
            status: "x",
        });

        mockDb.listRows.mockResolvedValue({ rows: [] });

        await expect(
            fetchOrder("b", "u1")
        ).rejects.toMatchObject({
            code: "forbidden",
        });

        const o = await fetchOrder("b");

        expect(o.status).toBeNull();
        expect(o.items).toEqual([]);
    });

    it("propaga errores de red al consultar", async () => {
        mockDb.getRow.mockRejectedValue(
            new Error("Network request failed")
        );

        await expect(
            fetchOrder("a", "u1")
        ).rejects.toThrow("Network request failed");
    });
});

describe("cancelación y suscripción", () => {
    it("solo cancela pedidos pendientes", async () => {
        await cancelMyOrder({
            id: "a",
            status: "pending",
        });

        expect(mockCancel).toHaveBeenCalledWith("a");

        for (const status of [
            "confirmed",
            "preparing",
            "on_the_way",
            "delivered",
            "cancelled",
            null,
        ] as const) {
            await expect(
                cancelMyOrder({ id: "a", status })
            ).rejects.toMatchObject({
                code: "not_cancellable",
            });
        }

        expect(mockCancel).toHaveBeenCalledTimes(1);
    });

    it("se suscribe al canal de la fila del pedido y devuelve el cierre", () => {
        // Conserva la definición original para restaurarla al terminar.
        const originalOSDescriptor = Object.getOwnPropertyDescriptor(
            Platform,
            "OS"
        );

        try {
            // Simula web sin usar jest.spyOn sobre un getter inexistente.
            Object.defineProperty(Platform, "OS", {
                configurable: true,
                value: "web",
            });

            const close = jest.fn();

            mockClient.subscribe.mockReturnValue(close);

            const onEvent = jest.fn();

            const unsub = subscribeToOrder("o1", onEvent);

            expect(mockClient.subscribe).toHaveBeenCalledTimes(1);

            expect(mockClient.subscribe.mock.calls[0][0]).toBe(
                "db.orders.o1"
            );

            mockClient.subscribe.mock.calls[0][1]({});

            expect(onEvent).toHaveBeenCalledTimes(1);

            unsub?.();

            expect(close).toHaveBeenCalledTimes(1);
        } finally {
            // Restaura exactamente la definición previa de Platform.OS.
            if (originalOSDescriptor) {
                Object.defineProperty(
                    Platform,
                    "OS",
                    originalOSDescriptor
                );
            }
        }
    });
});