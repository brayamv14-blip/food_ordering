import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
    getCurrentUser,
    updateUserProfile
} from "@/lib/appwrite";

const EditProfile = () => {
    const [user, setUser] = useState<any>(null);

    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [address1, setAddress1] = useState("");
    const [address2, setAddress2] = useState("");

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadProfile = async () => {
        try {
            setLoading(true);

            const currentUser =
                await getCurrentUser();

            setUser(currentUser);

            setName(currentUser.name ?? "");
            setPhone(currentUser.phone ?? "");
            setAddress1(
                currentUser.address1 ?? ""
            );
            setAddress2(
                currentUser.address2 ?? ""
            );
        } catch (error) {
            console.log(
                "Error al cargar perfil:",
                error
            );

            Alert.alert(
                "Error",
                "No se pudo cargar tu información."
            );
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            loadProfile();
        }, [])
    );

    const handleSave = async () => {
        if (!name.trim()) {
            Alert.alert(
                "Campo requerido",
                "Escribe tu nombre completo."
            );
            return;
        }

        if (!phone.trim()) {
            Alert.alert(
                "Campo requerido",
                "Escribe tu número de teléfono."
            );
            return;
        }

        if (!address1.trim()) {
            Alert.alert(
                "Campo requerido",
                "Escribe tu dirección de casa."
            );
            return;
        }

        try {
            setSaving(true);

            await updateUserProfile({
                userId: user.$id,
                name: name.trim(),
                phone: phone.trim(),
                address1: address1.trim(),
                address2: address2.trim()
            });

            Alert.alert(
                "Perfil actualizado",
                "Tus datos se guardaron correctamente.",
                [
                    {
                        text: "OK",
                        onPress: () =>
                            router.back()
                    }
                ]
            );
        } catch (error) {
            console.log(
                "Error al guardar perfil:",
                error
            );

            Alert.alert(
                "Error",
                "No se pudieron guardar tus cambios."
            );
        } finally {
            setSaving(false);
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
                    Cargando información...
                </Text>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView
            className="flex-1 bg-white"
            behavior={
                Platform.OS === "ios"
                    ? "padding"
                    : undefined
            }
        >
            <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: 55,
                    paddingBottom: 40
                }}
            >
                {/* ENCABEZADO */}
                <View className="mb-8 flex-row items-center">
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

                    <Text className="text-2xl font-bold text-dark-100">
                        Editar perfil
                    </Text>
                </View>

                {/* NOMBRE */}
                <View className="mb-5">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">
                        Nombre completo
                    </Text>

                    <View className="flex-row items-center rounded-2xl border border-gray-200 bg-gray-50 px-4">
                        <Ionicons
                            name="person-outline"
                            size={21}
                            color="#FF9C01"
                        />

                        <TextInput
                            value={name}
                            onChangeText={setName}
                            placeholder="Tu nombre completo"
                            placeholderTextColor="#9CA3AF"
                            className="ml-3 flex-1 py-4 text-base text-dark-100"
                        />
                    </View>
                </View>

                {/* EMAIL */}
                <View className="mb-5">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">
                        Correo electrónico
                    </Text>

                    <View className="flex-row items-center rounded-2xl border border-gray-200 bg-gray-100 px-4">
                        <Ionicons
                            name="mail-outline"
                            size={21}
                            color="#9CA3AF"
                        />

                        <Text className="ml-3 flex-1 py-4 text-base text-gray-400">
                            {user?.email ??
                                "Sin correo"}
                        </Text>
                    </View>

                    <Text className="mt-2 text-xs text-gray-400">
                        El correo electrónico no se puede
                        modificar desde aquí.
                    </Text>
                </View>

                {/* TELÉFONO */}
                <View className="mb-5">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">
                        Número de teléfono
                    </Text>

                    <View className="flex-row items-center rounded-2xl border border-gray-200 bg-gray-50 px-4">
                        <Ionicons
                            name="call-outline"
                            size={21}
                            color="#FF9C01"
                        />

                        <TextInput
                            value={phone}
                            onChangeText={setPhone}
                            placeholder="Ej. 5512345678"
                            placeholderTextColor="#9CA3AF"
                            keyboardType="phone-pad"
                            className="ml-3 flex-1 py-4 text-base text-dark-100"
                        />
                    </View>
                </View>

                {/* DIRECCIÓN CASA */}
                <View className="mb-5">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">
                        Dirección de casa
                    </Text>

                    <View className="flex-row items-start rounded-2xl border border-gray-200 bg-gray-50 px-4">
                        <Ionicons
                            name="home-outline"
                            size={21}
                            color="#FF9C01"
                            style={{
                                marginTop: 16
                            }}
                        />

                        <TextInput
                            value={address1}
                            onChangeText={setAddress1}
                            placeholder="Calle, número, colonia, municipio..."
                            placeholderTextColor="#9CA3AF"
                            multiline
                            textAlignVertical="top"
                            className="ml-3 flex-1 py-4 text-base text-dark-100"
                        />
                    </View>
                </View>

                {/* DIRECCIÓN TRABAJO */}
                <View className="mb-8">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">
                        Dirección de trabajo
                    </Text>

                    <View className="flex-row items-start rounded-2xl border border-gray-200 bg-gray-50 px-4">
                        <Ionicons
                            name="briefcase-outline"
                            size={21}
                            color="#3B82F6"
                            style={{
                                marginTop: 16
                            }}
                        />

                        <TextInput
                            value={address2}
                            onChangeText={setAddress2}
                            placeholder="Calle, número, colonia..."
                            placeholderTextColor="#9CA3AF"
                            multiline
                            textAlignVertical="top"
                            className="ml-3 flex-1 py-4 text-base text-dark-100"
                        />
                    </View>

                    <Text className="mt-2 text-xs text-gray-400">
                        Esta dirección es opcional.
                    </Text>
                </View>

                {/* GUARDAR */}
                <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={saving}
                    onPress={handleSave}
                    className={`items-center rounded-2xl py-4 ${
                        saving
                            ? "bg-orange-300"
                            : "bg-primary"
                    }`}
                >
                    {saving ? (
                        <View className="flex-row items-center">
                            <ActivityIndicator
                                color="white"
                                size="small"
                            />

                            <Text className="ml-2 text-base font-bold text-white">
                                Guardando...
                            </Text>
                        </View>
                    ) : (
                        <Text className="text-base font-bold text-white">
                            Guardar cambios
                        </Text>
                    )}
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default EditProfile;
