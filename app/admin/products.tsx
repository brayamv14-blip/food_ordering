import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, RefreshControl, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { formatMoney } from "@/lib/domain/pricing";
import { AdminCategory, AdminProduct, ProductInput, adjustStock, isAdminApiConfigured, listCategories, listProducts, saveProduct, setProductAvailability } from "@/lib/services/admin.service";
import { getMyRoles } from "@/lib/services/roles";
import { describeBackendError } from "@/lib/services/staff.service";

/** Identificador de intento para que un ajuste de stock repetido por mala conexion no se aplique dos veces. */
const newRequestId = () => `adj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

interface Draft { id?: string; name: string; price: string; description: string; image_url: string; categories: string; stock: string }
const emptyDraft: Draft = { name: "", price: "", description: "", image_url: "", categories: "", stock: "" };

const ProductsAdmin = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [products, setProducts] = useState<AdminProduct[]>([]);
    const [categories, setCategories] = useState<AdminCategory[]>([]);
    const [inventoryEnabled, setInventoryEnabled] = useState(false);
    const [lowStock, setLowStock] = useState(0);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [adjust, setAdjust] = useState<{ product: AdminProduct; delta: string; reason: string; requestId: string } | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async (q = "") => {
        try {
            setError(null);
            const r = await listProducts(q);
            setProducts(r.products);
            setLowStock(r.lowStock);
            setInventoryEnabled(r.inventoryEnabled);
        } catch (e) {
            setError(describeBackendError(e));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        getMyRoles().then((r) => {
            setAllowed(r.staff);
            setIsAdmin(r.admin);
            if (r.staff && isAdminApiConfigured()) {
                load();
                listCategories().then(setCategories).catch(() => {});
            } else setLoading(false);
        });
    }, [load]);

    const toggle = async (p: AdminProduct, available: boolean) => {
        try {
            const updated = await setProductAvailability(p.id, available);
            setProducts((list) => list.map((x) => (x.id === p.id ? updated : x)));
        } catch (e) {
            Alert.alert("No se pudo cambiar", describeBackendError(e));
        }
    };

    const submitDraft = async () => {
        if (!draft || saving) return;
        const price = Number(draft.price.replace(",", "."));
        const input: ProductInput = { name: draft.name, price, description: draft.description, image_url: draft.image_url };
        if (draft.categories) input.categories = draft.categories;
        if (!draft.id) input.stock = draft.stock.trim() === "" ? null : Number(draft.stock);
        if (!draft.description) delete input.description;
        if (!draft.image_url) delete input.image_url;
        setSaving(true);
        try {
            await saveProduct(input, draft.id);
            setDraft(null);
            await load(search);
        } catch (e) {
            Alert.alert("No se pudo guardar", describeBackendError(e));
        } finally {
            setSaving(false);
        }
    };

    const submitAdjust = async () => {
        if (!adjust || saving) return;
        const delta = Number(adjust.delta);
        if (!Number.isInteger(delta) || delta === 0) {
            Alert.alert("Ajuste inválido", "Escribe un entero distinto de 0 (por ejemplo 10 o -3).");
            return;
        }
        setSaving(true);
        try {
            const updated = await adjustStock(adjust.product.id, { delta }, adjust.reason, adjust.requestId);
            setProducts((list) => list.map((x) => (x.id === updated.id ? updated : x)));
            setAdjust(null);
        } catch (e) {
            // Se conserva el mismo requestId: reintentar no duplica el ajuste.
            Alert.alert("No se pudo ajustar", describeBackendError(e));
        } finally {
            setSaving(false);
        }
    };

    if (allowed === null || loading) return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    if (!allowed) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Tu cuenta no tiene acceso de personal.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3"><Text className="font-bold text-white">Volver</Text></TouchableOpacity>
            </View>
        );
    }
    if (!isAdminApiConfigured()) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Falta configurar EXPO_PUBLIC_FN_ADMIN_API (ver docs/ADMIN.md).</Text>
            </View>
        );
    }

    const field = (label: string, key: keyof Draft, extra: object = {}) => (
        <View className="mb-3">
            <Text className="mb-1 text-sm text-gray-500">{label}</Text>
            <TextInput value={draft?.[key] ?? ""} onChangeText={(v) => setDraft((d) => (d ? { ...d, [key]: v } : d))} className="rounded-xl border border-gray-200 px-3 py-2 text-dark-100" {...extra} />
        </View>
    );

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-3 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="flex-1 text-2xl font-bold text-dark-100">Productos e inventario</Text>
                {isAdmin && (
                    <TouchableOpacity onPress={() => setDraft({ ...emptyDraft })} className="rounded-full bg-primary px-4 py-2" accessibilityRole="button" accessibilityLabel="Nuevo producto">
                        <Text className="font-bold text-white">Nuevo</Text>
                    </TouchableOpacity>
                )}
            </View>
            <View className="mx-5 mb-2 flex-row items-center rounded-2xl border border-gray-200 px-3">
                <Ionicons name="search" size={18} color="#9CA3AF" />
                <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => load(search)} returnKeyType="search" placeholder="Buscar producto" className="ml-2 flex-1 py-2 text-dark-100" />
            </View>
            {!inventoryEnabled && <Text className="mx-5 mb-2 text-xs text-amber-600">El control de existencias está desactivado en el servidor (falta INVENTORY_MOVES_TABLE_ID).</Text>}
            {lowStock > 0 && <Text className="mx-5 mb-2 text-sm font-semibold text-red-500">{lowStock} producto(s) con existencias bajas</Text>}
            {error && <Text className="mx-5 mb-2 text-sm text-red-500">{error}</Text>}

            <FlatList
                data={products}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(search); }} />}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">No hay productos.</Text> : null}
                renderItem={({ item: p }) => (
                    <View className="mb-3 rounded-2xl border border-gray-100 bg-white p-4">
                        <View className="flex-row items-center justify-between">
                            <Text className="flex-1 pr-2 text-base font-bold text-dark-100">{p.name}</Text>
                            <Text className="font-semibold text-dark-100">{formatMoney(p.price)}</Text>
                        </View>
                        <View className="mt-2 flex-row items-center justify-between">
                            <Text className={`text-sm ${p.lowStock ? "font-bold text-red-500" : "text-gray-500"}`}>
                                {p.tracked ? `Existencias: ${p.stock}${p.lowStock ? " (bajas)" : ""}` : "Sin control de existencias"}
                            </Text>
                            <View className="flex-row items-center">
                                <Text className="mr-2 text-sm text-gray-500">{p.available ? "Activo" : "Inactivo"}</Text>
                                <Switch value={p.available} onValueChange={(v) => toggle(p, v)} accessibilityLabel={`Disponibilidad de ${p.name}`} />
                            </View>
                        </View>
                        <View className="mt-3 flex-row">
                            {inventoryEnabled && (
                                <TouchableOpacity onPress={() => setAdjust({ product: p, delta: "", reason: "", requestId: newRequestId() })} className="mr-2 rounded-xl border border-primary px-3 py-2" accessibilityRole="button">
                                    <Text className="font-semibold text-primary">Ajustar stock</Text>
                                </TouchableOpacity>
                            )}
                            {isAdmin && (
                                <TouchableOpacity onPress={() => setDraft({ id: p.id, name: p.name, price: String(p.price), description: p.description, image_url: p.image_url, categories: p.categories ?? "", stock: "" })} className="rounded-xl border border-gray-300 px-3 py-2" accessibilityRole="button">
                                    <Text className="font-semibold text-dark-100">Editar</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}
            />

            <Modal visible={!!draft} animationType="slide" onRequestClose={() => setDraft(null)}>
                <View className="flex-1 bg-white px-5 pt-14">
                    <Text className="mb-4 text-xl font-bold text-dark-100">{draft?.id ? "Editar producto" : "Nuevo producto"}</Text>
                    {field("Nombre", "name")}
                    {field("Precio (MXN)", "price", { keyboardType: "decimal-pad" })}
                    {field("Descripción", "description", { multiline: true })}
                    {field("Imagen (enlace https)", "image_url", { autoCapitalize: "none" })}
                    {categories.length > 0 && (
                        <View className="mb-3">
                            <Text className="mb-1 text-sm text-gray-500">Categoría</Text>
                            <View className="flex-row flex-wrap">
                                {categories.map((c) => (
                                    <TouchableOpacity key={c.id} onPress={() => setDraft((d) => (d ? { ...d, categories: c.id } : d))} className={`mb-2 mr-2 rounded-full border px-3 py-1 ${draft?.categories === c.id ? "border-primary bg-primary" : "border-gray-200"}`} accessibilityRole="button">
                                        <Text className={draft?.categories === c.id ? "text-white" : "text-dark-100"}>{c.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}
                    {!draft?.id && inventoryEnabled && field("Existencias iniciales (vacío = sin control)", "stock", { keyboardType: "number-pad" })}
                    <View className="mt-2 flex-row">
                        <TouchableOpacity onPress={() => setDraft(null)} className="mr-2 flex-1 items-center rounded-xl border border-gray-300 py-3"><Text className="font-bold text-dark-100">Cancelar</Text></TouchableOpacity>
                        <TouchableOpacity onPress={submitDraft} disabled={saving} className="flex-1 items-center rounded-xl bg-primary py-3">
                            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Guardar</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal visible={!!adjust} transparent animationType="fade" onRequestClose={() => setAdjust(null)}>
                <View className="flex-1 items-center justify-center bg-black/40 px-6">
                    <View className="w-full rounded-2xl bg-white p-5">
                        <Text className="mb-1 text-lg font-bold text-dark-100">Ajustar stock: {adjust?.product.name}</Text>
                        <Text className="mb-3 text-sm text-gray-500">Actual: {adjust?.product.stock ?? "sin control"}. Usa positivo para entradas y negativo para mermas.</Text>
                        <TextInput value={adjust?.delta ?? ""} onChangeText={(v) => setAdjust((a) => (a ? { ...a, delta: v } : a))} keyboardType="numbers-and-punctuation" placeholder="Ej. 10 o -3" className="mb-3 rounded-xl border border-gray-200 px-3 py-2 text-dark-100" />
                        <TextInput value={adjust?.reason ?? ""} onChangeText={(v) => setAdjust((a) => (a ? { ...a, reason: v } : a))} placeholder="Motivo (compra, merma, conteo…)" className="mb-3 rounded-xl border border-gray-200 px-3 py-2 text-dark-100" />
                        <View className="flex-row">
                            <TouchableOpacity onPress={() => setAdjust(null)} className="mr-2 flex-1 items-center rounded-xl border border-gray-300 py-3"><Text className="font-bold text-dark-100">Cancelar</Text></TouchableOpacity>
                            <TouchableOpacity onPress={submitAdjust} disabled={saving} className="flex-1 items-center rounded-xl bg-primary py-3">
                                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text className="font-bold text-white">Aplicar</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

export default ProductsAdmin;
