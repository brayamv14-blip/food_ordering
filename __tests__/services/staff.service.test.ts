const mockCall = jest.fn();
const mockConfig = { functions: { staffApi: "fnStaff", updateOrderStatus: "fnStatus", createOrder: "", updateDriverLocation: "" } };
const mockAccount = { get: jest.fn() };
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() { return mockConfig; },
    get account() { return mockAccount; },
    callBackendFunction: (...a: any[]) => mockCall(...a)
}));

import { rolesFromLabels, getMyRoles } from "@/lib/services/roles";
import {
    BackendNotConfiguredError, assignDriver, changeOrderStatus, describeBackendError, listDrivers, listMyDeliveries, listStaffOrders
} from "@/lib/services/staff.service";

beforeEach(() => { jest.clearAllMocks(); mockConfig.functions.staffApi = "fnStaff"; mockConfig.functions.updateOrderStatus = "fnStatus"; });

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

describe("servicio de personal", () => {
    it("lista pedidos con filtro opcional y tolera respuestas incompletas", async () => {
        mockCall.mockResolvedValue({ orders: [{ id: "o1" }] });
        expect(await listStaffOrders("preparing")).toEqual([{ id: "o1" }]);
        expect(mockCall).toHaveBeenCalledWith("fnStaff", { action: "listOrders", status: "preparing" });
        mockCall.mockResolvedValue({});
        expect(await listStaffOrders()).toEqual([]);
        expect(mockCall).toHaveBeenLastCalledWith("fnStaff", { action: "listOrders" });
        mockCall.mockResolvedValue(null);
        expect(await listDrivers()).toEqual([]);
        expect(await listMyDeliveries()).toEqual([]);
    });
    it("asigna repartidor y cambia estado enviando solo ids", async () => {
        mockCall.mockResolvedValue({});
        await assignDriver("o1", "d1");
        expect(mockCall).toHaveBeenCalledWith("fnStaff", { action: "assignDriver", orderId: "o1", driverUserId: "d1" });
        await changeOrderStatus("o1", "confirmed");
        expect(mockCall).toHaveBeenCalledWith("fnStatus", { orderId: "o1", status: "confirmed" });
    });
    it("sin funciones configuradas falla con un mensaje claro y sin llamar al servidor", async () => {
        mockConfig.functions.staffApi = "";
        mockConfig.functions.updateOrderStatus = "";
        await expect(listStaffOrders()).rejects.toBeInstanceOf(BackendNotConfiguredError);
        await expect(changeOrderStatus("o1", "confirmed")).rejects.toThrow("EXPO_PUBLIC_FN_UPDATE_ORDER_STATUS");
        expect(mockCall).not.toHaveBeenCalled();
    });
    it("traduce errores: el mensaje del servidor se muestra, los de red se resumen", () => {
        expect(describeBackendError(new Error("Solo personal autorizado."))).toBe("Solo personal autorizado.");
        expect(describeBackendError(new Error("Network request failed"))).toMatch(/conexión/);
        expect(describeBackendError(undefined)).toMatch(/conexión/);
        expect(describeBackendError(new BackendNotConfiguredError("X"))).toMatch(/X/);
    });
});
