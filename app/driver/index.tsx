import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Linking, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import { buildNavigationUrl, getRestaurant } from "@/lib/domain/restaurant";
import { startDriverBroadcaster } from "@/lib/domain/driverBroadcaster";
import { getCurrentPosition, isPermissionFailure } from "@/lib/services/location";
import { getMyRoles } from "@/lib/services/roles";
import { StaffOrder, changeOrderStatus, describeBackendError, listMyDeliveries, sendDriverLocation } from "@/lib/services/staff.service";

/**
 * Interfaz minima de repartidor (cuenta con etiqueta `driver`).
 * - La ubicacion SOLO se comparte tras pulsar "Compartir ubicacion", con un aviso
 *   visible mientras esta activa, y solo para el pedido elegido.
 * - Se detiene sola al marcar entregado, al salir de la pantalla, si la app pasa
 *   a segundo plano o si el servidor rechaza la operacion.
 * - Funciona solo en primer plano: no hay seguimiento en segundo plano.
 */
const DriverDeliveries = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [orders, setOrders] = useState<StaffOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [lastSent, setLastSent] = useState<string | null>(null);
    const [sharingError, setSharingError] = useState<string | null>(null);
    const [tab, setTab] = useState<"active" | "history">("active");
    const stopRef = useRef<null | (() => void)>(null);
    const restaurant = getRestaurant();

    const stopSharing = useCallback(() => {
        stopRef.current?.();
        stopRef.current = null;
        setSharingId(null);
    }, []);

    const load = useCallback(async () => {
        try {
            setError(null);
            setOrders(await listMyDeliveries(tab === "history"));
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [tab]);

    // Abre la app de mapas del teléfono para navegar a un destino con coordenadas reales.
    const navigateTo = async (dest: { latitude: number; longitude: number } | null) => {
        const url = buildNavigationUrl(dest);
        if (!url) {
            Alert.alert("Navegación", "Este destino no tiene coordenadas confirmadas. Usa la dirección escrita.");
            return;
        }
        try {
            await Linking.openURL(url);
        } catch {
            Alert.alert("Navegación", "No se pudo abrir la app de mapas.");
        }
    };

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.driver);
            if (r.driver) load();
            else setLoading(false);
        });
    }, [load]);
    // (al cambiar de pestaña `load` cambia y se vuelve a consultar)

    // Sin seguimiento silencioso: al salir de la pantalla o ir a segundo plano se detiene.
    useEffect(() => {
        const sub = AppState.addEventListener("change", (s) => {
            if (s !== "active" && stopRef.current) {
                stopSharing();
                setSharingError("Se detuvo el envío de ubicación porque la app salió de primer plano.");
            }
        });
        return () => {
            sub.remove();
            stopRef.current?.();
        };
    }, [stopSharing]);

    const startSharing = (orderId: string) => {
        if (stopRef.current) return;
        setSharingError(null);
        setLastSent(null);
        const b = startDriverBroadcaster({
            getPosition: async () => {
                const r = await getCurrentPosition();
                if (!r.ok) {
                    // Permiso denegado/bloqueado: no tiene sentido reintentar. GPS apagado, senal
                    // debil o sin posicion: se reintenta en el siguiente ciclo y se avisa.
                    throw Object.assign(new Error(r.message), { code: isPermissionFailure(r.reason) ? "forbidden" : "gps" });
                }
                return r.coords;
            },
            send: async (p) => {
                await sendDriverLocation(orderId, p.latitude, p.longitude);
            },
            onSent: () => setLastSent(new Date().toLocaleTimeString("es-MX")),
            onError: (e: any, fatal) => {
                setSharingError(
                    fatal
                        ? `Envío detenido: ${e?.message ?? "error"}`
                        : e?.code === "gps"
                            ? `${e.message} Reintentando…`
                            : "Sin conexión; reintentando…"
                );
                if (fatal) {
                    stopRef.current = null;
                    setSharingId(null);
                }
            }
        });
        stopRef.current = b.stop;
        setSharingId(orderId);
    };

    const setStatus = async (o: StaffOrder, to: "on_the_way" | "delivered") => {
        if (busyId) return;
        setBusyId(o.id);
        try {
            if (to === "delivered") stopSharing();
            await changeOrderStatus(o.id, to);
            await load();
        } catch (e) {
            Alert.alert("No se pudo completar", describeBackendError(e));
        } finally {
            setBusyId(null);
        }
    };

    if (allowed === null || (loading && !error)) {
        return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    }
    if (!allowed) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Tu cuenta no tiene acceso de repartidor.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3"><Text className="font-bold text-white">Volver</Text></TouchableOpacity>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-4 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="text-2xl font-bold text-dark-100">Mis entregas</Text>
            </View>

            <View className="mx-5 mb-3 flex-row">
                {(["active", "history"] as const).map((k) => (
                    <TouchableOpacity
                        key={k}
                        onPress={() => { setLoading(true); setTab(k); }}
                        className={`mr-2 rounded-full border px-4 py-2 ${tab === k ? "border-primary bg-primary" : "border-gray-200"}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: tab === k }}
                    >
                        <Text className={tab === k ? "font-bold text-white" : "text-dark-100"}>{k === "active" ? "Activas" : "Historial"}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {sharingId && (
                <View className="mx-5 mb-3 flex-row items-center rounded-xl bg-purple-100 p-3" accessibilityLiveRegion="polite">
                    <Ionicons name="navigate" size={18} color="#8B5CF6" />
                    <Text className="ml-2 flex-1 text-sm text-dark-100">
                        Compartiendo tu ubicación del pedido #{sharingId.slice(-6)}{lastSent ? ` · último envío ${lastSent}` : ""}
                    </Text>
                </View>
            )}
            {(error || sharingError) && (
                <View className="mx-5 mb-3 rounded-xl bg-red-50 p-3"><Text className="text-sm text-red-500">{error ?? sharingError}</Text></View>
            )}

            <FlatList
                data={orders}
                keyExtractor={(o) => o.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">{tab === "history" ? "Todavía no tienes entregas terminadas." : "No tienes entregas activas."}</Text> : null}
                renderItem={({ item: o }) => {
                    const busy = busyId === o.id;
                    const sharing = sharingId === o.id;
                    return (
                        <View className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                            <View className="flex-row items-center justify-between">
                                <Text className="text-base font-bold text-dark-100">#{o.id.slice(-6)}</Text>
                                <OrderStatusBadge status={o.status} />
                            </View>
                            <Text className="mt-2 text-sm text-dark-100">{o.customerName || "Cliente"} · {o.customerPhone || "sin teléfono"}</Text>
                            <Text className="mt-1 text-sm text-gray-400">{o.deliveryAddress}</Text>
                            <Text className="mt-2 text-sm text-gray-400" numberOfLines={3}>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</Text>

                            {tab === "active" && (
                                <View className="mt-3 flex-row">
                                    {restaurant && o.status === "preparing" && (
                                        <TouchableOpacity onPress={() => navigateTo(restaurant.location)} className="mr-2 flex-row items-center rounded-xl border border-primary px-3 py-2" accessibilityRole="button" accessibilityLabel="Navegar al restaurante">
                                            <Ionicons name="storefront-outline" size={16} color="#FF9C01" />
                                            <Text className="ml-1 font-semibold text-primary">Ir al restaurante</Text>
                                        </TouchableOpacity>
                                    )}
                                    <TouchableOpacity
                                        onPress={() => navigateTo(typeof o.deliveryLatitude === "number" && typeof o.deliveryLongitude === "number" ? { latitude: o.deliveryLatitude, longitude: o.deliveryLongitude } : null)}
                                        className="flex-row items-center rounded-xl border border-primary px-3 py-2"
                                        accessibilityRole="button"
                                        accessibilityLabel="Navegar al cliente"
                                    >
                                        <Ionicons name="navigate-outline" size={16} color="#FF9C01" />
                                        <Text className="ml-1 font-semibold text-primary">Ir con el cliente</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {o.status === "preparing" && tab === "active" && (
                                <TouchableOpacity onPress={() => setStatus(o, "on_the_way")} disabled={busy} className="mt-3 items-center rounded-xl bg-primary py-3">
                                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Salir a reparto</Text>}
                                </TouchableOpacity>
                            )}
                            {o.status === "on_the_way" && tab === "active" && (
                                <>
                                    <TouchableOpacity
                                        onPress={() => (sharing ? stopSharing() : startSharing(o.id))}
                                        disabled={!!sharingId && !sharing}
                                        className={`mt-3 items-center rounded-xl py-3 ${sharing ? "bg-red-500" : sharingId ? "bg-gray-200" : "bg-primary"}`}
                                    >
                                        <Text className="font-bold text-white">{sharing ? "Dejar de compartir ubicación" : "Compartir ubicación"}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => setStatus(o, "delivered")} disabled={busy} className="mt-2 items-center rounded-xl border border-green-500 py-3">
                                        {busy ? <ActivityIndicator color="#22C55E" /> : <Text className="font-bold text-green-600">Marcar entregado</Text>}
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    );
                }}
            />
        </View>
    );
};

export default DriverDeliveries;
