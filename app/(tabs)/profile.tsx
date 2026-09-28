
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
    getCurrentUser
} from "@/lib/appwrite";

const Profile = () => {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = async () => {
        try {
            setLoading(true);

            const currentUser = await getCurrentUser();

            setUser(currentUser);
        } catch (error) {
            console.log(
                "Error al cargar perfil:",
                error
            );

            Alert.alert(
                "Error",
                "No se pudo cargar tu perfil."
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

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator
                    size="large"
                    color="#FF9C01"
                />

                <Text className="mt-3 text-gray-400">
                    Cargando perfil...
                </Text>
            </View>
        );
    }

    const userName = user?.name || "Usuario";
    const userEmail = user?.email || "Sin correo";

    return (
        <View className="flex-1 bg-white">
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: 55,
                    paddingBottom: 130
                }}
            >
                {/* ENCABEZADO */}
                <View className="mb-7 flex-row items-center justify-between">
                    <TouchableOpacity
                        onPress={() => router.back()}
                        className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
                    >
                        <Ionicons
                            name="arrow-back"
                            size={22}
                            color="#221F1F"
                        />
                    </TouchableOpacity>

                    <Text className="text-2xl font-bold text-dark-100">
                        Profile
                    </Text>

                    <TouchableOpacity
                        onPress={() => {
                            Alert.alert(
                                "Buscar",
                                "La búsqueda estará disponible próximamente."
                            );
                        }}
                        className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
                    >
                        <Ionicons
                            name="search-outline"
                            size={22}
                            color="#221F1F"
                        />
                    </TouchableOpacity>
                </View>

                {/* FOTO DE PERFIL */}
                <View className="mb-8 items-center">
                    <View className="relative">
                        <View className="h-28 w-28 overflow-hidden rounded-full bg-orange-50">
                            {user?.avatar ? (
                                <Image
                                    source={{
                                        uri: user.avatar
                                    }}
                                    className="h-full w-full"
                                />
                            ) : (
                                <View className="flex-1 items-center justify-center">
                                    <Ionicons
                                        name="person"
                                        size={55}
                                        color="#FF9C01"
                                    />
                                </View>
                            )}
                        </View>

                        <TouchableOpacity
                            onPress={() => {
                                Alert.alert(
                                    "Foto de perfil",
                                    "La edición de foto estará disponible próximamente."
                                );
                            }}
                            className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full bg-primary"
                        >
                            <Ionicons
                                name="pencil"
                                size={17}
                                color="white"
                            />
                        </TouchableOpacity>
                    </View>

                    <Text className="mt-4 text-2xl font-bold text-dark-100">
                        {userName}
                    </Text>

                    <Text className="mt-1 text-sm text-gray-400">
                        {userEmail}
                    </Text>
                </View>

                {/* INFORMACIÓN PERSONAL */}
                <View className="mb-5">
                    <Text className="mb-4 text-xl font-bold text-dark-100">
                        Información personal
                    </Text>

                    {/* NOMBRE */}
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <View className="flex-row items-center">
                            <Ionicons
                                name="person-outline"
                                size={21}
                                color="#FF9C01"
                            />

                            <View className="ml-3 flex-1">
                                <Text className="text-xs text-gray-400">
                                    Nombre completo
                                </Text>

                                <Text className="mt-1 text-base font-semibold text-dark-100">
                                    {userName}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* EMAIL */}
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <View className="flex-row items-center">
                            <Ionicons
                                name="mail-outline"
                                size={21}
                                color="#FF9C01"
                            />

                            <View className="ml-3 flex-1">
                                <Text className="text-xs text-gray-400">
                                    Correo electrónico
                                </Text>

                                <Text className="mt-1 text-base font-semibold text-dark-100">
                                    {userEmail}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* TELÉFONO */}
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                        <View className="flex-row items-center">
                            <Ionicons
                                name="call-outline"
                                size={21}
                                color="#FF9C01"
                            />

                            <View className="ml-3 flex-1">
                                <Text className="text-xs text-gray-400">
                                    Número de teléfono
                                </Text>

                                <Text className="mt-1 text-base font-semibold text-gray-400">
                                    Próximamente
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* DIRECCIONES */}
                <View className="mb-5">
                    <View className="mb-4 flex-row items-center justify-between">
                        <Text className="text-xl font-bold text-dark-100">
                            Mis direcciones
                        </Text>

                        <TouchableOpacity
                            onPress={() => {
                                Alert.alert(
                                    "Direcciones",
                                    "Aquí podrás agregar y administrar tus direcciones."
                                );
                            }}
                        >
                            <Text className="font-semibold text-primary">
                                Administrar
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* CASA */}
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                        <View className="flex-row items-start">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-orange-50">
                                <Ionicons
                                    name="home-outline"
                                    size={22}
                                    color="#FF9C01"
                                />
                            </View>

                            <View className="ml-3 flex-1">
                                <Text className="text-base font-bold text-dark-100">
                                    Casa
                                </Text>

                                <Text className="mt-1 text-sm text-gray-400">
                                    No has agregado una dirección.
                                </Text>
                            </View>

                            <Ionicons
                                name="chevron-forward"
                                size={20}
                                color="#9CA3AF"
                            />
                        </View>
                    </View>

                    {/* TRABAJO */}
                    <View className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                        <View className="flex-row items-start">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-blue-50">
                                <Ionicons
                                    name="briefcase-outline"
                                    size={22}
                                    color="#3B82F6"
                                />
                            </View>

                            <View className="ml-3 flex-1">
                                <Text className="text-base font-bold text-dark-100">
                                    Trabajo
                                </Text>

                                <Text className="mt-1 text-sm text-gray-400">
                                    No has agregado una dirección.
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

                {/* EDITAR PERFIL */}
           <TouchableOpacity
    activeOpacity={0.8}
    onPress={() => router.push("/edit-profile")}
    className="mb-3 items-center rounded-2xl bg-primary py-4"
>
                    <Text className="text-base font-bold text-white">
                        Editar perfil
                    </Text>
                </TouchableOpacity>

                {/* MIS PEDIDOS */}
                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => router.push("/orders")}
                    className="mb-3 flex-row items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                >
                    <View className="flex-row items-center">
                        <View className="h-11 w-11 items-center justify-center rounded-full bg-orange-50">
                            <Ionicons
                                name="receipt-outline"
                                size={22}
                                color="#FF9C01"
                            />
                        </View>

                        <View className="ml-3">
                            <Text className="text-base font-bold text-dark-100">
                                Mis pedidos
                            </Text>

                            <Text className="mt-1 text-sm text-gray-400">
                                Consulta y sigue tus pedidos
                            </Text>
                        </View>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={21}
                        color="#9CA3AF"
                    />
                </TouchableOpacity>

                {/* LOGOUT */}
                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                        Alert.alert(
                            "Cerrar sesión",
                            "¿Estás seguro de que quieres cerrar sesión?",
                            [
                                {
                                    text: "Cancelar",
                                    style: "cancel"
                                },
                                {
                                    text: "Cerrar sesión",
                                    style: "destructive",
                                    onPress: () => {
                                        // Aquí conectaremos el logout
                                        // con tu auth store.
                                        Alert.alert(
                                            "Próximamente",
                                            "Aquí conectaremos el cierre de sesión."
                                        );
                                    }
                                }
                            ]
                        );
                    }}
                    className="mb-5 flex-row items-center justify-center rounded-2xl border border-red-200 bg-red-50 py-4"
                >
                    <Ionicons
                        name="log-out-outline"
                        size={21}
                        color="#EF4444"
                    />

                    <Text className="ml-2 text-base font-bold text-red-500">
                        Cerrar sesión
                    </Text>
                </TouchableOpacity>
            </ScrollView>
        </View>
    );
};

export default Profile;
