
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
    getCurrentUser,
    getMyOrders
} from "@/lib/appwrite";

const Orders = () => {
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const loadOrders = async () => {
        try {
            setLoading(true);

            const user = await getCurrentUser();

            const userId =
                user.accountId ?? user.$id;

            const myOrders =
                await getMyOrders(userId);

            setOrders(myOrders);
        } catch (error) {
            console.log(
                "Error al cargar pedidos:",
                error
            );
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            loadOrders();
        }, [])
    );

    const getStatusInfo = (status: string) => {
        switch (status) {
            case "pending":
                return {
                    text: "Pendiente",
                    icon: "time-outline",
                    color: "#FF9C01",
                    background: "bg-orange-100"
                };

            case "confirmed":
                return {
                    text: "Confirmado",
                    icon: "checkmark-circle-outline",
                    color: "#3B82F6",
                    background: "bg-blue-100"
                };

            case "preparing":
                return {
                    text: "Preparando",
                    icon: "restaurant-outline",
                    color: "#F59E0B",
                    background: "bg-yellow-100"
                };

            case "on_the_way":
                return {
                    text: "En camino",
                    icon: "bicycle-outline",
                    color: "#8B5CF6",
                    background: "bg-purple-100"
                };

            case "delivered":
                return {
                    text: "Entregado",
                    icon: "checkmark-circle",
                    color: "#22C55E",
                    background: "bg-green-100"
                };

            case "cancelled":
                return {
                    text: "Cancelado",
                    icon: "close-circle-outline",
                    color: "#EF4444",
                    background: "bg-red-100"
                };

            default:
                return {
                    text: status,
                    icon: "help-circle-outline",
                    color: "#6B7280",
                    background: "bg-gray-100"
                };
        }
    };

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator
                    size="large"
                    color="#FF9C01"
                />

                <Text className="mt-3 text-gray-400">
                    Cargando pedidos...
                </Text>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white px-5 pt-14">
            {/* ENCABEZADO */}
            <View className="mb-6 flex-row items-center">
                <TouchableOpacity
                    onPress={() => router.back()}
                    className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100"
                >
                    <Ionicons
                        name="arrow-back"
                        size={22}
                        color="#221F1F"
                    />
                </TouchableOpacity>

                <View>
                    <Text className="text-3xl font-bold text-dark-100">
                        Mis pedidos
                    </Text>

                    <Text className="mt-1 text-sm text-gray-400">
                        Consulta el estado de tus pedidos
                    </Text>
                </View>
            </View>

            {orders.length === 0 ? (
                <View className="flex-1 items-center justify-center">
                    <View className="mb-4 h-20 w-20 items-center justify-center rounded-full bg-orange-50">
                        <Ionicons
                            name="receipt-outline"
                            size={40}
                            color="#FF9C01"
                        />
                    </View>

                    <Text className="text-lg font-bold text-dark-100">
                        No tienes pedidos todavía
                    </Text>

                    <Text className="mt-2 px-8 text-center text-sm text-gray-400">
                        Cuando realices un pedido,
                        aparecerá aquí.
                    </Text>

                    <TouchableOpacity
                        onPress={() => router.replace("/")}
                        className="mt-5 rounded-xl bg-primary px-6 py-3"
                    >
                        <Text className="font-bold text-white">
                            Ir al inicio
                        </Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <FlatList
                    data={orders}
                    keyExtractor={(item) =>
                        item.$id
                    }
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{
                        paddingBottom: 40
                    }}
                    renderItem={({ item }) => {
                        const status =
                            getStatusInfo(
                                item.status
                            );

                        return (
                            <TouchableOpacity
                                onPress={() =>
                                    router.push({
                                        pathname:
                                            "/order/[id]",
                                        params: {
                                            id: item.$id
                                        }
                                    })
                                }
                                activeOpacity={0.8}
                                className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
                            >
                                {/* ENCABEZADO */}
                                <View className="mb-4 flex-row items-center justify-between">
                                    <View className="flex-1">
                                        <Text className="text-base font-bold text-dark-100">
                                            Pedido #
                                            {item.$id.slice(
                                                -6
                                            )}
                                        </Text>

                                        <Text className="mt-1 text-sm text-gray-400">
                                            {new Date(
                                                item.$createdAt
                                            ).toLocaleDateString(
                                                "es-MX",
                                                {
                                                    day: "2-digit",
                                                    month: "long",
                                                    year: "numeric"
                                                }
                                            )}
                                        </Text>
                                    </View>

                                    {/* ESTADO */}
                                    <View
                                        className={`flex-row items-center rounded-full px-3 py-2 ${status.background}`}
                                    >
                                        <Ionicons
                                            name={
                                                status.icon as any
                                            }
                                            size={16}
                                            color={
                                                status.color
                                            }
                                        />

                                        <Text
                                            className="ml-1 text-sm font-bold"
                                            style={{
                                                color:
                                                    status.color
                                            }}
                                        >
                                            {
                                                status.text
                                            }
                                        </Text>
                                    </View>
                                </View>

                                {/* PRODUCTOS */}
                                <View className="border-t border-gray-100 pt-4">
                                    {item.items?.map(
                                        (
                                            orderItem: any
                                        ) => {
                                            let extras: any[] =
                                                [];

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
                                                extras =
                                                    [];
                                            }

                                            const extrasNames =
                                                extras.length >
                                                0
                                                    ? extras
                                                          .map(
                                                              (
                                                                  extra: any
                                                              ) =>
                                                                  `${extra.name} (+$${Number(
                                                                      extra.price
                                                                  ).toFixed(
                                                                      2
                                                                  )})`
                                                          )
                                                          .join(
                                                              ", "
                                                          )
                                                    : "";

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
                                                    className="mb-4"
                                                >
                                                    <View className="flex-row justify-between">
                                                        <View className="flex-1 pr-3">
                                                            <Text className="text-base font-semibold text-dark-100">
                                                                {
                                                                    orderItem.name
                                                                }
                                                            </Text>

                                                            <Text className="mt-1 text-sm text-gray-400">
                                                                Cantidad:{" "}
                                                                {
                                                                    quantity
                                                                }
                                                            </Text>

                                                            {extrasNames !==
                                                                "" && (
                                                                <Text
                                                                    className="mt-1 text-xs text-gray-400"
                                                                    numberOfLines={
                                                                        3
                                                                    }
                                                                >
                                                                    Extras:{" "}
                                                                    {
                                                                        extrasNames
                                                                    }
                                                                </Text>
                                                            )}
                                                        </View>

                                                        <Text className="text-base font-bold text-primary">
                                                            $
                                                            {subtotal.toFixed(
                                                                2
                                                            )}
                                                        </Text>
                                                    </View>

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
                                                </View>
                                            );
                                        }
                                    )}
                                </View>

                                {/* COSTOS */}
                                <View className="mt-1 border-t border-gray-100 pt-4">
                                    <View className="mb-2 flex-row justify-between">
                                        <Text className="text-sm text-gray-400">
                                            Envío
                                        </Text>

                                        <Text className="text-sm text-dark-100">
                                            $
                                            {Number(
                                                item.deliveryFee
                                            ).toFixed(
                                                2
                                            )}
                                        </Text>
                                    </View>

                                    <View className="mb-2 flex-row justify-between">
                                        <Text className="text-sm text-gray-400">
                                            Descuento
                                        </Text>

                                        <Text className="text-sm text-green-600">
                                            -$
                                            {Number(
                                                item.discount
                                            ).toFixed(
                                                2
                                            )}
                                        </Text>
                                    </View>

                                    <View className="mt-2 flex-row items-center justify-between">
                                        <Text className="text-lg font-bold text-dark-100">
                                            Total
                                        </Text>

                                        <Text className="text-xl font-bold text-primary">
                                            $
                                            {Number(
                                                item.total
                                            ).toFixed(
                                                2
                                            )}
                                        </Text>
                                    </View>
                                </View>

                                {/* PAGO */}
                                <View className="mt-4 flex-row items-center">
                                    <Ionicons
                                        name="cash-outline"
                                        size={18}
                                        color="#9CA3AF"
                                    />

                                    <Text className="ml-2 text-sm text-gray-400">
                                        Efectivo contra
                                        entrega
                                    </Text>
                                </View>

                                {/* VER DETALLE */}
                                <View className="mt-4 flex-row items-center justify-end">
                                    <Text className="mr-1 text-sm font-semibold text-primary">
                                        Ver detalle
                                    </Text>

                                    <Ionicons
                                        name="chevron-forward"
                                        size={18}
                                        color="#FF9C01"
                                    />
                                </View>
                            </TouchableOpacity>
                        );
                    }}
                />
            )}
        </View>
    );
};

export default Orders;
