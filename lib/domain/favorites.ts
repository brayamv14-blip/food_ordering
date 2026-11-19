export const MAX_FAVORITES = 50;

/** Lee la lista guardada en las preferencias de la cuenta; ignora cualquier valor que no sea una lista de ids. */
export function parseFavorites(prefs: unknown): string[] {
    const raw = prefs && typeof prefs === "object" ? (prefs as Record<string, unknown>).favorites : undefined;
    let list: unknown = raw;
    if (typeof raw === "string") {
        try { list = JSON.parse(raw); } catch { list = []; }
    }
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_.-]{1,36}$/.test(x)))].slice(0, MAX_FAVORITES);
}

/** Agrega o quita un id (los mas nuevos primero) respetando el maximo. */
export function toggleFavorite(list: string[], id: string): string[] {
    if (list.includes(id)) return list.filter((x) => x !== id);
    return [id, ...list].slice(0, MAX_FAVORITES);
}
