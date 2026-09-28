import { useCartStore } from "@/store/cart.store";
import { CartItemType } from "@/type";
import {
    Image,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { images } from "@/constants";
import { router } from "expo-router";

const CartItem = ({
    item
}: {
    item: CartItemType
}) => {
    const {
        increaseQty,
        decreaseQty,
        removeItem
    } = useCartStore();

    const customizations =
        item.customizations ?? [];

    const customizationsTotal =
        customizations.reduce(
            (total, customization) =>
                total + customization.price,
            0
        );

    const itemPrice =
        item.price + customizationsTotal;

    const handleEdit = () => {
        const customizationIds =
            customizations
                .map(
                    (customization) =>
                        customization.id
                )
                .join(",");

        console.log(
            "Abriendo producto para editar:",
            item.id
        );

        router.push({
            pathname: "/product/[id]",
            params: {
                id: item.id,
                edit: "true",
                customizationIds
            }
        });
    };

    return (
        <View className="cart-item">
            <View className="flex-row items-center gap-x-3 flex-1">

                {/* PRODUCTO - AL TOCARLO EDITA */}
                <TouchableOpacity
                    onPress={handleEdit}
                    activeOpacity={0.7}
                    className="flex-1"
                >
                    <View className="flex-row items-center gap-x-3">

                        <View className="cart-item__image">
                            <Image
                                source={{
                                    uri: item.image_url
                                }}
                                className="size-4/5 rounded-lg"
                                resizeMode="cover"
                            />
                        </View>

                        <View className="flex-1">
                            <Text className="base-bold text-dark-100">
                                {item.name}
                            </Text>

                            {customizations.length > 0 && (
                                <View className="mt-2">
                                    <Text className="small-medium text-gray-200">
                                        Extras:
                                    </Text>

                                    {customizations.map(
                                        (customization) => (
                                            <Text
                                                key={
                                                    customization.id
                                                }
                                                className="small-regular text-gray-200"
                                            >
                                                •{" "}
                                                {
                                                    customization.name
                                                }{" "}
                                                +$
                                                {customization.price.toFixed(
                                                    2
                                                )}
                                            </Text>
                                        )
                                    )}
                                </View>
                            )}

                            <Text className="paragraph-bold text-primary mt-2">
                                ${itemPrice.toFixed(2)}
                            </Text>
                        </View>

                    </View>
                </TouchableOpacity>

                {/* CANTIDAD */}
                <View className="flex-row items-center gap-x-4">

                    <TouchableOpacity
                        onPress={() =>
                            decreaseQty(
                                item.id,
                                customizations
                            )
                        }
                        className="cart-item__actions"
                    >
                        <Image
                            source={images.minus}
                            className="size-1/2"
                            resizeMode="contain"
                            tintColor="#FF9C01"
                        />
                    </TouchableOpacity>

                    <Text className="base-bold text-dark-100">
                        {item.quantity}
                    </Text>

                    <TouchableOpacity
                        onPress={() =>
                            increaseQty(
                                item.id,
                                customizations
                            )
                        }
                        className="cart-item__actions"
                    >
                        <Image
                            source={images.plus}
                            className="size-1/2"
                            resizeMode="contain"
                            tintColor="#FF9C01"
                        />
                    </TouchableOpacity>

                </View>

                {/* ELIMINAR */}
                <TouchableOpacity
                    onPress={() =>
                        removeItem(
                            item.id,
                            customizations
                        )
                    }
                    className="flex-center"
                >
                    <Image
                        source={images.trash}
                        className="size-5"
                        resizeMode="contain"
                    />
                </TouchableOpacity>

            </View>
        </View>
    );
};

export default CartItem;