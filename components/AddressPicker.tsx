import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useDebounce } from "use-debounce";

import LeafletMap from "@/components/LeafletMap";
import { LatLng } from "@/lib/domain/coordinates";
import { DEFAULT_MAP_CENTER, GeoPlace } from "@/lib/domain/geo";
import { getCurrentPosition } from "@/lib/services/location";
import { autocompleteAddress, geoFailureMessage, isGeoConfigured, reverseGeocode } from "@/lib/services/geocoding";

interface Props {
    /** Se llama con una dirección ya validada por el geocodificador (texto + coordenadas reales). */
    onSelect: (place: GeoPlace) => void;
    initial?: LatLng | null;
}

/**
 * Buscar dirección (autocompletar), usar el GPS (se pide permiso solo al tocar el botón) o elegir un
 * punto en el mapa. Siempre devuelve texto + coordenadas reales; nunca coordenadas inventadas.
 */
const AddressPicker = ({ onSelect, initial }: Props) => {
    const [text, setText] = useState("");
    const [debounced] = useDebounce(text, 450);
    const [suggestions, setSuggestions] = useState<GeoPlace[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [mapOpen, setMapOpen] = useState(false);
    const [picked, setPicked] = useState<GeoPlace | null>(null);
    const [pickBusy, setPickBusy] = useState(false);
    const configured = isGeoConfigured();

    useEffect(() => {
        let alive = true;
        if (!configured || debounced.trim().length < 3) {
            setSuggestions([]);
            return;
        }
        setBusy(true);
        autocompleteAddress(debounced).then((r) => {
            if (!alive) return;
            setBusy(false);
            if (r.ok) {
                setSuggestions(r.value);
                setMessage(null);
            } else {
                setSuggestions([]);
                setMessage(geoFailureMessage(r.reason));
            }
        });
        return () => {
            alive = false;
        };
    }, [debounced, configured]);

    const choose = (p: GeoPlace) => {
        setSuggestions([]);
        setText("");
        setMessage(null);
        onSelect(p);
    };

    const useGps = async () => {
        setBusy(true);
        const pos = await getCurrentPosition();
        if (!pos.ok) {
            setBusy(false);
            setMessage(pos.message);
            return;
        }
        const r = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setBusy(false);
        if (r.ok) choose(r.value);
        else setMessage(geoFailureMessage(r.reason));
    };

    const onMapPick = async (p: LatLng) => {
        setPickBusy(true);
        setPicked(null);
        const r = await reverseGeocode(p.latitude, p.longitude);
        setPickBusy(false);
        if (r.ok) setPicked({ ...r.value, latitude: p.latitude, longitude: p.longitude });
        else setMessage(geoFailureMessage(r.reason));
    };

    return (
        <View>
            <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Buscar dirección (calle, número, colonia)"
                className="rounded-2xl border border-gray-200 px-4 py-3 text-dark-100"
                accessibilityLabel="Buscar dirección"
                editable={configured}
            />
            {busy && <ActivityIndicator size="small" color="#FF9C01" className="mt-2" />}
            {suggestions.map((s, i) => (
                <TouchableOpacity key={`${s.latitude},${s.longitude},${i}`} onPress={() => choose(s)} className="border-b border-gray-100 py-3" accessibilityRole="button">
                    <Text className="text-dark-100">{s.line}</Text>
                </TouchableOpacity>
            ))}
            {message && <Text className="mt-2 text-xs text-red-500">{message}</Text>}
            {!configured && <Text className="mt-2 text-xs text-gray-400">{geoFailureMessage("not_configured")}</Text>}
            <View className="mt-3 flex-row">
                <TouchableOpacity onPress={useGps} className="mr-4 flex-row items-center" accessibilityRole="button">
                    <Ionicons name="locate-outline" size={18} color="#FF9C01" />
                    <Text className="ml-1 text-sm font-semibold text-primary">Usar mi ubicación</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMapOpen(true)} disabled={!configured} className="flex-row items-center" accessibilityRole="button">
                    <Ionicons name="map-outline" size={18} color="#FF9C01" />
                    <Text className="ml-1 text-sm font-semibold text-primary">Elegir en el mapa</Text>
                </TouchableOpacity>
            </View>
            <Text className="mt-2 text-xs text-gray-400">Usamos tu ubicación solo para llenar la dirección de entrega.</Text>

            <Modal visible={mapOpen} animationType="slide" onRequestClose={() => setMapOpen(false)}>
                <SafeAreaView className="flex-1 bg-white">
                    <Text className="px-5 py-3 text-base font-bold text-dark-100">Toca el mapa para elegir el punto de entrega</Text>
                    <LeafletMap
                        style={{ flex: 1 }}
                        pickable
                        center={initial ?? DEFAULT_MAP_CENTER}
                        data={{ markers: picked ? [{ id: "pick", kind: "pick", position: { latitude: picked.latitude, longitude: picked.longitude } }] : [], route: [] }}
                        onPick={onMapPick}
                    />
                    <View className="px-5 py-3">
                        {pickBusy && <ActivityIndicator color="#FF9C01" />}
                        {picked && <Text className="mb-2 text-dark-100">{picked.line}</Text>}
                        <View className="flex-row">
                            <TouchableOpacity onPress={() => setMapOpen(false)} className="mr-3 flex-1 rounded-full border border-gray-200 py-3" accessibilityRole="button">
                                <Text className="text-center font-bold text-dark-100">Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                disabled={!picked}
                                onPress={() => {
                                    if (picked) {
                                        choose(picked);
                                        setMapOpen(false);
                                        setPicked(null);
                                    }
                                }}
                                className={`flex-1 rounded-full py-3 ${picked ? "bg-primary" : "bg-gray-200"}`}
                                accessibilityRole="button"
                            >
                                <Text className="text-center font-bold text-white">Usar este punto</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </SafeAreaView>
            </Modal>
        </View>
    );
};

export default AddressPicker;
