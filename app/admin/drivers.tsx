import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { setUserActive } from "@/lib/services/admin.service";
import { DRIVER_STATUS_COLOR, DRIVER_STATUS_LABEL, DriverOption, StaffOrder, describeBackendError, getDriverHistory, listDrivers } from "@/lib/services/staff.service";
import { describeAge } from "@/lib/domain/coordinates";

/** Gestion de repartidores: estado, ultima conexion, pedidos activos, historial y desempeño. */
const Drivers = () => {
    const allowed = useRoleGate("staff");
    const [drivers, setDrivers] = useState<DriverOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [hist, setHist] = useState<{ stats: { delivered: number; failed: number; cancelled: number; active: number }; orders: StaffOrder[] } | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);

    const load = useCallback(async () => {
        try {
            setError(null);
            setDrivers(await listDrivers());
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (allowed) {
            load();
            import("@/lib/services/roles").then((m) => m.getMyRoles()).then((r) => setIsAdmin(r.admin)).catch(() => {});
        }
    }, [allowed, load]);

    const toggle = async (id: string) => {
        if (open === id) { setOpen(null); return; }
        setOpen(id);
        setHist(null);
        try {
            setHist(await getDriverHistory(id));
        } catch (e) {
            Alert.alert("No se pudo cargar", describeBackendError(e));
        }
    };

    const setActive = (d: DriverOption, active: boolean) =>
        Alert.alert(active ? "Reactivar cuenta" : "Desactivar cuenta", `${active ? "Reactivar" : "Desactivar"} a ${d.name}?`, [
            { text: "No", style: "cancel" },
            { text: "Sí", style: active ? "default" : "destructive", onPress: async () => {
                try { await setUserActive(d.id, active); await load(); } catch (e) { Alert.alert("No se pudo cambiar", describeBackendError(e)); }
            } }
        ]);

    return (
        <AdminShell title="Repartidores" allowed={allowed} loading={loading} error={error} needsAdminApi={false}>
            <FlatList
                data={drivers}
                keyExtractor={(d) => d.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-10 text-center text-gray-400">No hay cuentas con la etiqueta “driver”.</Text>}
                renderItem={({ item: d }) => {
                    const st = d.status ?? "offline";
                    return (
                        <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4">
                            <TouchableOpacity onPress={() => toggle(d.id)} accessibilityRole="button">
                                <View className="flex-row justify-between">
                                    <Text className="text-base font-bold text-dark-100">{d.name}</Text>
                                    <Text style={{ color: DRIVER_STATUS_COLOR[st] }} className="text-xs font-semibold">{DRIVER_STATUS_LABEL[st]}</Text>
                                </View>
                                <Text className="mt-1 text-xs text-gray-500">
                                    Última señal: {d.lastSeenAt ? describeAge(d.lastSeenAt) ?? new Date(d.lastSeenAt).toLocaleString("es-MX") : "nunca"}{d.connected === false && d.lastSeenAt ? " (sin conexión reciente)" : ""} · {d.activeOrders ?? 0} activo(s), {d.inTransit ?? 0} en camino
                                </Text>
                                {d.userActive === false && <Text className="mt-1 text-xs text-red-500">Cuenta desactivada</Text>}
                            </TouchableOpacity>
                            {open === d.id && (
                                <View className="mt-3">
                                    {!hist ? <Text className="text-gray-400">Cargando historial…</Text> : (
                                        <>
                                            <Text className="text-sm text-dark-100">Entregados {hist.stats.delivered} · Fallidos {hist.stats.failed} · Cancelados {hist.stats.cancelled} · Activos {hist.stats.active}</Text>
                                            {hist.orders.slice(0, 10).map((o) => (
                                                <View key={o.id} className="mt-2 flex-row items-center justify-between">
                                                    <Text className="text-xs text-gray-500">#{o.id.slice(-6)} · {new Date(o.createdAt).toLocaleDateString("es-MX")}</Text>
                                                    <OrderStatusBadge status={o.status} />
                                                </View>
                                            ))}
                                            {hist.orders.length === 0 && <Text className="mt-2 text-xs text-gray-400">Sin pedidos asignados.</Text>}
                                        </>
                                    )}
                                    {isAdmin && (
                                        <TouchableOpacity onPress={() => setActive(d, d.userActive === false)} className="mt-3 items-center rounded-xl border border-gray-300 py-2" accessibilityRole="button">
                                            <Text className="font-semibold text-dark-100">{d.userActive === false ? "Reactivar cuenta" : "Desactivar cuenta"}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            )}
                        </View>
                    );
                }}
            />
        </AdminShell>
    );
};

export default Drivers;
