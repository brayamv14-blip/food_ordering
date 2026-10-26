import { Alert } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
const mockRoles = jest.fn();
jest.mock("@/lib/services/roles", () => ({ getMyRoles: () => mockRoles() }));
const mockList = jest.fn(), mockDrivers = jest.fn(), mockAssign = jest.fn(), mockChange = jest.fn(), mockMine = jest.fn(), mockSend = jest.fn(), mockHistory = jest.fn();
jest.mock("@/lib/services/staff.service", () => ({
    sendDriverLocation: (...a: any[]) => mockSend(...a),
    getOrderHistory: (...a: any[]) => mockHistory(...a),
    isStaleOrderError: (e: any) => e?.code === "stale_order",
    listStaffOrders: (...a: any[]) => mockList(...a),
    listDrivers: () => mockDrivers(),
    assignDriver: (...a: any[]) => mockAssign(...a),
    changeOrderStatus: (...a: any[]) => mockChange(...a),
    listMyDeliveries: () => mockMine(),
    describeBackendError: (e: any) => e?.message ?? "error"
}));
const mockPosition = jest.fn();
jest.mock("@/lib/services/location", () => ({
    getCurrentPosition: () => mockPosition(),
    isPermissionFailure: (r: string) => r === "denied" || r === "blocked"
}));

import AdminOrders from "@/app/admin/index";
import DriverDeliveries from "@/app/driver/index";

const order = (o: any = {}) => ({ id: "ord12345", status: "preparing", total: 20, createdAt: "", customerName: "Bryan", customerPhone: "5512345678", deliveryAddress: "Av. Reforma 123", driverUserId: null, driverName: null, updatedAt: "T1", items: [{ name: "Burger", quantity: 2 }], ...o });

beforeEach(() => {
    jest.clearAllMocks();
    mockDrivers.mockResolvedValue([{ id: "d1", name: "Luis" }]);
    mockChange.mockResolvedValue(undefined);
    mockAssign.mockResolvedValue(undefined);
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("panel de administración", () => {
    it("un cliente sin etiqueta staff no ve pedidos ni llama al servidor", async () => {
        mockRoles.mockResolvedValue({ staff: false, driver: false });
        render(<AdminOrders />);
        await waitFor(() => expect(screen.getByText(/No tienes acceso/)).toBeTruthy());
        expect(mockList).not.toHaveBeenCalled();
    });

    it("muestra pedidos, bloquea enviar a reparto sin repartidor y permite asignarlo", async () => {
        mockRoles.mockResolvedValue({ staff: true, driver: false });
        mockList.mockResolvedValue([order()]);
        render(<AdminOrders />);
        await waitFor(() => expect(screen.getByText("#d12345")).toBeTruthy());
        expect(screen.getByText("Asigna un repartidor primero.")).toBeTruthy();
        fireEvent.press(screen.getByText("Asignar"));
        fireEvent.press(await screen.findByText("Luis"));
        await waitFor(() => expect(mockAssign).toHaveBeenCalledWith("ord12345", "d1", { expectedStatus: "preparing", expectedUpdatedAt: "T1" }));
        expect(mockChange).not.toHaveBeenCalled();
    });

    it("cambia el estado con la acción válida y pide confirmación para cancelar", async () => {
        mockRoles.mockResolvedValue({ staff: true, driver: false });
        mockList.mockResolvedValue([order({ status: "pending" })]);
        render(<AdminOrders />);
        fireEvent.press(await screen.findByText("Confirmar pedido"));
        expect(Alert.alert).toHaveBeenCalledWith("Confirmar pedido", expect.any(String), expect.any(Array));
        (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress(); // el empleado confirma
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "confirmed", { expectedStatus: "pending", expectedUpdatedAt: "T1" }));
        fireEvent.press(screen.getByText("Cancelar pedido"));
        expect(Alert.alert).toHaveBeenCalledWith("Cancelar pedido", expect.any(String), expect.any(Array));
        expect(mockChange).toHaveBeenCalledTimes(1); // aún no se canceló
    });

    it("muestra el error del servidor y no cambia nada si rechaza la operación", async () => {
        mockRoles.mockResolvedValue({ staff: true, driver: false });
        mockList.mockResolvedValue([order({ status: "pending" })]);
        mockChange.mockRejectedValue(new Error("Transición no permitida."));
        render(<AdminOrders />);
        fireEvent.press(await screen.findByText("Confirmar pedido"));
        (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo completar", "Transición no permitida."));
    });

    it("muestra el error de carga", async () => {
        mockRoles.mockResolvedValue({ staff: true, driver: false });
        mockList.mockRejectedValue(new Error("Network request failed"));
        render(<AdminOrders />);
        await waitFor(() => expect(screen.getByText(/Network request failed/)).toBeTruthy());
    });
});

describe("panel de administración: filtros, conflictos e historial", () => {
    beforeEach(() => { mockRoles.mockResolvedValue({ staff: true, driver: false }); mockList.mockResolvedValue([order({ status: "pending" })]); });

    it("si otro empleado ya cambió el pedido avisa y recarga la lista", async () => {
        mockChange.mockRejectedValue(Object.assign(new Error("El pedido cambió"), { code: "stale_order" }));
        render(<AdminOrders />);
        fireEvent.press(await screen.findByText("Confirmar pedido"));
        const callsBefore = mockList.mock.calls.length;
        (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Pedido actualizado por otra persona", expect.stringContaining("Se recargó")));
        await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(callsBefore));
    });

    it("filtra por fecha y por estado enviando los parámetros al servidor", async () => {
        render(<AdminOrders />);
        fireEvent.press(await screen.findByText("Hoy"));
        await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ from: expect.any(String) })));
        fireEvent.press(screen.getByText("Preparando"));
        await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ status: "preparing", from: expect.any(String) })));
    });

    it("busca por identificador solo con 4 o más caracteres", async () => {
        render(<AdminOrders />);
        const input = await screen.findByLabelText("Buscar pedido por identificador");
        const calls = mockList.mock.calls.length;
        fireEvent.changeText(input, "ab");
        fireEvent(input, "submitEditing");
        expect(screen.getByText("Escribe al menos 4 caracteres del ID.")).toBeTruthy();
        expect(mockList.mock.calls.length).toBe(calls);
        fireEvent.changeText(input, "#d12345");
        fireEvent(input, "submitEditing");
        await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ query: "d12345" })));
    });

    it("muestra el historial de cambios del pedido", async () => {
        mockHistory.mockResolvedValue({ enabled: true, events: [
            { type: "created", from: null, to: "pending", actorRole: "customer", at: "2026-10-20T10:00:00Z" },
            { type: "status", from: "pending", to: "confirmed", actorRole: "staff", at: "2026-10-20T10:05:00Z" }
        ] });
        render(<AdminOrders />);
        fireEvent.press(await screen.findByLabelText("Ver historial del pedido d12345"));
        expect(await screen.findByText("Pedido creado")).toBeTruthy();
        expect(screen.getByText(/Cambio de estado: Pendiente → Confirmado/)).toBeTruthy();
    });

    it("avisa cuando el historial no está activado en la Function", async () => {
        mockHistory.mockResolvedValue({ enabled: false, events: [] });
        render(<AdminOrders />);
        fireEvent.press(await screen.findByLabelText("Ver historial del pedido d12345"));
        expect(await screen.findByText(/historial no está activado/)).toBeTruthy();
    });

    it("pide confirmación antes de cambiar el repartidor de un pedido en curso", async () => {
        mockList.mockResolvedValue([order({ status: "preparing", driverUserId: "d0", driverName: "Ana", updatedAt: "T9" })]);
        render(<AdminOrders />);
        fireEvent.press(await screen.findByText("Cambiar"));
        fireEvent.press(await screen.findByText("Luis"));
        expect(Alert.alert).toHaveBeenCalledWith("Cambiar repartidor", expect.any(String), expect.any(Array));
        expect(mockAssign).not.toHaveBeenCalled();
        (Alert.alert as jest.Mock).mock.calls.at(-1)[2][1].onPress();
        await waitFor(() => expect(mockAssign).toHaveBeenCalledWith("ord12345", "d1", { expectedStatus: "preparing", expectedUpdatedAt: "T9" }));
    });
});

describe("pantalla del repartidor", () => {
    beforeEach(() => { jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }); });
    afterEach(() => { jest.useRealTimers(); });

    it("una cuenta sin etiqueta driver no accede", async () => {
        mockRoles.mockResolvedValue({ staff: true, driver: false });
        render(<DriverDeliveries />);
        await waitFor(() => expect(screen.getByText(/no tiene acceso de repartidor/)).toBeTruthy());
        expect(mockMine).not.toHaveBeenCalled();
    });

    it("no comparte ubicación hasta que el repartidor lo pide y la envía con GPS real", async () => {
        mockRoles.mockResolvedValue({ staff: false, driver: true });
        mockMine.mockResolvedValue([order({ status: "on_the_way", driverUserId: "me" })]);
        mockPosition.mockResolvedValue({ ok: true, coords: { latitude: 19.5, longitude: -99.2 } });
        mockSend.mockResolvedValue(undefined);
        render(<DriverDeliveries />);
        const share = await screen.findByText("Compartir ubicación");
        await act(async () => { jest.advanceTimersByTime(20000); });
        expect(mockPosition).not.toHaveBeenCalled(); // nada antes de pulsar
        fireEvent.press(share);
        await waitFor(() => expect(mockSend).toHaveBeenCalledWith("ord12345", 19.5, -99.2));
        expect(screen.getByText(/Compartiendo tu ubicación/)).toBeTruthy();
        fireEvent.press(screen.getByText("Dejar de compartir ubicación"));
        mockPosition.mockClear();
        await act(async () => { jest.advanceTimersByTime(20000); });
        expect(mockPosition).not.toHaveBeenCalled(); // se detuvo de verdad
    });

    it("si se niega el permiso detiene el envío y lo explica", async () => {
        mockRoles.mockResolvedValue({ staff: false, driver: true });
        mockMine.mockResolvedValue([order({ status: "on_the_way", driverUserId: "me" })]);
        mockPosition.mockResolvedValue({ ok: false, reason: "denied", message: "Necesitamos permiso de ubicación para continuar." });
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Compartir ubicación"));
        await waitFor(() => expect(screen.getByText(/Envío detenido/)).toBeTruthy());
        expect(mockSend).not.toHaveBeenCalled();
        expect(screen.queryByText(/Compartiendo tu ubicación/)).toBeNull();
    });

    it("con el GPS apagado o señal débil avisa y sigue intentando; al recuperarse envía", async () => {
        mockRoles.mockResolvedValue({ staff: false, driver: true });
        mockMine.mockResolvedValue([order({ status: "on_the_way", driverUserId: "me" })]);
        mockSend.mockResolvedValue(undefined);
        mockPosition
            .mockResolvedValueOnce({ ok: false, reason: "disabled", message: "El GPS está desactivado. Actívalo para continuar." })
            .mockResolvedValue({ ok: true, coords: { latitude: 19.5, longitude: -99.2 }, accuracy: 8 });
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Compartir ubicación"));
        await waitFor(() => expect(screen.getByText(/El GPS está desactivado.*Reintentando/)).toBeTruthy());
        expect(screen.getByText(/Compartiendo tu ubicación/)).toBeTruthy(); // sigue activo
        expect(mockSend).not.toHaveBeenCalled();
        await act(async () => { jest.advanceTimersByTime(5000); });
        await waitFor(() => expect(mockSend).toHaveBeenCalledWith("ord12345", 19.5, -99.2));
    });

    it("al marcar entregado deja de compartir y cambia el estado", async () => {
        mockRoles.mockResolvedValue({ staff: false, driver: true });
        mockMine.mockResolvedValue([order({ status: "on_the_way", driverUserId: "me" })]);
        mockPosition.mockResolvedValue({ ok: true, coords: { latitude: 19.5, longitude: -99.2 } });
        mockSend.mockResolvedValue(undefined);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Compartir ubicación"));
        await waitFor(() => expect(mockSend).toHaveBeenCalled());
        fireEvent.press(screen.getByText("Marcar entregado"));
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "delivered"));
        expect(screen.queryByText(/Compartiendo tu ubicación/)).toBeNull();
    });
});
