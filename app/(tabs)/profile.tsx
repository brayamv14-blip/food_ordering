
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    Switch,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
    getCurrentUser,
    signOut
} from "@/lib/appwrite";
import useAuthStore from "@/store/auth.store";
import { Roles, getMyRoles } from "@/lib/services/roles";
import { isPushRegistered, registerForPush, unregisterPush } from "@/lib/services/notifications.service";

const Profile = () => {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [roles, setRoles] = useState<Roles>({ staff: false, driver: false });
    const [pushBusy, setPushBusy] = useState(false);

    const loadProfile = async () => {
        try {
            setLoading(true);

            const currentUser = await getCurrentUser();

            setUser(currentUser);
            // Solo decide que accesos mostrar; el servidor autoriza cada operacion.
            setRoles(await getMyRoles());
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

    const [pushOn, setPushOn] = useState(false);
    useEffect(() => {
        let alive = true;
        isPushRegistered().then((v) => alive && setPushOn(v));
        return () => {
            alive = false;
        };
    }, [user?.$id]);

    const togglePush = async (enable: boolean) => {
        if (!user || pushBusy) return;
        setPushBusy(true);
        try {
            if (!enable) {
                if (await unregisterPush()) setPushOn(false);
                else Alert.alert("Notificaciones", "No pudimos desactivarlas ahora. Revisa tu conexión e inténtalo de nuevo.");
                return;
            }
            const r = await registerForPush();
            if (r.status === "registered") {
                setPushOn(true);
            } else if (r.status === "denied") {
                Alert.alert("Notificaciones", "Para avisarte de tus pedidos necesitamos el permiso de notificaciones. Puedes activarlo en los ajustes del teléfono.");
            } else if (r.status === "not_configured") {
                Alert.alert("Notificaciones", "Falta configurar el proveedor de notificaciones (EXPO_PUBLIC_APPWRITE_PUSH_PROVIDER_ID). Consulta docs/NOTIFICACIONES.md.");
            } else if (r.status === "unsupported") {
                Alert.alert("Notificaciones", "Las notificaciones push están disponibles en Android.");
            } else if (r.status === "offline") {
                Alert.alert("Notificaciones", "Sin conexión. Inténtalo de nuevo cuando tengas internet.");
            } else {
                Alert.alert("Notificaciones", "No se pudieron activar en este dispositivo. Inténtalo de nuevo más tarde.");
            }
        } finally {
            setPushBusy(false);
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
                        onPress={() => router.push("/search")}
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

                                <Text className="mt-1 text-base font-semibold text-dark-100">
                                    {user?.phone || "No has agregado un teléfono"}
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
                            onPress={() => router.push("/edit-profile")}
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
                                    {user?.address1 || "No has agregado una dirección."}
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
                                    {user?.address2 || "No has agregado una dirección."}
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

                {/* NOTIFICACIONES DE PEDIDOS (opt-in) */}
                <View className="mb-3 flex-row items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <View className="flex-1 flex-row items-center pr-3">
                        <View className="h-11 w-11 items-center justify-center rounded-full bg-orange-50">
                            <Ionicons name="notifications-outline" size={22} color="#FF9C01" />
                        </View>
                        <View className="ml-3 flex-1">
                            <Text className="text-base font-bold text-dark-100">Notificaciones de pedidos</Text>
                            <Text className="text-xs text-gray-400">Te avisamos cuando cambie el estado de tu pedido.</Text>
                        </View>
                    </View>
                    <Switch
                        value={pushOn}
                        onValueChange={togglePush}
                        disabled={pushBusy}
                        accessibilityLabel="Activar notificaciones de pedidos"
                    />
                </View>

                {/* ACCESOS POR ROL (la autorización real está en el servidor) */}
                {roles.staff && (
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => router.push("/admin")}
                        className="mb-3 flex-row items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                    >
                        <View className="flex-row items-center">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-blue-50">
                                <Ionicons name="clipboard-outline" size={22} color="#3B82F6" />
                            </View>
                            <Text className="ml-3 text-base font-bold text-dark-100">Administrar pedidos</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={21} color="#9CA3AF" />
                    </TouchableOpacity>
                )}
                {roles.driver && (
                    <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => router.push("/driver")}
                        className="mb-3 flex-row items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                    >
                        <View className="flex-row items-center">
                            <View className="h-11 w-11 items-center justify-center rounded-full bg-purple-50">
                                <Ionicons name="bicycle-outline" size={22} color="#8B5CF6" />
                            </View>
                            <Text className="ml-3 text-base font-bold text-dark-100">Mis entregas</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={21} color="#9CA3AF" />
                    </TouchableOpacity>
                )}

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
                                    onPress: async () => {
                                        try {
                                            // Este dispositivo deja de recibir avisos de la cuenta que se cierra.
                                            if (pushOn) await unregisterPush();
                                            await signOut();
                                        } catch (e) {
                                            console.log("Error al cerrar sesión:", e);
                                        } finally {
                                            // Aunque falle la red, se limpia el estado local.
                                            useAuthStore.getState().setUser(null);
                                            useAuthStore.getState().setIsAuthenticated(false);
                                            router.replace("/sign-in");
                                        }
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
