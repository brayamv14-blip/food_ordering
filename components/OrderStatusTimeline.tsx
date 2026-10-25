import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import {
    PROGRESS_STEPS,
    STATUS_META,
    getProgressIndex,
    getStatusMeta,
    parseOrderStatus
} from "@/lib/domain/orderStatus";

/** Linea de progreso vertical. Cancelado y desconocido se muestran aparte. */
const OrderStatusTimeline = ({ status }: { status: unknown }) => {
    const parsed = parseOrderStatus(status);
    const current = getProgressIndex(status);

    if (parsed === "cancelled" || parsed === null) {
        const meta = getStatusMeta(status);
        return (
            <View className="flex-row items-center rounded-2xl p-4" style={{ backgroundColor: meta.background }}>
                <Ionicons name={meta.icon as any} size={24} color={meta.color} />
                <View className="ml-3 flex-1">
                    <Text className="base-bold" style={{ color: meta.color }}>{meta.label}</Text>
                    <Text className="small-regular text-gray-200 mt-1">{meta.description}</Text>
                </View>
            </View>
        );
    }

    return (
        <View>
            {PROGRESS_STEPS.map((step, index) => {
                const meta = STATUS_META[step];
                const done = index <= current;
                const isCurrent = index === current;
                const color = done ? meta.color : "#D1D5DB";
                return (
                    <View key={step} className="flex-row" accessibilityLabel={`${meta.label}${isCurrent ? ", paso actual" : done ? ", completado" : ", pendiente"}`}>
                        <View className="items-center mr-3">
                            <View
                                className="size-8 rounded-full items-center justify-center"
                                style={{ backgroundColor: done ? color : "#F3F4F6", borderWidth: isCurrent ? 2 : 0, borderColor: color }}
                            >
                                <Ionicons name={(done ? "checkmark" : "ellipse-outline") as any} size={16} color={done ? "#FFFFFF" : "#9CA3AF"} />
                            </View>
                            {index < PROGRESS_STEPS.length - 1 && (
                                <View style={{ width: 2, height: 28, backgroundColor: index < current ? color : "#E5E7EB" }} />
                            )}
                        </View>
                        <View className="pb-5 flex-1">
                            <Text className={isCurrent ? "base-bold text-dark-100" : "paragraph-medium text-gray-200"}>
                                {meta.label}
                            </Text>
                            {isCurrent && <Text className="small-regular text-gray-200">{meta.description}</Text>}
                        </View>
                    </View>
                );
            })}
        </View>
    );
};

export default OrderStatusTimeline;
