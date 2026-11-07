import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import { routeFromNotificationData } from "@/lib/domain/notifications";
import { ensureOrdersChannel, refreshPushToken } from "@/lib/services/notifications.service";

/**
 * Muestra las notificaciones con la app abierta y lleva a la pantalla correcta al
 * tocarlas (tambien si la app estaba cerrada). No renderiza nada.
 */
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false
    })
});

const NotificationHandler = () => {
    useEffect(() => {
        const open = (data: unknown) => {
            const route = routeFromNotificationData(data);
            if (route) router.push(route as never);
        };

        // Aviso tocado mientras la app estaba cerrada.
        Notifications.getLastNotificationResponseAsync()
            .then((r) => r && open(r.notification.request.content.data))
            .catch(() => {});

        const sub = Notifications.addNotificationResponseReceivedListener((r) =>
            open(r.notification.request.content.data)
        );
        // FCM puede renovar el token: se actualiza el destino de Appwrite si este dispositivo ya estaba registrado.
        const tokenSub = Notifications.addPushTokenListener((t) => {
            void refreshPushToken(t.data);
        });
        ensureOrdersChannel().catch(() => {});

        return () => {
            sub.remove();
            tokenSub.remove();
        };
    }, []);

    return null;
};

export default NotificationHandler;
