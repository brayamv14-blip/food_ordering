import { useEffect, useState } from "react";
import { Alert, FlatList, Text, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import { DriverApplication, listDriverApplications, reviewDriver } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

/** V16: solicitudes de repartidor pendientes. Aprobar da la etiqueta `driver` y la tienda; rechazar la elimina. El servidor valida la tienda del administrador. */
const DriverApplications = () => {
    const allowed = useRoleGate("admin");
    const [items, setItems] = useState<DriverApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (!allowed) return;
        let alive = true;
        listDriverApplications()
            .then((l) => { if (alive) { setItems(l); setError(null); } })
            .catch((e) => { if (alive) setError(describeBackendError(e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [allowed, reload]);

    const decide = (a: DriverApplication, approve: boolean) =>
        Alert.alert(approve ? "Aprobar repartidor" : "Rechazar solicitud", `${a.name}`, [
            { text: "Cancelar", style: "cancel" },
            { text: approve ? "Aprobar" : "Rechazar", style: approve ? "default" : "destructive", onPress: async () => {
                setBusy(a.id);
                try { await reviewDriver(a.id, approve); setReload((n) => n + 1); } catch (e) { Alert.alert("No se pudo completar", describeBackendError(e)); } finally { setBusy(null); }
            } }
        ]);

    return (
        <AdminShell title="Solicitudes de repartidor" allowed={allowed} loading={loading} error={error}>
            <FlatList
                data={items}
                keyExtractor={(a) => a.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-8 text-center text-gray-400">No hay solicitudes pendientes.</Text>}
                renderItem={({ item: a }) => (
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4">
                        <Text className="font-bold text-dark-100">{a.name}</Text>
                        <Text className="text-sm text-gray-500">{a.email ?? "sin correo"} · tienda {a.storeId}</Text>
                        <Text className="mt-1 text-sm text-dark-100">Tel. {a.phone ?? "—"} · {a.vehicle ?? "—"}</Text>
                        {!!a.note && <Text className="mt-1 text-sm text-gray-500">“{a.note}”</Text>}
                        <View className="mt-3 flex-row">
                            <TouchableOpacity disabled={busy === a.id} onPress={() => decide(a, true)} className="mr-2 flex-1 items-center rounded-xl bg-primary py-3" accessibilityRole="button"><Text className="font-bold text-white">Aprobar</Text></TouchableOpacity>
                            <TouchableOpacity disabled={busy === a.id} onPress={() => decide(a, false)} className="flex-1 items-center rounded-xl border border-red-300 py-3" accessibilityRole="button"><Text className="font-bold text-red-500">Rechazar</Text></TouchableOpacity>
                        </View>
                    </View>
                )}
            />
        </AdminShell>
    );
};

export default DriverApplications;
