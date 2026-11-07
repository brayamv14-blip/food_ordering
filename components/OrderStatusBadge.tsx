import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { getStatusMeta } from "@/lib/domain/orderStatus";

const OrderStatusBadge = ({ status }: { status: unknown }) => {
    const meta = getStatusMeta(status);
    return (
        <View
            className="flex-row items-center rounded-full px-3 py-2"
            style={{ backgroundColor: meta.background }}
            accessibilityLabel={`Estado del pedido: ${meta.label}`}
        >
            <Ionicons name={meta.icon as any} size={16} color={meta.color} />
            <Text className="ml-1 text-sm font-bold" style={{ color: meta.color }}>
                {meta.label}
            </Text>
        </View>
    );
};

export default OrderStatusBadge;
