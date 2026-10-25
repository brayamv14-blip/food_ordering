import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { getCurrentUser } from "@/lib/appwrite";
import { fetchMyOrders } from "@/lib/services/orders.service";
import { Order } from "@/lib/domain/order";
import { isTrackable } from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import OrderStatusBadge from "@/components/OrderStatusBadge";

const Orders = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadOrders = async () => {
        try {
            setLoading(true);
            setError(null);
            const user: any = await getCurrentUser();
            // Solo pedidos del usuario autenticado (filtro en consulta y en cliente).
            setOrders(await fetchMyOrders(user.accountId ?? user.$id));
        } catch (e) {
            console.log("Error al cargar pedidos:", e);
            setError("No pudimos cargar tus pedidos. Revisa tu conexión e inténtalo de nuevo.");
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            loadOrders();
        }, [])
    );

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
                <Text className="mt-3 text-gray-400">Cargando pedidos...</Text>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white px-5 pt-14">
            <View className="mb-6 flex-row items-center">
                <TouchableOpacity
                    onPress={() => router.back()}
                    className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100"
                    accessibilityLabel="Volver"
                >
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <View>
                    <Text className="text-3xl font-bold text-dark-100">Mis pedidos</Text>
                    <Text className="mt-1 text-sm text-gray-400">Consulta el estado de tus pedidos</Text>
                </View>
            </View>

            {error ? (
                <View className="flex-1 items-center justify-center">
                    <Text className="text-center text-gray-400 px-8">{error}</Text>
                    <TouchableOpacity onPress={loadOrders} className="mt-5 rounded-xl bg-primary px-6 py-3">
                        <Text className="font-bold text-white">Reintentar</Text>
                    </TouchableOpacity>
                </View>
            ) : orders.length === 0 ? (
                <View className="flex-1 items-center justify-center">
                    <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-orange-50">
                        <Ionicons name="receipt-outline" size={40} color="#FF9C01" />
                    </View>
                    <Text className="text-lg font-bold text-dark-100">No tienes pedidos todavía</Text>
                    <Text className="mt-2 px-8 text-center text-sm text-gray-400">
                        Cuando realices un pedido, aparecerá aquí.
                    </Text>
                    <TouchableOpacity onPress={() => router.replace("/")} className="mt-5 rounded-xl bg-primary px-6 py-3">
                        <Text className="font-bold text-white">Ir al inicio</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={orders}
                    keyExtractor={(item) => item.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 40 }}
                    renderItem={({ item }) => (
                        <TouchableOpacity
                            onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })}
                            activeOpacity={0.8}
                            className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
                        >
                            <View className="mb-4 flex-row items-center justify-between">
                                <View className="flex-1">
                                    <Text className="text-base font-bold text-dark-100">Pedido #{item.id.slice(-6)}</Text>
                                    <Text className="mt-1 text-sm text-gray-400">
                                        {item.createdAt
                                            ? new Date(item.createdAt).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })
                                            : "Fecha no disponible"}
                                    </Text>
                                </View>
                                <OrderStatusBadge status={item.rawStatus} />
                            </View>

                            <View className="border-t border-gray-100 pt-4">
                                {item.items.length === 0 && (
                                    <Text className="text-sm text-gray-400">Sin productos registrados.</Text>
                                )}
                                {item.items.map((orderItem) => (
                                    <View key={orderItem.id} className="mb-4">
                                        <View className="flex-row justify-between">
                                            <View className="flex-1 pr-3">
                                                <Text className="text-base font-semibold text-dark-100">{orderItem.name}</Text>
                                                <Text className="mt-1 text-sm text-gray-400">Cantidad: {orderItem.quantity}</Text>
                                                {orderItem.extras.length > 0 && (
                                                    <Text className="mt-1 text-xs text-gray-400" numberOfLines={3}>
                                                        Extras: {orderItem.extras.map((e) => `${e.name} (+${formatMoney(e.price)})`).join(", ")}
                                                    </Text>
                                                )}
                                            </View>
                                            <Text className="text-base font-bold text-primary">{formatMoney(orderItem.lineTotal)}</Text>
                                        </View>
                                        {orderItem.quantity > 1 && (
                                            <Text className="mt-1 text-xs text-gray-400">{formatMoney(orderItem.unitPrice)} c/u</Text>
                                        )}
                                    </View>
                                ))}
                            </View>

                            <View className="mt-1 border-t border-gray-100 pt-4">
                                <View className="mb-2 flex-row justify-between">
                                    <Text className="text-sm text-gray-400">Envío</Text>
                                    <Text className="text-sm text-dark-100">{formatMoney(item.deliveryFee)}</Text>
                                </View>
                                <View className="mb-2 flex-row justify-between">
                                    <Text className="text-sm text-gray-400">Descuento</Text>
                                    <Text className="text-sm text-green-600">-{formatMoney(item.discount)}</Text>
                                </View>
                                <View className="mt-2 flex-row items-center justify-between">
                                    <Text className="text-lg font-bold text-dark-100">Total</Text>
                                    <Text className="text-xl font-bold text-primary">{formatMoney(item.total)}</Text>
                                </View>
                            </View>

                            {item.deliveryAddress && (
                                <View className="mt-4 flex-row items-center">
                                    <Ionicons name="location-outline" size={18} color="#9CA3AF" />
                                    <Text className="ml-2 flex-1 text-sm text-gray-400" numberOfLines={2}>
                                        {item.deliveryAddress.line}
                                    </Text>
                                </View>
                            )}

                            <View className="mt-4 flex-row items-center justify-between">
                                <View className="flex-row items-center">
                                    <Ionicons name="cash-outline" size={18} color="#9CA3AF" />
                                    <Text className="ml-2 text-sm text-gray-400">Efectivo contra entrega</Text>
                                </View>
                                <View className="flex-row items-center">
                                    <Text className="mr-1 text-sm font-semibold text-primary">
                                        {isTrackable(item.status) ? "Seguir pedido" : "Ver detalle"}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={18} color="#FF9C01" />
                                </View>
                            </View>
                        </TouchableOpacity>
                    )}
                />
            )}
        </View>
    );
};

export default Orders;
