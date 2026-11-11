import { Alert, Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
jest.mock("@/components/LeafletMap", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-router", () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
const mockRoles = jest.fn();
jest.mock("@/lib/services/roles", () => ({ getMyRoles: () => mockRoles() }));
const mockList = jest.fn(), mockDrivers = jest.fn(), mockAssign = jest.fn(), mockChange = jest.fn(), mockMine = jest.fn(), mockSend = jest.fn(), mockHistory = jest.fn(), mockRespond = jest.fn(), mockAvail = jest.fn(), mockPool = jest.fn(), mockClaim = jest.fn();
jest.mock("@/lib/services/staff.service", () => ({
    sendDriverLocation: (...a: any[]) => mockSend(...a),
    getOrderHistory: (...a: any[]) => mockHistory(...a),
    isStaleOrderError: (e: any) => e?.code === "stale_order",
    listStaffOrders: (...a: any[]) => mockList(...a),
    listDrivers: () => mockDrivers(),
    assignDriver: (...a: any[]) => mockAssign(...a),
    changeOrderStatus: (...a: any[]) => mockChange(...a),
    listMyDeliveries: (...a: any[]) => mockMine(...a),
    respondAssignment: (...a: any[]) => mockRespond(...a),
    listAvailableOrders: (...a: any[]) => mockPool(...a),
    claimOrder: (...a: any[]) => mockClaim(...a),
    DRIVER_STATUS_LABEL: { offline: "Desconectado", available: "Disponible", busy: "Ocupado" },
    DRIVER_STATUS_COLOR: { offline: "#9CA3AF", available: "#16A34A", busy: "#F59E0B" },
    setDriverAvailability: (...a: any[]) => mockAvail(...a),
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

        await waitFor(() => {
            expect(mockRoles).toHaveBeenCalled();
        });

        await waitFor(() => {
            expect(screen.getByText(/No tienes acceso/)).toBeTruthy();
        });

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
        // Cancelar exige motivo: se abre el modal y todavía no se llama al servidor.
        expect(screen.getByText("Motivo de la cancelación")).toBeTruthy();
        expect(mockChange).toHaveBeenCalledTimes(1);
        fireEvent.press(screen.getByLabelText("Motivo: Sin stock"));
        const confirm = screen.getAllByText("Cancelar pedido").at(-1)!;
        fireEvent.press(confirm);
        await waitFor(() => expect(mockChange).toHaveBeenLastCalledWith("ord12345", "cancelled", { expectedStatus: "pending", expectedUpdatedAt: "T1" }, "Sin stock"));
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
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "delivered", {}, undefined));
        expect(screen.queryByText(/Compartiendo tu ubicación/)).toBeNull();
    });
});

describe("pantalla del repartidor: navegación e historial", () => {
    beforeEach(() => {
        mockRoles.mockResolvedValue({ staff: false, driver: true });
    });

    it("abre la navegación al cliente solo si hay coordenadas confirmadas", async () => {
        const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
        mockMine.mockResolvedValue([order({ id: "ordnav01", deliveryLatitude: 19.43, deliveryLongitude: -99.13 })]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByLabelText("Navegar al cliente"));
        await waitFor(() => expect(open).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=19.43,-99.13&travelmode=driving"));
    });
    it("sin coordenadas avisa en vez de abrir un destino inventado", async () => {
        const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
        mockMine.mockResolvedValue([order({ id: "ordnav02" })]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByLabelText("Navegar al cliente"));
        expect(open).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith("Navegación", expect.stringMatching(/coordenadas/));
    });
    it("el historial pide solo entregas terminadas y no ofrece acciones de reparto", async () => {
        mockMine.mockResolvedValue([order({ id: "ordact01" })]);
        render(<DriverDeliveries />);
        await screen.findByText("Ya recogí el pedido");
        mockMine.mockResolvedValue([order({ id: "ordhis01", status: "delivered" })]);
        fireEvent.press(screen.getByText("Historial"));
        await waitFor(() => expect(mockMine).toHaveBeenLastCalledWith(true));
        await waitFor(() => expect(screen.queryByText("Ya recogí el pedido")).toBeNull());
        expect(screen.queryByLabelText("Navegar al cliente")).toBeNull();
    });
});

describe("pantalla del repartidor: asignación, recogido y disponibilidad", () => {
    beforeEach(() => { mockRoles.mockResolvedValue({ staff: false, driver: true }); mockRespond.mockResolvedValue(undefined); mockChange.mockResolvedValue(undefined); });

    it("una asignación pendiente solo ofrece aceptar o rechazar (no recoger ni salir)", async () => {
        mockMine.mockResolvedValue([order({ status: "preparing", driverUserId: "me", driverResponse: "pending" })]);
        render(<DriverDeliveries />);
        await screen.findByText("Aceptar");
        expect(screen.getByText("Rechazar")).toBeTruthy();
        expect(screen.queryByText("Ya recogí el pedido")).toBeNull();
        fireEvent.press(screen.getByText("Aceptar"));
        await waitFor(() => expect(mockRespond).toHaveBeenCalledWith("ord12345", true, undefined));
    });

    it("rechazar pide motivo y llama al servidor con accept=false y el motivo", async () => {
        mockMine.mockResolvedValue([order({ status: "preparing", driverUserId: "me", driverResponse: "pending" })]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Rechazar"));
        expect(mockRespond).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText("Motivo: Estoy lejos"));
        fireEvent.press(screen.getAllByText("Rechazar").at(-1)!);
        await waitFor(() => expect(mockRespond).toHaveBeenCalledWith("ord12345", false, "Estoy lejos"));
    });

    it("pestaña Disponibles: aceptar toma el pedido y un 409 muestra el error", async () => {
        mockMine.mockResolvedValue([]);
        mockPool.mockResolvedValue({ offline: false, orders: [{ id: "pool12345", status: "ready", createdAt: "T", total: 120, paymentMethod: "online", itemsCount: 2, areaLatitude: 19.4, areaLongitude: -99.1, distanceKm: 3 }] });
        mockClaim.mockRejectedValueOnce(Object.assign(new Error("Otro repartidor ya lo tomó."), { code: "already_taken" }));
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Disponibles"));
        fireEvent.press(await screen.findByText("Aceptar pedido"));
        await waitFor(() => expect(mockClaim).toHaveBeenCalledWith("pool12345"));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("No se pudo tomar el pedido", "Otro repartidor ya lo tomó."));
        expect(screen.queryByText(/Total \$120/)).not.toBeNull(); // el pool no muestra datos del cliente
    });

    it("recogido y salir a reparto son pasos distintos", async () => {
        mockMine.mockResolvedValue([order({ status: "ready", driverUserId: "me", driverResponse: "accepted" })]);
        render(<DriverDeliveries />);
        const pickup = await screen.findByText("Ya recogí el pedido");
        // Tras cambiar el estado la pantalla recarga: el servidor ya devuelve "recogido".
        mockMine.mockResolvedValue([order({ status: "picked_up", driverUserId: "me", driverResponse: "accepted" })]);
        fireEvent.press(pickup);
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "picked_up", {}, undefined));
        fireEvent.press(await screen.findByText("Salir a reparto"));
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "on_the_way", {}, undefined));
    });

    it("la entrega fallida se puede reintentar", async () => {
        mockMine.mockResolvedValue([order({ status: "delivery_failed", driverUserId: "me" })]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("Reintentar entrega"));
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "on_the_way", {}, undefined));
    });

    it("desde \"recogido\" se puede reportar entrega fallida (con motivo obligatorio)", async () => {
        mockMine.mockResolvedValue([order({ status: "picked_up", driverUserId: "me", driverResponse: "accepted" })]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByText("No pude entregar"));
        expect(mockChange).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText("Motivo: Cliente no respondió"));
        fireEvent.press(screen.getByText("Registrar"));
        await waitFor(() => expect(mockChange).toHaveBeenCalledWith("ord12345", "delivery_failed", {}, "Cliente no respondió"));
    });

    it("el interruptor de disponibilidad se guarda en el servidor", async () => {
        mockAvail.mockResolvedValue(false);
        mockMine.mockResolvedValue([]);
        render(<DriverDeliveries />);
        fireEvent.press(await screen.findByLabelText("Disponible para recibir pedidos"));
        await waitFor(() => expect(mockAvail).toHaveBeenCalledWith(false));
        await screen.findByText(/Desconectado/);
    });
});