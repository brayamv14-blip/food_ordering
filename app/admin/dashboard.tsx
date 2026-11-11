import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import { formatMoney } from "@/lib/domain/pricing";
import { DashboardData, DriversSummary, ReportPeriod, getDashboard, periodRange } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

const PERIODS: { key: ReportPeriod; label: string }[] = [
    { key: "today", label: "Hoy" }, { key: "7d", label: "7 días" }, { key: "30d", label: "30 días" }, { key: "all", label: "Todo" }
];
const LINKS: { href: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { href: "/admin", label: "Pedidos", icon: "receipt-outline" },
    { href: "/admin/map", label: "Mapa en vivo", icon: "map-outline" },
    { href: "/admin/drivers", label: "Repartidores", icon: "bicycle-outline" },
    { href: "/admin/payments", label: "Pagos y reembolsos", icon: "card-outline" },
    { href: "/admin/products", label: "Productos y stock", icon: "fast-food-outline" },
    { href: "/admin/categories", label: "Categorías", icon: "list-outline" },
    { href: "/admin/customers", label: "Clientes", icon: "people-circle-outline" },
    { href: "/admin/reports", label: "Reportes", icon: "bar-chart-outline" },
    { href: "/admin/users", label: "Usuarios y roles", icon: "shield-outline" },
    { href: "/admin/audit", label: "Bitácora", icon: "document-text-outline" }
];

const Tile = ({ label, value }: { label: string; value: string | number }) => (
    <View className="mb-3 mr-3 min-w-[44%] flex-1 rounded-2xl border border-gray-100 bg-white p-4">
        <Text className="text-xs text-gray-400">{label}</Text>
        <Text className="mt-1 text-xl font-bold text-dark-100">{value}</Text>
    </View>
);

/** Panel de control: datos reales calculados en el servidor (funcion admin-api, solo admin). */
const Dashboard = () => {
    const allowed = useRoleGate("admin");
    const [period, setPeriod] = useState<ReportPeriod>("today");
    const [data, setData] = useState<{ d: DashboardData; drivers: DriversSummary; truncated: boolean } | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            const r = await getDashboard(periodRange(period));
            setData({ d: r.dashboard, drivers: r.driversSummary, truncated: r.truncated });
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [period]);

    useEffect(() => {
        if (allowed) load();
    }, [allowed, load]);

    const d = data?.d;
    return (
        <AdminShell title="Panel de control" allowed={allowed} loading={loading && !data} error={error}>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
                <View className="mb-3 flex-row">
                    {PERIODS.map((p) => (
                        <TouchableOpacity key={p.key} onPress={() => { setLoading(true); setPeriod(p.key); }} className={`mr-2 rounded-full border px-4 py-2 ${period === p.key ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: period === p.key }}>
                            <Text className={period === p.key ? "font-bold text-white" : "text-dark-100"}>{p.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                {data?.truncated && <Text className="mb-2 text-xs text-amber-600">Hay más pedidos que el límite de cálculo; las cifras pueden estar incompletas.</Text>}
                {d && (
                    <>
                        <View className="flex-row flex-wrap">
                            <Tile label="Ventas cobradas" value={formatMoney(d.sales)} />
                            <Tile label="Pedidos (periodo)" value={d.orders} />
                            <Tile label="Pedidos de hoy" value={d.todayOrders} />
                            <Tile label="Ticket promedio" value={formatMoney(d.averageTicket)} />
                            <Tile label="Efectivo" value={formatMoney(d.revenueByMethod.cash)} />
                            <Tile label="Stripe (en línea)" value={formatMoney(d.revenueByMethod.online)} />
                            <Tile label="Reembolsado" value={formatMoney(d.refunded)} />
                            <Tile label="Cancelación" value={`${d.cancellationRate}%`} />
                        </View>
                        {d.unpaidOnlineOrders > 0 && <Text className="mb-2 text-xs text-amber-600">{d.unpaidOnlineOrders} pedido(s) en línea sin pago confirmado.</Text>}

                        <Text className="mb-2 mt-2 text-base font-bold text-dark-100">Flujo de pedidos</Text>
                        <View className="mb-3 flex-row flex-wrap">
                            {([["Pendientes", d.pipeline.pending], ["Confirmados", d.pipeline.accepted], ["En preparación", d.pipeline.preparing], ["En camino", d.pipeline.onTheWay], ["Entregados", d.pipeline.delivered]] as const).map(([l, v]) => (
                                <View key={l} className="mb-2 mr-2 rounded-full bg-gray-100 px-3 py-1"><Text className="text-xs text-dark-100">{l}: {v}</Text></View>
                            ))}
                        </View>

                        <Text className="mb-2 text-base font-bold text-dark-100">Repartidores</Text>
                        <Text className="mb-3 text-sm text-gray-500">Disponibles {data!.drivers.available} · Ocupados {data!.drivers.busy} · Desconectados {data!.drivers.offline} (de {data!.drivers.total})</Text>

                        <Text className="mb-2 text-base font-bold text-dark-100">Productos más vendidos</Text>
                        {d.topProducts.length === 0 && <Text className="mb-3 text-gray-400">Sin ventas en el periodo.</Text>}
                        {d.topProducts.slice(0, 5).map((p) => (
                            <Text key={p.menuId} className="mb-1 text-sm text-dark-100">{p.name} · {p.quantity} u · {formatMoney(p.sales)}</Text>
                        ))}
                    </>
                )}
                <Text className="mb-2 mt-5 text-base font-bold text-dark-100">Módulos</Text>
                {LINKS.map((l) => (
                    <TouchableOpacity key={l.href} onPress={() => router.push(l.href as never)} className="mb-2 flex-row items-center justify-between rounded-2xl border border-gray-100 bg-white p-4" accessibilityRole="button">
                        <View className="flex-row items-center"><Ionicons name={l.icon} size={20} color="#FF9C01" /><Text className="ml-3 text-base text-dark-100">{l.label}</Text></View>
                        <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </AdminShell>
    );
};

export default Dashboard;
