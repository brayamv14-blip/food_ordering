import { useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import AdminStoreFilter, { useAdminStoreFilter } from "@/components/AdminStoreFilter";
import { formatMoney } from "@/lib/domain/pricing";
import { FinanceReport, FinanceSummary, getFinanceReport } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

type Period = "today" | "7d" | "30d" | "all";
const PERIODS: { key: Period; label: string }[] = [{ key: "today", label: "Hoy" }, { key: "7d", label: "7 días" }, { key: "30d", label: "30 días" }, { key: "all", label: "Todo" }];
const rangeFor = (p: Period): { from?: string } => {
    if (p === "all") return {};
    const d = new Date();
    if (p === "today") d.setHours(0, 0, 0, 0); else d.setTime(d.getTime() - (p === "7d" ? 7 : 30) * 86400000);
    return { from: d.toISOString() };
};
const Row = ({ label, s }: { label: string; s: FinanceSummary }) => (
    <View className="mb-2 rounded-xl border border-gray-100 bg-white p-3">
        <Text className="font-semibold text-dark-100">{label} · {s.orders} pedidos · {formatMoney(s.total)}</Text>
        <Text className="text-xs text-gray-500">Plataforma {formatMoney(s.platformCommission)} · Tienda {formatMoney(s.storeRevenue)} · Repartidores {formatMoney(s.driverEarning)}</Text>
    </View>
);

/** V16: reparto de lo cobrado en pedidos ENTREGADOS (comisión de plataforma, ingreso de tienda, ganancia de repartidores). Solo informa: no mueve dinero. */
const Finance = () => {
    const allowed = useRoleGate("admin");
    const sf = useAdminStoreFilter();
    const [period, setPeriod] = useState<Period>("30d");
    const [data, setData] = useState<FinanceReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (!allowed) return;
        let alive = true;
        getFinanceReport({ ...rangeFor(period), ...(sf.storeId ? { storeId: sf.storeId } : {}) })
            .then((d) => { if (alive) { setData(d); setError(null); } })
            .catch((e) => { if (alive) setError(describeBackendError(e)); })
            .finally(() => { if (alive) { setLoading(false); setRefreshing(false); } });
        return () => { alive = false; };
    }, [allowed, period, sf.storeId, reload]);

    const t = data?.finance.totals;
    return (
        <AdminShell title="Finanzas" allowed={allowed} loading={loading && !data} error={error}>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setReload((n) => n + 1); }} />}>
                {sf.isGlobal && <AdminStoreFilter stores={sf.stores} value={sf.storeId} onChange={(id) => { setLoading(true); sf.setStoreId(id); }} />}
                <View className="mb-3 flex-row">
                    {PERIODS.map((p) => (
                        <TouchableOpacity key={p.key} onPress={() => { setLoading(true); setPeriod(p.key); }} className={`mr-2 rounded-full border px-4 py-2 ${period === p.key ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: period === p.key }}><Text className={period === p.key ? "font-bold text-white" : "text-dark-100"}>{p.label}</Text></TouchableOpacity>
                    ))}
                </View>
                {data && t && (
                    <>
                        {data.truncated && <Text className="mb-2 text-xs text-amber-600">Hay más pedidos que el límite de cálculo; las cifras pueden estar incompletas.</Text>}
                        <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4">
                            <Text className="text-xs text-gray-400">Cobrado (entregados)</Text>
                            <Text className="text-3xl font-bold text-dark-100">{formatMoney(t.total)}</Text>
                            <Text className="mt-1 text-sm text-dark-100">Comisión de plataforma: {formatMoney(t.platformCommission)}</Text>
                            <Text className="text-sm text-dark-100">Ingreso de tiendas: {formatMoney(t.storeRevenue)}</Text>
                            <Text className="text-sm text-dark-100">Ganancia de repartidores: {formatMoney(t.driverEarning)} (propinas {formatMoney(t.tips)})</Text>
                            <Text className="text-sm text-dark-100">Reembolsos: {formatMoney(t.refunded)}</Text>
                            <Text className="mt-2 text-xs text-gray-400">Comisión {data.config.platformPct}% · repartidor {data.config.driverPct}% del envío. Los pagos a tiendas y repartidores se hacen fuera de la app (no hay transferencias automáticas).</Text>
                        </View>
                        <Text className="mb-2 text-base font-bold text-dark-100">Por tienda</Text>
                        {Object.entries(data.finance.byStore).map(([id, s]) => <Row key={id} label={id} s={s} />)}
                        <Text className="mb-2 mt-3 text-base font-bold text-dark-100">Por repartidor</Text>
                        {Object.values(data.finance.byDriver).length === 0 && <Text className="mb-2 text-gray-400">Sin entregas con repartidor.</Text>}
                        {Object.entries(data.finance.byDriver).map(([id, s]) => <Row key={id} label={s.name} s={s} />)}
                    </>
                )}
            </ScrollView>
        </AdminShell>
    );
};

export default Finance;
