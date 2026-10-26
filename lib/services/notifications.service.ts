import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { appwriteConfig, databases } from "@/lib/appwrite";
import { isExpoPushToken } from "@/lib/domain/notifications";

export type PushRegistration =
    | { status: "registered"; token: string }
    | { status: "denied" }
    | { status: "not_configured" }
    | { status: "unavailable" };

const saveToken = (profileRowId: string, pushToken: string | null) =>
    databases.updateRow({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.userCollectionId,
        rowId: profileRowId,
        data: { pushToken }
    });

/**
 * Activa las notificaciones de pedidos: pide permiso, obtiene el token de Expo y lo
 * guarda en el perfil del usuario. Solo se llama cuando el usuario lo activa.
 * Requiere un projectId de EAS (`npx eas-cli init`) y credenciales FCM en Android.
 */
export async function registerForPush(profileRowId: string): Promise<PushRegistration> {
    try {
        const projectId =
            (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
            Constants.easConfig?.projectId;
        if (!projectId) return { status: "not_configured" };

        if (Platform.OS === "android") {
            await Notifications.setNotificationChannelAsync("orders", {
                name: "Pedidos",
                importance: Notifications.AndroidImportance.HIGH
            });
        }

        let { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") {
            ({ status } = await Notifications.requestPermissionsAsync());
        }
        if (status !== "granted") return { status: "denied" };

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!isExpoPushToken(token)) return { status: "unavailable" };

        await saveToken(profileRowId, token);
        return { status: "registered", token };
    } catch {
        return { status: "unavailable" };
    }
}

/** Desactiva las notificaciones: borra el token del perfil (tambien al cerrar sesion). */
export async function unregisterPush(profileRowId: string): Promise<boolean> {
    try {
        await saveToken(profileRowId, null);
        return true;
    } catch {
        return false;
    }
}
