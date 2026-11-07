
import { Text, TouchableOpacity, Image, Platform } from "react-native";
import { MenuItem } from "@/type";
import { useCartStore } from "@/store/cart.store";
import { router } from "expo-router";

const MenuCard = ({
    item: { $id, image_url, name, price, available }
}: {
    item: MenuItem
}) => {
    const { addItem } = useCartStore();

 const handleCardPress = () => {
    router.push(`/product/${$id}` as any);
};
 
    const soldOut = available === false;

    const handleAddToCart = () => {
        if (soldOut) return;
        addItem({
            id: $id,
            name,
            price,
            image_url,
            customizations: []
        });
    };

    return (
        <TouchableOpacity
            className="menu-card"
            style={
                Platform.OS === "android"
                    ? {
                        elevation: 10,
                        shadowColor: "#878787"
                    }
                    : {}
            }
            onPress={handleCardPress}
            activeOpacity={0.8}
        >
            <Image
                source={{ uri: image_url }}
                className="size-32 absolute -top-10"
                style={soldOut ? { opacity: 0.4 } : undefined}
                resizeMode="contain"
            />

            <Text
                className="text-center base-bold text-dark-100 mb-2"
                numberOfLines={1}
            >
                {name}
            </Text>

            <Text className="body-regular text-gray-200 mb-4">
                From ${price}
            </Text>

            {soldOut ? (
                <Text className="paragraph-bold text-gray-200" accessibilityLabel={`${name} no disponible`}>
                    No disponible
                </Text>
            ) : (
                <TouchableOpacity
                    onPress={handleAddToCart}
                    activeOpacity={0.7}
                    accessibilityLabel={`Agregar ${name} al carrito`}
                >
                    <Text className="paragraph-bold text-primary">
                        Add to Cart +
                    </Text>
                </TouchableOpacity>
            )}
        </TouchableOpacity>
    );
};

export default MenuCard;

