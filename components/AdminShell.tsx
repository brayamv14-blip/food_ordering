import { ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { isAdminApiConfigured } from "@/lib/services/admin.service";
import { getMyRoles } from "@/lib/services/roles";

type Need = "admin" | "staff";

/** Hook de acceso: la UI solo oculta; el servidor vuelve a validar el rol en cada accion. */
export const useRoleGate = (need: Need = "admin"): boolean | null => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    useEffect(() => {
        getMyRoles().then((r) => setAllowed(need === "admin" ? r.admin : r.staff || r.admin)).catch(() => setAllowed(false));
    }, [need]);
    return allowed;
};

interface Props {
    title: string;
    allowed: boolean | null;
    loading?: boolean;
    error?: string | null;
    needsAdminApi?: boolean;
    right?: ReactNode;
    children: ReactNode;
}

/** Marco comun de las pantallas de administracion: cabecera, acceso, carga y error. */
const AdminShell = ({ title, allowed, loading = false, error, needsAdminApi = true, right, children }: Props) => {
    if (allowed === null) {
        return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    }
    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-4 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="flex-1 text-2xl font-bold text-dark-100">{title}</Text>
                {right}
            </View>
            {!allowed ? (
                <Text className="mt-10 px-8 text-center text-gray-400">Tu cuenta no tiene acceso a esta sección.</Text>
            ) : needsAdminApi && !isAdminApiConfigured() ? (
                <Text className="mt-10 px-8 text-center text-gray-400">Falta configurar la función de administración (EXPO_PUBLIC_FN_ADMIN_API).</Text>
            ) : (
                <>
                    {error ? <View className="mx-5 mb-3 rounded-xl bg-red-50 p-3"><Text className="text-sm text-red-500">{error}</Text></View> : null}
                    {loading ? <ActivityIndicator className="mt-10" size="large" color="#FF9C01" /> : children}
                </>
            )}
        </View>
    );
};

export default AdminShell;
