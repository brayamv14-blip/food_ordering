import { AVATAR_MAX_BYTES, fileIdFromAvatarUrl, validateAvatarAsset } from "@/lib/domain/avatar";
import { canAssignDriverTo, getStaffActions } from "@/lib/domain/orderStatus";
import { redactText, scrubEvent, sentryPrivacyOptions } from "@/lib/sentryConfig";

describe("foto de perfil", () => {
    const ok = { uri: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", fileSize: 1000 };
    it("acepta JPG/PNG/WebP razonables", () => {
        expect(validateAvatarAsset(ok)).toMatchObject({ ok: true, file: { name: "a.jpg", type: "image/jpeg", size: 1000 } });
        expect(validateAvatarAsset({ ...ok, fileName: null, mimeType: "image/png" })).toMatchObject({ ok: true, file: { name: "avatar.png" } });
    });
    it("rechaza tipo, tamaño o datos inválidos", () => {
        expect(validateAvatarAsset({ ...ok, mimeType: "application/pdf" }).ok).toBe(false);
        expect(validateAvatarAsset({ ...ok, mimeType: null }).ok).toBe(false);
        expect(validateAvatarAsset({ ...ok, fileSize: AVATAR_MAX_BYTES + 1 }).ok).toBe(false);
        expect(validateAvatarAsset({ ...ok, fileSize: 0 }).ok).toBe(false);
        expect(validateAvatarAsset({ ...ok, fileSize: undefined }).ok).toBe(false);
        expect(validateAvatarAsset({ ...ok, uri: "" }).ok).toBe(false);
        expect(validateAvatarAsset(null).ok).toBe(false);
    });
    it("solo reconoce como propios los archivos del bucket de la app", () => {
        const u = "https://cloud.appwrite.io/v1/storage/buckets/B1/files/F9/view?project=p";
        expect(fileIdFromAvatarUrl(u, "B1")).toBe("F9");
        expect(fileIdFromAvatarUrl(u, "OTRO")).toBeNull();
        expect(fileIdFromAvatarUrl("https://cloud.appwrite.io/v1/avatars/initials?name=B", "B1")).toBeNull();
        expect(fileIdFromAvatarUrl(undefined, "B1")).toBeNull();
    });
});

describe("acciones del administrador", () => {
    it("ofrece solo las transiciones válidas con etiquetas en español", () => {
        expect(getStaffActions("pending", false).map((a) => a.to)).toEqual(["confirmed", "cancelled"]);
        expect(getStaffActions("confirmed", false).map((a) => a.label)).toEqual(["Empezar a preparar", "Cancelar pedido"]);
        expect(getStaffActions("delivered", true)).toEqual([]);
        expect(getStaffActions("cancelled", true)).toEqual([]);
        expect(getStaffActions("raro", true)).toEqual([]);
        expect(getStaffActions(undefined, true)).toEqual([]);
    });
    it("no permite enviar a reparto sin repartidor y marca cancelar como destructivo", () => {
        const [a] = getStaffActions("preparing", false);
        expect(a).toMatchObject({ to: "on_the_way", disabledReason: expect.any(String) });
        expect(getStaffActions("preparing", true)[0].disabledReason).toBeUndefined();
        expect(getStaffActions("pending", true).find((x) => x.to === "cancelled")?.destructive).toBe(true);
    });
    it("solo se asigna repartidor a pedidos no finalizados", () => {
        expect(canAssignDriverTo("confirmed")).toBe(true);
        expect(canAssignDriverTo("delivered")).toBe(false);
        expect(canAssignDriverTo("cancelled")).toBe(false);
        expect(canAssignDriverTo("x")).toBe(false);
    });
});

describe("privacidad en Sentry", () => {
    it("no envía PII ni graba sesiones y enmascara el contenido", () => {
        expect(sentryPrivacyOptions.sendDefaultPii).toBe(false);
        expect(sentryPrivacyOptions.replaysSessionSampleRate).toBe(0);
        expect(sentryPrivacyOptions.replaysOnErrorSampleRate).toBeLessThanOrEqual(0.1);
        expect(sentryPrivacyOptions.maskAllText).toBe(true);
    });
    it("enmascara teléfonos y correos en texto", () => {
        expect(redactText("llamar al 55 1234 5678 o a b@c.com")).toBe("llamar al [telefono] o a [correo]");
        expect(redactText("+52 (55) 1234-5678")).toBe("[telefono]");
        expect(redactText("pedido 12 de 3")).toBe("pedido 12 de 3");
    });
    it("limpia el evento: sin usuario, request, extra ni migas de consola", () => {
        const ev: any = scrubEvent({
            user: { email: "b@c.com", ip_address: "1.2.3.4" }, request: { url: "x" }, extra: { addr: "Calle 1" },
            message: "fallo con 5512345678",
            exception: { values: [{ value: "tel 5512345678" }] },
            breadcrumbs: [{ category: "console", message: "dir: Calle 1" }, { category: "navigation", message: "a b@c.com", data: { to: "/x" } }]
        });
        expect(ev.user).toBeUndefined();
        expect(ev.request).toBeUndefined();
        expect(ev.extra).toBeUndefined();
        expect(ev.message).toBe("fallo con [telefono]");
        expect(ev.exception.values[0].value).toBe("tel [telefono]");
        expect(ev.breadcrumbs).toHaveLength(1);
        expect(ev.breadcrumbs[0]).toMatchObject({ message: "a [correo]", data: undefined });
    });
    it("tolera eventos casi vacíos", () => {
        expect(() => scrubEvent({} as any)).not.toThrow();
    });
});

import { dateRangeFor, isOrderQueryTooShort, normalizeOrderQuery } from "@/lib/domain/orderFilters";

describe("filtros de pedidos", () => {
    it("calcula el inicio de 'hoy' y de 'últimos 7 días' en hora local", () => {
        const now = new Date(2026, 9, 21, 15, 30); // 21/oct/2026 15:30 local
        expect(dateRangeFor("all", now)).toEqual({});
        expect(new Date(dateRangeFor("today", now).from!).getTime()).toBe(new Date(2026, 9, 21, 0, 0, 0, 0).getTime());
        expect(new Date(dateRangeFor("week", now).from!).getTime()).toBe(new Date(2026, 9, 15, 0, 0, 0, 0).getTime());
    });
    it("normaliza la búsqueda por identificador", () => {
        expect(normalizeOrderQuery(" #ab12cd ")).toBe("ab12cd");
        expect(normalizeOrderQuery("abc")).toBeUndefined();
        expect(normalizeOrderQuery("")).toBeUndefined();
        expect(isOrderQueryTooShort("ab")).toBe(true);
        expect(isOrderQueryTooShort("")).toBe(false);
        expect(isOrderQueryTooShort("abcd")).toBe(false);
    });
});
