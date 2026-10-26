import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { getCurrentUser } from "@/lib/appwrite";
import { fetchMyOrders } from "@/lib/services/orders.service";
import { Order } from "@/lib/domain/order";
import { isTrackable } from "@/lib/domain/orderStatus";
import { formatMoney } from "@/lib/domain/pricing";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import { describePayment, describeProviderStatus } from "@/lib/domain/payment";
import { openCheckout, requestPaymentUrl, syncPayment } from "@/lib/services/payments.service";
import { reorderToCart } from "@/lib/services/reorder.service";

const Orders = () => {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

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

    const verifyPayment = async (order: Order) => {
        const sync = await syncPayment(order.id);
        Alert.alert(
            sync.paymentStatus === "paid" ? "Pago confirmado" : "Pago no confirmado",
            sync.paymentStatus === "paid" ? "Recibimos tu pago. Tu pedido seguirá su curso." : describeProviderStatus(sync.providerStatus)
        );
        await loadOrders();
    };

    // Paga (o reintenta pagar) un pedido en linea pendiente; despues el servidor verifica el pago.
    const payNow = async (order: Order) => {
        if (busyId) return;
        setBusyId(order.id);
        try {
            await openCheckout(await requestPaymentUrl(order.id));
            await verifyPayment(order);
        } catch {
            Alert.alert("Pago", "No pudimos completar la operación. Puedes intentarlo de nuevo desde aquí.");
        } finally {
            setBusyId(null);
        }
    };

    const checkPayment = async (order: Order) => {
        if (busyId) return;
        setBusyId(order.id);
        try {
            await verifyPayment(order);
        } catch {
            Alert.alert("Pago", "No pudimos verificar el pago. Revisa tu conexión e inténtalo de nuevo.");
        } finally {
            setBusyId(null);
        }
    };

    const reorder = async (order: Order) => {
        if (busyId) return;
        setBusyId(order.id);
        try {
            const { lines, skipped } = await reorderToCart(order);
            const omitted = skipped.length ? `\n\nNo se agregaron: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : "";
            if (lines.length === 0) {
                Alert.alert("Pedir de nuevo", `No se pudo agregar ningún producto.${omitted}`);
                return;
            }
            Alert.alert("Pedir de nuevo", `Agregamos ${lines.length} producto(s) a tu carrito con los precios actuales.${omitted}`, [
                { text: "Seguir aquí", style: "cancel" },
                { text: "Ir al carrito", onPress: () => router.push("/cart") }
            ]);
        } catch {
            Alert.alert("Pedir de nuevo", "No pudimos consultar el catálogo. Revisa tu conexión e inténtalo de nuevo.");
        } finally {
            setBusyId(null);
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

                            {(() => {
                                const pay = describePayment(item.paymentMethod, item.paymentStatus, item.status);
                                return (
                                    <View className="mt-4">
                                        <View className="flex-row items-center">
                                            <Ionicons name={item.paymentMethod === "online" ? "card-outline" : "cash-outline"} size={18} color="#9CA3AF" />
                                            <Text className={`ml-2 text-sm ${pay.tone === "ok" ? "text-green-600 font-semibold" : pay.tone === "warn" ? "text-orange-500 font-semibold" : "text-gray-400"}`}>
                                                {pay.label}
                                            </Text>
                                        </View>
                                        {pay.actionable && (
                                            <View className="mt-3 flex-row">
                                                <TouchableOpacity
                                                    onPress={() => payNow(item)}
                                                    disabled={busyId === item.id}
                                                    className="mr-2 rounded-xl bg-primary px-4 py-2"
                                                    accessibilityRole="button"
                                                >
                                                    <Text className="font-bold text-white">Pagar ahora</Text>
                                                </TouchableOpacity>
                                                <TouchableOpacity
                                                    onPress={() => checkPayment(item)}
                                                    disabled={busyId === item.id}
                                                    className="rounded-xl border border-primary px-4 py-2"
                                                    accessibilityRole="button"
                                                >
                                                    <Text className="font-bold text-primary">Verificar pago</Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>
                                );
                            })()}

                            <View className="mt-4 flex-row items-center justify-between">
                                <TouchableOpacity
                                    onPress={() => reorder(item)}
                                    disabled={busyId === item.id || item.items.length === 0}
                                    className="flex-row items-center"
                                    accessibilityRole="button"
                                    accessibilityLabel={`Pedir de nuevo el pedido ${item.id.slice(-6)}`}
                                >
                                    {busyId === item.id ? <ActivityIndicator size="small" color="#FF9C01" /> : <Ionicons name="repeat-outline" size={18} color="#FF9C01" />}
                                    <Text className="ml-1 text-sm font-semibold text-primary">Pedir de nuevo</Text>
                                </TouchableOpacity>
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
