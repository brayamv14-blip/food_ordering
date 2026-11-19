const mockCall = jest.fn();
const mockConfig: any = { functions: { adminApi: "fnAdmin", createOrder: "fnOrder", updateOrderStatus: "fnStatus" } };
const mockPrefs = { getPrefs: jest.fn(), updatePrefs: jest.fn() };
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() { return mockConfig; },
    account: { getPrefs: (...a: any[]) => mockPrefs.getPrefs(...a), updatePrefs: (...a: any[]) => mockPrefs.updatePrefs(...a) },
    callBackendFunction: (...a: any[]) => mockCall(...a)
}));

import { applyDriver, changeOrderStatus, expireAssignments, getDriverEarnings, getMyDeliveryCode, getMyDriverStatus } from "@/lib/services/staff.service";
import { getFinanceReport, listCategories, listDriverApplications, reviewDriver, saveCategory } from "@/lib/services/admin.service";
import { loadSavedStore, saveSelectedStore } from "@/lib/services/storePrefs";

beforeEach(() => { jest.clearAllMocks(); });

describe("V16 · repartidor (staff.service)", () => {
    it("applyDriver manda solo campos con valor", async () => {
        mockCall.mockResolvedValue({ state: "pending" });
        await applyDriver({ phone: "5512345678", vehicle: "moto", note: "", storeId: "s1" });
        expect(mockCall).toHaveBeenCalledWith("fnStatus", { action: "applyDriver", application: { phone: "5512345678", vehicle: "moto", storeId: "s1" } });
    });
    it("getMyDriverStatus normaliza la respuesta", async () => {
        mockCall.mockResolvedValue({ state: "approved", available: true });
        expect(await getMyDriverStatus()).toEqual({ state: "approved", available: true });
        mockCall.mockResolvedValue({});
        expect(await getMyDriverStatus()).toEqual({ state: null, available: null });
    });
    it("el código de entrega viaja en updateStatus y solo si existe", async () => {
        mockCall.mockResolvedValue({});
        await changeOrderStatus("o1", "delivered", {}, undefined, "1234");
        expect(mockCall).toHaveBeenLastCalledWith("fnStatus", { action: "updateStatus", orderId: "o1", status: "delivered", deliveryCode: "1234" });
        await changeOrderStatus("o1", "picked_up");
        expect(mockCall).toHaveBeenLastCalledWith("fnStatus", { action: "updateStatus", orderId: "o1", status: "picked_up" });
    });
    it("getMyDeliveryCode devuelve enabled=false si el servidor no usa OTP", async () => {
        mockCall.mockResolvedValue({ enabled: false });
        expect(await getMyDeliveryCode("o1")).toEqual({ enabled: false, code: null });
        mockCall.mockResolvedValue({ enabled: true, code: "4821" });
        expect(await getMyDeliveryCode("o1")).toEqual({ enabled: true, code: "4821" });
    });
    it("getDriverEarnings y expireAssignments llaman a su acción", async () => {
        mockCall.mockResolvedValue({ totals: { delivered: 1 } });
        await getDriverEarnings({ from: "2026-11-01T00:00:00Z" });
        expect(mockCall).toHaveBeenLastCalledWith("fnStatus", { action: "driverEarnings", from: "2026-11-01T00:00:00Z" });
        mockCall.mockResolvedValue({ enabled: true, expired: [{ orderId: "o1", reassigned: false }] });
        expect((await expireAssignments()).expired).toHaveLength(1);
        mockCall.mockResolvedValue({ enabled: false });
        expect(await expireAssignments()).toEqual({ enabled: false, expired: [] });
    });
});

describe("V16 · admin.service (solicitudes, finanzas, categorías por tienda)", () => {
    it("solicitudes y revisión", async () => {
        mockCall.mockResolvedValue({ applications: [{ id: "u1" }] });
        expect(await listDriverApplications()).toEqual([{ id: "u1" }]);
        mockCall.mockResolvedValue({ state: "approved" });
        await reviewDriver("u1", true);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "reviewDriver", userId: "u1", approve: true });
    });
    it("getFinanceReport descarta filtros vacíos", async () => {
        mockCall.mockResolvedValue({ finance: {} });
        await getFinanceReport({ from: "", storeId: "s1" });
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "financeReport", storeId: "s1" });
    });
    it("listCategories/saveCategory envían la tienda solo cuando corresponde", async () => {
        mockCall.mockResolvedValue({ categories: [] });
        await listCategories("s1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "listCategories", storeId: "s1" });
        await listCategories();
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "listCategories" });
        mockCall.mockResolvedValue({ category: { id: "c1", name: "X" } });
        await saveCategory({ name: "X" }, undefined, "s1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveCategory", category: { name: "X" }, storeId: "s1" });
        await saveCategory({ name: "Y" }, "c1", "s1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveCategory", category: { name: "Y" }, categoryId: "c1" });
    });
});

describe("V16 · tienda persistente (storePrefs)", () => {
    it("loadSavedStore valida la forma y tolera errores", async () => {
        mockPrefs.getPrefs.mockResolvedValue({ selectedStore: { id: "s1", name: "Sur" } });
        expect(await loadSavedStore()).toEqual({ id: "s1", name: "Sur" });
        mockPrefs.getPrefs.mockResolvedValue({ selectedStore: { id: 3 } });
        expect(await loadSavedStore()).toBeNull();
        mockPrefs.getPrefs.mockRejectedValue(new Error("sin sesión"));
        expect(await loadSavedStore()).toBeNull();
    });
    it("saveSelectedStore fusiona con otras preferencias y no escribe si no cambió", async () => {
        mockPrefs.getPrefs.mockResolvedValue({ favoritos: ["a"] });
        await saveSelectedStore({ id: "s2", name: "Norte" });
        expect(mockPrefs.updatePrefs).toHaveBeenCalledWith({ prefs: { favoritos: ["a"], selectedStore: { id: "s2", name: "Norte" } } });
        mockPrefs.updatePrefs.mockClear();
        mockPrefs.getPrefs.mockResolvedValue({ selectedStore: { id: "s2", name: "Norte" } });
        await saveSelectedStore({ id: "s2", name: "Norte" });
        expect(mockPrefs.updatePrefs).not.toHaveBeenCalled();
    });
    it("saveSelectedStore no lanza si falla la red", async () => {
        mockPrefs.getPrefs.mockRejectedValue(new Error("net"));
        await expect(saveSelectedStore({ id: "s", name: "n" })).resolves.toBeUndefined();
    });
});
