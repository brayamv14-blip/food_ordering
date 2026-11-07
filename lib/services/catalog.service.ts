import { Query } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/lib/appwrite";

/**
 * Devuelve los nombres de los productos del carrito que ya no se pueden pedir
 * (agotados o eliminados del catalogo). Si la consulta falla devuelve `null`:
 * no se bloquea al cliente, porque el servidor valida igualmente al crear el pedido.
 */
export async function findUnavailableItems(
    items: { id: string; name: string }[]
): Promise<string[] | null> {
    const ids = [...new Set(items.map((i) => i.id))];
    if (ids.length === 0) return [];
    try {
        const res = await databases.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.menuCollectionId,
            queries: [Query.equal("$id", ids), Query.limit(100)]
        });
        const rows = new Map(res.rows.map((r) => [r.$id, r as unknown as { available?: boolean }]));
        return items
            .filter((i) => {
                const row = rows.get(i.id);
                return !row || row.available === false;
            })
            .map((i) => i.name);
    } catch {
        return null;
    }
}
