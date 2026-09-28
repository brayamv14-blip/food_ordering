import {
    View,
    Text,
    Image,
    TouchableOpacity,
    ActivityIndicator,
    ScrollView
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import {
    router,
    useLocalSearchParams
} from "expo-router";

import {
    useEffect,
    useState
} from "react";

import { Ionicons } from "@expo/vector-icons";

import {
    getMenu,
    getProductCustomizations
} from "@/lib/appwrite";

import {
    MenuItem,
    CartCustomization
} from "@/type";

import { useCartStore } from "@/store/cart.store";

const ProductDetails = () => {
    const {
        id,
        edit,
        customizationIds
    } =
        useLocalSearchParams<{
            id: string;
            edit?: string;
            customizationIds?: string;
        }>();

    const isEditing = edit === "true";

    const [
        product,
        setProduct
    ] = useState<MenuItem | null>(null);

    const [
        customizations,
        setCustomizations
    ] = useState<CartCustomization[]>([]);

    const [
        selectedCustomizations,
        setSelectedCustomizations
    ] = useState<CartCustomization[]>([]);

    const [loading, setLoading] =
        useState(true);

    const {
        addItem,
        updateItem
    } = useCartStore();

    useEffect(() => {
        const loadProduct = async () => {
            if (!id) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);

                const products =
                    await getMenu({});

                const foundProduct =
                    products.find(
                        (item) =>
                            item.$id === id
                    );

                setProduct(
                    foundProduct ?? null
                );

                if (foundProduct) {
                    const productCustomizations =
                        await getProductCustomizations(
                            foundProduct.$id
                        );

                    setCustomizations(
                        productCustomizations
                    );

                    if (
                        isEditing &&
                        customizationIds
                    ) {
                        const ids =
                            customizationIds
                                .split(",")
                                .filter(Boolean);

                        const selected =
                            productCustomizations.filter(
                                (
                                    customization
                                ) =>
                                    ids.includes(
                                        customization.id
                                    )
                            );

                        setSelectedCustomizations(
                            selected
                        );
                    }
                }
            } catch (error) {
                console.log(
                    "Error al cargar producto:",
                    error
                );
            } finally {
                setLoading(false);
            }
        };

        loadProduct();
    }, [
        id,
        isEditing,
        customizationIds
    ]);

    const toggleCustomization = (
        customization: CartCustomization
    ) => {
        setSelectedCustomizations(
            (current) => {
                const alreadySelected =
                    current.some(
                        (item) =>
                            item.id ===
                            customization.id
                    );

                if (alreadySelected) {
                    return current.filter(
                        (item) =>
                            item.id !==
                            customization.id
                    );
                }

                return [
                    ...current,
                    customization
                ];
            }
        );
    };

    const getTotalPrice = () => {
        if (!product) return 0;

        const customizationTotal =
            selectedCustomizations.reduce(
                (
                    total,
                    customization
                ) =>
                    total +
                    customization.price,
                0
            );

        return (
            product.price +
            customizationTotal
        );
    };

    const handleCartAction = () => {
        if (!product) return;

        if (isEditing) {
            const oldCustomizations =
                customizationIds
                    ? customizationIds
                          .split(",")
                          .filter(Boolean)
                          .map((id) => ({
                              id,
                              name: "",
                              price: 0,
                              type: ""
                          }))
                    : [];

            updateItem(
                product.$id,
                oldCustomizations,
                {
                    id: product.$id,
                    name: product.name,
                    price: product.price,
                    image_url:
                        product.image_url,
                    customizations:
                        selectedCustomizations
                }
            );
        } else {
            addItem({
                id: product.$id,
                name: product.name,
                price: product.price,
                image_url:
                    product.image_url,
                customizations:
                    selectedCustomizations
            });
        }

        router.push("/(tabs)/cart");
    };

    if (loading) {
        return (
            <SafeAreaView className="flex-1 bg-white items-center justify-center">
                <ActivityIndicator
                    size="large"
                    color="#FE8C00"
                />

                <Text className="mt-4 text-gray-200">
                    Cargando producto...
                </Text>
            </SafeAreaView>
        );
    }

    if (!product) {
        return (
            <SafeAreaView className="flex-1 bg-white items-center justify-center px-5">
                <Text className="h2-bold text-dark-100 text-center">
                    Producto no encontrado
                </Text>

                <TouchableOpacity
                    onPress={() =>
                        router.back()
                    }
                    className="bg-primary rounded-full px-6 py-4 mt-5"
                >
                    <Text className="paragraph-bold text-white">
                        Volver
                    </Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView
                showsVerticalScrollIndicator={
                    false
                }
                contentContainerClassName="pb-10"
            >
                <View className="flex-row items-center px-5 pt-3">
                    <TouchableOpacity
                        onPress={() =>
                            router.back()
                        }
                        className="size-10 rounded-full bg-white items-center justify-center"
                    >
                        <Ionicons
                            name="arrow-back"
                            size={25}
                            color="#181C2E"
                        />
                    </TouchableOpacity>

                    <Text className="flex-1 text-center h3-bold text-dark-100 mr-10">
                        Product Details
                    </Text>
                </View>

                <View className="items-center justify-center mt-5 h-72">
                    <Image
                        source={{
                            uri: product.image_url
                        }}
                        className="size-64"
                        resizeMode="contain"
                    />
                </View>

                <View className="px-5">
                    <Text className="h1-bold text-dark-100">
                        {product.name}
                    </Text>

                    <View className="flex-row items-center mt-3">
                        <Ionicons
                            name="star"
                            size={20}
                            color="#FE8C00"
                        />

                        <Text className="paragraph-semibold text-dark-100 ml-1">
                            {product.rating}
                        </Text>

                        <Text className="paragraph-regular text-gray-200 ml-2">
                            Rating
                        </Text>
                    </View>

                    <Text className="h2-bold text-primary mt-4">
                        $
                        {getTotalPrice().toFixed(
                            2
                        )}
                    </Text>

                    <Text className="paragraph-regular text-gray-200 mt-5 leading-6">
                        {product.description}
                    </Text>

                    <View className="flex-row mt-6 gap-3">
                        <View className="flex-1 bg-gray-100 rounded-2xl p-4">
                            <Text className="small-medium text-gray-200">
                                Calories
                            </Text>

                            <Text className="base-bold text-dark-100 mt-1">
                                {
                                    product.calories
                                }{" "}
                                kcal
                            </Text>
                        </View>

                        <View className="flex-1 bg-gray-100 rounded-2xl p-4">
                            <Text className="small-medium text-gray-200">
                                Protein
                            </Text>

                            <Text className="base-bold text-dark-100 mt-1">
                                {
                                    product.protein
                                }{" "}
                                g
                            </Text>
                        </View>
                    </View>

                    {customizations.length >
                        0 && (
                        <View className="mt-8">
                            <Text className="h3-bold text-dark-100 mb-4">
                                Customize your
                                order
                            </Text>

                            {customizations.map(
                                (
                                    customization
                                ) => {
                                    const selected =
                                        selectedCustomizations.some(
                                            (
                                                item
                                            ) =>
                                                item.id ===
                                                customization.id
                                        );

                                    return (
                                        <TouchableOpacity
                                            key={
                                                customization.id
                                            }
                                            onPress={() =>
                                                toggleCustomization(
                                                    customization
                                                )
                                            }
                                            className="flex-row items-center justify-between border-b border-gray-100 py-4"
                                        >
                                            <View className="flex-1">
                                                <Text className="base-bold text-dark-100">
                                                    {
                                                        customization.name
                                                    }
                                                </Text>

                                                <Text className="body-regular text-gray-200 mt-1">
                                                    +$
                                                    {customization.price.toFixed(
                                                        2
                                                    )}
                                                </Text>
                                            </View>

                                            <View
                                                className={`size-6 rounded-full border-2 items-center justify-center ${
                                                    selected
                                                        ? "bg-primary border-primary"
                                                        : "bg-white border-gray-200"
                                                }`}
                                            >
                                                {selected && (
                                                    <Ionicons
                                                        name="checkmark"
                                                        size={
                                                            16
                                                        }
                                                        color="#FFFFFF"
                                                    />
                                                )}
                                            </View>
                                        </TouchableOpacity>
                                    );
                                }
                            )}
                        </View>
                    )}

                    <TouchableOpacity
                        onPress={
                            handleCartAction
                        }
                        className="bg-primary rounded-full py-5 mt-8"
                        activeOpacity={0.8}
                    >
                        <Text className="text-white text-center paragraph-bold">
                            {isEditing
                                ? "Update Cart"
                                : "Add to Cart"}{" "}
                            - $
                            {getTotalPrice().toFixed(
                                2
                            )}
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export default ProductDetails;
