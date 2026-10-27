import { useMemo } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import LeafletMap from "@/components/LeafletMap";

import useAuthStore from "@/store/auth.store";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import { useRoute } from "@/hooks/useRoute";
import { describeAge } from "@/lib/domain/coordinates";
import { getStatusMeta, isTrackable } from "@/lib/domain/orderStatus";
import { MapData, MapMarker } from "@/lib/domain/geo";
import { getRestaurant } from "@/lib/domain/restaurant";
import OrderStatusBadge from "@/components/OrderStatusBadge";

const TrackingScreen = () => {
    const { id } = useLocalSearchParams<{ id: string }>();
    const user = useAuthStore((s) => s.user);
    const { order, loading, error, stale } = useOrderTracking(id, user?.accountId ?? user?.$id);

    const driver = order?.driverLocation ?? null;
    const destination = order?.deliveryLocation ?? null;
    const route = useRoute(driver, destination);
    const lastUpdate = useMemo(() => describeAge(order?.driverUpdatedAt), [order?.driverUpdatedAt]);

    // Solo puntos reales: el destino del pedido y la última ubicación que el repartidor sí compartió.
    const mapData = useMemo<MapData>(() => {
        const markers: MapMarker[] = [];
        const restaurant = getRestaurant();
        if (restaurant) markers.push({ id: "rest", kind: "restaurant", position: restaurant.location, label: restaurant.name });
        if (destination) markers.push({ id: "dest", kind: "destination", position: destination, label: "Destino" });
        if (driver) markers.push({ id: "drv", kind: "driver", position: driver, label: order?.driverName ?? "Repartidor" });
        return { markers, route: route?.ok ? route.points : [] };
    }, [destination, driver, route, order?.driverName]);

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
                <Text className="mt-3 text-gray-400">Cargando seguimiento...</Text>
            </View>
        );
    }

    if (!order) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">{error ?? "No encontramos este pedido."}</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3">
                    <Text className="font-bold text-white">Volver al detalle</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const hasAnyCoordinate = !!driver || !!destination;
    const meta = getStatusMeta(order.rawStatus);

    return (
        <View className="flex-1 bg-white">
            {hasAnyCoordinate ? (
                <LeafletMap style={{ flex: 1 }} data={mapData} />
            ) : (
                <View className="flex-1 items-center justify-center px-8 bg-gray-100">
                    <Ionicons name="map-outline" size={56} color="#9CA3AF" />
                    <Text className="mt-4 text-center base-bold text-dark-100">Aún no hay ubicación disponible</Text>
                    <Text className="mt-2 text-center small-regular text-gray-200">
                        {isTrackable(order.status)
                            ? "El repartidor todavía no ha compartido su ubicación. Se actualizará automáticamente."
                            : "El mapa estará disponible cuando tu pedido vaya en camino."}
                    </Text>
                </View>
            )}

            <SafeAreaView edges={["top"]} className="absolute top-0 left-0 px-5 pt-2">
                <TouchableOpacity
                    onPress={() => router.back()}
                    className="size-11 rounded-full bg-white items-center justify-center shadow-md"
                    accessibilityLabel="Regresar al detalle del pedido"
                >
                    <Ionicons name="arrow-back" size={22} color="#181C2E" />
                </TouchableOpacity>
            </SafeAreaView>

            <View className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl px-5 pt-5 pb-10 shadow-lg">
                <View className="flex-row items-center justify-between mb-3">
                    <Text className="h3-bold text-dark-100">Pedido #{order.id.slice(-6)}</Text>
                    <OrderStatusBadge status={order.rawStatus} />
                </View>
                {order.status === null && <Text className="small-regular text-gray-200 mb-2">{meta.description}</Text>}
                <Text className="small-regular text-gray-200">
                    Repartidor: <Text className="paragraph-semibold text-dark-100">{order.driverName ?? "Por asignar"}</Text>
                </Text>
                <Text className="small-regular text-gray-200 mt-1" numberOfLines={2}>
                    Destino: <Text className="paragraph-semibold text-dark-100">{order.deliveryAddress?.line ?? "No registrado"}</Text>
                </Text>
                <Text className="small-regular text-gray-200 mt-1">
                    Última ubicación: {lastUpdate ?? "sin datos todavía"}
                </Text>
                {route?.ok && route.durationSeconds !== null && (
                    <Text className="small-regular text-gray-200 mt-1">
                        Ruta por calles: ~{Math.max(1, Math.round(route.durationSeconds / 60))} min
                        {route.distanceMeters !== null ? ` · ${(route.distanceMeters / 1000).toFixed(1)} km` : ""} (estimación de Geoapify · OpenStreetMap)
                    </Text>
                )}
                {route && !route.ok && driver && destination && (
                    <Text className="small-regular text-gray-200 mt-1">
                        {route.reason === "not_configured"
                            ? "Ruta no disponible: no hay servicio de rutas configurado."
                            : "No se pudo calcular la ruta por calles en este momento."}
                    </Text>
                )}
                {error && (
                    <Text className="small-regular text-red-500 mt-2">
                        {stale ? "Sin conexión: se muestra la última información conocida." : error}
                    </Text>
                )}
                <TouchableOpacity onPress={() => router.back()} className="mt-4 bg-primary rounded-full py-3" accessibilityRole="button">
                    <Text className="text-white text-center paragraph-bold">Volver al detalle</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

export default TrackingScreen;
