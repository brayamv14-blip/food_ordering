import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import { AdminCategory, deleteCategory, listCategories, saveCategory, setCategoryActive } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

/** CRUD de categorias (solo admin). El servidor valida nombre y bloquea borrar categorias en uso. */
const Categories = () => {
    const allowed = useRoleGate("admin");
    const [items, setItems] = useState<AdminCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setError(null);
            setItems(await listCategories());
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { if (allowed) load(); }, [allowed, load]);

    const reset = () => { setEditing(null); setName(""); setDescription(""); };

    const save = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await saveCategory({ name: name.trim(), description: description.trim() }, editing ?? undefined);
            reset();
            await load();
        } catch (e) {
            Alert.alert("No se pudo guardar", describeBackendError(e));
        } finally {
            setBusy(false);
        }
    };

    const remove = (c: AdminCategory) =>
        Alert.alert("Eliminar categoría", `¿Eliminar “${c.name}”? Si tiene productos, el servidor lo rechazará.`, [
            { text: "No", style: "cancel" },
            { text: "Eliminar", style: "destructive", onPress: async () => {
                try { await deleteCategory(c.id); await load(); } catch (e) { Alert.alert("No se pudo eliminar", describeBackendError(e)); }
            } }
        ]);

    return (
        <AdminShell title="Categorías" allowed={allowed} loading={loading} error={error}>
            <View className="mx-5 mb-3 rounded-2xl border border-gray-100 p-3">
                <TextInput value={name} onChangeText={setName} placeholder="Nombre" maxLength={60} className="mb-2 rounded-xl border border-gray-200 px-3 py-2" />
                <TextInput value={description} onChangeText={setDescription} placeholder="Descripción (opcional)" maxLength={200} className="mb-2 rounded-xl border border-gray-200 px-3 py-2" />
                <View className="flex-row">
                    <TouchableOpacity onPress={save} disabled={busy || name.trim().length < 2} className={`mr-2 flex-1 items-center rounded-xl py-3 ${busy || name.trim().length < 2 ? "bg-gray-300" : "bg-primary"}`} accessibilityRole="button">
                        <Text className="font-bold text-white">{editing ? "Guardar cambios" : "Crear categoría"}</Text>
                    </TouchableOpacity>
                    {editing && <TouchableOpacity onPress={reset} className="items-center justify-center rounded-xl border border-gray-300 px-4"><Text>Cancelar</Text></TouchableOpacity>}
                </View>
            </View>
            <FlatList
                data={items}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-6 text-center text-gray-400">Sin categorías.</Text>}
                renderItem={({ item: c }) => (
                    <View className="mb-2 rounded-2xl border border-gray-100 bg-white p-3">
                        <View className="flex-row items-center justify-between">
                            <View className="flex-1 pr-2">
                                <Text className="font-semibold text-dark-100">{c.name}</Text>
                                {!!c.description && <Text className="text-xs text-gray-500">{c.description}</Text>}
                            </View>
                            <Switch value={c.active !== false} onValueChange={async (v) => {
                                try { await setCategoryActive(c.id, v); await load(); } catch (e) { Alert.alert("No se pudo cambiar", describeBackendError(e)); }
                            }} accessibilityLabel={`Activa: ${c.name}`} />
                        </View>
                        <View className="mt-2 flex-row">
                            <TouchableOpacity onPress={() => { setEditing(c.id); setName(c.name); setDescription(c.description ?? ""); }} className="mr-4"><Text className="font-semibold text-primary">Editar</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => remove(c)}><Text className="font-semibold text-red-500">Eliminar</Text></TouchableOpacity>
                        </View>
                    </View>
                )}
            />
        </AdminShell>
    );
};

export default Categories;
