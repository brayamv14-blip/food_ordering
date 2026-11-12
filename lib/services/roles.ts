import { account } from "@/lib/appwrite";

export interface Roles {
    /** Personal del restaurante (incluye a los administradores). */
    staff: boolean;
    driver: boolean;
    /** Administrador: ademas gestiona productos, precios y roles. */
    admin: boolean;
}

/**
 * Roles segun las etiquetas (labels) de la cuenta de Appwrite.
 * SOLO sirve para decidir que pantallas mostrar: la autorizacion real se
 * comprueba en las Appwrite Functions.
 */
export const rolesFromLabels = (labels: unknown): Roles => {
    const list = Array.isArray(labels) ? labels : [];
    const admin = list.includes("admin");
    return { staff: admin || list.includes("staff"), driver: list.includes("driver"), admin };
};

export async function getMyRoles(): Promise<Roles> {
    try {
        const me = await account.get();
        return rolesFromLabels((me as { labels?: unknown }).labels);
    } catch {
        return { staff: false, driver: false, admin: false };
    }
}
