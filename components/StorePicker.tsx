import { useEffect, useState } from "react";
import { Alert, FlatList, Modal, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { PublicStore, listStores } from "@/lib/services/store.service";
import { loadSavedStore, saveSelectedStore } from "@/lib/services/storePrefs";
import { useCartStore } from "@/store/cart.store";
import useStoreSelection from "@/store/store.store";

/**
 * Selector de tienda del cliente. Solo aparece si el servidor tiene multitienda y hay mas de una tienda activa.
 * Cambiar de tienda vacia el carrito (los productos y el inventario son de cada tienda).
 */
const StorePicker = ({ onChanged }: { onChanged?: () => void }) => {
    const { enabled, storeId, storeName, setEnabled, select } = useStoreSelection();
    const items = useCartStore((s) => s.items);
    const clearCart = useCartStore((s) => s.clearCart);
    const [stores, setStores] = useState<PublicStore[]>([]);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let alive = true;
        listStores().then(async (r) => {
            if (!alive) return;
            setEnabled(r.enabled);
            setStores(r.stores);
            const current = useStoreSelection.getState().storeId;
            const still = r.stores.find((s) => s.id === current);
            if (r.enabled && !still && r.stores.length > 0) {
                // v16: primero la tienda guardada en la cuenta (si sigue activa); si no, la de por defecto.
                const saved = await loadSavedStore();
                if (!alive) return;
                const savedStore = saved ? r.stores.find((s) => s.id === saved.id) : undefined;
                const first = savedStore ?? r.stores.find((s) => s.id === r.defaultStoreId) ?? r.stores[0];
                select(first.id, first.name);
                onChanged?.();
            }
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!enabled || stores.length === 0) return null;

    const choose = (s: PublicStore) => {
        if (s.id === storeId) { setOpen(false); return; }
        const apply = () => { if (items.length > 0) clearCart(); select(s.id, s.name); void saveSelectedStore({ id: s.id, name: s.name }); setOpen(false); onChanged?.(); };
        if (items.length === 0) return apply();
        Alert.alert("Cambiar de tienda", "Tu carrito se vaciará porque los productos son de cada tienda. ¿Continuar?", [
            { text: "No", style: "cancel" },
            { text: "Sí, cambiar", style: "destructive", onPress: apply }
        ]);
    };

    return (
        <>
            <TouchableOpacity onPress={() => setOpen(true)} className="mx-5 mt-4 flex-row items-center rounded-2xl border border-gray-200 px-4 py-3" accessibilityRole="button" accessibilityLabel="Cambiar de tienda">
                <Ionicons name="storefront-outline" size={20} color="#FE8C00" />
                <Text className="ml-2 flex-1 font-bold text-dark-100" numberOfLines={1}>{storeName ?? "Elige una tienda"}</Text>
                <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
            </TouchableOpacity>
            <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
                <View className="flex-1 justify-end bg-black/40">
                    <View className="max-h-[75%] rounded-t-3xl bg-white p-5">
                        <Text className="mb-3 text-lg font-bold text-dark-100">Elige tu tienda</Text>
                        <FlatList
                            data={stores}
                            keyExtractor={(s) => s.id}
                            renderItem={({ item: s }) => (
                                <TouchableOpacity onPress={() => choose(s)} className={`mb-2 rounded-2xl border p-4 ${s.id === storeId ? "border-primary" : "border-gray-100"}`} accessibilityRole="button" accessibilityState={{ selected: s.id === storeId }}>
                                    <View className="flex-row items-center justify-between">
                                        <Text className="flex-1 font-bold text-dark-100">{s.name}</Text>
                                        {typeof s.open === "boolean" && <Text className={s.open ? "text-green-600" : "text-red-500"}>{s.open ? "Abierta" : "Cerrada"}</Text>}
                                    </View>
                                    {!!s.address && <Text className="mt-1 text-sm text-gray-500">{s.address}</Text>}
                                    {!!s.hours && <Text className="text-xs text-gray-400">Horario: {s.hours}</Text>}
                                </TouchableOpacity>
                            )}
                        />
                        <TouchableOpacity onPress={() => setOpen(false)} className="mt-2 items-center rounded-xl bg-gray-100 py-3"><Text className="font-bold text-dark-100">Cerrar</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </>
    );
};

export default StorePicker;
