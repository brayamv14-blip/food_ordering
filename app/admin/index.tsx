import { useCallback, useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Modal,
    RefreshControl,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import {
    DATE_PRESETS,
    DatePreset,
    dateRangeFor,
    isOrderQueryTooShort,
    normalizeOrderQuery
} from "@/lib/domain/orderFilters";
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
    OrderEvent,
    StaffOrder,
    assignDriver,
    changeOrderStatus,
    describeBackendError,
    getOrderHistory,
    isStaleOrderError,
    listDrivers,
    listStaffOrders
} from "@/lib/services/staff.service";

const EVENT_LABELS: Record<string, string> = {
    created: "Pedido creado",
    status: "Cambio de estado",
    driver_assigned: "Repartidor asignado"
};
const ROLE_LABELS: Record<string, string> = { customer: "cliente", staff: "personal", driver: "repartidor" };

/**
 * Panel de administracion. Mostrarlo depende de la etiqueta `staff`, pero la
 * autorizacion real la hace la Appwrite Function: un cliente que llegue aqui
 * recibe 403 en cada operacion. Cada accion envia lo que el empleado vio para que
 * el servidor rechace el cambio si otra persona ya modifico el pedido.
 */
const AdminOrders = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
    const [preset, setPreset] = useState<DatePreset>("all");
    const [search, setSearch] = useState("");
    const [orders, setOrders] = useState<StaffOrder[]>([]);
    const [drivers, setDrivers] = useState<DriverOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pickFor, setPickFor] = useState<StaffOrder | null>(null);
    const [history, setHistory] = useState<{ order: StaffOrder; events: OrderEvent[] | null; enabled: boolean; error?: string } | null>(null);
    // Evita que una respuesta lenta pise a otra mas reciente.
    const requestSeq = useRef(0);

    const load = useCallback(async (filters: { status?: OrderStatus; preset: DatePreset; search: string }) => {
        const seq = ++requestSeq.current;
        try {
            setError(null);
            const [list, drv] = await Promise.all([
                listStaffOrders({ status: filters.status, ...dateRangeFor(filters.preset), query: normalizeOrderQuery(filters.search) }),
                listDrivers()
            ]);
            if (seq !== requestSeq.current) return;
            setOrders(list);
            setDrivers(drv);
        } catch (e) {
            if (seq === requestSeq.current) setError(describeBackendError(e));
        } finally {
            if (seq === requestSeq.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    const reload = (next: Partial<{ status?: OrderStatus; preset: DatePreset; search: string }> = {}) => {
        const filters = { status, preset, search, ...next };
        setLoading(true);
        load(filters);
    };

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.staff);
            if (r.staff) load({ preset: "all", search: "" });
            else setLoading(false);
        });
    }, [load]);

    const run = async (orderId: string, op: () => Promise<void>) => {
        if (busyId) return;
        setBusyId(orderId);
        try {
            await op();
            await load({ status, preset, search });
        } catch (e) {
            if (isStaleOrderError(e)) {
                Alert.alert("Pedido actualizado por otra persona", "El pedido cambió mientras lo veías. Se recargó la lista; revisa su estado actual antes de repetir la acción.");
                await load({ status, preset, search });
            } else {
                Alert.alert("No se pudo completar", describeBackendError(e));
            }
        } finally {
            setBusyId(null);
        }
    };

    const confirmAction = (order: StaffOrder, to: OrderStatus, label: string, destructive: boolean) => {
        const go = () => run(order.id, () => changeOrderStatus(order.id, to, { expectedStatus: order.status, expectedUpdatedAt: order.updatedAt }));
        Alert.alert(label, destructive ? "Esta acción no se puede deshacer." : `¿Confirmas “${label}” para el pedido #${order.id.slice(-6)}?`, [
            { text: "No", style: "cancel" },
            { text: "Sí", style: destructive ? "destructive" : "default", onPress: go }
        ]);
    };

    const openHistory = async (order: StaffOrder) => {
        setHistory({ order, events: null, enabled: true });
        try {
            const res = await getOrderHistory(order.id);
            setHistory({ order, events: res.events, enabled: res.enabled });
        } catch (e) {
            setHistory({ order, events: [], enabled: true, error: describeBackendError(e) });
        }
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

    const chip = (selected: boolean, label: string, onPress: () => void, key: string) => (
        <TouchableOpacity
            key={key}
            onPress={onPress}
            className={`mr-2 rounded-full border px-4 py-2 ${selected ? "border-primary bg-primary" : "border-gray-200"}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
        >
            <Text className={selected ? "font-bold text-white" : "text-dark-100"}>{label}</Text>
        </TouchableOpacity>
    );

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-3 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="text-2xl font-bold text-dark-100">Administrar pedidos</Text>
            </View>

            <View className="mx-5 mb-2 flex-row items-center rounded-2xl border border-gray-200 px-3">
                <Ionicons name="search" size={18} color="#9CA3AF" />
                <TextInput
                    value={search}
                    onChangeText={setSearch}
                    onSubmitEditing={() => !isOrderQueryTooShort(search) && reload({ search })}
                    placeholder="Buscar por ID (mín. 4 caracteres)"
                    autoCapitalize="none"
                    returnKeyType="search"
                    className="ml-2 flex-1 py-3 text-dark-100"
                    accessibilityLabel="Buscar pedido por identificador"
                />
                {search.length > 0 && (
                    <TouchableOpacity onPress={() => { setSearch(""); reload({ search: "" }); }} accessibilityLabel="Limpiar búsqueda">
                        <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                )}
            </View>
            {isOrderQueryTooShort(search) && <Text className="mx-5 mb-2 text-xs text-gray-400">Escribe al menos 4 caracteres del ID.</Text>}

            <View className="mb-2 px-5">
                <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={DATE_PRESETS}
                    keyExtractor={(p) => p.key}
                    renderItem={({ item }) => chip(preset === item.key, item.label, () => { setPreset(item.key); reload({ preset: item.key }); }, item.key)}
                />
            </View>
            <View className="mb-3 px-5">
                <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={[undefined, ...ORDER_STATUSES]}
                    keyExtractor={(s) => s ?? "all"}
                    renderItem={({ item }) => chip(status === item, item ? getStatusMeta(item).label : "Todos", () => { setStatus(item); reload({ status: item }); }, item ?? "all")}
                />
            </View>

            {error && (
                <View className="mx-5 mb-3 rounded-xl bg-red-50 p-3">
                    <Text className="text-sm text-red-500">{error}</Text>
                    <TouchableOpacity onPress={() => reload()} className="mt-2"><Text className="font-bold text-primary">Reintentar</Text></TouchableOpacity>
                </View>
            )}

            <FlatList
                data={orders}
                keyExtractor={(o) => o.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load({ status, preset, search }); }} />}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">No hay pedidos con estos filtros.</Text> : null}
                renderItem={({ item: o }) => {
                    const actions = getStaffActions(o.status, !!o.driverUserId);
                    const busy = busyId === o.id;
                    return (
                        <View className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                            <View className="flex-row items-center justify-between">
                                <Text className="text-base font-bold text-dark-100">#{o.id.slice(-6)}</Text>
                                <OrderStatusBadge status={o.status} />
                            </View>
                            <Text className="mt-1 text-xs text-gray-400">{o.createdAt ? new Date(o.createdAt).toLocaleString("es-MX") : ""}</Text>
                            <Text className="mt-2 text-sm text-dark-100">{o.customerName || "Cliente"} · {o.customerPhone || "sin teléfono"}</Text>
                            <Text className="mt-1 text-sm text-gray-400" numberOfLines={2}>{o.deliveryAddress || "Sin dirección"}</Text>
                            <Text className="mt-2 text-sm text-gray-400" numberOfLines={3}>
                                {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ") || "Sin productos"}
                            </Text>
                            <Text className="mt-2 font-bold text-primary">{formatMoney(o.total)}</Text>

                            <View className="mt-3 flex-row items-center justify-between">
                                <Text className="text-sm text-gray-400">Repartidor: <Text className="font-semibold text-dark-100">{o.driverName ?? "sin asignar"}</Text></Text>
                                <View className="flex-row">
                                    {canAssignDriverTo(o.status) && (
                                        <TouchableOpacity onPress={() => setPickFor(o)} disabled={busy} className="mr-4">
                                            <Text className="font-semibold text-primary">{o.driverUserId ? "Cambiar" : "Asignar"}</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity onPress={() => openHistory(o)} accessibilityLabel={`Ver historial del pedido ${o.id.slice(-6)}`}>
                                        <Text className="font-semibold text-gray-400">Historial</Text>
                                    </TouchableOpacity>
                                </View>
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
                                onPress={() => {
                                    const o = pickFor!;
                                    setPickFor(null);
                                    const go = () => run(o.id, () => assignDriver(o.id, d.id, { expectedStatus: o.status, expectedUpdatedAt: o.updatedAt }));
                                    // Cambiar de repartidor un pedido en curso pide confirmacion.
                                    if (o.driverUserId && o.driverUserId !== d.id) {
                                        Alert.alert("Cambiar repartidor", `El pedido pasará a ${d.name} y se descartará la ubicación del anterior.`, [
                                            { text: "No", style: "cancel" },
                                            { text: "Sí, cambiar", style: "destructive", onPress: go }
                                        ]);
                                    } else go();
                                }}
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

            <Modal visible={!!history} transparent animationType="slide" onRequestClose={() => setHistory(null)}>
                <View className="flex-1 justify-end bg-black/40">
                    <View className="max-h-[70%] rounded-t-3xl bg-white p-5 pb-10">
                        <Text className="mb-3 text-lg font-bold text-dark-100">Historial #{history?.order.id.slice(-6)}</Text>
                        {history?.events === null && <ActivityIndicator color="#FF9C01" />}
                        {history?.error && <Text className="text-sm text-red-500">{history.error}</Text>}
                        {history && history.events !== null && !history.enabled && (
                            <Text className="text-gray-400">El historial no está activado (falta ORDER_EVENTS_TABLE_ID en la Function).</Text>
                        )}
                        {history && history.enabled && history.events?.length === 0 && !history.error && (
                            <Text className="text-gray-400">Sin eventos registrados todavía.</Text>
                        )}
                        <FlatList
                            data={history?.events ?? []}
                            keyExtractor={(e, i) => `${e.at}-${i}`}
                            renderItem={({ item: e }) => (
                                <View className="border-b border-gray-100 py-3">
                                    <Text className="font-semibold text-dark-100">
                                        {EVENT_LABELS[e.type] ?? e.type}
                                        {e.type === "status" && e.to ? `: ${getStatusMeta(e.from).label} → ${getStatusMeta(e.to).label}` : ""}
                                    </Text>
                                    <Text className="text-xs text-gray-400">{new Date(e.at).toLocaleString("es-MX")} · {ROLE_LABELS[e.actorRole ?? ""] ?? "sistema"}</Text>
                                </View>
                            )}
                        />
                        <TouchableOpacity onPress={() => setHistory(null)} className="mt-4 items-center py-3">
                            <Text className="font-semibold text-gray-400">Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

export default AdminOrders;
