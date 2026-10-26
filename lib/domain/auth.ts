/** Validacion de formularios de acceso y traduccion de errores de Appwrite. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Appwrite exige contrasenas de 8 a 256 caracteres. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

export function validateSignIn(input: { email: string; password: string }): string | null {
    if (!EMAIL_RE.test((input.email ?? "").trim())) return "Escribe un correo válido.";
    if (!input.password) return "Escribe tu contraseña.";
    return null;
}

export function validateSignUp(input: { name: string; email: string; password: string }): string | null {
    const name = (input.name ?? "").trim();
    if (name.length < 2) return "Escribe tu nombre.";
    if (name.length > 128) return "El nombre es demasiado largo.";
    if (!EMAIL_RE.test((input.email ?? "").trim())) return "Escribe un correo válido.";
    const pw = input.password ?? "";
    if (pw.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
    if (pw.length > PASSWORD_MAX) return "La contraseña es demasiado larga.";
    return null;
}

/** Mensaje en espanol para un error de inicio de sesion o registro. */
export function describeAuthError(e: unknown): string {
    const err = e as { code?: number; type?: string; message?: string } | null;
    const code = typeof err?.code === "number" ? err.code : undefined;
    if (code === 401 || err?.type === "user_invalid_credentials") return "Correo o contraseña incorrectos.";
    if (code === 409 || err?.type === "user_already_exists") return "Ya existe una cuenta con ese correo.";
    if (code === 429) return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
    if (code === 400) return "Revisa los datos: correo válido y contraseña de al menos 8 caracteres.";
    if (/network|fetch|timeout|offline/i.test(err?.message ?? "")) {
        return "No hay conexión. Revisa tu internet e inténtalo de nuevo.";
    }
    return "No pudimos completar la operación. Inténtalo de nuevo.";
}

/** Solo valida el correo (recuperacion de contrasena). */
export function validateEmailOnly(email: string): string | null {
    return EMAIL_RE.test((email ?? "").trim()) ? null : "Escribe un correo válido.";
}

/** Valida la nueva contrasena y su confirmacion. */
export function validateNewPassword(password: string, confirm: string): string | null {
    const pw = password ?? "";
    if (pw.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
    if (pw.length > PASSWORD_MAX) return "La contraseña es demasiado larga.";
    if (pw !== confirm) return "Las contraseñas no coinciden.";
    return null;
}

const USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;
const SECRET_RE = /^[A-Za-z0-9]{10,256}$/;

/**
 * Extrae y valida `userId` y `secret` del enlace de recuperacion (parametros de
 * la ruta o texto pegado por el usuario). Devuelve null si no son utilizables.
 */
export function parseRecoveryParams(
    params: { userId?: unknown; secret?: unknown } | null | undefined
): { userId: string; secret: string } | null {
    const pick = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const userId = pick(params?.userId);
    const secret = pick(params?.secret);
    if (typeof userId !== "string" || typeof secret !== "string") return null;
    const u = userId.trim();
    const s = secret.trim();
    return USER_ID_RE.test(u) && SECRET_RE.test(s) ? { userId: u, secret: s } : null;
}

/** Extrae userId y secret de un enlace completo pegado (https://.../?userId=..&secret=..). */
export function parseRecoveryLink(link: string): { userId: string; secret: string } | null {
    const q = (link ?? "").split("?")[1];
    if (!q) return null;
    const get = (k: string) => {
        const m = q.split("#")[0].split("&").map((p) => p.split("=")).find(([key]) => key === k);
        return m && m[1] !== undefined ? decodeURIComponent(m[1]) : undefined;
    };
    return parseRecoveryParams({ userId: get("userId"), secret: get("secret") });
}
