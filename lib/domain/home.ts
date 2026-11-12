/** Utilidades puras de la pantalla principal (sin dependencias de React Native). */

export const ACTIVE_ORDER_STATUSES = ["pending", "confirmed", "preparing", "ready", "picked_up", "on_the_way", "delivery_failed"] as const;

/** Saludo segun la hora local (0-23). */
export function greetingFor(hour: number): string {
    if (hour >= 5 && hour < 12) return "Buenos días";
    if (hour >= 12 && hour < 19) return "Buenas tardes";
    return "Buenas noches";
}

/** Primer nombre para el saludo; vacio si no hay nombre. */
export function firstName(name: unknown): string {
    const n = typeof name === "string" ? name.trim() : "";
    return n ? n.split(/\s+/)[0] : "";
}

type IconName = "pizza-outline" | "fast-food-outline" | "restaurant-outline" | "cafe-outline" | "ice-cream-outline" | "nutrition-outline" | "beer-outline" | "fish-outline" | "grid-outline";

/** Icono decorativo por palabra clave del nombre de la categoria (el nombre siempre viene de Appwrite). */
export function categoryIcon(name: string): IconName {
    const n = (name ?? "").toLowerCase();
    if (/pizza/.test(n)) return "pizza-outline";
    if (/burger|hamburg|sandwich|hot ?dog/.test(n)) return "fast-food-outline";
    if (/bebida|drink|refresco|jugo|soda/.test(n)) return "beer-outline";
    if (/caf[eé]|coffee/.test(n)) return "cafe-outline";
    if (/postre|dessert|helado|dulce/.test(n)) return "ice-cream-outline";
    if (/ensalada|salad|fruta|vegan|veget/.test(n)) return "nutrition-outline";
    if (/sushi|pescado|mariscos|fish/.test(n)) return "fish-outline";
    if (/burrito|taco|mex|wrap|pasta|plato|comida/.test(n)) return "restaurant-outline";
    return "grid-outline";
}

interface HasAvail { available?: boolean; $createdAt?: string }

/** Productos mas recientes y disponibles (los agotados quedan al final). */
export function pickNewest<T extends HasAvail>(items: T[], n: number): T[] {
    const ts = (x: T) => Date.parse(x.$createdAt ?? "") || 0;
    return [...items]
        .sort((a, b) => Number(b.available !== false) - Number(a.available !== false) || ts(b) - ts(a))
        .slice(0, Math.max(0, n));
}

/** Filtra productos por texto (nombre/descripcion), sin distinguir mayusculas ni acentos. */
export function filterProducts<T extends { name?: string; description?: string }>(items: T[], query: string): T[] {
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const q = norm(query.trim());
    if (!q) return items;
    return items.filter((i) => norm(`${i.name ?? ""} ${i.description ?? ""}`).includes(q));
}

/**
 * Pantalla de aterrizaje tras iniciar sesion segun el rol (solo comodidad; la autorizacion real esta en el servidor).
 * Admin -> panel de control; personal -> pedidos; repartidor (sin ser personal) -> sus entregas; cliente -> inicio.
 */
export function landingRouteFor(roles: { admin: boolean; staff: boolean; driver: boolean }): string | null {
    if (roles.admin) return "/admin/dashboard";
    if (roles.staff) return "/admin";
    if (roles.driver) return "/driver";
    return null;
}
