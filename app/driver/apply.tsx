import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { listStores, PublicStore } from "@/lib/services/store.service";
import { DRIVER_VEHICLES, DriverAccountState, applyDriver, describeBackendError, getMyDriverStatus } from "@/lib/services/staff.service";

/** V16: solicitud para ser repartidor. Queda PENDIENTE hasta que un administrador la apruebe (el servidor nunca da el rol directamente). */
const ApplyDriver = () => {
    const [state, setState] = useState<DriverAccountState | "loading">("loading");
    const [phone, setPhone] = useState("");
    const [vehicle, setVehicle] = useState<string>("moto");
    const [note, setNote] = useState("");
    const [stores, setStores] = useState<PublicStore[]>([]);
    const [storeId, setStoreId] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        getMyDriverStatus().then((r) => setState(r.state)).catch(() => setState(null));
        listStores().then((r) => { if (r.enabled) { setStores(r.stores); setStoreId(r.defaultStoreId); } }).catch(() => {});
    }, []);

    const submit = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await applyDriver({ phone, vehicle, note: note.trim() || undefined, storeId: storeId || undefined });
            setState("pending");
        } catch (e) {
            Alert.alert("No se pudo enviar", describeBackendError(e));
        } finally {
            setBusy(false);
        }
    };

    if (state === "loading") return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    const message = state === "pending" ? "Tu solicitud está en revisión. Te avisaremos cuando un administrador la apruebe."
        : state === "approved" ? "Tu cuenta ya es de repartidor. Ve a “Mis entregas”."
        : state === "suspended" ? "Tu cuenta de repartidor está suspendida. Contacta al administrador." : null;

    return (
        <ScrollView className="flex-1 bg-white" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <View className="mb-4 flex-row items-center">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver"><Ionicons name="arrow-back" size={22} color="#221F1F" /></TouchableOpacity>
                <Text className="text-2xl font-bold text-dark-100">Ser repartidor</Text>
            </View>
            {message ? (
                <View className="rounded-2xl border border-gray-100 p-4">
                    <Text className="text-base text-dark-100">{message}</Text>
                    {state === "approved" && <TouchableOpacity onPress={() => router.replace("/driver")} className="mt-4 items-center rounded-xl bg-primary py-3"><Text className="font-bold text-white">Mis entregas</Text></TouchableOpacity>}
                </View>
            ) : (
                <>
                    <Text className="mb-1 text-sm text-gray-500">Teléfono de contacto</Text>
                    <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={16} placeholder="55 1234 5678" className="mb-3 rounded-xl border border-gray-200 px-3 py-3" />
                    <Text className="mb-1 text-sm text-gray-500">Vehículo</Text>
                    <View className="mb-3 flex-row flex-wrap">
                        {DRIVER_VEHICLES.map(([k, l]) => (
                            <TouchableOpacity key={k} onPress={() => setVehicle(k)} className={`mb-2 mr-2 rounded-full border px-4 py-2 ${vehicle === k ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: vehicle === k }}><Text className={vehicle === k ? "font-bold text-white" : "text-dark-100"}>{l}</Text></TouchableOpacity>
                        ))}
                    </View>
                    {stores.length > 1 && (
                        <>
                            <Text className="mb-1 text-sm text-gray-500">Tienda donde quieres repartir</Text>
                            <View className="mb-3 flex-row flex-wrap">
                                {stores.map((s) => (
                                    <TouchableOpacity key={s.id} onPress={() => setStoreId(s.id)} className={`mb-2 mr-2 rounded-full border px-4 py-2 ${storeId === s.id ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: storeId === s.id }}><Text className={storeId === s.id ? "font-bold text-white" : "text-dark-100"}>{s.name}</Text></TouchableOpacity>
                                ))}
                            </View>
                        </>
                    )}
                    <Text className="mb-1 text-sm text-gray-500">Comentarios (opcional)</Text>
                    <TextInput value={note} onChangeText={setNote} maxLength={200} multiline placeholder="Disponibilidad, experiencia…" className="mb-4 rounded-xl border border-gray-200 px-3 py-3" />
                    <TouchableOpacity onPress={submit} disabled={busy || phone.replace(/\D/g, "").length < 10} className={`items-center rounded-xl py-4 ${busy || phone.replace(/\D/g, "").length < 10 ? "bg-gray-300" : "bg-primary"}`} accessibilityRole="button">
                        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Enviar solicitud</Text>}
                    </TouchableOpacity>
                </>
            )}
        </ScrollView>
    );
};

export default ApplyDriver;
