/**
 * V15 — roles y tienda segun las etiquetas de la cuenta. SOLO decide que pantallas/opciones se muestran;
 * el servidor vuelve a validar rol y tienda en cada accion (espejo de `actorScope` en appwrite-functions/shared/rules.js).
 */
export type RoleKey = "superadmin" | "admin" | "staff" | "driver" | "customer";

export const DEFAULT_STORE_ID = "main";

export interface Scope {
    role: RoleKey;
    storeId: string | null;
    superadmin: boolean;
    /** Ve todas las tiendas (superadmin o administrador V14 sin tienda). */
    global: boolean;
    isAdmin: boolean;
    isStaff: boolean;
    isDriver: boolean;
}

export const ROLE_NAMES: Record<RoleKey, string> = {
    superadmin: "Superadministrador",
    admin: "Administrador de tienda",
    staff: "Encargado / personal",
    driver: "Repartidor",
    customer: "Cliente"
};

const STORE_LABEL_RE = /^st([A-Za-z0-9]{1,34})$/;

export function scopeFromLabels(labels: unknown): Scope {
    const l = Array.isArray(labels) ? (labels as string[]) : [];
    const superadmin = l.includes("superadmin");
    const admin = l.includes("admin");
    let storeId: string | null = null;
    for (const x of l) {
        if (x === "staff") continue;
        const m = STORE_LABEL_RE.exec(String(x));
        if (m) { storeId = m[1]; break; }
    }
    if (!storeId && !admin && !superadmin && (l.includes("staff") || l.includes("driver"))) storeId = DEFAULT_STORE_ID;
    const role: RoleKey = superadmin ? "superadmin" : admin ? "admin" : l.includes("staff") ? "staff" : l.includes("driver") ? "driver" : "customer";
    return { role, storeId, superadmin, global: superadmin || (admin && !storeId), isAdmin: superadmin || admin, isStaff: superadmin || admin || l.includes("staff"), isDriver: l.includes("driver") };
}

/** Roles que este usuario puede asignar al crear/editar (nunca superadministrador). */
export function creatableRoles(scope: Pick<Scope, "role">): RoleKey[] {
    if (scope.role === "superadmin") return ["admin", "staff", "driver", "customer"];
    if (scope.role === "admin") return ["staff", "driver", "customer"];
    return [];
}

export const rolNeedsStore = (role: RoleKey): boolean => role === "admin" || role === "staff" || role === "driver";

/** Validacion de formulario (mensajes claros); el servidor valida de nuevo. */
export function validateUserForm(f: { name: string; email: string; role: RoleKey; storeId: string | null; password?: string }): string | null {
    const name = f.name.trim();
    if (name.length < 2 || name.length > 80) return "El nombre debe tener entre 2 y 80 caracteres.";
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(f.email.trim())) return "Escribe un correo válido.";
    if (rolNeedsStore(f.role) && !f.storeId) return "Elige la tienda a la que pertenece este usuario.";
    if (f.password && (f.password.length < 8 || f.password.length > 128)) return "La contraseña debe tener entre 8 y 128 caracteres (o déjala vacía para enviar un correo de recuperación).";
    return null;
}

const MESSAGES: Record<string, string> = {
    email_taken: "Ese correo ya está registrado.",
    forbidden: "No tienes permiso para esta acción.",
    role_not_allowed: "No puedes asignar ese rol.",
    store_forbidden: "No tienes permiso sobre esa tienda.",
    store_required: "Ese rol necesita una tienda.",
    store_not_found: "La tienda no existe.",
    store_inactive: "La tienda está inactiva.",
    self_role_change: "No puedes cambiar tu propio rol.",
    self_store_change: "No puedes cambiar tu propia tienda.",
    weak_password: "La contraseña debe tener entre 8 y 128 caracteres.",
    create_user_failed: "No se pudo crear el usuario. No quedó ninguna cuenta a medias; inténtalo de nuevo.",
    recovery_disabled: "Falta configurar RECOVERY_URL en el servidor.",
    last_admin: "Debe quedar al menos un administrador."
};
/** Mensaje claro para un error del servidor (usa el codigo y, si no se conoce, el texto del servidor). */
export function userErrorMessage(e: unknown): string {
    const err = e as { code?: unknown; type?: unknown; message?: string; status?: number };
    const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? (err.type as string) : "";
    if (MESSAGES[code]) return MESSAGES[code];
    if (err?.status === 401 || err?.code === 401) return "Tu sesión expiró. Inicia sesión de nuevo.";
    if (err?.status === 403 || err?.code === 403) return MESSAGES.forbidden;
    if (typeof err?.message === "string" && err.message && !/network|fetch|timeout/i.test(err.message)) return err.message;
    return "No pudimos completar la operación. Revisa tu conexión e inténtalo de nuevo.";
}
