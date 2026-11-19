import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { getMyDeliveryCode } from "@/lib/services/staff.service";

/** V16: muestra al CLIENTE su código de entrega cuando el servidor lo exige (DELIVERY_OTP) y el pedido ya va a salir/va en camino. */
const DeliveryCodeBadge = ({ orderId, status }: { orderId: string; status: string | null }) => {
    const [code, setCode] = useState<string | null>(null);
    const active = status === "ready" || status === "picked_up" || status === "on_the_way";
    useEffect(() => {
        if (!active) return;
        let alive = true;
        getMyDeliveryCode(orderId).then((r) => { if (alive) setCode(r.enabled ? r.code : null); }).catch(() => { if (alive) setCode(null); });
        return () => { alive = false; };
    }, [orderId, active]);
    if (!active || !code) return null;
    return (
        <View className="mt-4 items-center rounded-2xl border border-primary bg-orange-50 p-4" accessibilityLiveRegion="polite">
            <Text className="text-sm text-gray-500">Código de entrega</Text>
            <Text className="text-4xl font-bold tracking-widest text-dark-100" accessibilityLabel={`Código de entrega ${code.split("").join(" ")}`}>{code}</Text>
            <Text className="mt-1 text-center text-xs text-gray-500">Díselo al repartidor al recibir tu pedido. No lo compartas antes.</Text>
        </View>
    );
};

export default DeliveryCodeBadge;
