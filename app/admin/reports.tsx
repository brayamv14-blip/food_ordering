import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { formatMoney } from "@/lib/domain/pricing";
import { AdminPayment, ReportPeriod, SalesReport, getReport, isAdminApiConfigured, listPayments, periodRange } from "@/lib/services/admin.service";
import { getMyRoles } from "@/lib/services/roles";
import { describeBackendError } from "@/lib/services/staff.service";

const PERIODS: { key: ReportPeriod; label: string }[] = [
    { key: "today", label: "Hoy" },
    { key: "7d", label: "7 días" },
    { key: "30d", label: "30 días" },
    { key: "all", label: "Todo" }
];
const PAY_FILTERS = [{ key: "", label: "Todos" }, { key: "paid", label: "Pagados" }, { key: "pending", label: "Pendientes" }, { key: "failed", label: "Fallidos" }, { key: "refunded", label: "Reembolsados" }, { key: "cancelled", label: "Cancelados" }];
const PAY_LABEL: Record<string, string> = { paid: "Pagado", pending: "Pendiente", failed: "Fallido", refunded: "Reembolsado", cancelled: "Cancelado", not_required: "Efectivo" };

/** Todo sale del servidor (pedidos reales); aqui no se calcula ni se inventa nada. */
const ReportsScreen = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [period, setPeriod] = useState<ReportPeriod>("7d");
    const [payFilter, setPayFilter] = useState("");
    const [report, setReport] = useState<SalesReport | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [payments, setPayments] = useState<AdminPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (p: ReportPeriod, pf: string) => {
        setLoading(true);
        try {
            setError(null);
            const range = periodRange(p);
            const [r, pay] = await Promise.all([getReport(range), listPayments({ ...range, paymentStatus: pf })]);
            setReport(r.report);
            setTruncated(r.truncated);
            setPayments(pay);
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.staff);
            if (r.staff && isAdminApiConfigured()) load(period, payFilter);
            else setLoading(false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const pick = (p: ReportPeriod) => { setPeriod(p); load(p, payFilter); };
    const pickPay = (k: string) => { setPayFilter(k); load(period, k); };

    const exportCsv = async () => {
        try {
            const r = await getReport(periodRange(period), true);
            // Se comparte como texto (hoja de calculo / correo); no se escribe nada en disco ni se agregan librerias.
            await Share.share({ title: "Reporte de pedidos", message: r.csv ?? "" });
        } catch (e) {
            Alert.alert("No se pudo exportar", describeBackendError(e));
        }
    };

    if (allowed === null) return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    if (!allowed) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Tu cuenta no tiene acceso de personal.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3"><Text className="font-bold text-white">Volver</Text></TouchableOpacity>
            </View>
        );
    }
    if (!isAdminApiConfigured()) {
        return <View className="flex-1 items-center justify-center bg-white px-8"><Text className="text-center text-gray-400">Falta configurar EXPO_PUBLIC_FN_ADMIN_API (ver docs/ADMIN.md).</Text></View>;
    }

    const tile = (label: string, value: string) => (
        <View className="mb-3 mr-3 min-w-[44%] flex-1 rounded-2xl border border-gray-100 bg-white p-4">
            <Text className="text-xs text-gray-500">{label}</Text>
            <Text className="mt-1 text-xl font-bold text-dark-100">{value}</Text>
        </View>
    );

    return (
        <ScrollView className="flex-1 bg-white pt-14" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
            <View className="mb-3 flex-row items-center">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="flex-1 text-2xl font-bold text-dark-100">Reportes y pagos</Text>
                <TouchableOpacity onPress={exportCsv} className="rounded-full border border-primary px-3 py-2" accessibilityRole="button"><Text className="font-semibold text-primary">Exportar CSV</Text></TouchableOpacity>
            </View>

            <View className="mb-3 flex-row">
                {PERIODS.map((p) => (
                    <TouchableOpacity key={p.key} onPress={() => pick(p.key)} className={`mr-2 rounded-full border px-4 py-2 ${period === p.key ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: period === p.key }}>
                        <Text className={period === p.key ? "font-bold text-white" : "text-dark-100"}>{p.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {error && <Text className="mb-3 text-sm text-red-500">{error}</Text>}
            {loading && <ActivityIndicator color="#FF9C01" />}
            {!loading && report && (
                <>
                    {truncated && <Text className="mb-2 text-xs text-amber-600">El periodo tiene demasiados pedidos: el reporte cubre los primeros 2,000. Elige un periodo más corto.</Text>}
                    <View className="flex-row flex-wrap">
                        {tile("Ventas (entregados)", formatMoney(report.sales))}
                        {tile("Pedidos", String(report.orders))}
                        {tile("Entregados", String(report.delivered))}
                        {tile("Cancelados", `${report.cancelled} (${report.cancellationRate}%)`)}
                        {tile("Ticket promedio", formatMoney(report.averageTicket))}
                        {tile("Reembolsado", formatMoney(report.refunded))}
                    </View>
                    <Text className="mb-2 mt-2 text-lg font-bold text-dark-100">Más vendidos</Text>
                    {report.topProducts.length === 0 && <Text className="text-gray-400">Sin ventas entregadas en este periodo.</Text>}
                    {report.topProducts.map((p) => (
                        <View key={p.menuId ?? p.name} className="mb-2 flex-row justify-between">
                            <Text className="flex-1 text-dark-100">{p.name}</Text>
                            <Text className="text-gray-500">{p.quantity} · {formatMoney(p.sales)}</Text>
                        </View>
                    ))}
                </>
            )}

            <Text className="mb-2 mt-6 text-lg font-bold text-dark-100">Pagos en línea</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
                {PAY_FILTERS.map((f) => (
                    <TouchableOpacity key={f.key} onPress={() => pickPay(f.key)} className={`mr-2 rounded-full border px-3 py-1 ${payFilter === f.key ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button">
                        <Text className={payFilter === f.key ? "text-white" : "text-dark-100"}>{f.label}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
            {!loading && payments.length === 0 && <Text className="text-gray-400">No hay pagos con este filtro.</Text>}
            {payments.map((p) => (
                <View key={p.orderId} className="mb-2 rounded-xl border border-gray-100 p-3">
                    <View className="flex-row justify-between">
                        <Text className="font-semibold text-dark-100">#{p.orderId.slice(-6)}</Text>
                        <Text className="font-semibold text-dark-100">{formatMoney(p.total)}</Text>
                    </View>
                    <Text className="text-sm text-gray-500">{PAY_LABEL[p.paymentStatus] ?? p.paymentStatus} · pedido {p.orderStatus}{p.reference ? ` · ref ${p.reference}` : ""}</Text>
                </View>
            ))}
        </ScrollView>
    );
};

export default ReportsScreen;
