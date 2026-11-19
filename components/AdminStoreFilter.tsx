import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import { AdminStore, isAdminApiConfigured, listAdminStores } from "@/lib/services/admin.service";
import { getMyScope } from "@/lib/services/roles";

/**
 * v16: filtro de tienda para el superadministrador. Un administrador de tienda no lo ve (el servidor ya lo limita a la suya).
 * `value` = "" significa "todas las tiendas".
 */
export function useAdminStoreFilter() {
    const [isGlobal, setIsGlobal] = useState(false);
    const [stores, setStores] = useState<AdminStore[]>([]);
    const [storeId, setStoreId] = useState("");

    useEffect(() => {
        let alive = true;
        (async () => {
            const scope = await getMyScope();
            if (!alive || !scope.global || !isAdminApiConfigured()) return;
            try {
                const r = await listAdminStores();
                if (!alive || !r.enabled) return;
                setStores(r.stores);
                setIsGlobal(true);
            } catch {
                /* sin multitienda o sin red: no hay filtro */
            }
        })();
        return () => { alive = false; };
    }, []);

    return { isGlobal, stores, storeId, setStoreId };
}

const AdminStoreFilter = ({ stores, value, onChange, allLabel = "Todas" }: { stores: AdminStore[]; value: string; onChange: (id: string) => void; allLabel?: string }) => {
    if (stores.length === 0) return null;
    return (
        <View className="mb-3">
            <Text className="mb-1 text-xs text-gray-400">Tienda</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[{ id: "", name: allLabel }, ...stores].map((s) => (
                    <TouchableOpacity key={s.id || "all"} onPress={() => onChange(s.id)} className={`mr-2 rounded-full border px-4 py-2 ${value === s.id ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: value === s.id }}>
                        <Text className={value === s.id ? "font-bold text-white" : "text-dark-100"}>{s.name}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
};

export default AdminStoreFilter;
