import { Alert } from "react-native";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react-native";

const mockPush = jest.fn();
const mockReplace = jest.fn();


jest.mock("expo-router", () => {
    const React = require("react");

    return {
        router: {
            push: (...args: any[]) => mockPush(...args),
            replace: (...args: any[]) => mockReplace(...args),
            back: jest.fn()
        },

        useFocusEffect: (callback: any) => {
            React.useEffect(() => {
                const cleanup = callback();

                return typeof cleanup === "function"
                    ? cleanup
                    : undefined;
            }, [callback]);
        }
    };
});


jest.mock("react-native-safe-area-context", () => ({
    SafeAreaView: ({ children }: any) => children
}));

const mockGetUser = jest.fn();

jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    getCurrentUser: (...args: any[]) => mockGetUser(...args)
}));

const mockFetchOrders = jest.fn();
const mockCreate = jest.fn();

jest.mock("@/lib/services/orders.service", () => {
    class OrderServiceError extends Error {
        code: string;
        compensated: boolean;

        constructor(
            code: string,
            message: string,
            compensated = false
        ) {
            super(message);
            this.code = code;
            this.compensated = compensated;
        }
    }

    return {
        OrderServiceError,
        fetchMyOrders: (...args: any[]) => mockFetchOrders(...args),
        createOrderIdempotent: (...args: any[]) => mockCreate(...args),
        newClientRequestId: () => "chk_fixed0001"
    };
});

const mockOpen = jest.fn();
const mockRequestUrl = jest.fn();
const mockSync = jest.fn();
const mockEnabled = jest.fn();

jest.mock("@/lib/services/payments.service", () => ({
    isOnlinePaymentEnabled: () => mockEnabled(),
    openCheckout: (...args: any[]) => mockOpen(...args),
    requestPaymentUrl: (...args: any[]) => mockRequestUrl(...args),
    syncPayment: (...args: any[]) => mockSync(...args)
}));

const mockReorder = jest.fn();

jest.mock("@/lib/services/reorder.service", () => ({
    reorderToCart: (...args: any[]) => mockReorder(...args)
}));

jest.mock("@/lib/services/catalog.service", () => ({
    findUnavailableItems: jest.fn().mockResolvedValue([])
}));

jest.mock("expo-notifications", () => {
    const state = {
        handler: jest.fn(),
        listener: null as any,
        tokenListener: null as any,
        last: jest.fn(),
        remove: jest.fn(),
        tokenRemove: jest.fn()
    };

    return {
        __state: state,
        setNotificationHandler: (handler: any) => state.handler(handler),
        getLastNotificationResponseAsync: () => state.last(),
        addNotificationResponseReceivedListener: (callback: any) => {
            state.listener = callback;
            return { remove: state.remove };
        },
        addPushTokenListener: (callback: any) => {
            state.tokenListener = callback;
            return { remove: state.tokenRemove };
        }
    };
});

const mockRefreshToken = jest.fn();
jest.mock("@/lib/services/notifications.service", () => ({
    ensureOrdersChannel: () => Promise.resolve(),
    refreshPushToken: (...a: any[]) => mockRefreshToken(...a)
}));
jest.mock("@/components/AddressPicker", () => ({ __esModule: true, default: () => null }));

const mockNotif = jest.requireMock("expo-notifications").__state;

import Orders from "@/app/orders";
import Checkout from "@/app/checkout";
import NotificationHandler from "@/components/NotificationHandler";
import { useCartStore } from "@/store/cart.store";

const order = (overrides: any = {}) => ({
    id: "ord123456",
    userId: "u1",
    status: "pending",
    rawStatus: "pending",
    subtotal: 20,
    deliveryFee: 5,
    discount: 0.5,
    total: 24.5,
    paymentMethod: "cash_on_delivery",
    paymentStatus: "not_required",
    createdAt: "2026-10-20T10:00:00Z",
    updatedAt: null,
    deliveryAddress: {
        label: "home",
        line: "Av. Reforma 123",
        latitude: null,
        longitude: null
    },
    deliveryLocation: null,
    driverName: null,
    driverLocation: null,
    driverUpdatedAt: null,
    items: [
        {
            id: "i1",
            menuId: "m1",
            name: "Burger",
            unitPrice: 10,
            quantity: 2,
            extras: [],
            lineTotal: 20
        }
    ],
    ...overrides
});

beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    mockGetUser.mockResolvedValue({
        $id: "row1",
        accountId: "acc1",
        name: "Bryan",
        email: "b@c.com",
        phone: "5512345678",
        address1: "Av. Reforma 123, Centro",
        address2: ""
    });

    mockEnabled.mockReturnValue(true);
});

describe("Mis pedidos: pago y pedir de nuevo", () => {
    it("un pedido en efectivo no ofrece acciones de pago", async () => {
        mockFetchOrders.mockResolvedValue([order()]);

        render(<Orders />);

        await waitFor(() => {
            expect(mockGetUser).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(mockFetchOrders).toHaveBeenCalled();
        });

        expect(mockFetchOrders).toHaveBeenCalledWith("acc1");

        expect(
            await screen.findByText("Efectivo contra entrega")
        ).toBeTruthy();

        expect(screen.queryByText("Pagar ahora")).toBeNull();
        expect(screen.queryByText("Verificar pago")).toBeNull();

        expect(mockOpen).not.toHaveBeenCalled();
        expect(mockSync).not.toHaveBeenCalled();
    });

    it("un pedido en línea pendiente permite pagar y verificar", async () => {
        mockFetchOrders.mockResolvedValue([
            order({
                paymentMethod: "online",
                paymentStatus: "pending"
            })
        ]);

        mockRequestUrl.mockResolvedValue("https://checkout.stripe.com/c/pay/cs_test_a1");
        mockOpen.mockResolvedValue(undefined);
        mockSync.mockResolvedValue({ paymentStatus: "paid" });

        render(<Orders />);

        fireEvent.press(await screen.findByText("Pagar ahora"));

        await waitFor(() => {
            expect(mockOpen).toHaveBeenCalledWith(
                "https://checkout.stripe.com/c/pay/cs_test_a1"
            );
        });

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pago confirmado",
                expect.any(String)
            );
        });

        expect(mockRequestUrl).toHaveBeenCalledWith("ord123456");
        expect(mockSync).toHaveBeenCalledWith("ord123456");
    });

    it("un pago fallido o cancelado se puede reintentar; uno reembolsado no", async () => {
        mockFetchOrders.mockResolvedValue([order({ id: "ordfail01", paymentMethod: "online", paymentStatus: "failed" })]);
        render(<Orders />);
        expect(await screen.findByText("Pagar ahora")).toBeTruthy();
        expect(screen.getByText(/Pago fallido/)).toBeTruthy();
    });

    it("un pedido reembolsado no ofrece pagar", async () => {
        mockFetchOrders.mockResolvedValue([order({ id: "ordrefd01", status: "cancelled", rawStatus: "cancelled", paymentMethod: "online", paymentStatus: "refunded" })]);
        render(<Orders />);
        expect(await screen.findByText("Pago reembolsado")).toBeTruthy();
        expect(screen.queryByText("Pagar ahora")).toBeNull();
    });

    it("verificar un pago rechazado explica qué pasó y no lo da por pagado", async () => {
        mockFetchOrders.mockResolvedValue([
            order({
                paymentMethod: "online",
                paymentStatus: "pending"
            })
        ]);

        mockSync.mockResolvedValue({
            paymentStatus: "pending",
            providerStatus: "failed"
        });

        render(<Orders />);

        fireEvent.press(await screen.findByText("Verificar pago"));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pago no confirmado",
                expect.stringMatching(/rechazado/i)
            );
        });
    });

    it("un pedido en línea ya pagado no ofrece pagar otra vez", async () => {
        mockFetchOrders.mockResolvedValue([
            order({
                paymentMethod: "online",
                paymentStatus: "paid"
            })
        ]);

        render(<Orders />);

        expect(await screen.findByText("Pagado en línea")).toBeTruthy();
        expect(screen.queryByText("Pagar ahora")).toBeNull();
    });

    it("un fallo de red al verificar muestra un mensaje comprensible", async () => {
        mockFetchOrders.mockResolvedValue([
            order({
                paymentMethod: "online",
                paymentStatus: "pending"
            })
        ]);

        mockSync.mockRejectedValue(
            new Error("Network request failed")
        );

        render(<Orders />);

        fireEvent.press(await screen.findByText("Verificar pago"));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pago",
                expect.stringMatching(/conexión/i)
            );
        });
    });

    it("pedir de nuevo informa lo agregado y lo omitido y lleva al carrito", async () => {
        mockFetchOrders.mockResolvedValue([order()]);

        mockReorder.mockResolvedValue({
            lines: [{}, {}],
            skipped: [{ name: "Pizza", reason: "está agotado" }]
        });

        render(<Orders />);

        fireEvent.press(
            await screen.findByLabelText(
                "Pedir de nuevo el pedido 123456"
            )
        );

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedir de nuevo",
                expect.stringContaining("Pizza (está agotado)"),
                expect.any(Array)
            );
        });

        const alertCalls = (Alert.alert as jest.Mock).mock.calls;
        const lastAlert = alertCalls[alertCalls.length - 1];

        lastAlert[2][1].onPress();

        expect(mockPush).toHaveBeenCalledWith("/cart");
    });

    it("si no se pudo agregar nada o el catálogo falla, lo dice sin ir al carrito", async () => {
        mockFetchOrders.mockResolvedValue([order()]);

        mockReorder.mockResolvedValue({
            lines: [],
            skipped: [{ name: "Burger", reason: "está agotado" }]
        });

        render(<Orders />);

        fireEvent.press(
            await screen.findByLabelText(
                "Pedir de nuevo el pedido 123456"
            )
        );

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedir de nuevo",
                expect.stringContaining(
                    "No se pudo agregar ningún producto"
                )
            );
        });

        mockReorder.mockRejectedValue(new Error("offline"));

        fireEvent.press(
            screen.getByLabelText(
                "Pedir de nuevo el pedido 123456"
            )
        );

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedir de nuevo",
                expect.stringMatching(/conexión/i)
            );
        });

        expect(mockPush).not.toHaveBeenCalled();
    });
});

describe("checkout con pago en línea", () => {
    beforeEach(() => {
        useCartStore.setState({
            items: [
                {
                    id: "m1",
                    name: "Burger",
                    price: 10,
                    image_url: "x",
                    quantity: 2,
                    customizations: []
                }
            ]
        });
    });

    const choose = async () => {
        await waitFor(() => {
            expect(
                screen.getByText("Av. Reforma 123, Centro")
            ).toBeTruthy();
        });
    };

    it("solo ofrece pago en línea cuando está habilitado", async () => {
        mockEnabled.mockReturnValue(false);

        render(<Checkout />);

        await choose();

        expect(
            screen.queryByLabelText("Pago en línea (tarjeta)")
        ).toBeNull();

        expect(
            screen.getByLabelText("Efectivo contra entrega")
        ).toBeTruthy();
    });

    it("paga en línea: guarda el pedido, abre Stripe Checkout y verifica con el servidor", async () => {
        mockCreate.mockResolvedValue({
            orderId: "o1",
            duplicate: false,
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1"
        });

        mockOpen.mockResolvedValue(undefined);
        mockSync.mockResolvedValue({ paymentStatus: "paid" });

        render(<Checkout />);

        await choose();

        fireEvent.press(
            screen.getByLabelText("Pago en línea (tarjeta)")
        );

        fireEvent.press(
            screen.getByRole("button", { name: /Pagar y confirmar/ })
        );

        await waitFor(() => {
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({ paymentMethod: "online" })
            );
        });

        await waitFor(() => {
            expect(mockOpen).toHaveBeenCalledWith(
                "https://checkout.stripe.com/c/pay/cs_test_a1"
            );
        });

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedido registrado",
                expect.stringContaining("Pago confirmado"),
                expect.any(Array)
            );
        });

        expect(mockSync).toHaveBeenCalledWith("o1");
        expect(useCartStore.getState().items).toHaveLength(0);
    });

    it("si el usuario cierra el pago sin completarlo, el pedido queda pendiente y se explica", async () => {
        mockCreate.mockResolvedValue({
            orderId: "o1",
            duplicate: false,
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1"
        });

        mockOpen.mockResolvedValue(undefined);

        mockSync.mockResolvedValue({
            paymentStatus: "pending",
            providerStatus: null
        });

        render(<Checkout />);

        await choose();

        fireEvent.press(
            screen.getByLabelText("Pago en línea (tarjeta)")
        );

        fireEvent.press(
            screen.getByRole("button", { name: /Pagar y confirmar/ })
        );

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedido registrado",
                expect.stringMatching(/Todavía no/i),
                expect.any(Array)
            );
        });
    });

    it("un fallo al abrir/verificar el pago no pierde el pedido y remite a Mis pedidos", async () => {
        mockCreate.mockResolvedValue({
            orderId: "o1",
            duplicate: false,
            checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1"
        });

        mockOpen.mockRejectedValue(new Error("sin navegador"));

        render(<Checkout />);

        await choose();

        fireEvent.press(
            screen.getByLabelText("Pago en línea (tarjeta)")
        );

        fireEvent.press(
            screen.getByRole("button", { name: /Pagar y confirmar/ })
        );

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                "Pedido registrado",
                expect.stringContaining("Mis pedidos"),
                expect.any(Array)
            );
        });

        expect(mockSync).not.toHaveBeenCalled();
    });

    it("en efectivo sigue como antes (sin abrir ningún pago)", async () => {
        mockCreate.mockResolvedValue({
            orderId: "o2",
            duplicate: false
        });

        render(<Checkout />);

        await choose();

        fireEvent.press(
            screen.getByRole("button", { name: /Confirmar pedido/ })
        );

        await waitFor(() => {
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    paymentMethod: "cash_on_delivery"
                })
            );
        });

        expect(mockOpen).not.toHaveBeenCalled();
    });
});

describe("manejador de notificaciones", () => {
    beforeEach(() => {
        mockNotif.last.mockResolvedValue(null);
        mockNotif.listener = null;
        mockNotif.tokenListener = null;
        mockRefreshToken.mockClear();
    });

    const response = (data: any) => ({
        notification: {
            request: {
                content: { data }
            }
        }
    });

    it("al tocar un aviso de pedido abre su detalle", async () => {
        render(<NotificationHandler />);

        await act(async () => {});

        mockNotif.listener(
            response({
                type: "order_status",
                orderId: "64f1a2b3c4d5e6f7"
            })
        );

        expect(mockPush).toHaveBeenCalledWith({
            pathname: "/order/[id]",
            params: { id: "64f1a2b3c4d5e6f7" }
        });
    });

    it("al tocar un aviso de pago también abre el pedido", async () => {
        render(<NotificationHandler />);
        await act(async () => {});
        mockNotif.listener(response({ type: "order_status", orderId: "64f1a2b3c4d5e6f7", payment: "refunded" }));
        expect(mockPush).toHaveBeenCalledWith({ pathname: "/order/[id]", params: { id: "64f1a2b3c4d5e6f7" } });
    });

    it("cuando FCM renueva el token lo reenvía para actualizar el destino y limpia el listener", async () => {
        const { unmount } = render(<NotificationHandler />);
        await act(async () => {});
        mockNotif.tokenListener({ type: "android", data: "token-nuevo" });
        expect(mockRefreshToken).toHaveBeenCalledWith("token-nuevo");
        unmount();
        expect(mockNotif.tokenRemove).toHaveBeenCalled();
    });

    it("si la app estaba cerrada abre el aviso pendiente", async () => {
        mockNotif.last.mockResolvedValue(
            response({
                type: "driver_assigned",
                orderId: "x"
            })
        );

        render(<NotificationHandler />);

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith({
                pathname: "/driver"
            });
        });
    });

    it("ignora avisos con datos inválidos y limpia el listener al salir", async () => {
        const { unmount } = render(<NotificationHandler />);

        await act(async () => {});

        mockNotif.listener(
            response({
                type: "order_status",
                orderId: "../../admin"
            })
        );

        mockNotif.listener(response(undefined));

        expect(mockPush).not.toHaveBeenCalled();

        unmount();

        expect(mockNotif.remove).toHaveBeenCalled();
    });
});
