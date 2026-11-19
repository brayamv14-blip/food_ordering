// roles.ts importa lib/appwrite (SDK real, ESM): se simula, esta prueba solo usa funciones puras.
jest.mock("@/lib/appwrite", () => ({ __esModule: true, account: {}, appwriteConfig: {}, callBackendFunction: jest.fn() }));

import { DEFAULT_STORE_ID, ROLE_NAMES, creatableRoles, rolNeedsStore, scopeFromLabels, userErrorMessage, validateUserForm } from "@/lib/domain/access";
import { rolesFromLabels } from "@/lib/services/roles";

describe("V15 · alcance por etiquetas (espejo del servidor)", () => {
    it("superadmin es global y administrador", () => {
        const s = scopeFromLabels(["superadmin"]);
        expect(s).toMatchObject({ role: "superadmin", superadmin: true, global: true, isAdmin: true, isStaff: true });
    });
    it("administrador con etiqueta de tienda queda limitado a ella", () => {
        const s = scopeFromLabels(["admin", "stabc123"]);
        expect(s).toMatchObject({ role: "admin", storeId: "abc123", global: false, isAdmin: true });
    });
    it("administrador V14 sin tienda sigue siendo global (compatibilidad)", () => {
        expect(scopeFromLabels(["admin"]).global).toBe(true);
    });
    it("personal y repartidor V14 sin etiqueta pertenecen a la tienda por omisión", () => {
        expect(scopeFromLabels(["staff"]).storeId).toBe(DEFAULT_STORE_ID);
        expect(scopeFromLabels(["driver"]).storeId).toBe(DEFAULT_STORE_ID);
    });
    it("la etiqueta `staff` no se confunde con una tienda", () => {
        expect(scopeFromLabels(["staff", "stmain"]).storeId).toBe("main");
        expect(scopeFromLabels(["staff"]).role).toBe("staff");
    });
    it("cliente: sin etiquetas, sin tienda", () => {
        expect(scopeFromLabels([])).toMatchObject({ role: "customer", storeId: null, isStaff: false });
        expect(scopeFromLabels(undefined).role).toBe("customer");
    });
    it("rolesFromLabels trata al superadmin como administrador y conserva la forma V14", () => {
        expect(rolesFromLabels(["superadmin"])).toEqual({ staff: true, driver: false, admin: true });
        expect(rolesFromLabels(["staff"])).toEqual({ staff: true, driver: false, admin: false });
    });
});

describe("V15 · roles que se pueden crear (sin elevar privilegios)", () => {
    it("superadmin crea admin/staff/driver/customer, nunca superadmin", () => {
        expect(creatableRoles({ role: "superadmin" })).toEqual(["admin", "staff", "driver", "customer"]);
    });
    it("administrador de tienda no crea administradores", () => {
        expect(creatableRoles({ role: "admin" })).toEqual(["staff", "driver", "customer"]);
    });
    it("personal, repartidor y cliente no crean usuarios", () => {
        for (const role of ["staff", "driver", "customer"] as const) expect(creatableRoles({ role })).toEqual([]);
    });
    it("admin, encargado y repartidor necesitan tienda; el cliente no", () => {
        expect(["admin", "staff", "driver"].every((r) => rolNeedsStore(r as never))).toBe(true);
        expect(rolNeedsStore("customer")).toBe(false);
    });
    it("hay nombre visible para cada rol", () => {
        expect(Object.keys(ROLE_NAMES).sort()).toEqual(["admin", "customer", "driver", "staff", "superadmin"]);
    });
});

describe("V15 · validación del formulario de usuario", () => {
    const ok = { name: "Ana Pérez", email: "ana@correo.com", role: "staff" as const, storeId: "s1" };
    it("acepta datos correctos", () => expect(validateUserForm(ok)).toBeNull());
    it("pide nombre", () => expect(validateUserForm({ ...ok, name: "A" })).toMatch(/nombre/i));
    it("pide un correo válido", () => expect(validateUserForm({ ...ok, email: "no-es-correo" })).toMatch(/correo/i));
    it("exige tienda cuando el rol la necesita", () => expect(validateUserForm({ ...ok, storeId: null })).toMatch(/tienda/i));
    it("el cliente puede no tener tienda", () => expect(validateUserForm({ ...ok, role: "customer", storeId: null })).toBeNull());
    it("contraseña opcional, pero si se escribe debe tener 8+ caracteres", () => {
        expect(validateUserForm({ ...ok, password: "" })).toBeNull();
        expect(validateUserForm({ ...ok, password: "1234" })).toMatch(/contraseña/i);
        expect(validateUserForm({ ...ok, password: "ClaveSegura#1" })).toBeNull();
    });
});

describe("V15 · mensajes de error claros", () => {
    it("traduce los códigos del servidor", () => {
        expect(userErrorMessage({ code: "email_taken" })).toBe("Ese correo ya está registrado.");
        expect(userErrorMessage({ code: "store_inactive" })).toMatch(/inactiva/);
        expect(userErrorMessage({ code: "store_not_found" })).toMatch(/no existe/);
        expect(userErrorMessage({ code: "forbidden" })).toMatch(/permiso/);
        expect(userErrorMessage({ code: "role_not_allowed" })).toMatch(/rol/);
    });
    it("403 y 401 de Appwrite", () => {
        expect(userErrorMessage({ code: 403 })).toMatch(/permiso/);
        expect(userErrorMessage({ status: 401 })).toMatch(/sesión/);
    });
    it("usa el texto del servidor si no conoce el código y oculta errores de red", () => {
        expect(userErrorMessage({ message: "Algo específico" })).toBe("Algo específico");
        expect(userErrorMessage(new Error("Network request failed"))).toMatch(/conexión/);
    });
});
