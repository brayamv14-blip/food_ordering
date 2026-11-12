import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import LeafletMap from "@/components/LeafletMap";
import { FRESHNESS_LABEL, describeAge, locationFreshness } from "@/lib/domain/coordinates";
import { MapData, MapMarker } from "@/lib/domain/geo";
import { DRIVER_STATUS_COLOR, DRIVER_STATUS_LABEL, DriversMap, describeBackendError, getDriversMap } from "@/lib/services/staff.service";

/** Cada cuanto se consulta el servidor (sondeo; NO es tiempo real de Appwrite Realtime). */
export const ADMIN_MAP_POLL_MS = 15000;

/**
 * Mapa operativo (personal/admin): restaurante, pedidos activos, pedidos sin asignar y
 * repartidores con su ultima ubicacion conocida. Se actualiza solo por sondeo cada 15 s
 * mientras la pantalla esta abierta; muestra la hora de la ultima consulta.
 */
const AdminMap = () => {
    const allowed = useRoleGate("staff");
    const [map, setMap] = useState<DriversMap | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
        try {
            setMap(await getDriversMap());
            setError(null);
        } catch (e) {
            // Se conserva el ultimo dato y se avisa que esta desactualizado.
            setError(`${describeBackendError(e)} Mostrando la última información recibida.`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!allowed) return;
        load();
        timer.current = setInterval(load, ADMIN_MAP_POLL_MS);
        return () => { if (timer.current) clearInterval(timer.current); };
    }, [allowed, load]);

    // Ubicacion de cada repartidor = la del pedido activo que lleva (el backend solo la guarda por pedido).
    const driverPoints = (map?.orders ?? []).filter((o) => o.driverUserId && typeof o.driverLatitude === "number" && typeof o.driverLongitude === "number");
    const data: MapData = (() => {
        const markers: MapMarker[] = [];
        if (map?.restaurant) markers.push({ id: "rest", kind: "restaurant", position: map.restaurant, label: "Restaurante" });
        for (const o of [...(map?.orders ?? []), ...(map?.unassigned ?? [])]) {
            if (typeof o.deliveryLatitude === "number" && typeof o.deliveryLongitude === "number" && (!selected || selected === o.id || selected === o.driverUserId)) {
                markers.push({ id: `d-${o.id}`, kind: "destination", position: { latitude: o.deliveryLatitude, longitude: o.deliveryLongitude }, label: `#${o.id.slice(-6)}${o.driverUserId ? "" : " (sin asignar)"}` });
            }
        }
        for (const o of driverPoints) {
            if (selected && selected !== o.id && selected !== o.driverUserId) continue;
            const name = map?.drivers.find((d) => d.id === o.driverUserId)?.name ?? "Repartidor";
            markers.push({ id: `r-${o.id}`, kind: "driver", position: { latitude: o.driverLatitude as number, longitude: o.driverLongitude as number }, label: name });
        }
        return { markers, route: [] };
    })();

    return (
        <AdminShell title="Mapa operativo" allowed={allowed} loading={loading} error={error} needsAdminApi={false}>
            <View className="mx-5 mb-2">
                <Text className="text-xs text-gray-500">
                    Se actualiza solo cada {ADMIN_MAP_POLL_MS / 1000} s (sondeo). Última consulta: {map ? new Date(map.at).toLocaleTimeString("es-MX") : "—"}
                </Text>
            </View>
            <View style={{ height: 300 }} className="mx-5 overflow-hidden rounded-2xl">
                <LeafletMap data={data} />
            </View>
            <FlatList
                className="mt-3"
                data={map?.drivers ?? []}
                keyExtractor={(d) => d.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 30 }}
                ListHeaderComponent={<Text className="mb-2 text-sm text-gray-500">Sin asignar: {map?.unassigned.length ?? 0} · Activos: {map?.orders.length ?? 0}</Text>}
                ListEmptyComponent={<Text className="text-gray-400">No hay repartidores registrados.</Text>}
                renderItem={({ item: d }) => {
                    const o = driverPoints.find((x) => x.driverUserId === d.id);
                    const fresh = o ? locationFreshness(o.driverUpdatedAt, true) : null;
                    const status = d.status ?? "offline";
                    return (
                        <TouchableOpacity onPress={() => setSelected(selected === d.id ? null : d.id)} className={`mb-2 rounded-2xl border p-3 ${selected === d.id ? "border-primary" : "border-gray-100"}`} accessibilityRole="button">
                            <View className="flex-row justify-between">
                                <Text className="font-semibold text-dark-100">{d.name}</Text>
                                <Text style={{ color: DRIVER_STATUS_COLOR[status] }} className="text-xs font-semibold">{DRIVER_STATUS_LABEL[status]}</Text>
                            </View>
                            <Text className="mt-1 text-xs text-gray-500">
                                {o ? `${fresh ? FRESHNESS_LABEL[fresh] : ""}${describeAge(o.driverUpdatedAt) ? ` (${describeAge(o.driverUpdatedAt)})` : ""}` : "Sin ubicación compartida"} · {d.activeOrders ?? 0} activo(s)
                            </Text>
                        </TouchableOpacity>
                    );
                }}
            />
        </AdminShell>
    );
};

export default AdminMap;
