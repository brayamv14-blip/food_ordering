import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import { appwriteConfig, callBackendFunction } from "@/lib/appwrite";
import { startDriverBroadcaster } from "@/lib/domain/driverBroadcaster";
import { getCurrentPosition } from "@/lib/services/location";
import { getMyRoles } from "@/lib/services/roles";
import { StaffOrder, changeOrderStatus, describeBackendError, listMyDeliveries } from "@/lib/services/staff.service";

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
    const stopRef = useRef<null | (() => void)>(null);

    const stopSharing = useCallback(() => {
        stopRef.current?.();
        stopRef.current = null;
        setSharingId(null);
    }, []);

    const load = useCallback(async () => {
        try {
            setError(null);
            setOrders(await listMyDeliveries());
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.driver);
            if (r.driver) load();
            else setLoading(false);
        });
    }, [load]);

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
        const fn = appwriteConfig.functions.updateDriverLocation;
        if (!fn) {
            Alert.alert("Configuración", "Falta EXPO_PUBLIC_FN_UPDATE_DRIVER_LOCATION en .env.local.");
            return;
        }
        setSharingError(null);
        setLastSent(null);
        const b = startDriverBroadcaster({
            getPosition: async () => {
                const r = await getCurrentPosition();
                if (!r.ok) {
                    // Permiso denegado/bloqueado: no tiene sentido reintentar.
                    throw Object.assign(new Error(r.message), { code: r.reason === "unavailable" ? "gps" : "forbidden" });
                }
                return r.coords;
            },
            send: async (p) => {
                await callBackendFunction(fn, { orderId, latitude: p.latitude, longitude: p.longitude });
            },
            onSent: () => setLastSent(new Date().toLocaleTimeString("es-MX")),
            onError: (e: any, fatal) => {
                setSharingError(fatal ? `Envío detenido: ${e?.message ?? "error"}` : "Sin conexión o sin señal GPS; reintentando…");
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
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">No tienes entregas activas.</Text> : null}
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

                            {o.status === "preparing" && (
                                <TouchableOpacity onPress={() => setStatus(o, "on_the_way")} disabled={busy} className="mt-3 items-center rounded-xl bg-primary py-3">
                                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Salir a reparto</Text>}
                                </TouchableOpacity>
                            )}
                            {o.status === "on_the_way" && (
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
