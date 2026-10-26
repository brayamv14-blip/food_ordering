/** Registro, inicio/cierre de sesión, sesión persistente y llamadas al backend (Appwrite simulado). */
jest.mock("react-native-appwrite", () => {
    const mocks = {
        account: { create: jest.fn(), createEmailPasswordSession: jest.fn(), get: jest.fn(), deleteSession: jest.fn(), createRecovery: jest.fn(), updateRecovery: jest.fn() },
        db: { listRows: jest.fn(), createRow: jest.fn(), getRow: jest.fn(), updateRow: jest.fn() },
        functions: { createExecution: jest.fn() }
    };
    class Client { setEndpoint() { return this; } setProject() { return this; } setPlatform() { return this; } }
    let n = 0;
    return {
        __mocks: mocks,
        Client,
        Account: class { constructor() { return mocks.account as any; } },
        Avatars: class { getInitialsURL(name: string) { return `https://avatar/${encodeURIComponent(name)}`; } },
        TablesDB: class { constructor() { return mocks.db as any; } },
        Storage: class {},
        Functions: class { constructor() { return mocks.functions as any; } },
        ExecutionMethod: { POST: "POST" },
        ID: { unique: () => `id${++n}` },
        Query: { equal: (f: string, v: any) => `equal(${f},${v})`, limit: (n: number) => `limit(${n})`, orderDesc: (f: string) => `orderDesc(${f})` }
    };
});

const { account: mockAccount, db: mockDb, functions: mockFunctions } = jest.requireMock("react-native-appwrite").__mocks;

import {
    appwriteConfig, callBackendFunction, cancelOrder, completePasswordRecovery, createUser, getCurrentUser, RecoveryNotConfiguredError, requestPasswordRecovery, signIn, signOut
} from "@/lib/appwrite";
import useAuthStore from "@/store/auth.store";
import { describeAuthError, parseRecoveryLink, parseRecoveryParams, validateEmailOnly, validateNewPassword, validateSignIn, validateSignUp } from "@/lib/domain/auth";

const noSession = () => mockAccount.get.mockRejectedValue(Object.assign(new Error("guests"), { code: 401 }));
const session = (extra: any = {}) => mockAccount.get.mockResolvedValue({ $id: "acc1", email: "b@c.com", name: "Bryan", ...extra });

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockAccount.create.mockResolvedValue({ $id: "acc1" });
    mockAccount.createEmailPasswordSession.mockResolvedValue({});
    mockAccount.deleteSession.mockResolvedValue({});
    mockDb.listRows.mockResolvedValue({ rows: [] });
    mockDb.createRow.mockImplementation(async ({ data }: any) => ({ $id: "row1", ...data }));
    appwriteConfig.functions.updateOrderStatus = "";
    appwriteConfig.recoveryUrl = "";
    useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: true });
});

describe("formularios de acceso", () => {
    it("valida inicio de sesión", () => {
        expect(validateSignIn({ email: "b@c.com", password: "x" })).toBeNull();
        expect(validateSignIn({ email: "mal", password: "x" })).toMatch(/correo/);
        expect(validateSignIn({ email: "b@c.com", password: "" })).toMatch(/contraseña/);
    });
    it("valida registro (nombre, correo, contraseña de 8+)", () => {
        expect(validateSignUp({ name: "Bryan", email: "b@c.com", password: "12345678" })).toBeNull();
        expect(validateSignUp({ name: "B", email: "b@c.com", password: "12345678" })).toMatch(/nombre/);
        expect(validateSignUp({ name: "Bryan", email: "b@c", password: "12345678" })).toMatch(/correo/);
        expect(validateSignUp({ name: "Bryan", email: "b@c.com", password: "1234567" })).toMatch(/8 caracteres/);
        expect(validateSignUp({ name: "Bryan", email: "b@c.com", password: "x".repeat(257) })).toMatch(/larga/);
    });
    it("traduce errores de Appwrite al español", () => {
        expect(describeAuthError({ code: 401 })).toBe("Correo o contraseña incorrectos.");
        expect(describeAuthError({ type: "user_invalid_credentials" })).toBe("Correo o contraseña incorrectos.");
        expect(describeAuthError({ code: 409 })).toBe("Ya existe una cuenta con ese correo.");
        expect(describeAuthError({ code: 429 })).toMatch(/Demasiados intentos/);
        expect(describeAuthError({ code: 400 })).toMatch(/8 caracteres/);
        expect(describeAuthError(new Error("Network request failed"))).toMatch(/conexión/);
        expect(describeAuthError(undefined)).toMatch(/No pudimos/);
    });
});

describe("registro e inicio de sesión", () => {
    it("el registro crea la cuenta, inicia sesión y guarda el perfil", async () => {
        noSession();
        const row: any = await createUser({ email: "b@c.com", password: "12345678", name: "Bryan" });
        expect(mockAccount.create).toHaveBeenCalledWith("id1", "b@c.com", "12345678", "Bryan");
        expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith("b@c.com", "12345678");
        expect(row).toMatchObject({ accountId: "acc1", email: "b@c.com", name: "Bryan" });
        expect(row.avatar).toContain("avatar");
    });

    it("un correo repetido falla sin crear perfil ni sesión", async () => {
        mockAccount.create.mockRejectedValue(Object.assign(new Error("exists"), { code: 409 }));
        await expect(createUser({ email: "b@c.com", password: "12345678", name: "Bryan" })).rejects.toMatchObject({ code: 409 });
        expect(mockAccount.createEmailPasswordSession).not.toHaveBeenCalled();
        expect(mockDb.createRow).not.toHaveBeenCalled();
    });

    it("el inicio de sesión reemplaza una sesión previa", async () => {
        session();
        await signIn({ email: "b@c.com", password: "12345678" });
        expect(mockAccount.deleteSession).toHaveBeenCalledWith("current");
        expect(mockAccount.createEmailPasswordSession).toHaveBeenCalledWith("b@c.com", "12345678");
    });

    it("credenciales incorrectas propagan el error y no dejan sesión", async () => {
        noSession();
        mockAccount.createEmailPasswordSession.mockRejectedValue(Object.assign(new Error("bad"), { code: 401 }));
        await expect(signIn({ email: "b@c.com", password: "mala" })).rejects.toMatchObject({ code: 401 });
        expect(describeAuthError({ code: 401 })).toBe("Correo o contraseña incorrectos.");
    });

    it("cerrar sesión elimina la sesión actual", async () => {
        await signOut();
        expect(mockAccount.deleteSession).toHaveBeenCalledWith("current");
    });
});

describe("sesión persistente y perfil", () => {
    it("con sesión válida al abrir la app el usuario queda autenticado", async () => {
        session();
        mockDb.listRows.mockResolvedValue({ rows: [{ $id: "row1", accountId: "acc1", name: "Bryan", email: "b@c.com", avatar: "a", $createdAt: "x", $updatedAt: "y" }] });
        await useAuthStore.getState().fetchAuthenticatedUser();
        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(true);
        expect(s.user).toMatchObject({ accountId: "acc1", name: "Bryan" });
        expect(s.isLoading).toBe(false);
    });

    it("sin sesión o con error de red la app queda sin autenticar y sin bloquearse", async () => {
        noSession();
        await useAuthStore.getState().fetchAuthenticatedUser();
        expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, user: null, isLoading: false });
        mockAccount.get.mockRejectedValue(new Error("Network request failed"));
        await useAuthStore.getState().fetchAuthenticatedUser();
        expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("si falló la creación del perfil tras registrarse, el siguiente acceso lo crea", async () => {
        session();
        mockDb.listRows.mockResolvedValue({ rows: [] });
        const row: any = await getCurrentUser();
        expect(mockDb.createRow).toHaveBeenCalledTimes(1);
        expect(row).toMatchObject({ accountId: "acc1", name: "Bryan", email: "b@c.com" });
    });

    it("llamadas simultáneas comparten una sola consulta (sin perfiles duplicados)", async () => {
        session();
        mockDb.listRows.mockResolvedValue({ rows: [{ $id: "row1" }] });
        const [a, b, c] = await Promise.all([getCurrentUser(), getCurrentUser(), getCurrentUser()]);
        expect(mockAccount.get).toHaveBeenCalledTimes(1);
        expect(a).toBe(b); expect(b).toBe(c);
        await getCurrentUser(); // una llamada posterior consulta de nuevo
        expect(mockAccount.get).toHaveBeenCalledTimes(2);
    });

    it("si otra petición creó el perfil a la vez, se reutiliza", async () => {
        session();
        mockDb.listRows.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ $id: "rowX" }] });
        mockDb.createRow.mockRejectedValue(Object.assign(new Error("dup"), { code: 409 }));
        await expect(getCurrentUser()).resolves.toMatchObject({ $id: "rowX" });
    });

    it("sin sesión getCurrentUser lanza (el store lo trata como no autenticado)", async () => {
        noSession();
        await expect(getCurrentUser()).rejects.toMatchObject({ code: 401 });
        expect(mockDb.createRow).not.toHaveBeenCalled();
    });
});

describe("llamadas al backend y cancelación", () => {
    const exec = (status: number, body: any, st = "completed") => mockFunctions.createExecution.mockResolvedValue({ responseStatusCode: status, responseBody: JSON.stringify(body), status: st });

    it("devuelve el cuerpo JSON de la función", async () => {
        exec(200, { ok: true });
        await expect(callBackendFunction("fn", { a: 1 })).resolves.toEqual({ ok: true });
        expect(mockFunctions.createExecution).toHaveBeenCalledWith(expect.objectContaining({ functionId: "fn", body: '{"a":1}', async: false }));
    });
    it("convierte errores del servidor en Error con código", async () => {
        exec(403, { code: "forbidden", error: "Solo personal autorizado." });
        await expect(callBackendFunction("fn", {})).rejects.toMatchObject({ message: "Solo personal autorizado.", code: "forbidden" });
        exec(500, "no es objeto json", "failed");
        mockFunctions.createExecution.mockResolvedValue({ responseStatusCode: 500, responseBody: "<html>", status: "failed" });
        await expect(callBackendFunction("fn", {})).rejects.toThrow();
    });
    it("cancelar con Function configurada delega en el servidor", async () => {
        appwriteConfig.functions.updateOrderStatus = "fnOps";
        exec(200, { status: "cancelled" });
        await cancelOrder("o1");
        expect(JSON.parse(mockFunctions.createExecution.mock.calls[0][0].body)).toEqual({ action: "updateStatus", orderId: "o1", status: "cancelled" });
    });
    it("en modo desarrollo solo cancela pedidos pendientes", async () => {
        mockDb.getRow.mockResolvedValue({ $id: "o1", status: "confirmed" });
        await expect(cancelOrder("o1")).rejects.toThrow(/ya no se puede cancelar/);
        expect(mockDb.updateRow).not.toHaveBeenCalled();
        mockDb.getRow.mockResolvedValue({ $id: "o1", status: "pending" });
        mockDb.updateRow.mockResolvedValue({});
        await cancelOrder("o1");
        expect(mockDb.updateRow).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));
    });
});

describe("recuperación de credenciales", () => {
    it("valida correo y nueva contraseña", () => {
        expect(validateEmailOnly("b@c.com")).toBeNull();
        expect(validateEmailOnly("b@c")).toMatch(/correo/);
        expect(validateNewPassword("12345678", "12345678")).toBeNull();
        expect(validateNewPassword("1234567", "1234567")).toMatch(/8 caracteres/);
        expect(validateNewPassword("12345678", "87654321")).toMatch(/no coinciden/);
        expect(validateNewPassword("x".repeat(257), "x".repeat(257))).toMatch(/larga/);
    });

    it("solo acepta userId y secret con formato válido (del enlace o pegados)", () => {
        const ok = { userId: "64f1a2b3c4d5e6f7a8b9", secret: "abcdef0123456789abcdef0123456789" };
        expect(parseRecoveryParams(ok)).toEqual(ok);
        expect(parseRecoveryParams({ userId: [ok.userId], secret: ok.secret })).toEqual(ok); // parámetros repetidos de la ruta
        expect(parseRecoveryParams({ userId: ok.userId, secret: "corto" })).toBeNull();
        expect(parseRecoveryParams({ userId: "../etc", secret: ok.secret })).toBeNull();
        expect(parseRecoveryParams({ userId: "<script>", secret: ok.secret })).toBeNull();
        expect(parseRecoveryParams({ userId: ok.userId })).toBeNull();
        expect(parseRecoveryParams(null)).toBeNull();
        expect(parseRecoveryLink(`https://x.github.io/r/?userId=${ok.userId}&secret=${ok.secret}&expire=2026`)).toEqual(ok);
        expect(parseRecoveryLink("https://x.github.io/r/")).toBeNull();
        expect(parseRecoveryLink("")).toBeNull();
    });

    it("sin URL de recuperación configurada no llama a Appwrite", async () => {
        await expect(requestPasswordRecovery("b@c.com")).rejects.toBeInstanceOf(RecoveryNotConfiguredError);
        expect(mockAccount.createRecovery).not.toHaveBeenCalled();
    });

    it("solicita el correo con la URL configurada", async () => {
        appwriteConfig.recoveryUrl = "https://equipo.github.io/delivery/";
        mockAccount.createRecovery.mockResolvedValue({});
        await requestPasswordRecovery("  b@c.com ");
        expect(mockAccount.createRecovery).toHaveBeenCalledWith({ email: "b@c.com", url: "https://equipo.github.io/delivery/" });
    });

    it("completa el cambio con userId, secret y contraseña nueva", async () => {
        mockAccount.updateRecovery.mockResolvedValue({});
        await completePasswordRecovery({ userId: "u1", secret: "s".repeat(20), password: "nueva-clave-1" });
        expect(mockAccount.updateRecovery).toHaveBeenCalledWith({ userId: "u1", secret: "s".repeat(20), password: "nueva-clave-1" });
        mockAccount.updateRecovery.mockRejectedValue(Object.assign(new Error("Invalid token"), { code: 401 }));
        await expect(completePasswordRecovery({ userId: "u1", secret: "x".repeat(20), password: "nueva-clave-1" })).rejects.toMatchObject({ code: 401 });
    });
});
