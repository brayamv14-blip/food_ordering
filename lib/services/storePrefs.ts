import { account } from "@/lib/appwrite";

/**
 * v16: persistencia de la tienda elegida por el cliente en las preferencias de su cuenta de Appwrite
 * (no requiere paquetes nuevos). Es "mejor esfuerzo": si falla (sin sesion, sin red) la app sigue funcionando
 * y simplemente vuelve a la tienda por defecto.
 */
const KEY = "selectedStore";

export type SavedStore = { id: string; name: string };

export async function loadSavedStore(): Promise<SavedStore | null> {
    try {
        const prefs = (await account.getPrefs()) as Record<string, unknown>;
        const v = prefs?.[KEY] as Partial<SavedStore> | undefined;
        return v && typeof v.id === "string" && v.id && typeof v.name === "string" ? { id: v.id, name: v.name } : null;
    } catch {
        return null;
    }
}

export async function saveSelectedStore(store: SavedStore): Promise<void> {
    try {
        // updatePrefs reemplaza el objeto completo: se lee y se fusiona para no perder otras preferencias.
        const prefs = ((await account.getPrefs()) as Record<string, unknown>) ?? {};
        if ((prefs[KEY] as Partial<SavedStore> | undefined)?.id === store.id) return;
        await account.updatePrefs({ prefs: { ...prefs, [KEY]: store } });
    } catch {
        /* mejor esfuerzo */
    }
}
