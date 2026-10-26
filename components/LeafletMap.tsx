import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import { LatLng } from "@/lib/domain/coordinates";
import { DEFAULT_MAP_CENTER, MapData, buildMapHtml, parseMapMessage, safeJson } from "@/lib/domain/geo";
import { geoKey, isGeoConfigured } from "@/lib/services/geocoding";

interface Props {
    data?: MapData;
    center?: LatLng | null;
    pickable?: boolean;
    onPick?: (p: LatLng) => void;
    style?: object;
}

/**
 * Mapa Leaflet + OpenStreetMap (teselas Geoapify) dentro de un WebView: funciona en Expo Go y en
 * builds propios, sin claves nativas. Solo muestra los puntos que recibe; no inventa ubicaciones.
 */
const LeafletMap = ({ data, center, pickable = false, onPick, style }: Props) => {
    const ref = useRef<WebView>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);
    const configured = isGeoConfigured();

    // El HTML se construye una vez; los cambios de puntos se envían con setMapData (sin recargar).
    const html = useMemo(
        () => (configured ? buildMapHtml({ apiKey: geoKey(), center: center ?? data?.markers[0]?.position ?? DEFAULT_MAP_CENTER, pickable, data }) : ""),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [configured, pickable]
    );

    useEffect(() => {
        if (ready && data) ref.current?.injectJavaScript(`window.setMapData(${safeJson(data)}, true); true;`);
    }, [ready, data]);

    if (!configured) {
        return (
            <View style={style} className="items-center justify-center bg-gray-100 px-6">
                <Text className="text-center text-gray-400">Mapa no disponible: falta configurar EXPO_PUBLIC_GEOAPIFY_API_KEY.</Text>
            </View>
        );
    }

    const onMessage = (e: WebViewMessageEvent) => {
        const m = parseMapMessage(e.nativeEvent.data);
        if (!m) return;
        if (m.type === "ready") setReady(true);
        else if (m.type === "pick") onPick?.({ latitude: m.latitude, longitude: m.longitude });
        else if (m.type === "error") setFailed(m.message || "No se pudo cargar el mapa");
    };

    return (
        <View style={style}>
            <WebView
                ref={ref}
                originWhitelist={["https://*", "about:blank"]}
                source={{ html, baseUrl: "https://maps.geoapify.com" }}
                onMessage={onMessage}
                onError={() => setFailed("No se pudo cargar el mapa. Revisa tu conexión.")}
                onHttpError={() => setFailed("No se pudo cargar el mapa.")}
                javaScriptEnabled
                domStorageEnabled={false}
                setSupportMultipleWindows={false}
                style={{ flex: 1 }}
                accessibilityLabel="Mapa"
            />
            {!ready && !failed && (
                <View className="absolute inset-0 items-center justify-center bg-white/70">
                    <ActivityIndicator color="#FF9C01" />
                </View>
            )}
            {failed && (
                <View className="absolute inset-x-0 top-0 bg-red-50 px-4 py-2">
                    <Text className="text-center text-xs text-red-600">{failed}</Text>
                </View>
            )}
        </View>
    );
};

export default LeafletMap;
