import * as Application from "expo-application";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { account, appwriteConfig } from "@/lib/appwrite";
import { deviceTargetId, findPushTarget, isFcmToken } from "@/lib/domain/notifications";

export type PushRegistration =
    | { status: "registered"; targetId: string }
    | { status: "denied" }
    | { status: "not_configured" }
    | { status: "unsupported" }
    | { status: "offline" }
    | { status: "unavailable" };

export const ORDERS_CHANNEL_ID = "orders";

/** Canal Android de pedidos (el mismo que usa `defaultChannel` de app.json para los push de FCM). */
export async function ensureOrdersChannel(): Promise<void> {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync(ORDERS_CHANNEL_ID, {
        name: "Pedidos",
        importance: Notifications.AndroidImportance.HIGH
    });
}

const errCode = (e: unknown): number | undefined => (e && typeof e === "object" ? (e as { code?: number }).code : undefined);
const isOffline = (e: unknown): boolean => {
    const m = e instanceof Error ? e.message : "";
    return /network|timeout|failed to fetch|offline|ECONN/i.test(m) && errCode(e) === undefined;
};

/** Id estable del destino de este dispositivo (null si la plataforma no da un id de dispositivo). */
async function currentTargetId(): Promise<string | null> {
    if (Platform.OS !== "android") return null;
    try {
        return deviceTargetId(await Application.getAndroidId());
    } catch {
        return null;
    }
}

/**
 * Crea el destino push o, si ya existe (mismo dispositivo), solo actualiza el token. Nunca crea dos
 * destinos para el mismo dispositivo: el id es fijo y un 409 de Appwrite se resuelve con una actualizacion.
 */
async function upsertTarget(targetId: string, token: string): Promise<void> {
    try {
        await account.createPushTarget({ targetId, identifier: token, providerId: appwriteConfig.pushProviderId });
    } catch (e) {
        if (errCode(e) !== 409) throw e;
        await account.updatePushTarget({ targetId, identifier: token });
    }
}

/**
 * Activa las notificaciones de pedidos en ESTE dispositivo: pide permiso, obtiene el token FCM nativo y
 * lo registra como destino push de la cuenta en Appwrite Messaging. Solo se llama cuando el usuario lo activa.
 * Requiere google-services.json (Firebase) en el build y el proveedor FCM de Appwrite configurado.
 */
export async function registerForPush(): Promise<PushRegistration> {
    try {
        if (!appwriteConfig.pushProviderId) return { status: "not_configured" };
        if (Platform.OS !== "android") return { status: "unsupported" };
        const targetId = await currentTargetId();
        if (!targetId) return { status: "unavailable" };

        await ensureOrdersChannel();

        let { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
        if (status !== "granted") return { status: "denied" };

        const token = (await Notifications.getDevicePushTokenAsync()).data;
        if (!isFcmToken(token)) return { status: "unavailable" };

        await upsertTarget(targetId, token);
        return { status: "registered", targetId };
    } catch (e) {
        return { status: isOffline(e) ? "offline" : "unavailable" };
    }
}

/** ¿Este dispositivo ya esta registrado en la cuenta actual? (consulta los destinos reales en Appwrite). */
export async function isPushRegistered(): Promise<boolean> {
    try {
        const targetId = await currentTargetId();
        if (!targetId) return false;
        const me = await account.get();
        return !!findPushTarget((me as { targets?: unknown }).targets, targetId);
    } catch {
        return false;
    }
}

/** Desactiva las notificaciones de este dispositivo (tambien al cerrar sesion). */
export async function unregisterPush(): Promise<boolean> {
    try {
        const targetId = await currentTargetId();
        if (!targetId) return true;
        try {
            await account.deletePushTarget({ targetId });
        } catch (e) {
            if (errCode(e) !== 404) throw e; // ya no existia: queda igual
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * Renovacion del token: FCM puede cambiarlo. Solo actualiza si este dispositivo ya estaba registrado
 * (si el usuario no activo los avisos, no se crea nada).
 */
export async function refreshPushToken(newToken: unknown): Promise<boolean> {
    try {
        if (!isFcmToken(newToken) || !appwriteConfig.pushProviderId) return false;
        const targetId = await currentTargetId();
        if (!targetId) return false;
        const me = await account.get();
        if (!findPushTarget((me as { targets?: unknown }).targets, targetId)) return false;
        await account.updatePushTarget({ targetId, identifier: newToken });
        return true;
    } catch {
        return false;
    }
}
