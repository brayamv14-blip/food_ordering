const mockCall = jest.fn();
const mockConfig = { functions: { adminApi: "fnAdmin" } };
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() { return mockConfig; },
    callBackendFunction: (...a: any[]) => mockCall(...a)
}));

import {
    adjustStock, getReport, isAdminApiConfigured, listPayments, listProducts, listUsers, periodRange, saveProduct, setProductAvailability, setUserRoles
} from "@/lib/services/admin.service";
import { BackendNotConfiguredError } from "@/lib/services/staff.service";

beforeEach(() => { jest.clearAllMocks(); mockConfig.functions.adminApi = "fnAdmin"; });

describe("admin.service", () => {
    it("sin EXPO_PUBLIC_FN_ADMIN_API falla con un mensaje claro y no llama al backend", async () => {
        mockConfig.functions.adminApi = "";
        expect(isAdminApiConfigured()).toBe(false);
        await expect(listProducts()).rejects.toBeInstanceOf(BackendNotConfiguredError);
        expect(mockCall).not.toHaveBeenCalled();
    });

    it("listProducts devuelve lista vacía si la respuesta no es válida", async () => {
        mockCall.mockResolvedValue(null);
        expect(await listProducts()).toEqual({ products: [], lowStock: 0, inventoryEnabled: false });
        expect(mockCall).toHaveBeenCalledWith("fnAdmin", { action: "listProducts" });
    });

    it("saveProduct crea o edita según haya productId", async () => {
        mockCall.mockResolvedValue({ product: { id: "p1" } });
        await saveProduct({ name: "Taco", price: 10 });
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveProduct", product: { name: "Taco", price: 10 } });
        await saveProduct({ price: 12 }, "p1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveProduct", product: { price: 12 }, productId: "p1" });
    });

    it("adjustStock envía un identificador de intento para que reintentar no duplique", async () => {
        mockCall.mockResolvedValue({ product: { id: "p1", stock: 8 } });
        await adjustStock("p1", { delta: 5 }, "compra", "adj_abc12345");
        expect(mockCall).toHaveBeenCalledWith("fnAdmin", { action: "adjustStock", productId: "p1", delta: 5, reason: "compra", clientRequestId: "adj_abc12345" });
    });

    it("disponibilidad, usuarios y roles llaman a sus acciones", async () => {
        mockCall.mockResolvedValue({ product: { id: "p1", available: false }, users: [{ id: "u1" }], labels: ["staff"] });
        await setProductAvailability("p1", false);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "setProductAvailability", productId: "p1", available: false });
        expect(await listUsers("ana")).toEqual([{ id: "u1" }]);
        expect(await setUserRoles("u1", ["staff"])).toEqual(["staff"]);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "setRole", userId: "u1", labels: ["staff"] });
    });

    it("pagos y reportes omiten filtros vacíos y piden CSV solo si se pide", async () => {
        mockCall.mockResolvedValue({ payments: [], report: {}, truncated: false });
        await listPayments({ paymentStatus: "", from: "2026-10-01T00:00:00.000Z" });
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "listPayments", from: "2026-10-01T00:00:00.000Z" });
        await getReport({});
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "report" });
        await getReport({ from: "2026-10-01T00:00:00.000Z" }, true);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "report", from: "2026-10-01T00:00:00.000Z", format: "csv" });
    });

    it("propaga el error del backend (por ejemplo, permisos)", async () => {
        mockCall.mockRejectedValue(Object.assign(new Error("Solo administradores."), { code: "forbidden" }));
        await expect(setUserRoles("u1", ["admin"])).rejects.toThrow("Solo administradores.");
    });

    it("periodRange calcula periodos desde el inicio del día local", () => {
        const now = new Date(2026, 9, 20, 15, 30);
        expect(periodRange("all", now)).toEqual({});
        const today = periodRange("today", now);
        expect(new Date(today.from!).getHours()).toBe(0);
        expect(new Date(today.from!).getDate()).toBe(20);
        expect(new Date(periodRange("7d", now).from!).getDate()).toBe(14);
        expect(today.to).toBe(now.toISOString());
    });
});
