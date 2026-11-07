import { useEffect, useState } from "react";
import {
ActivityIndicator,
Alert,
ScrollView,
Text,
TouchableOpacity,
View
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
cancelOrder,
getCurrentUser,
getMyOrders
} from "@/lib/appwrite";

const OrderDetails = () => {
const { id } = useLocalSearchParams<{
id: string;
}>();


const [order, setOrder] = useState<any>(null);
const [loading, setLoading] = useState(true);

const loadOrder = async () => {
    try {
        const user = await getCurrentUser();

        const userId =
            user.accountId ?? user.$id;

        const orders =
            await getMyOrders(userId);

        const foundOrder = orders.find(
            (item: any) =>
                item.$id === id
        );

        setOrder(foundOrder ?? null);
    } catch (error) {
        console.log(
            "Error al cargar detalle del pedido:",
            error
        );
    } finally {
        setLoading(false);
    }
};

useEffect(() => {
    loadOrder();
}, [id]);

const handleCancelOrder = () => {
    Alert.alert(
        "Cancelar pedido",
        "¿Estás seguro de que quieres cancelar este pedido?",
        [
            {
                text: "No",
                style: "cancel"
            },
            {
                text: "Sí, cancelar",
                style: "destructive",
                onPress: async () => {
                    try {
                        await cancelOrder(order.$id);

                        setOrder({
                            ...order,
                            status: "cancelled"
                        });

                        Alert.alert(
                            "Pedido cancelado",
                            "Tu pedido ha sido cancelado correctamente."
                        );
                    } catch (error) {
                        console.log(
                            "Error al cancelar pedido:",
                            error
                        );

                        Alert.alert(
                            "Error",
                            "No se pudo cancelar el pedido."
                        );
                    }
                }
            }
        ]
    );
};

if (loading) {
    return (
        <View className="flex-1 items-center justify-center bg-white">
            <ActivityIndicator
                size="large"
                color="#FF9C01"
            />

            <Text className="mt-3 text-gray-400">
                Cargando pedido...
            </Text>
        </View>
    );
}

if (!order) {
    return (
        <View className="flex-1 items-center justify-center bg-white px-5">

            <Text className="text-xl font-bold text-dark-100">
                Pedido no encontrado
            </Text>

            <TouchableOpacity
                onPress={() => router.back()}
                className="mt-5 rounded-xl bg-primary px-6 py-3"
            >
                <Text className="font-bold text-white">
                    Regresar
                </Text>
            </TouchableOpacity>

        </View>
    );
}

const statusText =
    order.status === "pending"
        ? "Pendiente"
        : order.status === "confirmed"
        ? "Confirmado"
        : order.status === "preparing"
        ? "Preparando"
        : order.status === "delivered"
        ? "Entregado"
        : order.status === "cancelled"
        ? "Cancelado"
        : order.status;

const statusIcon =
    order.status === "delivered"
        ? "checkmark-circle"
        : order.status === "cancelled"
        ? "close-circle"
        : order.status === "preparing"
        ? "restaurant"
        : "time";

const statusColor =
    order.status === "cancelled"
        ? "#EF4444"
        : "#FF9C01";

return (
    <View className="flex-1 bg-white">

        {/* ENCABEZADO */}
        <View className="px-5 pb-5 pt-14">

            <TouchableOpacity
                onPress={() => router.back()}
                className="mb-5 h-10 w-10 items-center justify-center rounded-full bg-gray-100"
            >
                <Ionicons
                    name="arrow-back"
                    size={22}
                    color="#221F1F"
                />
            </TouchableOpacity>

            <Text className="text-3xl font-bold text-dark-100">
                Detalle del pedido
            </Text>

            <Text className="mt-2 text-base text-gray-400">
                Pedido #{order.$id.slice(-6)}
            </Text>

            <Text className="mt-1 text-sm text-gray-400">
                {new Date(
                    order.$createdAt
                ).toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric"
                })}
            </Text>

        </View>

        <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: 40
            }}
        >

            {/* ESTADO */}
            <View className="mb-5 rounded-2xl bg-orange-50 p-5">

                <View className="flex-row items-center">

                    <View className="h-12 w-12 items-center justify-center rounded-full bg-white">

                        <Ionicons
                            name={statusIcon as any}
                            size={25}
                            color={statusColor}
                        />

                    </View>

                    <View className="ml-4">

                        <Text className="text-sm text-gray-400">
                            Estado del pedido
                        </Text>

                        <Text
                            className="mt-1 text-xl font-bold"
                            style={{
                                color: statusColor
                            }}
                        >
                            {statusText}
                        </Text>

                    </View>

                </View>

            </View>

            {/* PRODUCTOS */}
            <View className="mb-5 rounded-2xl border border-gray-100 bg-white p-5">

                <Text className="mb-5 text-xl font-bold text-dark-100">
                    Productos
                </Text>

                {order.items?.map(
                    (orderItem: any) => {

                        let extras: any[] = [];

                        try {
                            extras =
                                typeof orderItem.customizations ===
                                "string"
                                    ? JSON.parse(
                                          orderItem.customizations
                                      )
                                    : orderItem.customizations ??
                                      [];
                        } catch {
                            extras = [];
                        }

                        const unitPrice =
                            Number(
                                orderItem.price
                            );

                        const quantity =
                            Number(
                                orderItem.quantity
                            );

                        const subtotal =
                            unitPrice *
                            quantity;

                        return (
                            <View
                                key={
                                    orderItem.$id
                                }
                                className="mb-5 border-b border-gray-100 pb-5"
                            >

                                <View className="flex-row justify-between">

                                    <View className="flex-1 pr-4">

                                        <Text className="text-base font-bold text-dark-100">
                                            {
                                                orderItem.name
                                            }
                                        </Text>

                                        <Text className="mt-1 text-sm text-gray-400">
                                            {quantity}{" "}
                                            {quantity ===
                                            1
                                                ? "unidad"
                                                : "unidades"}
                                        </Text>

                                        {quantity >
                                            1 && (
                                            <Text className="mt-1 text-xs text-gray-400">
                                                $
                                                {unitPrice.toFixed(
                                                    2
                                                )}{" "}
                                                c/u
                                            </Text>
                                        )}

                                        {extras.length >
                                            0 && (
                                            <View className="mt-3">

                                                <Text className="text-sm font-semibold text-gray-500">
                                                    Extras
                                                </Text>

                                                {extras.map(
                                                    (
                                                        extra: any
                                                    ) => (
                                                        <Text
                                                            key={
                                                                extra.id
                                                            }
                                                            className="mt-1 text-sm text-gray-400"
                                                        >
                                                            •{" "}
                                                            {
                                                                extra.name
                                                            }{" "}
                                                            (+$
                                                            {Number(
                                                                extra.price
                                                            ).toFixed(
                                                                2
                                                            )}
                                                            )
                                                        </Text>
                                                    )
                                                )}

                                            </View>
                                        )}

                                    </View>

                                    <Text className="text-base font-bold text-primary">
                                        $
                                        {subtotal.toFixed(
                                            2
                                        )}
                                    </Text>

                                </View>

                            </View>
                        );
                    }
                )}

            </View>

            {/* RESUMEN */}
            <View className="mb-5 rounded-2xl border border-gray-100 bg-white p-5">

                <Text className="mb-5 text-xl font-bold text-dark-100">
                    Resumen del pago
                </Text>

                <View className="mb-3 flex-row justify-between">

                    <Text className="text-sm text-gray-400">
                        Envío
                    </Text>

                    <Text className="text-sm text-dark-100">
                        $
                        {Number(
                            order.deliveryFee
                        ).toFixed(2)}
                    </Text>

                </View>

                <View className="mb-4 flex-row justify-between">

                    <Text className="text-sm text-gray-400">
                        Descuento
                    </Text>

                    <Text className="text-sm text-green-600">
                        -$
                        {Number(
                            order.discount
                        ).toFixed(2)}
                    </Text>

                </View>

                <View className="flex-row justify-between border-t border-gray-100 pt-4">

                    <Text className="text-lg font-bold text-dark-100">
                        Total
                    </Text>

                    <Text className="text-2xl font-bold text-primary">
                        $
                        {Number(
                            order.total
                        ).toFixed(2)}
                    </Text>

                </View>

            </View>

            {/* MÉTODO DE PAGO */}
            <View className="mb-5 rounded-2xl border border-gray-100 bg-white p-5">

                <Text className="mb-4 text-xl font-bold text-dark-100">
                    Método de pago
                </Text>

                <View className="flex-row items-center">

                    <View className="h-11 w-11 items-center justify-center rounded-full bg-orange-50">

                        <Ionicons
                            name="cash-outline"
                            size={23}
                            color="#FF9C01"
                        />

                    </View>

                    <Text className="ml-3 text-base text-gray-500">
                        {order.paymentMethod ===
                        "cash_on_delivery"
                            ? "Efectivo contra entrega"
                            : order.paymentMethod}
                    </Text>

                </View>

            </View>

            {/* CANCELAR PEDIDO */}
            {order.status === "pending" && (
                <TouchableOpacity
                    onPress={handleCancelOrder}
                    activeOpacity={0.8}
                    className="mb-3 items-center rounded-2xl border border-red-200 bg-red-50 py-4"
                >
                    <Text className="text-base font-bold text-red-500">
                        Cancelar pedido
                    </Text>
                </TouchableOpacity>
            )}

            {/* REGRESAR */}
            <TouchableOpacity
                onPress={() => router.back()}
                activeOpacity={0.8}
                className="items-center rounded-2xl bg-primary py-4"
            >
                <Text className="text-base font-bold text-white">
                    Volver a mis pedidos
                </Text>
            </TouchableOpacity>

        </ScrollView>

    </View>
);


};

export default OrderDetails;
