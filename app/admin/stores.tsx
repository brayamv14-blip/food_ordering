import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Scope, userErrorMessage } from "@/lib/domain/access";
import { AdminStore, StoreInput, isAdminApiConfigured, listAdminStores, saveStore, setStoreActive } from "@/lib/services/admin.service";
import { getMyScope } from "@/lib/services/roles";

const FIELDS: { key: keyof StoreInput; label: string; numeric?: boolean; hint?: string }[] = [
    { key: "name", label: "Nombre comercial" }, { key: "description", label: "Descripción" }, { key: "imageUrl", label: "Logotipo o imagen (URL https)" },
    { key: "address", label: "Dirección" }, { key: "phone", label: "Teléfono" }, { key: "openHours", label: "Horario (HH:MM-HH:MM)", hint: "09:00-22:00" },
    { key: "latitude", label: "Latitud", numeric: true }, { key: "longitude", label: "Longitud", numeric: true },
    { key: "deliveryFee", label: "Envío fijo ($)", numeric: true }, { key: "deliveryFeeBase", label: "Envío base por distancia ($)", numeric: true },
    { key: "deliveryFeePerKm", label: "Envío por km ($)", numeric: true }, { key: "deliveryFeeMax", label: "Envío máximo ($)", numeric: true },
    { key: "deliveryRadiusKm", label: "Radio de entrega (km)", numeric: true }, { key: "prepMinutes", label: "Preparación (min)", numeric: true },
    { key: "coupons", label: "Cupones (CODIGO:tipo:valor:mínimo;…)" }
];
// v16: solo el superadministrador define el reparto financiero (el servidor rechaza a cualquier otro con 403).
const SUPER_FIELDS: typeof FIELDS = [
    { key: "platformPct", label: "Comisión de plataforma (% de productos)", numeric: true, hint: "vacío = valor del servidor" },
    { key: "driverPct", label: "Parte del repartidor (% del envío)", numeric: true, hint: "vacío = valor del servidor" }
];

/** Tiendas. Superadministrador: crea, edita, activa y desactiva todas. Administrador de tienda: edita solo la suya (sin activar/desactivar). */
const StoresAdmin = () => {
    const [scope, setScope] = useState<Scope | null>(null);
    const [stores, setStores] = useState<AdminStore[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ open: boolean; store: AdminStore | null }>({ open: false, store: null });

    const load = useCallback(async () => {
        try { setError(null); const r = await listAdminStores(); setStores(r.stores); setEnabled(r.enabled); } catch (e) { setError(userErrorMessage(e)); } finally { setLoading(false); }
    }, []);
    useEffect(() => { getMyScope().then((s) => { setScope(s); if (s.isAdmin && isAdminApiConfigured()) load(); else setLoading(false); }); }, [load]);

    if (scope === null || loading) return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    if (!scope.isAdmin) return <View className="flex-1 items-center justify-center bg-white px-8"><Text className="text-center text-gray-400">Tu cuenta no tiene acceso a esta sección.</Text></View>;

    const toggle = (s: AdminStore) => Alert.alert(s.active ? "Desactivar tienda" : "Activar tienda", s.active ? `“${s.name}” dejará de recibir pedidos.` : `“${s.name}” volverá a recibir pedidos.`, [
        { text: "No", style: "cancel" },
        { text: "Sí", style: s.active ? "destructive" : "default", onPress: async () => {
            try { const r = await setStoreActive(s.id, !s.active); setStores((l) => l.map((x) => (x.id === s.id ? r : x))); setNotice(r.active ? "Tienda activada." : "Tienda desactivada."); } catch (e) { Alert.alert("No se pudo cambiar", userErrorMessage(e)); }
        } }
    ]);

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-3 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver"><Ionicons name="arrow-back" size={22} color="#221F1F" /></TouchableOpacity>
                <Text className="flex-1 text-2xl font-bold text-dark-100">{scope.global ? "Tiendas" : "Mi tienda"}</Text>
                {scope.superadmin && enabled && <TouchableOpacity onPress={() => setEditing({ open: true, store: null })} className="rounded-full bg-primary px-4 py-2" accessibilityRole="button" accessibilityLabel="Nueva tienda"><Text className="font-bold text-white">+ Nueva</Text></TouchableOpacity>}
            </View>
            {!enabled && <Text className="mx-5 mb-3 text-sm text-gray-500">El servidor no tiene multitienda activa. Configura STORES_TABLE_ID en las Functions (ver docs/V15-GUIA.md).</Text>}
            {error && <Text className="mx-5 mb-2 text-sm text-red-500">{error}</Text>}
            {notice && <Text className="mx-5 mb-2 text-sm text-green-600">{notice}</Text>}
            <FlatList
                data={stores}
                keyExtractor={(s) => s.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">Sin tiendas.</Text> : null}
                renderItem={({ item: s }) => (
                    <View className={`mb-3 rounded-2xl border border-gray-100 p-4 ${s.active ? "" : "opacity-60"}`}>
                        <View className="flex-row items-center justify-between">
                            <Text className="flex-1 text-base font-bold text-dark-100">{s.name}</Text>
                            <Text className={`text-xs font-bold ${s.active ? "text-green-600" : "text-red-500"}`}>{s.active ? (s.closed ? "Cerrada (manual)" : "Activa") : "Inactiva"}</Text>
                        </View>
                        {!!s.address && <Text className="text-sm text-gray-500">{s.address}</Text>}
                        <Text className="text-xs text-gray-400">ID: {s.id}{s.openHours ? ` · ${s.openHours}` : ""}</Text>
                        <View className="mt-3 flex-row">
                            <TouchableOpacity onPress={() => setEditing({ open: true, store: s })} className="mr-2 rounded-full border border-gray-200 px-3 py-1"><Text className="text-dark-100">Editar</Text></TouchableOpacity>
                            {scope.superadmin && <TouchableOpacity onPress={() => toggle(s)} className="rounded-full border border-gray-200 px-3 py-1"><Text className="text-dark-100">{s.active ? "Desactivar" : "Activar"}</Text></TouchableOpacity>}
                        </View>
                    </View>
                )}
            />
            <StoreForm isSuper={!!scope.superadmin} visible={editing.open} store={editing.store} onClose={() => setEditing({ open: false, store: null })} onSaved={(m) => { setEditing({ open: false, store: null }); setNotice(m); load(); }} />
        </View>
    );
};

const StoreForm = ({ isSuper, visible, store, onClose, onSaved }: { isSuper: boolean; visible: boolean; store: AdminStore | null; onClose: () => void; onSaved: (m: string) => void }) => {
    const [vals, setVals] = useState<Record<string, string>>({});
    const [closed, setClosed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        if (!visible) return;
        setErr(null);
        const v: Record<string, string> = {};
        for (const f of [...FIELDS, ...SUPER_FIELDS]) { const x = (store as unknown as Record<string, unknown> | null)?.[f.key]; v[f.key] = x === null || x === undefined ? "" : String(x); }
        setVals(v); setClosed(store?.closed ?? false);
    }, [visible, store]);

    const submit = async () => {
        const name = (vals.name ?? "").trim();
        if (name.length < 2) { setErr("Escribe el nombre comercial (mínimo 2 caracteres)."); return; }
        const input: Record<string, unknown> = {};
        for (const f of (isSuper ? [...FIELDS, ...SUPER_FIELDS] : FIELDS)) {
            const raw = (vals[f.key] ?? "").trim();
            if (f.numeric) { if (raw === "") continue; const n = Number(raw); if (!Number.isFinite(n)) { setErr(`Valor numérico inválido en “${f.label}”.`); return; } input[f.key] = n; }
            else if (raw !== "" || store) input[f.key] = raw;
        }
        input.closed = closed;
        setSaving(true); setErr(null);
        try { await saveStore(input as StoreInput, store?.id); onSaved(store ? "Tienda actualizada." : "Tienda creada."); } catch (e) { setErr(userErrorMessage(e)); } finally { setSaving(false); }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <ScrollView className="flex-1 bg-white px-5 pt-14" keyboardShouldPersistTaps="handled">
                <Text className="mb-4 text-2xl font-bold text-dark-100">{store ? "Editar tienda" : "Nueva tienda"}</Text>
                {(isSuper ? [...FIELDS, ...SUPER_FIELDS] : FIELDS).map((f) => (
                    <View key={f.key}>
                        <Text className="mb-1 text-sm text-gray-500">{f.label}</Text>
                        <TextInput value={vals[f.key] ?? ""} onChangeText={(t) => setVals((v) => ({ ...v, [f.key]: t }))} placeholder={f.hint} keyboardType={f.numeric ? "decimal-pad" : "default"} autoCapitalize="none" className="mb-3 rounded-xl border border-gray-200 px-3 py-3 text-dark-100" accessibilityLabel={f.label} />
                    </View>
                ))}
                <TouchableOpacity onPress={() => setClosed((c) => !c)} className="mb-4 flex-row items-center" accessibilityRole="checkbox" accessibilityState={{ checked: closed }}>
                    <Ionicons name={closed ? "checkbox" : "square-outline"} size={22} color="#FE8C00" /><Text className="ml-2 text-dark-100">Cierre manual (no recibe pedidos aunque esté en horario)</Text>
                </TouchableOpacity>
                {err && <Text className="mb-3 text-sm text-red-500" accessibilityRole="alert">{err}</Text>}
                <View className="mb-10 flex-row">
                    <TouchableOpacity onPress={onClose} disabled={saving} className="mr-3 flex-1 items-center rounded-xl bg-gray-100 py-3"><Text className="font-bold text-dark-100">Cancelar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={submit} disabled={saving} className="flex-1 items-center rounded-xl bg-primary py-3" accessibilityRole="button">{saving ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">Guardar</Text>}</TouchableOpacity>
                </View>
            </ScrollView>
        </Modal>
    );
};

export default StoresAdmin;
