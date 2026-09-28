import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";

import { useCartStore } from "@/store/cart.store";
import {
    createOrder,
    getCurrentUser
} from "@/lib/appwrite";

const Checkout = () => {
    const {
        items,
        getTotalItems,
        getTotalPrice,
        clearCart
    } = useCartStore();

    const [loading, setLoading] = useState(false);

    const totalItems = getTotalItems();
    const subtotal = getTotalPrice();
    const deliveryFee = 5;
    const discount = 0.5;
    const total = subtotal + deliveryFee - discount;

    const handleConfirmOrder = async () => {
        if (items.length === 0) {
            Alert.alert(
                "Cart Empty",
                "Add products before placing an order."
            );
            return;
        }

        try {
            setLoading(true);

            const user = await getCurrentUser();

            if (!user) {
                throw new Error(
                    "No se encontró el usuario actual."
                );
            }

            const orderItems = items.map((item) => {
                const customizationTotal =
                    item.customizations?.reduce(
                        (sum, customization) =>
                            sum + customization.price,
                        0
                    ) ?? 0;

                return {
                    menuId: item.id,
                    name: item.name,
                    price:
                        item.price +
                        customizationTotal,
                    quantity: item.quantity,
                    customizations: JSON.stringify(
                        item.customizations ?? []
                    )
                };
            });

            await createOrder({
                userId: user.accountId ?? user.$id,
                total,
                deliveryFee,
                discount,
                paymentMethod:
                    "cash_on_delivery",
                items: orderItems
            });

            clearCart();

            Alert.alert(
                "Order Confirmed",
                "Your order has been placed successfully!",
                [
                    {
                        text: "OK",
                        onPress: () =>
                            router.replace(
                                "/(tabs)"
                            )
                    }
                ]
            );
        } catch (error) {
            console.log(
                "Error al confirmar pedido:",
                error
            );

            Alert.alert(
                "Error",
                "Could not place your order. Please try again."
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerClassName="pb-10"
            >
                {/* Header */}
                <View className="flex-row items-center px-5 pt-3">
                    <TouchableOpacity
                        onPress={() => router.back()}
                        className="size-10 rounded-full bg-gray-100 items-center justify-center"
                    >
                        <Ionicons
                            name="arrow-back"
                            size={24}
                            color="#181C2E"
                        />
                    </TouchableOpacity>

                    <Text className="flex-1 text-center h3-bold text-dark-100 mr-10">
                        Checkout
                    </Text>
                </View>

                {/* Delivery Address */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">
                        Delivery Address
                    </Text>

                    <View className="border border-gray-200 rounded-2xl p-5">
                        <View className="flex-row items-center">
                            <Ionicons
                                name="location-outline"
                                size={24}
                                color="#FE8C00"
                            />

                            <View className="ml-3 flex-1">
                                <Text className="base-bold text-dark-100">
                                    My Address
                                </Text>

                                <Text className="paragraph-regular text-gray-200 mt-1">
                                    Add your delivery address
                                </Text>
                            </View>

                            <Ionicons
                                name="chevron-forward"
                                size={20}
                                color="#9CA3AF"
                            />
                        </View>
                    </View>
                </View>

                {/* Order Summary */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">
                        Order Summary
                    </Text>

                    <View className="border border-gray-200 rounded-2xl p-5">
                        {items.map((item) => {
                            const customizationTotal =
                                item.customizations?.reduce(
                                    (sum, customization) =>
                                        sum +
                                        customization.price,
                                    0
                                ) ?? 0;

                            const itemPrice =
                                item.price +
                                customizationTotal;

                            const customizationIds =
                                (
                                    item.customizations ??
                                    []
                                )
                                    .map(
                                        (customization) =>
                                            customization.id
                                    )
                                    .sort()
                                    .join("-");

                            return (
                                <View
                                    key={`${item.id}-${customizationIds}`}
                                    className="mb-5"
                                >
                                    <View className="flex-row justify-between">
                                        <View className="flex-1 pr-4">
                                            <Text className="base-bold text-dark-100">
                                                {item.name}
                                            </Text>

                                            <Text className="small-regular text-gray-200 mt-1">
                                                Quantity:{" "}
                                                {
                                                    item.quantity
                                                }
                                            </Text>

                                            {item.customizations &&
                                                item
                                                    .customizations
                                                    .length >
                                                    0 && (
                                                    <Text className="small-regular text-gray-200 mt-1">
                                                        {item.customizations
                                                            .map(
                                                                (
                                                                    customization
                                                                ) =>
                                                                    customization.name
                                                            )
                                                            .join(
                                                                ", "
                                                            )}
                                                    </Text>
                                                )}
                                        </View>

                                        <Text className="base-bold text-primary">
                                            $
                                            {(
                                                itemPrice *
                                                item.quantity
                                            ).toFixed(2)}
                                        </Text>
                                    </View>
                                </View>
                            );
                        })}

                        <View className="border-t border-gray-200 pt-4">
                            <View className="flex-row justify-between mb-2">
                                <Text className="paragraph-regular text-gray-200">
                                    Items ({totalItems})
                                </Text>

                                <Text className="paragraph-semibold text-dark-100">
                                    ${subtotal.toFixed(2)}
                                </Text>
                            </View>

                            <View className="flex-row justify-between mb-2">
                                <Text className="paragraph-regular text-gray-200">
                                    Delivery Fee
                                </Text>

                                <Text className="paragraph-semibold text-dark-100">
                                    ${deliveryFee.toFixed(2)}
                                </Text>
                            </View>

                            <View className="flex-row justify-between mb-3">
                                <Text className="paragraph-regular text-gray-200">
                                    Discount
                                </Text>

                                <Text className="paragraph-semibold text-success">
                                    - $
                                    {discount.toFixed(
                                        2
                                    )}
                                </Text>
                            </View>

                            <View className="border-t border-gray-200 pt-3 flex-row justify-between">
                                <Text className="base-bold text-dark-100">
                                    Total
                                </Text>

                                <Text className="h3-bold text-primary">
                                    ${total.toFixed(2)}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Payment Method */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">
                        Payment Method
                    </Text>

                    <View className="border border-gray-200 rounded-2xl p-5">
                        <View className="flex-row items-center">
                            <Ionicons
                                name="cash-outline"
                                size={24}
                                color="#FE8C00"
                            />

                            <View className="ml-3 flex-1">
                                <Text className="base-bold text-dark-100">
                                    Cash on Delivery
                                </Text>

                                <Text className="small-regular text-gray-200 mt-1">
                                    Pay when your order arrives
                                </Text>
                            </View>

                            <View className="size-6 rounded-full bg-primary items-center justify-center">
                                <Ionicons
                                    name="checkmark"
                                    size={16}
                                    color="#FFFFFF"
                                />
                            </View>
                        </View>
                    </View>
                </View>

                {/* Confirm Button */}
                <View className="px-5 mt-8">
                    <TouchableOpacity
                        onPress={handleConfirmOrder}
                        disabled={loading}
                        className="bg-primary rounded-full py-5"
                        activeOpacity={0.8}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Text className="text-white text-center paragraph-bold">
                                Confirm Order - $
                                {total.toFixed(2)}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export default Checkout;