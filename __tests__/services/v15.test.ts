const mockCall = jest.fn();
const mockConfig: any = { functions: { adminApi: "fnAdmin", createOrder: "fnOrder" } };
jest.mock("@/lib/appwrite", () => ({
    __esModule: true,
    get appwriteConfig() { return mockConfig; },
    callBackendFunction: (...a: any[]) => mockCall(...a)
}));

import { createUser, listAdminStores, listUsers, resetUserPassword, saveStore, setStoreActive, updateUser, userHistory } from "@/lib/services/admin.service";
import { getQuote, getStoreInfo, listStores } from "@/lib/services/store.service";

beforeEach(() => { jest.clearAllMocks(); mockConfig.functions = { adminApi: "fnAdmin", createOrder: "fnOrder" }; });

describe("V15 · admin.service (usuarios)", () => {
    it("createUser envía solo los campos con valor y nunca devuelve ni reenvía la contraseña", async () => {
        mockCall.mockResolvedValue({ user: { id: "u1" }, recoveryEmailSent: true, passwordSetByAdmin: false });
        const r = await createUser({ name: "Ana", email: "a@b.co", role: "staff", storeId: "s1", phone: "", password: "" });
        expect(mockCall).toHaveBeenCalledWith("fnAdmin", { action: "createUser", user: { name: "Ana", email: "a@b.co", role: "staff", storeId: "s1" } });
        expect(r.recoveryEmailSent).toBe(true);
        expect(JSON.stringify(r)).not.toMatch(/password"\s*:\s*"/i);
    });
    it("listUsers acepta filtros de rol y tienda y descarta los vacíos", async () => {
        mockCall.mockResolvedValue({ users: [{ id: "u1" }] });
        expect(await listUsers({ query: "ana", role: "driver", storeId: "" })).toEqual([{ id: "u1" }]);
        expect(mockCall).toHaveBeenCalledWith("fnAdmin", { action: "listUsers", query: "ana", role: "driver" });
        expect(await listUsers()).toEqual([{ id: "u1" }]);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "listUsers" });
    });
    it("updateUser, resetUserPassword y userHistory llaman a su acción", async () => {
        mockCall.mockResolvedValueOnce({ user: { id: "u1", role: "driver" } });
        expect(await updateUser("u1", { role: "driver" })).toEqual({ id: "u1", role: "driver" });
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "updateUser", userId: "u1", changes: { role: "driver" } });
        mockCall.mockResolvedValueOnce({ sent: true });
        await resetUserPassword("u1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "resetPassword", userId: "u1" });
        mockCall.mockResolvedValueOnce({ entries: [{ id: "e1" }] });
        expect(await userHistory("u1")).toEqual([{ id: "e1" }]);
    });
    it("propaga el error del servidor (p. ej. correo duplicado) sin ocultarlo", async () => {
        mockCall.mockRejectedValue(Object.assign(new Error("Ese correo ya está registrado."), { code: "email_taken" }));
        await expect(createUser({ name: "Ana", email: "a@b.co", role: "staff", storeId: "s1" })).rejects.toMatchObject({ code: "email_taken" });
    });
});

describe("V15 · admin.service (tiendas)", () => {
    it("listAdminStores devuelve vacío si la respuesta no es válida", async () => {
        mockCall.mockResolvedValue(null);
        expect(await listAdminStores()).toEqual({ enabled: false, stores: [] });
    });
    it("saveStore crea o edita según haya storeId", async () => {
        mockCall.mockResolvedValue({ store: { id: "s1" } });
        await saveStore({ name: "Sucursal" });
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveStore", store: { name: "Sucursal" } });
        await saveStore({ openHours: "09:00-22:00" }, "s1");
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "saveStore", store: { openHours: "09:00-22:00" }, storeId: "s1" });
    });
    it("setStoreActive", async () => {
        mockCall.mockResolvedValue({ store: { id: "s1", active: false } });
        await setStoreActive("s1", false);
        expect(mockCall).toHaveBeenLastCalledWith("fnAdmin", { action: "setStoreActive", storeId: "s1", active: false });
    });
});

describe("V15 · store.service (cliente)", () => {
    it("listStores sin servidor configurado = una sola tienda (V14)", async () => {
        mockConfig.functions.createOrder = "";
        expect(await listStores()).toEqual({ enabled: false, defaultStoreId: "main", stores: [] });
    });
    it("listStores devuelve las tiendas activas", async () => {
        mockCall.mockResolvedValue({ enabled: true, defaultStoreId: "main", stores: [{ id: "sA", name: "A", open: true }] });
        const r = await listStores();
        expect(r.enabled).toBe(true);
        expect(r.stores).toHaveLength(1);
        expect(mockCall).toHaveBeenCalledWith("fnOrder", { action: "listStores" });
    });
    it("un fallo de red no rompe la pantalla: cae a una sola tienda", async () => {
        mockCall.mockRejectedValue(new Error("Network request failed"));
        expect((await listStores()).enabled).toBe(false);
    });
    it("storeInfo y quote envían la tienda elegida", async () => {
        mockCall.mockResolvedValue({ open: true, hours: "", prepMinutes: 20, tipMax: 100, couponsEnabled: false });
        await getStoreInfo("sB");
        expect(mockCall).toHaveBeenLastCalledWith("fnOrder", { action: "storeInfo", storeId: "sB" });
        await getStoreInfo();
        expect(mockCall).toHaveBeenLastCalledWith("fnOrder", { action: "storeInfo" });
        mockCall.mockResolvedValue({ total: 10 });
        await getQuote({ storeId: "sB", items: [{ id: "p1", quantity: 1, price: 5, name: "x" } as any], address: { line: "x" } });
        expect(mockCall.mock.calls.at(-1)![1]).toMatchObject({ action: "quote", storeId: "sB" });
    });
});
