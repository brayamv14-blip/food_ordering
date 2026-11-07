
import {
    normalizePhone,
    validatePhone,
} from "@/lib/domain/address";

/** Validación de formularios de acceso y traducción de errores de Appwrite. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

export function validateSignIn(input: {
    email: string;
    password: string;
}): string | null {
    if (!EMAIL_RE.test((input.email ?? "").trim())) {
        return "Escribe un correo válido.";
    }

    if (!input.password) {
        return "Escribe tu contraseña.";
    }

    return null;
}

export function validateSignUp(input: {
    name: string;
    email: string;
    password: string;
    phone: string;
}): string | null {
    const name = (input.name ?? "").trim();

    if (name.length < 2) {
        return "Escribe tu nombre.";
    }

    if (name.length > 128) {
        return "El nombre es demasiado largo.";
    }

    if (!EMAIL_RE.test((input.email ?? "").trim())) {
        return "Escribe un correo válido.";
    }

    const phoneError = validatePhone(input.phone);

    if (phoneError) {
        return phoneError;
    }

    const password = input.password ?? "";

    if (password.length < PASSWORD_MIN) {
        return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
    }

    if (password.length > PASSWORD_MAX) {
        return "La contraseña es demasiado larga.";
    }

    return null;
}

export function describeAuthError(error: unknown): string {
    const err = error as {
        code?: number;
        type?: string;
        message?: string;
    } | null;

    const code =
        typeof err?.code === "number" ? err.code : undefined;

    if (
        code === 401 ||
        err?.type === "user_invalid_credentials"
    ) {
        return "Correo o contraseña incorrectos.";
    }

    if (
        code === 409 ||
        err?.type === "user_already_exists"
    ) {
        return (
            "Ya existe una cuenta con ese correo. " +
            "Si es tu cuenta, inicia sesión."
        );
    }

    if (code === 429) {
        return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
    }

    if (code === 400) {
        return "Revisa los datos: correo válido, teléfono correcto y contraseña de al menos 8 caracteres.";
    }

    if (/network|fetch|timeout|offline/i.test(err?.message ?? "")) {
        return "No hay conexión. Revisa tu internet e inténtalo de nuevo.";
    }

    return (
        err?.message ||
        "No pudimos completar la operación. Inténtalo de nuevo."
    );
}

export function validateEmailOnly(email: string): string | null {
    return EMAIL_RE.test((email ?? "").trim())
        ? null
        : "Escribe un correo válido.";
}

export function validateNewPassword(
    password: string,
    confirm: string
): string | null {
    const value = password ?? "";

    if (value.length < PASSWORD_MIN) {
        return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
    }

    if (value.length > PASSWORD_MAX) {
        return "La contraseña es demasiado larga.";
    }

    if (value !== confirm) {
        return "Las contraseñas no coinciden.";
    }

    return null;
}

const USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const SECRET_RE = /^[A-Za-z0-9]{10,256}$/;

export function parseRecoveryParams(
    params:
        | { userId?: unknown; secret?: unknown }
        | null
        | undefined
): { userId: string; secret: string } | null {
    const pick = (value: unknown) =>
        Array.isArray(value) ? value[0] : value;

    const userId = pick(params?.userId);
    const secret = pick(params?.secret);

    if (
        typeof userId !== "string" ||
        typeof secret !== "string"
    ) {
        return null;
    }

    const normalizedUserId = userId.trim();
    const normalizedSecret = secret.trim();

    if (
        !USER_ID_RE.test(normalizedUserId) ||
        !SECRET_RE.test(normalizedSecret)
    ) {
        return null;
    }

    return {
        userId: normalizedUserId,
        secret: normalizedSecret,
    };
}

export function parseRecoveryLink(
    link: string
): { userId: string; secret: string } | null {
    const questionMark = (link ?? "").indexOf("?");

    if (questionMark < 0) {
        return null;
    }

    const queryString = link
        .slice(questionMark + 1)
        .split("#")[0];

    const params = new URLSearchParams(queryString);

    return parseRecoveryParams({
        userId: params.get("userId") ?? undefined,
        secret: params.get("secret") ?? undefined,
    });
}
