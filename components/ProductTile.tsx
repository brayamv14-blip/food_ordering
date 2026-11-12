import { Image, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { MenuItem } from "@/type";
import { formatMoney } from "@/lib/domain/pricing";
import { useCartStore } from "@/store/cart.store";

/** Tarjeta compacta de producto: imagen, nombre, descripcion, precio, disponibilidad y boton de agregar. */
const ProductTile = ({ item, width = 220 }: { item: MenuItem; width?: number }) => {
    const addItem = useCartStore((s) => s.addItem);
    const soldOut = item.available === false;

    return (
        <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/product/${item.$id}` as never)}
            style={{ width, elevation: 4, shadowColor: "#878787" }}
            className="mr-4 overflow-hidden rounded-3xl bg-white"
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${formatMoney(item.price)}${soldOut ? ", agotado" : ""}`}
        >
            <View className="h-36 items-center justify-center bg-orange-50">
                <Image source={{ uri: item.image_url }} style={{ width: "80%", height: "85%", opacity: soldOut ? 0.4 : 1 }} resizeMode="contain" />
                {soldOut && (
                    <View className="absolute left-3 top-3 rounded-full bg-gray-700 px-3 py-1">
                        <Text className="text-xs font-bold text-white">Agotado</Text>
                    </View>
                )}
            </View>
            <View className="p-3">
                <Text className="base-bold text-dark-100" numberOfLines={1}>{item.name}</Text>
                <Text className="mt-1 min-h-[32px] text-xs text-gray-200" numberOfLines={2}>{item.description}</Text>
                <View className="mt-2 flex-row items-center justify-between">
                    <Text className="paragraph-bold text-dark-100">{formatMoney(item.price)}</Text>
                    <TouchableOpacity
                        disabled={soldOut}
                        onPress={() => addItem({ id: item.$id, name: item.name, price: item.price, image_url: item.image_url, customizations: [] })}
                        className={`h-9 w-9 items-center justify-center rounded-full ${soldOut ? "bg-gray-200" : "bg-primary"}`}
                        accessibilityRole="button"
                        accessibilityLabel={soldOut ? `${item.name} no disponible` : `Agregar ${item.name} al carrito`}
                        accessibilityState={{ disabled: soldOut }}
                    >
                        <Ionicons name={soldOut ? "close" : "add"} size={20} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>
            </View>
        </TouchableOpacity>
    );
};

export default ProductTile;
