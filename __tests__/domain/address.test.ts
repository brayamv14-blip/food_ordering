import { validateDeliveryAddress, validatePhone, validateProfile } from "@/lib/domain/address";

const valid = { name: "Bryan Pérez", email: "bryan@correo.com", phone: "55 1234 5678", homeAddress: "Av. Reforma 123, Col. Centro", workAddress: "" };

describe("validación de perfil y direcciones", () => {
    it("acepta un perfil correcto y normaliza el teléfono", () => {
        const r = validateProfile(valid);
        expect(r.valid).toBe(true);
        expect(r.values.phone).toBe("5512345678");
    });

    it("reporta cada campo inválido", () => {
        const r = validateProfile({ name: "A", email: "x", phone: "123", homeAddress: "corta", workAddress: "12345678" });
        expect(r.valid).toBe(false);
        expect(Object.keys(r.errors).sort()).toEqual(["email", "homeAddress", "name", "phone", "workAddress"]);
    });

    it("la dirección de trabajo es opcional pero se valida si existe", () => {
        expect(validateProfile({ ...valid, workAddress: "" }).valid).toBe(true);
        expect(validateProfile({ ...valid, workAddress: "abc" }).errors.workAddress).toBeDefined();
    });

    it("valida teléfonos", () => {
        expect(validatePhone("+52 (55) 1234-5678")).toBeNull();
        expect(validatePhone("")).not.toBeNull();
        expect(validatePhone("55-abcd-5678")).not.toBeNull();
        expect(validatePhone("1234567890123456")).not.toBeNull();
    });

    it("la dirección de entrega manual se acepta sin coordenadas", () => {
        const r = validateDeliveryAddress({ label: "manual", line: "  Calle 5   de Mayo 10, Atizapán " });
        expect(r.valid).toBe(true);
        expect(r.values).toEqual({ label: "manual", line: "Calle 5 de Mayo 10, Atizapán", latitude: null, longitude: null });
    });

    it("rechaza dirección ausente, vacía o con coordenadas a medias", () => {
        expect(validateDeliveryAddress(null).valid).toBe(false);
        expect(validateDeliveryAddress({ line: "   " }).errors.line).toBeDefined();
        expect(validateDeliveryAddress({ line: "Calle larga 123", latitude: 19.5, longitude: null }).errors.coordinates).toBeDefined();
    });
});
