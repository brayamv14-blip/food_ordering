import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";

import AdminShell, { useRoleGate } from "@/components/AdminShell";
import { formatMoney } from "@/lib/domain/pricing";
import { AdminCustomer, CustomerOrder, getCustomerOrders, listCustomers, setUserActive } from "@/lib/services/admin.service";
import { describeBackendError } from "@/lib/services/staff.service";

/** Clientes (solo admin). Direcciones solo bajo peticion expresa; el servidor deja registro en la bitacora. */
const Customers = () => {
    const allowed = useRoleGate("admin");
    const [items, setItems] = useState<AdminCustomer[]>([]);
    const [q, setQ] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [detail, setDetail] = useState<{ orders: CustomerOrder[]; spent: number; addresses?: string[] } | null>(null);

    const load = useCallback(async (query = "") => {
        try {
            setError(null);
            setItems(await listCustomers(query));
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { if (allowed) load(); }, [allowed, load]);

    const show = async (id: string, addresses = false) => {
        setOpen(id);
        if (!addresses) setDetail(null);
        try { setDetail(await getCustomerOrders(id, addresses)); } catch (e) { Alert.alert("No se pudo cargar", describeBackendError(e)); }
    };

    return (
        <AdminShell title="Clientes" allowed={allowed} loading={loading} error={error}>
            <View className="mx-5 mb-3 flex-row">
                <TextInput value={q} onChangeText={setQ} onSubmitEditing={() => load(q.trim())} returnKeyType="search" placeholder="Buscar por nombre o correo" className="flex-1 rounded-xl border border-gray-200 px-3 py-2" />
            </View>
            <FlatList
                data={items}
                keyExtractor={(c) => c.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={<Text className="mt-6 text-center text-gray-400">Sin clientes.</Text>}
                renderItem={({ item: c }) => (
                    <View className="mb-2 rounded-2xl border border-gray-100 bg-white p-3">
                        <TouchableOpacity onPress={() => (open === c.id ? setOpen(null) : show(c.id))} accessibilityRole="button">
                            <Text className="font-semibold text-dark-100">{c.name}</Text>
                            <Text className="text-xs text-gray-500">{c.email ?? "sin correo"}{c.active ? "" : " · cuenta desactivada"}</Text>
                        </TouchableOpacity>
                        {open === c.id && (
                            <View className="mt-2">
                                {!detail ? <Text className="text-gray-400">Cargando…</Text> : (
                                    <>
                                        <Text className="text-sm text-dark-100">{detail.orders.length} pedido(s) · gastado {formatMoney(detail.spent)}</Text>
                                        {detail.orders.slice(0, 8).map((o) => (
                                            <Text key={o.id} className="mt-1 text-xs text-gray-500">#{o.id.slice(-6)} · {o.status} · {o.paymentMethod === "cash_on_delivery" ? "efectivo" : "en línea"} · {formatMoney(o.total)}</Text>
                                        ))}
                                        {detail.addresses ? detail.addresses.map((a, i) => <Text key={i} className="mt-1 text-xs text-dark-100">📍 {a}</Text>) : (
                                            <TouchableOpacity onPress={() => show(c.id, true)} className="mt-2"><Text className="text-xs font-semibold text-primary">Ver direcciones (queda registrado)</Text></TouchableOpacity>
                                        )}
                                    </>
                                )}
                                <TouchableOpacity onPress={() => Alert.alert(c.active ? "Desactivar" : "Reactivar", `${c.name}`, [
                                    { text: "No", style: "cancel" },
                                    { text: "Sí", onPress: async () => { try { await setUserActive(c.id, !c.active); await load(q.trim()); } catch (e) { Alert.alert("No se pudo cambiar", describeBackendError(e)); } } }
                                ])} className="mt-3"><Text className="text-xs font-semibold text-red-500">{c.active ? "Desactivar cuenta" : "Reactivar cuenta"}</Text></TouchableOpacity>
                            </View>
                        )}
                    </View>
                )}
            />
        </AdminShell>
    );
};

export default Customers;
