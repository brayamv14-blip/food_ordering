import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import useAuthStore from "@/store/auth.store";
import { useOrderTracking } from "@/hooks/useOrderTracking";
import { cancelMyOrder } from "@/lib/services/orders.service";
import { canCustomerCancel, getStatusMeta, isTrackable } from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import OrderStatusTimeline from "@/components/OrderStatusTimeline";

const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : null;

const OrderDetail = () => {
    const { id } = useLocalSearchParams<{ id: string }>();
    const user = useAuthStore((s) => s.user);
    const { order, loading, error, stale } = useOrderTracking(id, user?.accountId ?? user?.$id);
    const [cancelling, setCancelling] = useState(false);

    const handleCancel = () => {
        if (!order || cancelling) return;
        Alert.alert("Cancelar pedido", "¿Seguro que quieres cancelar este pedido?", [
            { text: "No", style: "cancel" },
            {
                text: "Sí, cancelar",
                style: "destructive",
                onPress: async () => {
                    setCancelling(true);
                    try {
                        await cancelMyOrder(order);
                        // El estado nuevo llega por suscripción / consulta periódica.
                    } catch (e: any) {
                        Alert.alert("No se pudo cancelar", e?.message ?? "Inténtalo de nuevo.");
                    } finally {
                        setCancelling(false);
                    }
                }
            }
        ]);
    };

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
            </View>
        );
    }

    if (!order) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">{error ?? "No encontramos este pedido."}</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3">
                    <Text className="font-bold text-white">Volver</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    const meta = getStatusMeta(order.rawStatus);

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView contentContainerClassName="px-5 pb-12" showsVerticalScrollIndicator={false}>
                <View className="flex-row items-center pt-3 mb-6">
                    <TouchableOpacity onPress={() => router.back()} className="size-10 rounded-full bg-gray-100 items-center justify-center" accessibilityLabel="Volver">
                        <Ionicons name="arrow-back" size={22} color="#181C2E" />
                    </TouchableOpacity>
                    <Text className="flex-1 text-center h3-bold text-dark-100 mr-10">Pedido #{order.id.slice(-6)}</Text>
                </View>

                {stale && error && (
                    <Text className="small-regular text-red-500 mb-3">{error} Mostrando la última información disponible.</Text>
                )}

                <View className="flex-row items-center justify-between mb-2">
                    <OrderStatusBadge status={order.rawStatus} />
                </View>
                <Text className="small-regular text-gray-200 mb-1">Creado: {fmtDate(order.createdAt) ?? "—"}</Text>
                {order.updatedAt && order.updatedAt !== order.createdAt && (
                    <Text className="small-regular text-gray-200 mb-1">Actualizado: {fmtDate(order.updatedAt)}</Text>
                )}
                {order.status === null && (
                    <Text className="small-regular text-gray-200 mb-1">{meta.description} (valor recibido: “{order.rawStatus || "vacío"}”)</Text>
                )}

                <View className="mt-6">
                    <OrderStatusTimeline status={order.rawStatus} />
                </View>

                {isTrackable(order.status) && (
                    <TouchableOpacity
                        onPress={() => router.push({ pathname: "/order/tracking/[id]", params: { id: order.id } })}
                        className="bg-primary rounded-full py-4 mt-2"
                        accessibilityRole="button"
                    >
                        <Text className="text-white text-center paragraph-bold">Seguir mi pedido en el mapa</Text>
                    </TouchableOpacity>
                )}

                <Text className="h3-bold text-dark-100 mt-8 mb-3">Productos</Text>
                <View className="border border-gray-200 rounded-2xl p-5">
                    {order.items.length === 0 && <Text className="text-gray-400">No hay productos registrados.</Text>}
                    {order.items.map((item) => (
                        <View key={item.id} className="mb-4 flex-row justify-between">
                            <View className="flex-1 pr-3">
                                <Text className="base-bold text-dark-100">{item.name}</Text>
                                <Text className="small-regular text-gray-200 mt-1">Cantidad: {item.quantity} · {formatMoney(item.unitPrice)} c/u</Text>
                                {item.extras.length > 0 && (
                                    <Text className="small-regular text-gray-200 mt-1">
                                        Extras: {item.extras.map((e) => `${e.name} (+${formatMoney(e.price)})`).join(", ")}
                                    </Text>
                                )}
                            </View>
                            <Text className="base-bold text-primary">{formatMoney(item.lineTotal)}</Text>
                        </View>
                    ))}
                    <View className="border-t border-gray-200 pt-3">
                        {order.subtotal !== null && (
                            <View className="flex-row justify-between mb-1">
                                <Text className="text-gray-200">Subtotal</Text>
                                <Text className="text-dark-100">{formatMoney(order.subtotal)}</Text>
                            </View>
                        )}
                        <View className="flex-row justify-between mb-1">
                            <Text className="text-gray-200">Envío</Text>
                            <Text className="text-dark-100">{formatMoney(order.deliveryFee)}</Text>
                        </View>
                        <View className="flex-row justify-between mb-2">
                            <Text className="text-gray-200">Descuento</Text>
                            <Text className="text-green-600">-{formatMoney(order.discount)}</Text>
                        </View>
                        <View className="flex-row justify-between">
                            <Text className="base-bold text-dark-100">Total</Text>
                            <Text className="h3-bold text-primary">{formatMoney(order.total)}</Text>
                        </View>
                    </View>
                </View>

                <Text className="h3-bold text-dark-100 mt-8 mb-3">Entrega</Text>
                <View className="border border-gray-200 rounded-2xl p-5">
                    <View className="flex-row items-start">
                        <Ionicons name="location-outline" size={22} color="#FE8C00" />
                        <Text className="ml-3 flex-1 paragraph-regular text-dark-100">
                            {order.deliveryAddress?.line ?? "Dirección no registrada en este pedido."}
                        </Text>
                    </View>
                    {order.driverName && (
                        <Text className="small-regular text-gray-200 mt-3">Repartidor: {order.driverName}</Text>
                    )}
                </View>

                {canCustomerCancel(order.status) && (
                    <TouchableOpacity
                        onPress={handleCancel}
                        disabled={cancelling}
                        className="mt-8 rounded-full border border-red-400 py-4"
                        accessibilityRole="button"
                    >
                        {cancelling ? <ActivityIndicator color="#EF4444" /> : (
                            <Text className="text-center paragraph-bold text-red-500">Cancelar pedido</Text>
                        )}
                    </TouchableOpacity>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

export default OrderDetail;
