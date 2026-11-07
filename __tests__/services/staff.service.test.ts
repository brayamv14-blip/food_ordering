const mockCall = jest.fn();
const mockConfig = { functions: { updateOrderStatus: "fnOps", createOrder: "" } };
const mockAccount = { get: jest.fn() };
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() { return mockConfig; },
    get account() { return mockAccount; },
    callBackendFunction: (...a: any[]) => mockCall(...a)
}));

import { rolesFromLabels, getMyRoles } from "@/lib/services/roles";
import {
    BackendNotConfiguredError, assignDriver, changeOrderStatus, describeBackendError, getOrderHistory, isStaleOrderError, listDrivers, listMyDeliveries, listStaffOrders, sendDriverLocation
} from "@/lib/services/staff.service";

beforeEach(() => { jest.clearAllMocks(); mockConfig.functions.updateOrderStatus = "fnOps"; });

describe("roles", () => {
    it("interpreta las etiquetas de la cuenta", () => {
        expect(rolesFromLabels(["staff"])).toEqual({ staff: true, driver: false });
        expect(rolesFromLabels(["driver", "x"])).toEqual({ staff: false, driver: true });
        expect(rolesFromLabels(undefined)).toEqual({ staff: false, driver: false });
        expect(rolesFromLabels("staff")).toEqual({ staff: false, driver: false });
    });
    it("sin sesión o con error de red no concede ningún rol", async () => {
        mockAccount.get.mockResolvedValue({ labels: ["staff"] });
        expect(await getMyRoles()).toEqual({ staff: true, driver: false });
        mockAccount.get.mockRejectedValue(new Error("401"));
        expect(await getMyRoles()).toEqual({ staff: false, driver: false });
    });
});

describe("servicio de personal (una sola función con campo action)", () => {
    it("lista pedidos con filtros, descarta vacíos y tolera respuestas incompletas", async () => {
        mockCall.mockResolvedValue({ orders: [{ id: "o1" }] });
        expect(await listStaffOrders({ status: "preparing", from: "2026-10-01T00:00:00Z", query: "", to: undefined })).toEqual([{ id: "o1" }]);
        expect(mockCall).toHaveBeenCalledWith("fnOps", { action: "listOrders", status: "preparing", from: "2026-10-01T00:00:00Z" });
        mockCall.mockResolvedValue({});
        expect(await listStaffOrders()).toEqual([]);
        expect(mockCall).toHaveBeenLastCalledWith("fnOps", { action: "listOrders" });
        mockCall.mockResolvedValue(null);
        expect(await listDrivers()).toEqual([]);
        expect(await listMyDeliveries()).toEqual([]);
        expect(mockCall).toHaveBeenLastCalledWith("fnOps", { action: "myDeliveries" });
        await listMyDeliveries(true);
        expect(mockCall).toHaveBeenLastCalledWith("fnOps", { action: "myDeliveries", history: true });
        expect(await getOrderHistory("o1")).toEqual({ enabled: false, events: [] });
    });
    it("asigna repartidor y cambia estado enviando solo ids y lo que el usuario vio", async () => {
        mockCall.mockResolvedValue({});
        await assignDriver("o1", "d1", { expectedStatus: "preparing", expectedUpdatedAt: "T1" });
        expect(mockCall).toHaveBeenCalledWith("fnOps", { action: "assignDriver", orderId: "o1", driverUserId: "d1", expectedStatus: "preparing", expectedUpdatedAt: "T1" });
        await changeOrderStatus("o1", "confirmed");
        expect(mockCall).toHaveBeenCalledWith("fnOps", { action: "updateStatus", orderId: "o1", status: "confirmed" });
    });
    it("envía la ubicación del repartidor con la misma función", async () => {
        mockCall.mockResolvedValue({ ok: true });
        await sendDriverLocation("o1", 19.5, -99.2);
        expect(mockCall).toHaveBeenCalledWith("fnOps", { action: "updateLocation", orderId: "o1", latitude: 19.5, longitude: -99.2 });
    });
    it("devuelve el historial", async () => {
        mockCall.mockResolvedValue({ enabled: true, events: [{ type: "created" }] });
        expect(await getOrderHistory("o1")).toEqual({ enabled: true, events: [{ type: "created" }] });
    });
    it("sin función configurada falla con mensaje claro y sin llamar al servidor", async () => {
        mockConfig.functions.updateOrderStatus = "";
        await expect(listStaffOrders()).rejects.toBeInstanceOf(BackendNotConfiguredError);
        await expect(changeOrderStatus("o1", "confirmed")).rejects.toThrow("EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS");
        await expect(sendDriverLocation("o1", 1, 2)).rejects.toBeInstanceOf(BackendNotConfiguredError);
        expect(mockCall).not.toHaveBeenCalled();
    });
    it("reconoce el conflicto de edición y traduce errores", () => {
        expect(isStaleOrderError(Object.assign(new Error("x"), { code: "stale_order" }))).toBe(true);
        expect(isStaleOrderError(new Error("x"))).toBe(false);
        expect(isStaleOrderError(undefined)).toBe(false);
        expect(describeBackendError(new Error("Solo personal autorizado."))).toBe("Solo personal autorizado.");
        expect(describeBackendError(new Error("Network request failed"))).toMatch(/conexión/);
        expect(describeBackendError(undefined)).toMatch(/conexión/);
        expect(describeBackendError(new BackendNotConfiguredError("X"))).toMatch(/X/);
    });
});
