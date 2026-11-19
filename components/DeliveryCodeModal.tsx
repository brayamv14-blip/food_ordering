import { useState } from "react";
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";

/** V16: el repartidor escribe el codigo de 4 digitos que le dicta el cliente para confirmar la entrega (OTP). */
type Props = { visible: boolean; wrong: boolean; busy: boolean; onClose: () => void; onSubmit: (code: string) => void };

// El formulario se remonta cada vez que se abre (key), así el campo siempre empieza vacío sin efectos.
const DeliveryCodeModal = (props: Props) => <CodeForm key={props.visible ? "open" : "closed"} {...props} />;

const CodeForm = ({ visible, wrong, busy, onClose, onSubmit }: Props) => {
    const [code, setCode] = useState("");
    const valid = /^\d{4}$/.test(code);
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View className="flex-1 items-center justify-center bg-black/40 px-8">
                <View className="w-full rounded-2xl bg-white p-5">
                    <Text className="text-lg font-bold text-dark-100">Código de entrega</Text>
                    <Text className="mt-1 text-sm text-gray-500">Pídele al cliente el código de 4 dígitos que ve en su pedido.</Text>
                    {wrong && <Text className="mt-2 text-sm text-red-500">El código no es correcto. Inténtalo de nuevo.</Text>}
                    <TextInput
                        value={code}
                        onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 4))}
                        keyboardType="number-pad"
                        maxLength={4}
                        placeholder="0000"
                        className="mt-3 rounded-xl border border-gray-200 px-4 py-3 text-center text-2xl font-bold tracking-widest"
                        accessibilityLabel="Código de entrega"
                    />
                    <View className="mt-4 flex-row">
                        <TouchableOpacity onPress={onClose} className="mr-2 flex-1 items-center rounded-xl border border-gray-300 py-3" accessibilityRole="button"><Text>Cancelar</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => valid && onSubmit(code)} disabled={!valid || busy} className={`flex-1 items-center rounded-xl py-3 ${valid && !busy ? "bg-primary" : "bg-gray-300"}`} accessibilityRole="button">
                            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Confirmar entrega</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

export default DeliveryCodeModal;
