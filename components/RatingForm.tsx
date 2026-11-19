import { useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export const Stars = ({ value, onChange, size = 32, label }: { value: number; onChange?: (n: number) => void; size?: number; label: string }) => (
    <View className="flex-row" accessibilityLabel={`${label}: ${value} de 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
            <TouchableOpacity
                key={n}
                disabled={!onChange}
                onPress={() => onChange?.(n)}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${n} ${n === 1 ? "estrella" : "estrellas"}`}
                className="mr-1"
            >
                <Ionicons name={n <= value ? "star" : "star-outline"} size={size} color="#FE8C00" />
            </TouchableOpacity>
        ))}
    </View>
);

interface Props {
    hasDriver: boolean;
    busy: boolean;
    onSubmit: (v: { rating: number; driverRating: number | null; comment: string }) => void;
}

/** Calificacion tras la entrega: pedido (obligatorio), repartidor (si hubo) y comentario opcional. */
const RatingForm = ({ hasDriver, busy, onSubmit }: Props) => {
    const [rating, setRating] = useState(0);
    const [driverRating, setDriverRating] = useState(0);
    const [comment, setComment] = useState("");

    return (
        <View className="border border-gray-200 rounded-2xl p-5">
            <Text className="base-bold text-dark-100">¿Cómo estuvo tu pedido?</Text>
            <View className="mt-3"><Stars value={rating} onChange={setRating} label="Calificación del pedido" /></View>
            {hasDriver && (
                <>
                    <Text className="base-bold text-dark-100 mt-5">¿Y el repartidor?</Text>
                    <View className="mt-3"><Stars value={driverRating} onChange={setDriverRating} size={26} label="Calificación del repartidor" /></View>
                </>
            )}
            <TextInput
                value={comment}
                onChangeText={(t) => setComment(t.slice(0, 300))}
                placeholder="Comentario (opcional)"
                multiline
                className="mt-5 min-h-[72px] rounded-xl border border-gray-200 p-3 text-dark-100"
                accessibilityLabel="Comentario"
            />
            <TouchableOpacity
                disabled={rating === 0 || busy}
                onPress={() => onSubmit({ rating, driverRating: driverRating || null, comment })}
                className={`mt-4 rounded-full py-4 ${rating === 0 ? "bg-gray-200" : "bg-primary"}`}
                accessibilityRole="button"
                accessibilityLabel="Enviar calificación"
            >
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-center paragraph-bold text-white">Enviar calificación</Text>}
            </TouchableOpacity>
        </View>
    );
};

export default RatingForm;
