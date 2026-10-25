import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ router: { replace: (...a: any[]) => mockReplace(...a), back: jest.fn(), push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: any) => children }));

const mockGetUser = jest.fn();
jest.mock("@/lib/appwrite", () => ({ __esModule: true, getCurrentUser: (...a: any[]) => mockGetUser(...a) }));

const mockCreate = jest.fn();
jest.mock("@/lib/services/orders.service", () => {
    const actual = jest.requireActual("@/lib/domain/pricing");
    void actual;
    class OrderServiceError extends Error { code: string; compensated: boolean; constructor(c: string, m: string, comp = false) { super(m); this.code = c; this.compensated = comp; } }
    return { OrderServiceError, createOrderIdempotent: (...a: any[]) => mockCreate(...a), newClientRequestId: () => "chk_fixed0001" };
});

import Checkout from "@/app/checkout";
import { useCartStore } from "@/store/cart.store";

const profileRow = { $id: "row1", accountId: "acc1", name: "Bryan", email: "b@c.com", phone: "5512345678", address1: "Av. Reforma 123, Centro", address2: "" };

beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(profileRow);
    useCartStore.setState({ items: [{ id: "m1", name: "Burger", price: 10, image_url: "x", quantity: 2, customizations: [] }] });
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

const pressConfirm = async () => {
    await waitFor(() => expect(screen.getByText("Av. Reforma 123, Centro")).toBeTruthy());
    fireEvent.press(screen.getByRole("button", { name: /Confirmar pedido/ }));
};

describe("checkout", () => {
    it("muestra totales y usa la dirección guardada", async () => {
        render(<Checkout />);
        await waitFor(() => expect(screen.getByText("Av. Reforma 123, Centro")).toBeTruthy());
        // 2 x $10 = $20.00; + envío $5.00 - descuento $0.50 = $24.50
        expect(screen.getAllByText("$20.00")).toHaveLength(2); // total de la línea + subtotal
        expect(screen.getByText("- $0.50")).toBeTruthy();
        expect(screen.getAllByText("$24.50").length).toBeGreaterThan(0);
    });

    it("guarda el pedido, vacía el carrito y confirma solo después de guardar", async () => {
        mockCreate.mockResolvedValue({ orderId: "o1", duplicate: false });
        render(<Checkout />);
        await pressConfirm();
        await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
        expect(mockCreate.mock.calls[0][0]).toMatchObject({ userId: "acc1", clientRequestId: "chk_fixed0001", address: { line: "Av. Reforma 123, Centro", label: "home" } });
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Pedido confirmado", expect.any(String), expect.any(Array)));
        expect(useCartStore.getState().items).toHaveLength(0);
    });

    it("si falla, conserva el carrito y muestra un error comprensible", async () => {
        mockCreate.mockRejectedValue(new Error("Network request failed"));
        render(<Checkout />);
        await pressConfirm();
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo confirmar", expect.stringContaining("conexión")));
        expect(useCartStore.getState().items).toHaveLength(1);
        expect(Alert.alert).not.toHaveBeenCalledWith("Pedido confirmado", expect.anything(), expect.anything());
    });

    it("ignora dobles pulsaciones mientras se guarda", async () => {
        let resolve!: (v: any) => void;
        mockCreate.mockImplementation(() => new Promise((r) => { resolve = r; }));
        render(<Checkout />);
        await waitFor(() => expect(screen.getByText("Av. Reforma 123, Centro")).toBeTruthy());
        const button = screen.getByRole("button", { name: /Confirmar pedido/ });
        fireEvent.press(button);
        fireEvent.press(button);
        fireEvent.press(button);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        resolve({ orderId: "o1", duplicate: false });
        await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    });

    it("no intenta guardar con carrito vacío", async () => {
        useCartStore.setState({ items: [] });
        render(<Checkout />);
        await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
        fireEvent.press(screen.getByRole("button", { name: /Confirmar pedido/ }));
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
