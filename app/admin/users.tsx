import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { AdminUser, isAdminApiConfigured, listUsers, setUserRoles } from "@/lib/services/admin.service";
import { getMyRoles } from "@/lib/services/roles";
import { describeBackendError } from "@/lib/services/staff.service";

const ROLES = [{ key: "admin", label: "Administrador" }, { key: "staff", label: "Personal" }, { key: "driver", label: "Repartidor" }];

/** Solo administradores. Cada cambio se confirma y el servidor vuelve a validar permisos, roles y "ultimo admin". */
const UsersAdmin = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (q = "") => {
        try {
            setError(null);
            setUsers(await listUsers(q));
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.admin);
            if (r.admin && isAdminApiConfigured()) load();
            else setLoading(false);
        });
    }, [load]);

    const change = (u: AdminUser, role: string) => {
        const has = u.labels.includes(role);
        const next = has ? u.labels.filter((l) => l !== role) : [...u.labels, role];
        Alert.alert(has ? "Quitar rol" : "Dar rol", `${has ? "Quitar" : "Dar"} “${ROLES.find((r) => r.key === role)?.label}” a ${u.name}?`, [
            { text: "No", style: "cancel" },
            {
                text: "Sí", style: has ? "destructive" : "default",
                onPress: async () => {
                    setBusy(u.id);
                    try {
                        const labels = await setUserRoles(u.id, next);
                        setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, labels } : x)));
                    } catch (e) {
                        Alert.alert("No se pudo cambiar", describeBackendError(e));
                    } finally {
                        setBusy(null);
                    }
                }
            }
        ]);
    };

    if (allowed === null || loading) return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    if (!allowed) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Solo los administradores pueden gestionar usuarios.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3"><Text className="font-bold text-white">Volver</Text></TouchableOpacity>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-3 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="text-2xl font-bold text-dark-100">Usuarios y roles</Text>
            </View>
            <View className="mx-5 mb-2 flex-row items-center rounded-2xl border border-gray-200 px-3">
                <Ionicons name="search" size={18} color="#9CA3AF" />
                <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => load(search)} returnKeyType="search" placeholder="Buscar por nombre" className="ml-2 flex-1 py-2 text-dark-100" />
            </View>
            {error && <Text className="mx-5 mb-2 text-sm text-red-500">{error}</Text>}
            <FlatList
                data={users}
                keyExtractor={(u) => u.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">Sin resultados.</Text> : null}
                renderItem={({ item: u }) => (
                    <View className="mb-3 rounded-2xl border border-gray-100 p-4">
                        <Text className="text-base font-bold text-dark-100">{u.name}</Text>
                        {u.email && <Text className="text-sm text-gray-500">{u.email}</Text>}
                        <View className="mt-3 flex-row flex-wrap">
                            {ROLES.map((r) => {
                                const on = u.labels.includes(r.key);
                                return (
                                    <TouchableOpacity key={r.key} disabled={busy === u.id} onPress={() => change(u, r.key)} className={`mb-1 mr-2 rounded-full border px-3 py-1 ${on ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: on }}>
                                        <Text className={on ? "text-white" : "text-dark-100"}>{r.label}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>
                )}
            />
        </View>
    );
};

export default UsersAdmin;
