import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ router: { replace: (...a: any[]) => mockReplace(...a), back: jest.fn(), push: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: any) => children }));
const mockGetUser = jest.fn();
jest.mock("@/lib/appwrite", () => ({ __esModule: true, getCurrentUser: (...a: any[]) => mockGetUser(...a) }));
const mockCreate = jest.fn();
jest.mock("@/lib/services/orders.service", () => {
    class OrderServiceError extends Error { code: string; compensated: boolean; constructor(c: string, m: string, comp = false) { super(m); this.code = c; this.compensated = comp; } }
    return { OrderServiceError, createOrderIdempotent: (...a: any[]) => mockCreate(...a), newClientRequestId: () => "chk_fixed0001" };
});
jest.mock("@/lib/services/catalog.service", () => ({ findUnavailableItems: jest.fn().mockResolvedValue([]) }));
jest.mock("@/components/AddressPicker", () => ({ __esModule: true, default: () => null }));
const mockStore = jest.fn();
const mockQuote = jest.fn();
jest.mock("@/lib/services/store.service", () => ({ getStoreInfo: () => mockStore(), getQuote: (...a: any[]) => mockQuote(...a) }));

import Checkout from "@/app/checkout";
import RatingForm from "@/components/RatingForm";
import { useCartStore } from "@/store/cart.store";

const profileRow = { $id: "row1", accountId: "acc1", name: "Bryan", email: "b@c.com", phone: "5512345678", address1: "Av. Reforma 123, Centro", address2: "" };

beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(profileRow);
    mockStore.mockResolvedValue({ open: true, hours: "", prepMinutes: 15, tipMax: 200, couponsEnabled: true });
    mockQuote.mockRejectedValue(new Error("sin cotización"));
    useCartStore.setState({ items: [{ id: "m1", name: "Burger", price: 10, image_url: "x", quantity: 2, customizations: [] }] });
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("checkout v14", () => {
    it("restaurante cerrado: muestra el aviso, deshabilita el botón y no crea el pedido", async () => {
        mockStore.mockResolvedValue({ open: false, hours: "09:00-22:00", reason: "outside_hours", prepMinutes: 15, tipMax: 200, couponsEnabled: false });
        render(<Checkout />);
        await waitFor(() => expect(screen.getByText(/Restaurante cerrado · Horario 09:00-22:00/)).toBeTruthy());
        fireEvent.press(screen.getByRole("button", { name: /Confirmar pedido/ }));
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("envía la propina elegida al crear el pedido y la suma al total mostrado", async () => {
        mockCreate.mockResolvedValue({ orderId: "o1", duplicate: false });
        render(<Checkout />);
        await waitFor(() => expect(screen.getByText("Av. Reforma 123, Centro")).toBeTruthy());
        fireEvent.press(screen.getByRole("button", { name: "Propina de $10.00" }));
        await waitFor(() => expect(screen.getByText("Propina al repartidor")).toBeTruthy());
        fireEvent.press(screen.getByRole("button", { name: /Confirmar pedido/ }));
        await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
        expect(mockCreate.mock.calls[0][0]).toMatchObject({ tip: 10 });
        expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("couponCode");
    });

    it("sin cupones configurados no muestra el campo de cupón", async () => {
        mockStore.mockResolvedValue({ open: true, hours: "", prepMinutes: 15, tipMax: 200, couponsEnabled: false });
        render(<Checkout />);
        await waitFor(() => expect(screen.getByText("Av. Reforma 123, Centro")).toBeTruthy());
        await waitFor(() => expect(screen.queryByText("¿Tienes un cupón?")).toBeNull());
    });
});

describe("RatingForm", () => {
    it("no deja enviar sin estrellas y envía pedido, repartidor y comentario", () => {
        const onSubmit = jest.fn();
        render(<RatingForm hasDriver busy={false} onSubmit={onSubmit} />);
        fireEvent.press(screen.getByRole("button", { name: "Enviar calificación" }));
        expect(onSubmit).not.toHaveBeenCalled();
        fireEvent.press(screen.getByRole("button", { name: "Calificación del pedido: 4 estrellas" }));
        fireEvent.press(screen.getByRole("button", { name: "Calificación del repartidor: 5 estrellas" }));
        fireEvent.changeText(screen.getByLabelText("Comentario"), "Todo bien");
        fireEvent.press(screen.getByRole("button", { name: "Enviar calificación" }));
        expect(onSubmit).toHaveBeenCalledWith({ rating: 4, driverRating: 5, comment: "Todo bien" });
    });

    it("sin repartidor no pide calificarlo", () => {
        render(<RatingForm hasDriver={false} busy={false} onSubmit={jest.fn()} />);
        expect(screen.queryByText("¿Y el repartidor?")).toBeNull();
    });
});
