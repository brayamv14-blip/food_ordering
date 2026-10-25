import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    RefreshControl,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import {
    ORDER_STATUSES,
    OrderStatus,
    canAssignDriverTo,
    getStaffActions,
    getStatusMeta
} from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import { getMyRoles } from "@/lib/services/roles";
import {
    DriverOption,
    StaffOrder,
    assignDriver,
    changeOrderStatus,
    describeBackendError,
    listDrivers,
    listStaffOrders
} from "@/lib/services/staff.service";

/**
 * Panel de administracion. Mostrarlo depende de la etiqueta `staff`, pero la
 * autorizacion real la hacen las Appwrite Functions: un cliente que llegue aqui
 * recibe 403 en cada operacion.
 */
const AdminOrders = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [filter, setFilter] = useState<OrderStatus | undefined>(undefined);
    const [orders, setOrders] = useState<StaffOrder[]>([]);
    const [drivers, setDrivers] = useState<DriverOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pickFor, setPickFor] = useState<StaffOrder | null>(null);

    const load = useCallback(async (status?: OrderStatus) => {
        try {
            setError(null);
            const [list, drv] = await Promise.all([listStaffOrders(status), listDrivers()]);
            setOrders(list);
            setDrivers(drv);
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.staff);
            if (r.staff) load(undefined);
            else setLoading(false);
        });
    }, [load]);

    const applyFilter = (status?: OrderStatus) => {
        setFilter(status);
        setLoading(true);
        load(status);
    };

    const run = async (orderId: string, op: () => Promise<void>) => {
        if (busyId) return;
        setBusyId(orderId);
        try {
            await op();
            await load(filter);
        } catch (e) {
            Alert.alert("No se pudo completar", describeBackendError(e));
        } finally {
            setBusyId(null);
        }
    };

    const confirmAction = (order: StaffOrder, to: OrderStatus, label: string, destructive: boolean) => {
        const go = () => run(order.id, () => changeOrderStatus(order.id, to));
        if (!destructive) return go();
        Alert.alert(label, "Esta acción no se puede deshacer.", [
            { text: "No", style: "cancel" },
            { text: "Sí", style: "destructive", onPress: go }
        ]);
    };

    if (allowed === null || (loading && orders.length === 0 && !error)) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
            </View>
        );
    }

    if (!allowed) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">No tienes acceso al panel de administración.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3">
                    <Text className="font-bold text-white">Volver</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-4 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="text-2xl font-bold text-dark-100">Administrar pedidos</Text>
            </View>

            <View className="mb-3 px-5">
                <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={[undefined, ...ORDER_STATUSES]}
                    keyExtractor={(s) => s ?? "all"}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            onPress={() => applyFilter(item)}
                            className={`mr-2 rounded-full border px-4 py-2 ${filter === item ? "border-primary bg-primary" : "border-gray-200"}`}
                            accessibilityState={{ selected: filter === item }}
                        >
                            <Text className={filter === item ? "font-bold text-white" : "text-dark-100"}>
                                {item ? getStatusMeta(item).label : "Todos"}
                            </Text>
                        </TouchableOpacity>
                    )}
                />
            </View>

            {error && (
                <View className="mx-5 mb-3 rounded-xl bg-red-50 p-3">
                    <Text className="text-sm text-red-500">{error}</Text>
                </View>
            )}

            <FlatList
                data={orders}
                keyExtractor={(o) => o.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(filter); }} />}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">No hay pedidos con este filtro.</Text> : null}
                renderItem={({ item: o }) => {
                    const actions = getStaffActions(o.status, !!o.driverUserId);
                    const busy = busyId === o.id;
                    return (
                        <View className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                            <View className="flex-row items-center justify-between">
                                <Text className="text-base font-bold text-dark-100">#{o.id.slice(-6)}</Text>
                                <OrderStatusBadge status={o.status} />
                            </View>
                            <Text className="mt-2 text-sm text-dark-100">{o.customerName || "Cliente"} · {o.customerPhone || "sin teléfono"}</Text>
                            <Text className="mt-1 text-sm text-gray-400" numberOfLines={2}>{o.deliveryAddress || "Sin dirección"}</Text>
                            <Text className="mt-2 text-sm text-gray-400" numberOfLines={3}>
                                {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ") || "Sin productos"}
                            </Text>
                            <Text className="mt-2 font-bold text-primary">{formatMoney(o.total)}</Text>

                            <View className="mt-3 flex-row items-center justify-between">
                                <Text className="text-sm text-gray-400">Repartidor: <Text className="font-semibold text-dark-100">{o.driverName ?? "sin asignar"}</Text></Text>
                                {canAssignDriverTo(o.status) && (
                                    <TouchableOpacity onPress={() => setPickFor(o)} disabled={busy}>
                                        <Text className="font-semibold text-primary">{o.driverUserId ? "Cambiar" : "Asignar"}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {actions.length > 0 && (
                                <View className="mt-3">
                                    {actions.map((a) => (
                                        <View key={a.to} className="mb-2">
                                            <TouchableOpacity
                                                onPress={() => confirmAction(o, a.to, a.label, a.destructive)}
                                                disabled={busy || !!a.disabledReason}
                                                className={`items-center rounded-xl py-3 ${a.disabledReason || busy ? "bg-gray-200" : a.destructive ? "border border-red-400" : "bg-primary"}`}
                                                accessibilityRole="button"
                                            >
                                                {busy ? <ActivityIndicator color="#FFFFFF" /> : (
                                                    <Text className={a.destructive && !a.disabledReason ? "font-bold text-red-500" : "font-bold text-white"}>{a.label}</Text>
                                                )}
                                            </TouchableOpacity>
                                            {a.disabledReason && <Text className="mt-1 text-xs text-gray-400">{a.disabledReason}</Text>}
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    );
                }}
            />

            <Modal visible={!!pickFor} transparent animationType="slide" onRequestClose={() => setPickFor(null)}>
                <View className="flex-1 justify-end bg-black/40">
                    <View className="rounded-t-3xl bg-white p-5 pb-10">
                        <Text className="mb-3 text-lg font-bold text-dark-100">Asignar repartidor</Text>
                        {drivers.length === 0 && <Text className="text-gray-400">No hay cuentas con la etiqueta “driver”.</Text>}
                        {drivers.map((d) => (
                            <TouchableOpacity
                                key={d.id}
                                onPress={() => { const o = pickFor!; setPickFor(null); run(o.id, () => assignDriver(o.id, d.id)); }}
                                className="border-b border-gray-100 py-4"
                            >
                                <Text className="text-base text-dark-100">{d.name}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity onPress={() => setPickFor(null)} className="mt-4 items-center py-3">
                            <Text className="font-semibold text-gray-400">Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

export default AdminOrders;
