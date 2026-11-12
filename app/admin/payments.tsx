import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import ReasonModal from "@/components/ReasonModal";
import { formatMoney } from "@/lib/domain/pricing";
import { AdminPayment, listPayments } from "@/lib/services/admin.service";
import { describeBackendError, refundOrder } from "@/lib/services/staff.service";

/**
 * Pagos y reembolsos. No existe "marcar como pagado": el estado de pago solo lo cambia el webhook de
 * Stripe (verificado por firma). Reembolso total/parcial: lo ejecuta el servidor contra Stripe.
 */
const Payments = () => {
    const allowed = useRoleGate("admin");
    const [method, setMethod] = useState<"online" | "cash_on_delivery">("online");
    const [items, setItems] = useState<AdminPayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refundFor, setRefundFor] = useState<AdminPayment | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setError(null);
            setItems(await listPayments({ paymentMethod: method }));
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, [method]);
    useEffect(() => { if (allowed) load(); }, [allowed, load]);

    return (
        <AdminShell title="Pagos y reembolsos" allowed={allowed} loading={loading} error={error}>
            <View className="mx-5 mb-3 flex-row">
                {(["online", "cash_on_delivery"] as const).map((m) => (
                    <TouchableOpacity key={m} onPress={() => { setLoading(true); setMethod(m); }} className={`mr-2 rounded-full border px-4 py-2 ${method === m ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button" accessibilityState={{ selected: method === m }}>
                        <Text className={method === m ? "font-bold text-white" : "text-dark-100"}>{m === "online" ? "En línea (Stripe)" : "Efectivo"}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <FlatList
                data={items}
                keyExtractor={(p) => p.orderId}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-6 text-center text-gray-400">Sin pagos.</Text>}
                renderItem={({ item: p }) => {
                    const refundable = p.paymentMethod !== "cash_on_delivery" && (p.paymentStatus === "paid" || p.paymentStatus === "partially_refunded") && (p.refundedAmount ?? 0) < p.total;
                    return (
                        <View className="mb-2 rounded-2xl border border-gray-100 bg-white p-3">
                            <View className="flex-row justify-between">
                                <Text className="font-semibold text-dark-100">#{p.orderId.slice(-6)} · {formatMoney(p.total)}</Text>
                                <Text className="text-xs text-gray-500">{p.paymentStatus}</Text>
                            </View>
                            <Text className="text-xs text-gray-500">Pedido: {p.orderStatus} · {new Date(p.at).toLocaleString("es-MX")}{(p.refundedAmount ?? 0) > 0 ? ` · reembolsado ${formatMoney(p.refundedAmount ?? 0)}` : ""}</Text>
                            {refundable && <TouchableOpacity onPress={() => setRefundFor(p)} className="mt-2"><Text className="font-semibold text-red-500">Reembolsar</Text></TouchableOpacity>}
                        </View>
                    );
                }}
            />
            <ReasonModal
                visible={!!refundFor}
                title={`Reembolso del pedido #${refundFor?.orderId.slice(-6) ?? ""}`}
                options={["Producto no entregado", "Pedido incorrecto", "Cobro duplicado", "Cortesía"]}
                amountLabel="Importe a reembolsar (vacío = lo restante)"
                confirmLabel="Reembolsar"
                destructive
                busy={busy}
                onClose={() => setRefundFor(null)}
                onConfirm={async (reason, amount) => {
                    const p = refundFor!;
                    setBusy(true);
                    try {
                        const r = await refundOrder(p.orderId, reason, amount);
                        Alert.alert("Reembolso registrado", `${formatMoney(r.refundedAmount)} ${r.full ? "(total)" : "(parcial)"}`);
                        setRefundFor(null);
                        await load();
                    } catch (e) {
                        Alert.alert("No se pudo reembolsar", describeBackendError(e));
                    } finally {
                        setBusy(false);
                    }
                }}
            />
        </AdminShell>
    );
};

export default Payments;
