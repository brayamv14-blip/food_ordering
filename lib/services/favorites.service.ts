import { account } from "@/lib/appwrite";
import { MAX_FAVORITES, parseFavorites, toggleFavorite } from "@/lib/domain/favorites";

/**
 * Favoritos en las preferencias de la cuenta de Appwrite (se sincronizan entre dispositivos y no necesitan tabla).
 * `updatePrefs` reemplaza el objeto completo, por eso se lee primero y se conservan las demas preferencias.
 */
export async function loadFavorites(): Promise<string[]> {
    try {
        return parseFavorites(await account.getPrefs());
    } catch {
        return [];
    }
}

export async function setFavorite(menuId: string, on: boolean): Promise<string[]> {
    const prefs = (await account.getPrefs()) as Record<string, unknown>;
    const current = parseFavorites(prefs);
    const has = current.includes(menuId);
    const next = on === has ? current : toggleFavorite(current, menuId);
    if (next === current) return current;
    await account.updatePrefs({ prefs: { ...prefs, favorites: JSON.stringify(next.slice(0, MAX_FAVORITES)) } });
    return next;
}
