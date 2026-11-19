import { useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";

import { formatMoney } from "@/lib/domain/pricing";
import { DriverEarnings, describeBackendError, getDriverEarnings } from "@/lib/services/staff.service";

type Period = "today" | "7d" | "30d" | "all";
const PERIODS: { key: Period; label: string }[] = [{ key: "today", label: "Hoy" }, { key: "7d", label: "7 días" }, { key: "30d", label: "30 días" }, { key: "all", label: "Todo" }];
const rangeFor = (p: Period): { from?: string } => {
    if (p === "all") return {};
    const d = new Date();
    if (p === "today") d.setHours(0, 0, 0, 0); else d.setTime(d.getTime() - (p === "7d" ? 7 : 30) * 86400000);
    return { from: d.toISOString() };
};

/** V16: resumen de ganancias del repartidor. Lo calcula el servidor; la app solo lo muestra. No hay retiros automáticos. */
const DriverEarningsPanel = () => {
    const [period, setPeriod] = useState<Period>("7d");
    const [data, setData] = useState<DriverEarnings | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [reload, setReload] = useState(0);

    // Todo setState ocurre en callbacks asíncronos (no de forma síncrona dentro del efecto).
    useEffect(() => {
        let alive = true;
        getDriverEarnings(rangeFor(period))
            .then((d) => { if (alive) { setData(d); setError(null); } })
            .catch((e) => { if (alive) setError(describeBackendError(e)); })
            .finally(() => { if (alive) { setLoading(false); setRefreshing(false); } });
        return () => { alive = false; };
    }, [period, reload]);

    if (loading && !data) return <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    const days = Object.entries(data?.byDay ?? {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    return (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload((n) => n + 1); }} />}>
            <View className="mb-3 flex-row">
                {PERIODS.map((p) => (
                    <TouchableOpacity key={p.key} onPress={() => { setLoading(true); setPeriod(p.key); }} className={`mr-2 rounded-full border px-3 py-1 ${period === p.key ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: period === p.key }}>
                        <Text className={period === p.key ? "font-bold text-white" : "text-dark-100"}>{p.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            {error && <Text className="mb-2 text-sm text-red-500">{error}</Text>}
            {data && (
                <>
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4">
                        <Text className="text-xs text-gray-400">Ganancia estimada</Text>
                        <Text className="text-3xl font-bold text-dark-100">{formatMoney(data.totals.earnings)}</Text>
                        <Text className="mt-1 text-sm text-gray-500">Entregas {data.totals.delivered} · Propinas {formatMoney(data.totals.tips)} · Fallidas {data.totals.failed} · Canceladas {data.totals.cancelled}</Text>
                        <Text className="mt-1 text-xs text-gray-400">Tu parte del envío es {data.config.driverPct}% más 100% de la propina. Los pagos/retiros se gestionan fuera de la app.</Text>
                    </View>
                    {data.truncated && <Text className="mb-2 text-xs text-amber-600">Hay más entregas que el límite de cálculo; elige un periodo menor.</Text>}
                    <Text className="mb-2 text-base font-bold text-dark-100">Por día</Text>
                    {days.length === 0 && <Text className="mb-3 text-gray-400">Sin entregas en el periodo.</Text>}
                    {days.map(([d, v]) => <Text key={d} className="mb-1 text-sm text-dark-100">{d} · {formatMoney(v)}</Text>)}
                    <Text className="mb-2 mt-4 text-base font-bold text-dark-100">Últimas entregas</Text>
                    {data.deliveries.map((x) => <Text key={x.orderId} className="mb-1 text-sm text-dark-100">#{x.orderId.slice(-6)} · {formatMoney(x.earning)}{x.tip > 0 ? ` (propina ${formatMoney(x.tip)})` : ""}</Text>)}
                </>
            )}
        </ScrollView>
    );
};

export default DriverEarningsPanel;
