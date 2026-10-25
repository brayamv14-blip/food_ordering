import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    TextInput
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCartStore } from "@/store/cart.store";
import { getCurrentUser } from "@/lib/appwrite";
import {
    OrderServiceError,
    createOrderIdempotent,
    newClientRequestId
} from "@/lib/services/orders.service";
import {
    Profile,
    listSelectableAddresses,
    mapProfileRow
} from "@/lib/services/profile.service";
import {
    DeliveryAddress,
    validateDeliveryAddress,
    validatePhone,
    normalizePhone
} from "@/lib/domain/address";
import { computeOrderTotals, unitPrice, formatMoney } from "@/lib/domain/pricing";

type AddressChoice = "home" | "work" | "manual";

const LABELS: Record<AddressChoice, string> = {
    home: "Casa",
    work: "Trabajo",
    manual: "Otra dirección"
};

const Checkout = () => {
    const { items, getTotalItems, clearCart } = useCartStore();

    const [loading, setLoading] = useState(false);
    const [profile, setProfile] = useState<(Profile & { accountId: string }) | null>(null);
    const [profileError, setProfileError] = useState<string | null>(null);
    const [choice, setChoice] = useState<AddressChoice>("home");
    const [manualAddress, setManualAddress] = useState("");
    const [phone, setPhone] = useState("");

    // Un solo identificador por intento: los reintentos lo reutilizan y el
    // servicio devuelve el pedido ya creado en lugar de duplicarlo.
    const requestIdRef = useRef(newClientRequestId());
    // Candado inmediato contra dobles pulsaciones (el estado tarda en reflejarse).
    const submittingRef = useRef(false);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const row: any = await getCurrentUser();
                if (!active) return;
                const mapped = mapProfileRow(row);
                setProfile({ ...mapped, accountId: row.accountId ?? row.$id });
                setPhone(mapped.phone);
                const available = listSelectableAddresses(mapped);
                if (available.length === 0) setChoice("manual");
                else setChoice(
                    available.some((a) => a.label === mapped.selectedAddress)
                        ? mapped.selectedAddress
                        : (available[0].label as AddressChoice)
                );
            } catch {
                if (active) setProfileError("No pudimos cargar tu perfil. Puedes escribir la dirección manualmente.");
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    const saved = useMemo(() => (profile ? listSelectableAddresses(profile) : []), [profile]);
    const totals = useMemo(() => computeOrderTotals(items), [items]);
    const totalItems = getTotalItems();

    const currentAddress = (): Partial<DeliveryAddress> | null => {
        if (choice === "manual") {
            return { label: "manual", line: manualAddress, latitude: null, longitude: null };
        }
        return saved.find((a) => a.label === choice) ?? null;
    };

    const handleConfirmOrder = async () => {
        if (submittingRef.current) return;

        if (items.length === 0) {
            Alert.alert("Carrito vacío", "Agrega productos antes de hacer un pedido.");
            return;
        }

        const addressCheck = validateDeliveryAddress(currentAddress());
        if (!addressCheck.valid || !addressCheck.values) {
            Alert.alert("Dirección de entrega", Object.values(addressCheck.errors)[0] ?? "Revisa la dirección.");
            return;
        }
        const phoneError = validatePhone(phone);
        if (phoneError) {
            Alert.alert("Teléfono de contacto", phoneError);
            return;
        }
        if (!profile) {
            Alert.alert("Sesión", "No pudimos identificar tu cuenta. Vuelve a iniciar sesión.");
            return;
        }

        submittingRef.current = true;
        setLoading(true);
        try {
            const result = await createOrderIdempotent({
                userId: profile.accountId,
                items,
                address: addressCheck.values,
                contact: { name: profile.name, phone: normalizePhone(phone) },
                clientRequestId: requestIdRef.current
            });

            // Solo aquí el pedido y sus artículos están guardados.
            clearCart();
            requestIdRef.current = newClientRequestId();

            Alert.alert(
                "Pedido confirmado",
                result.duplicate
                    ? "Tu pedido ya estaba registrado. No se cobró dos veces."
                    : "Tu pedido se registró correctamente.",
                [{ text: "Ver pedido", onPress: () => router.replace({ pathname: "/order/[id]", params: { id: result.orderId } }) }]
            );
        } catch (error) {
            console.log("Error al confirmar pedido:", error);
            // El carrito se conserva; el mismo requestId permite reintentar sin duplicar.
            const message =
                error instanceof OrderServiceError
                    ? error.message + (error.compensated ? " No se guardó nada; puedes reintentar." : " Revisa Mis pedidos antes de reintentar.")
                    : "No pudimos registrar tu pedido. Revisa tu conexión e inténtalo de nuevo.";
            Alert.alert("No se pudo confirmar", message);
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    return (
        <SafeAreaView className="flex-1 bg-white">
            <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
                <View className="flex-row items-center px-5 pt-3">
                    <TouchableOpacity
                        onPress={() => router.back()}
                        className="size-10 rounded-full bg-gray-100 items-center justify-center"
                        accessibilityLabel="Volver"
                    >
                        <Ionicons name="arrow-back" size={24} color="#181C2E" />
                    </TouchableOpacity>
                    <Text className="flex-1 text-center h3-bold text-dark-100 mr-10">Checkout</Text>
                </View>

                {/* Dirección de entrega */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">Dirección de entrega</Text>
                    {profileError && <Text className="small-regular text-red-500 mb-2">{profileError}</Text>}

                    <View className="flex-row mb-3">
                        {([...saved.map((a) => a.label), "manual"] as AddressChoice[]).map((key) => (
                            <TouchableOpacity
                                key={key}
                                onPress={() => setChoice(key)}
                                className={`mr-2 rounded-full px-4 py-2 border ${choice === key ? "bg-primary border-primary" : "border-gray-200"}`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: choice === key }}
                            >
                                <Text className={choice === key ? "text-white paragraph-bold" : "paragraph-medium text-dark-100"}>
                                    {LABELS[key]}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <View className="border border-gray-200 rounded-2xl p-5">
                        <View className="flex-row items-start">
                            <Ionicons name="location-outline" size={24} color="#FE8C00" />
                            <View className="ml-3 flex-1">
                                {choice === "manual" ? (
                                    <TextInput
                                        value={manualAddress}
                                        onChangeText={setManualAddress}
                                        placeholder="Calle, número, colonia, municipio"
                                        multiline
                                        className="paragraph-regular text-dark-100"
                                        accessibilityLabel="Dirección de entrega manual"
                                    />
                                ) : (
                                    <Text className="paragraph-regular text-dark-100">
                                        {saved.find((a) => a.label === choice)?.line}
                                    </Text>
                                )}
                            </View>
                        </View>
                        {saved.length === 0 && (
                            <TouchableOpacity onPress={() => router.push("/edit-profile")} className="mt-3">
                                <Text className="small-bold text-primary">Guardar direcciones en mi perfil</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    <Text className="paragraph-medium text-dark-100 mt-4 mb-2">Teléfono de contacto</Text>
                    <TextInput
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                        placeholder="10 dígitos"
                        className="border border-gray-200 rounded-2xl px-4 py-3 paragraph-regular text-dark-100"
                        accessibilityLabel="Teléfono de contacto"
                    />
                </View>

                {/* Resumen */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">Resumen del pedido</Text>
                    <View className="border border-gray-200 rounded-2xl p-5">
                        {items.map((item) => {
                            const price = unitPrice({ price: item.price, quantity: item.quantity, customizations: item.customizations });
                            const key = `${item.id}-${(item.customizations ?? []).map((c) => c.id).sort().join("-")}`;
                            return (
                                <View key={key} className="mb-5 flex-row justify-between">
                                    <View className="flex-1 pr-4">
                                        <Text className="base-bold text-dark-100">{item.name}</Text>
                                        <Text className="small-regular text-gray-200 mt-1">Cantidad: {item.quantity}</Text>
                                        {item.customizations && item.customizations.length > 0 && (
                                            <Text className="small-regular text-gray-200 mt-1">
                                                {item.customizations.map((c) => c.name).join(", ")}
                                            </Text>
                                        )}
                                    </View>
                                    <Text className="base-bold text-primary">{formatMoney(price * item.quantity)}</Text>
                                </View>
                            );
                        })}

                        <View className="border-t border-gray-200 pt-4">
                            <View className="flex-row justify-between mb-2">
                                <Text className="paragraph-regular text-gray-200">Artículos ({totalItems})</Text>
                                <Text className="paragraph-semibold text-dark-100">{formatMoney(totals.subtotal)}</Text>
                            </View>
                            <View className="flex-row justify-between mb-2">
                                <Text className="paragraph-regular text-gray-200">Envío</Text>
                                <Text className="paragraph-semibold text-dark-100">{formatMoney(totals.deliveryFee)}</Text>
                            </View>
                            <View className="flex-row justify-between mb-3">
                                <Text className="paragraph-regular text-gray-200">Descuento</Text>
                                <Text className="paragraph-semibold text-success">- {formatMoney(totals.discount)}</Text>
                            </View>
                            <View className="border-t border-gray-200 pt-3 flex-row justify-between">
                                <Text className="base-bold text-dark-100">Total</Text>
                                <Text className="h3-bold text-primary">{formatMoney(totals.total)}</Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* Pago */}
                <View className="px-5 mt-8">
                    <Text className="h3-bold text-dark-100 mb-4">Método de pago</Text>
                    <View className="border border-gray-200 rounded-2xl p-5 flex-row items-center">
                        <Ionicons name="cash-outline" size={24} color="#FE8C00" />
                        <View className="ml-3 flex-1">
                            <Text className="base-bold text-dark-100">Efectivo contra entrega</Text>
                            <Text className="small-regular text-gray-200 mt-1">Pagas cuando llegue tu pedido</Text>
                        </View>
                        <View className="size-6 rounded-full bg-primary items-center justify-center">
                            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                        </View>
                    </View>
                </View>

                <View className="px-5 mt-8">
                    <TouchableOpacity
                        onPress={handleConfirmOrder}
                        disabled={loading || items.length === 0}
                        className={`rounded-full py-5 ${loading || items.length === 0 ? "bg-gray-200" : "bg-primary"}`}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Text className="text-white text-center paragraph-bold">
                                Confirmar pedido - {formatMoney(totals.total)}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export default Checkout;
