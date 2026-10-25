/** Validación de datos de contacto y direcciónes de entrega. */

export type AddressLabel = "home" | "work" | "manual";

export interface DeliveryAddress {
    label: AddressLabel;
    /** Texto completo de la dirección. */
    line: string;
    /** Coordenadas opcionales; `null` significa "sin coordenadas". */
    latitude: number | null;
    longitude: number | null;
}

export interface ProfileInput {
    name: string;
    email: string;
    phone: string;
    homeAddress: string;
    workAddress?: string;
}

export type ValidationErrors<T extends string> = Partial<Record<T, string>>;

export interface ValidationResult<V, K extends string> {
    valid: boolean;
    errors: ValidationErrors<K>;
    values: V;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizePhone = (raw: string): string =>
    (raw ?? "").replace(/[\s().-]/g, "");

export function validatePhone(raw: string): string | null {
    const phone = normalizePhone(raw);
    if (!phone) return "Escribe tu número de teléfono.";
    if (!/^\+?\d+$/.test(phone)) return "El teléfono solo puede tener números.";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
        return "El teléfono debe tener entre 10 y 15 dígitos.";
    }
    return null;
}

export function validateAddressLine(raw: string, required = true): string | null {
    const line = (raw ?? "").trim().replace(/\s+/g, " ");
    if (!line) return required ? "Escribe la dirección." : null;
    if (line.length < 8) return "La dirección es muy corta (mínimo 8 caracteres).";
    if (line.length > 200) return "La dirección es muy larga (máximo 200 caracteres).";
    if (!/[\p{L}]/u.test(line)) return "La dirección debe incluir texto, no solo números.";
    return null;
}

export function validateProfile(
    input: ProfileInput
): ValidationResult<ProfileInput, keyof ProfileInput> {
    const errors: ValidationErrors<keyof ProfileInput> = {};
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    const email = (input.email ?? "").trim();

    if (name.length < 2) errors.name = "Escribe tu nombre completo.";
    else if (name.length > 80) errors.name = "El nombre es muy largo.";

    if (!EMAIL_RE.test(email)) errors.email = "Escribe un correo válido.";

    const phoneError = validatePhone(input.phone);
    if (phoneError) errors.phone = phoneError;

    const homeError = validateAddressLine(input.homeAddress, true);
    if (homeError) errors.homeAddress = homeError;

    const workError = validateAddressLine(input.workAddress ?? "", false);
    if (workError) errors.workAddress = workError;

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        values: {
            name,
            email,
            phone: normalizePhone(input.phone),
            homeAddress: (input.homeAddress ?? "").trim().replace(/\s+/g, " "),
            workAddress: (input.workAddress ?? "").trim().replace(/\s+/g, " ")
        }
    };
}

/** Valida y normaliza la dirección elegida en el checkout. */
export function validateDeliveryAddress(
    input: Partial<DeliveryAddress> | null | undefined
): ValidationResult<DeliveryAddress | null, "line" | "coordinates"> {
    const errors: ValidationErrors<"line" | "coordinates"> = {};
    if (!input) {
        return {
            valid: false,
            errors: { line: "Elige o escribe una dirección de entrega." },
            values: null
        };
    }
    const lineError = validateAddressLine(input.line ?? "", true);
    if (lineError) errors.line = lineError;

    const lat = input.latitude ?? null;
    const lng = input.longitude ?? null;
    const hasLat = lat !== null;
    const hasLng = lng !== null;
    if (hasLat !== hasLng) {
        errors.coordinates = "Las coordenadas están incompletas.";
    }

    const label: AddressLabel =
        input.label === "home" || input.label === "work" ? input.label : "manual";

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        values: {
            label,
            line: (input.line ?? "").trim().replace(/\s+/g, " "),
            latitude: hasLat && hasLng ? lat : null,
            longitude: hasLat && hasLng ? lng : null
        }
    };
}
