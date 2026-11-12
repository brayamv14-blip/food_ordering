import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, FlatList, Linking, RefreshControl, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import OrderStatusBadge from "@/components/OrderStatusBadge";
import ReasonModal from "@/components/ReasonModal";
import { buildNavigationUrl, getRestaurant } from "@/lib/domain/restaurant";
import { startDriverBroadcaster } from "@/lib/domain/driverBroadcaster";
import { getCurrentPosition, isPermissionFailure } from "@/lib/services/location";
import { getMyRoles } from "@/lib/services/roles";
import { PoolOrder, StaffOrder, changeOrderStatus, claimOrder, describeBackendError, listAvailableOrders, listMyDeliveries, respondAssignment, sendDriverLocation, setDriverAvailability } from "@/lib/services/staff.service";

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
    const [tab, setTab] = useState<"pool" | "active" | "history">("active");
    const [pool, setPool] = useState<PoolOrder[]>([]);
    const [poolOffline, setPoolOffline] = useState(false);
    // Motivo obligatorio para rechazar una asignacion o registrar una entrega fallida.
    const [reasonFor, setReasonFor] = useState<null | { order: StaffOrder; kind: "reject" | "failed" }>(null);
    // Disponibilidad: por omision disponible; el servidor es quien la guarda.
    const [available, setAvailable] = useState(true);
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
            if (tab === "pool") {
                const r = await listAvailableOrders();
                setPool(r.orders);
                setPoolOffline(r.offline);
            } else {
                setOrders(await listMyDeliveries(tab === "history"));
            }
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

    const toggleAvailability = async () => {
        const next = !available;
        try {
            await setDriverAvailability(next);
            setAvailable(next);
        } catch (e) {
            Alert.alert("No se pudo cambiar", describeBackendError(e));
        }
    };

    // Tomar un pedido del pool: el servidor decide quien llega primero (409 si ya lo tomaron).
    const takeOrder = async (o: PoolOrder) => {
        if (busyId) return;
        setBusyId(o.id);
        try {
            await claimOrder(o.id);
            setTab("active");
        } catch (e) {
            Alert.alert("No se pudo tomar el pedido", describeBackendError(e));
            await load();
        } finally {
            setBusyId(null);
        }
    };

    const answerAssignment = async (o: StaffOrder, accept: boolean, reason?: string) => {
        if (busyId) return;
        setBusyId(o.id);
        try {
            await respondAssignment(o.id, accept, reason);
            await load();
        } catch (e) {
            Alert.alert("No se pudo completar", describeBackendError(e));
        } finally {
            setBusyId(null);
        }
    };

    const setStatus = async (o: StaffOrder, to: "picked_up" | "on_the_way" | "delivered" | "delivery_failed", reason?: string) => {
        if (busyId) return;
        setBusyId(o.id);
        try {
            if (to !== "on_the_way") stopSharing();
            await changeOrderStatus(o.id, to, {}, reason);
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

            <TouchableOpacity
                onPress={toggleAvailability}
                className={`mx-5 mb-3 flex-row items-center rounded-xl border px-4 py-3 ${available ? "border-green-300 bg-green-50" : "border-gray-200 bg-gray-50"}`}
                accessibilityRole="switch"
                accessibilityState={{ checked: available }}
                accessibilityLabel="Disponible para recibir pedidos"
            >
                <Ionicons name={available ? "radio-button-on" : "radio-button-off"} size={18} color={available ? "#22C55E" : "#9CA3AF"} />
                <Text className="ml-2 flex-1 text-sm text-dark-100">{available ? "Conectado y disponible (los pedidos en curso te marcan como ocupado)" : "Desconectado: no recibirás pedidos ni verás el pool"}</Text>
            </TouchableOpacity>

            <View className="mx-5 mb-3 flex-row">
                {(["pool", "active", "history"] as const).map((k) => (
                    <TouchableOpacity
                        key={k}
                        onPress={() => { setLoading(true); setTab(k); }}
                        className={`mr-2 rounded-full border px-4 py-2 ${tab === k ? "border-primary bg-primary" : "border-gray-200"}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: tab === k }}
                    >
                        <Text className={tab === k ? "font-bold text-white" : "text-dark-100"}>{k === "pool" ? "Disponibles" : k === "active" ? "Activas" : "Historial"}</Text>
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

            {tab === "pool" ? (
                <FlatList
                    data={pool}
                    keyExtractor={(o) => o.id}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
                    ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">{poolOffline ? "Estás desconectado: actívate para ver pedidos disponibles." : "No hay pedidos disponibles ahora. Desliza para actualizar."}</Text> : null}
                    renderItem={({ item: o }) => (
                        <View className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                            <View className="flex-row items-center justify-between">
                                <Text className="text-base font-bold text-dark-100">#{o.id.slice(-6)}</Text>
                                <OrderStatusBadge status={o.status} />
                            </View>
                            <Text className="mt-2 text-sm text-gray-400">{o.itemsCount} producto(s) · {o.paymentMethod === "cash_on_delivery" ? "Efectivo" : "Pagado en línea"}</Text>
                            <Text className="mt-1 text-sm text-dark-100">Total ${o.total}{typeof o.distanceKm === "number" ? ` · ~${o.distanceKm} km` : ""}</Text>
                            <Text className="mt-1 text-xs text-gray-400">Los datos del cliente se muestran al aceptar.</Text>
                            <TouchableOpacity onPress={() => takeOrder(o)} disabled={busyId === o.id} className="mt-3 items-center rounded-xl bg-primary py-3" accessibilityRole="button">
                                {busyId === o.id ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Aceptar pedido</Text>}
                            </TouchableOpacity>
                        </View>
                    )}
                />
            ) : (
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
                                    {restaurant && (o.status === "preparing" || o.status === "ready") && (
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

                            {tab === "active" && o.driverResponse === "pending" && (
                                <View className="mt-3 flex-row">
                                    <TouchableOpacity onPress={() => answerAssignment(o, true)} disabled={busy} className="mr-2 flex-1 items-center rounded-xl bg-primary py-3" accessibilityRole="button">
                                        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Aceptar</Text>}
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => setReasonFor({ order: o, kind: "reject" })} disabled={busy} className="flex-1 items-center rounded-xl border border-red-300 py-3" accessibilityRole="button">
                                        <Text className="font-bold text-red-500">Rechazar</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                            {tab === "active" && o.driverResponse !== "pending" && (o.status === "preparing" || o.status === "ready") && (
                                <TouchableOpacity onPress={() => setStatus(o, "picked_up")} disabled={busy} className="mt-3 items-center rounded-xl bg-primary py-3">
                                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Ya recogí el pedido</Text>}
                                </TouchableOpacity>
                            )}
                            {tab === "active" && o.driverResponse !== "pending" && o.status === "picked_up" && (
                                <TouchableOpacity
                                    onPress={() => setReasonFor({ order: o, kind: "failed" })}
                                    disabled={busy}
                                    className="mt-2 items-center rounded-xl border border-red-300 py-3"
                                    accessibilityRole="button"
                                >
                                    <Text className="font-bold text-red-500">No pude entregar</Text>
                                </TouchableOpacity>
                            )}
                            {tab === "active" && o.driverResponse !== "pending" && (o.status === "picked_up" || o.status === "delivery_failed") && (
                                <TouchableOpacity onPress={() => setStatus(o, "on_the_way")} disabled={busy} className="mt-3 items-center rounded-xl bg-primary py-3">
                                    {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">{o.status === "delivery_failed" ? "Reintentar entrega" : "Salir a reparto"}</Text>}
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
                                    <TouchableOpacity
                                        onPress={() => setReasonFor({ order: o, kind: "failed" })}
                                        disabled={busy}
                                        className="mt-2 items-center rounded-xl border border-red-300 py-3"
                                        accessibilityRole="button"
                                    >
                                        <Text className="font-bold text-red-500">No pude entregar</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    );
                }}
            />
            )}

            <ReasonModal
                visible={!!reasonFor}
                title={reasonFor?.kind === "reject" ? "¿Por qué rechazas el pedido?" : "¿Por qué no se pudo entregar?"}
                options={reasonFor?.kind === "reject" ? ["Estoy lejos", "Problema con mi vehículo", "Ya no puedo trabajar"] : ["Cliente no respondió", "Dirección incorrecta", "Cliente rechazó el pedido", "Problema con el vehículo"]}
                confirmLabel={reasonFor?.kind === "reject" ? "Rechazar" : "Registrar"}
                destructive
                busy={!!busyId}
                onClose={() => setReasonFor(null)}
                onConfirm={async (reason) => {
                    const t = reasonFor;
                    setReasonFor(null);
                    if (!t) return;
                    if (t.kind === "reject") await answerAssignment(t.order, false, reason);
                    else await setStatus(t.order, "delivery_failed", reason);
                }}
            />
        </View>
    );
};

export default DriverDeliveries;
