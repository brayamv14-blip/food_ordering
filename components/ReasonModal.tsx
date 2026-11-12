import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Text, TextInput, TouchableOpacity, View } from "react-native";

interface Props {
    visible: boolean;
    title: string;
    /** Motivos frecuentes (se eligen con un toque). */
    options?: readonly string[];
    /** Texto del boton de confirmar. */
    confirmLabel: string;
    /** Si es true, el motivo es obligatorio (mínimo 3 caracteres). */
    required?: boolean;
    busy?: boolean;
    destructive?: boolean;
    /** Campo extra opcional (p. ej. importe de un reembolso parcial). */
    amountLabel?: string;
    onConfirm: (reason: string, amount?: number) => void;
    onClose: () => void;
}

/** Pide un motivo (y opcionalmente un importe). La validacion real vuelve a hacerla el servidor. */
const ReasonModal = ({ visible, title, options = [], confirmLabel, required = true, busy = false, destructive = false, amountLabel, onConfirm, onClose }: Props) => {
    const [reason, setReason] = useState("");
    const [amount, setAmount] = useState("");

    useEffect(() => {
        if (visible) {
            setReason("");
            setAmount("");
        }
    }, [visible]);

    const trimmed = reason.trim();
    const amountNumber = amount.trim() === "" ? undefined : Number(amount.replace(",", "."));
    const amountInvalid = amountNumber !== undefined && (!Number.isFinite(amountNumber) || amountNumber <= 0);
    const canConfirm = !busy && !amountInvalid && (!required || trimmed.length >= 3);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end bg-black/50">
                <View className="rounded-t-3xl bg-white px-5 pb-8 pt-5">
                    <Text className="mb-3 text-lg font-bold text-dark-100">{title}</Text>
                    <View className="mb-3 flex-row flex-wrap">
                        {options.map((o) => (
                            <TouchableOpacity key={o} onPress={() => setReason(o)} accessibilityRole="button" accessibilityLabel={`Motivo: ${o}`}
                                className={`mb-2 mr-2 rounded-full border px-3 py-2 ${trimmed === o ? "border-primary bg-primary/10" : "border-gray-200"}`}>
                                <Text className={trimmed === o ? "font-semibold text-primary" : "text-dark-100"}>{o}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <TextInput
                        value={reason}
                        onChangeText={setReason}
                        placeholder={required ? "Escribe el motivo (mínimo 3 caracteres)" : "Comentario (opcional)"}
                        maxLength={200}
                        multiline
                        className="mb-3 min-h-[44px] rounded-xl border border-gray-200 px-3 py-2 text-dark-100"
                        accessibilityLabel="Motivo"
                    />
                    {amountLabel && (
                        <TextInput
                            value={amount}
                            onChangeText={setAmount}
                            placeholder={amountLabel}
                            keyboardType="decimal-pad"
                            className={`mb-3 rounded-xl border px-3 py-2 text-dark-100 ${amountInvalid ? "border-red-400" : "border-gray-200"}`}
                            accessibilityLabel={amountLabel}
                        />
                    )}
                    <View className="flex-row">
                        <TouchableOpacity onPress={onClose} className="mr-2 flex-1 items-center rounded-xl border border-gray-200 py-3" accessibilityRole="button">
                            <Text className="font-semibold text-dark-100">Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => canConfirm && onConfirm(trimmed, amountNumber)}
                            disabled={!canConfirm}
                            className={`ml-2 flex-1 items-center rounded-xl py-3 ${canConfirm ? (destructive ? "bg-red-500" : "bg-primary") : "bg-gray-300"}`}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !canConfirm }}
                        >
                            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">{confirmLabel}</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

export default ReasonModal;
