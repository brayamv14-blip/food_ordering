import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ROLE_NAMES, RoleKey, Scope, creatableRoles, rolNeedsStore, scopeFromLabels, userErrorMessage, validateUserForm } from "@/lib/domain/access";
import {
    AdminStore, AdminUser, createUser, isAdminApiConfigured, listAdminStores, listUsers, resetUserPassword, setUserActive, updateUser, userHistory
} from "@/lib/services/admin.service";
import { getMyScope } from "@/lib/services/roles";

const ALL_ROLES: RoleKey[] = ["superadmin", "admin", "staff", "driver", "customer"];

const Chip = ({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity disabled={disabled} onPress={onPress} className={`mb-1 mr-2 rounded-full border px-3 py-1 ${on ? "border-primary bg-primary" : "border-gray-200"} ${disabled ? "opacity-40" : ""}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!disabled }}>
        <Text className={on ? "text-white" : "text-dark-100"}>{label}</Text>
    </TouchableOpacity>
);

/**
 * Usuarios (V15). Superadministrador: todas las tiendas. Administrador de tienda: solo su tienda y solo roles inferiores.
 * Esta pantalla solo oculta opciones; el servidor valida rol, tienda y reglas en cada operacion.
 */
const UsersAdmin = () => {
    const [scope, setScope] = useState<Scope | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [stores, setStores] = useState<AdminStore[]>([]);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState<RoleKey | "">("");
    const [storeFilter, setStoreFilter] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [form, setForm] = useState<{ open: boolean; editing: AdminUser | null }>({ open: false, editing: null });
    const [history, setHistory] = useState<{ user: AdminUser; rows: { id: string; action: string; summary: string; at: string }[] } | null>(null);

    const load = useCallback(async () => {
        try {
            setError(null);
            setUsers(await listUsers({ query: search.trim() || undefined, role: roleFilter || undefined, storeId: storeFilter || undefined }));
        } catch (e) {
            setError(userErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [search, roleFilter, storeFilter]);

    useEffect(() => {
        getMyScope().then(async (s) => {
            setScope(s);
            if (s.isAdmin && isAdminApiConfigured()) {
                listAdminStores().then((r) => setStores(r.stores)).catch(() => {});
            } else setLoading(false);
        });
    }, []);
    useEffect(() => { if (scope?.isAdmin && isAdminApiConfigured()) load(); }, [scope, roleFilter, storeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

    const storeName = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s.name])), [stores]);

    if (scope === null || (loading && !users.length && !error)) return <View className="flex-1 items-center justify-center bg-white"><ActivityIndicator size="large" color="#FF9C01" /></View>;
    if (!scope.isAdmin) {
        return (
            <View className="flex-1 items-center justify-center bg-white px-8">
                <Text className="text-center text-gray-400">Solo los administradores pueden gestionar usuarios.</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-xl bg-primary px-6 py-3"><Text className="font-bold text-white">Volver</Text></TouchableOpacity>
            </View>
        );
    }

    const toggleActive = (u: AdminUser) => {
        const next = u.active === false;
        Alert.alert(next ? "Reactivar usuario" : "Desactivar usuario", `${next ? "Reactivar" : "Desactivar"} a ${u.name}?`, [
            { text: "No", style: "cancel" },
            { text: "Sí", style: next ? "default" : "destructive", onPress: async () => {
                setBusy(u.id);
                try { await setUserActive(u.id, next); setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, active: next } : x))); setNotice(next ? "Usuario reactivado." : "Usuario desactivado."); }
                catch (e) { Alert.alert("No se pudo cambiar", userErrorMessage(e)); }
                finally { setBusy(null); }
            } }
        ]);
    };
    const reset = (u: AdminUser) => Alert.alert("Restablecer contraseña", `Se enviará un correo de recuperación a ${u.email ?? u.name}. Tú no verás la contraseña.`, [
        { text: "Cancelar", style: "cancel" },
        { text: "Enviar", onPress: async () => {
            setBusy(u.id);
            try { await resetUserPassword(u.id); setNotice("Correo de recuperación enviado."); } catch (e) { Alert.alert("No se pudo enviar", userErrorMessage(e)); } finally { setBusy(null); }
        } }
    ]);
    const showHistory = async (u: AdminUser) => {
        try { setHistory({ user: u, rows: await userHistory(u.id) }); } catch (e) { Alert.alert("Historial", userErrorMessage(e)); }
    };

    return (
        <View className="flex-1 bg-white pt-14">
            <View className="mb-3 flex-row items-center px-5">
                <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                    <Ionicons name="arrow-back" size={22} color="#221F1F" />
                </TouchableOpacity>
                <Text className="flex-1 text-2xl font-bold text-dark-100">Usuarios</Text>
                {creatableRoles(scope).length > 0 && (
                    <TouchableOpacity onPress={() => setForm({ open: true, editing: null })} className="rounded-full bg-primary px-4 py-2" accessibilityRole="button" accessibilityLabel="Nuevo usuario">
                        <Text className="font-bold text-white">+ Nuevo</Text>
                    </TouchableOpacity>
                )}
            </View>
            <View className="mx-5 mb-2 flex-row items-center rounded-2xl border border-gray-200 px-3">
                <Ionicons name="search" size={18} color="#9CA3AF" />
                <TextInput value={search} onChangeText={setSearch} onSubmitEditing={load} returnKeyType="search" placeholder="Buscar por nombre o correo" className="ml-2 flex-1 py-2 text-dark-100" />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2 max-h-10 px-5">
                <Chip label="Todos" on={roleFilter === ""} onPress={() => setRoleFilter("")} />
                {ALL_ROLES.map((r) => <Chip key={r} label={ROLE_NAMES[r]} on={roleFilter === r} onPress={() => setRoleFilter(r)} />)}
            </ScrollView>
            {scope.global && stores.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2 max-h-10 px-5">
                    <Chip label="Todas las tiendas" on={storeFilter === ""} onPress={() => setStoreFilter("")} />
                    {stores.map((s) => <Chip key={s.id} label={s.name} on={storeFilter === s.id} onPress={() => setStoreFilter(s.id)} />)}
                </ScrollView>
            )}
            {error && <Text className="mx-5 mb-2 text-sm text-red-500">{error}</Text>}
            {notice && <Text className="mx-5 mb-2 text-sm text-green-600">{notice}</Text>}
            <FlatList
                data={users}
                keyExtractor={(u) => u.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                ListEmptyComponent={!error ? <Text className="mt-10 text-center text-gray-400">Sin resultados.</Text> : null}
                renderItem={({ item: u }) => {
                    const role = u.role ?? scopeFromLabels(u.labels).role;
                    return (
                        <View className={`mb-3 rounded-2xl border border-gray-100 p-4 ${u.active === false ? "opacity-60" : ""}`}>
                            <View className="flex-row items-center justify-between">
                                <Text className="flex-1 text-base font-bold text-dark-100">{u.name}</Text>
                                <Text className={`text-xs font-bold ${u.active === false ? "text-red-500" : "text-green-600"}`}>{u.active === false ? "Desactivado" : "Activo"}</Text>
                            </View>
                            {u.email && <Text className="text-sm text-gray-500">{u.email}</Text>}
                            <Text className="mt-1 text-sm text-dark-100">{ROLE_NAMES[role]}{u.storeId ? ` · ${storeName[u.storeId] ?? u.storeId}` : ""}</Text>
                            {u.createdAt && <Text className="text-xs text-gray-400">Alta: {new Date(u.createdAt).toLocaleDateString("es-MX")}</Text>}
                            <View className="mt-3 flex-row flex-wrap">
                                <Chip label="Editar" on={false} disabled={busy === u.id} onPress={() => setForm({ open: true, editing: u })} />
                                <Chip label={u.active === false ? "Reactivar" : "Desactivar"} on={false} disabled={busy === u.id} onPress={() => toggleActive(u)} />
                                <Chip label="Restablecer contraseña" on={false} disabled={busy === u.id} onPress={() => reset(u)} />
                                <Chip label="Historial" on={false} onPress={() => showHistory(u)} />
                            </View>
                        </View>
                    );
                }}
            />

            <UserForm
                visible={form.open}
                editing={form.editing}
                scope={scope}
                stores={stores}
                onClose={() => setForm({ open: false, editing: null })}
                onSaved={(msg) => { setForm({ open: false, editing: null }); setNotice(msg); load(); }}
            />

            <Modal visible={!!history} transparent animationType="slide" onRequestClose={() => setHistory(null)}>
                <View className="flex-1 justify-end bg-black/40">
                    <View className="max-h-[70%] rounded-t-3xl bg-white p-5">
                        <Text className="mb-3 text-lg font-bold text-dark-100">Historial de {history?.user.name}</Text>
                        <ScrollView>
                            {history && history.rows.length === 0 && <Text className="text-gray-400">Sin acciones registradas.</Text>}
                            {history?.rows.map((r) => (
                                <View key={r.id} className="mb-2 border-b border-gray-100 pb-2">
                                    <Text className="font-bold text-dark-100">{r.action}</Text>
                                    {!!r.summary && <Text className="text-sm text-gray-500">{r.summary}</Text>}
                                    <Text className="text-xs text-gray-400">{new Date(r.at).toLocaleString("es-MX")}</Text>
                                </View>
                            ))}
                        </ScrollView>
                        <TouchableOpacity onPress={() => setHistory(null)} className="mt-3 items-center rounded-xl bg-gray-100 py-3"><Text className="font-bold text-dark-100">Cerrar</Text></TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
};

/** Formulario de alta/edicion. La contraseña es opcional: sin ella se envia un correo de recuperacion. */
const UserForm = ({ visible, editing, scope, stores, onClose, onSaved }: { visible: boolean; editing: AdminUser | null; scope: Scope; stores: AdminStore[]; onClose: () => void; onSaved: (msg: string) => void }) => {
    const roles = creatableRoles(scope);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<RoleKey>("staff");
    const [storeId, setStoreId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    useEffect(() => {
        if (!visible) return;
        setFormError(null);
        setPassword("");
        if (editing) {
            setName(editing.name); setEmail(editing.email ?? "");
            setRole(editing.role ?? scopeFromLabels(editing.labels).role); setStoreId(editing.storeId ?? null);
        } else {
            setName(""); setEmail(""); setRole(roles[1] ?? roles[0] ?? "customer");
            setStoreId(scope.global ? null : scope.storeId);
        }
    }, [visible, editing]); // eslint-disable-line react-hooks/exhaustive-deps

    const needsStore = rolNeedsStore(role);
    const submit = async () => {
        const problem = editing ? (name.trim().length < 2 ? "El nombre debe tener al menos 2 caracteres." : needsStore && !storeId ? "Elige la tienda a la que pertenece este usuario." : null) : validateUserForm({ name, email, role, storeId, password });
        if (problem) { setFormError(problem); return; }
        setSaving(true);
        setFormError(null);
        try {
            if (editing) {
                const changes: { name?: string; role?: RoleKey; storeId?: string | null } = {};
                if (name.trim() !== editing.name) changes.name = name.trim();
                if (role !== (editing.role ?? scopeFromLabels(editing.labels).role)) changes.role = role;
                if (scope.global && storeId !== (editing.storeId ?? null)) changes.storeId = storeId;
                if (Object.keys(changes).length === 0) { onClose(); return; }
                await updateUser(editing.id, changes);
                onSaved("Usuario actualizado.");
            } else {
                const r = await createUser({ name: name.trim(), email: email.trim(), role, storeId: needsStore || scope.global ? storeId : undefined, ...(password ? { password } : {}) });
                onSaved(r.passwordSetByAdmin ? "Usuario creado correctamente." : r.recoveryEmailSent ? "Usuario creado. Le enviamos un correo para que establezca su contraseña." : "Usuario creado, pero no se pudo enviar el correo de recuperación. Usa “Restablecer contraseña”.");
            }
        } catch (e) {
            setFormError(userErrorMessage(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <ScrollView className="flex-1 bg-white px-5 pt-14" keyboardShouldPersistTaps="handled">
                <Text className="mb-4 text-2xl font-bold text-dark-100">{editing ? "Editar usuario" : "Nuevo usuario"}</Text>
                <Text className="mb-1 text-sm text-gray-500">Nombre</Text>
                <TextInput value={name} onChangeText={setName} className="mb-3 rounded-xl border border-gray-200 px-3 py-3 text-dark-100" accessibilityLabel="Nombre" />
                <Text className="mb-1 text-sm text-gray-500">Correo</Text>
                <TextInput value={email} onChangeText={setEmail} editable={!editing} autoCapitalize="none" keyboardType="email-address" className={`mb-3 rounded-xl border border-gray-200 px-3 py-3 text-dark-100 ${editing ? "bg-gray-50" : ""}`} accessibilityLabel="Correo" />
                {!editing && (
                    <>
                        <Text className="mb-1 text-sm text-gray-500">Contraseña (opcional)</Text>
                        <TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="Vacía = se envía correo de recuperación" className="mb-3 rounded-xl border border-gray-200 px-3 py-3 text-dark-100" accessibilityLabel="Contraseña" />
                    </>
                )}
                <Text className="mb-1 text-sm text-gray-500">Rol</Text>
                <View className="mb-3 flex-row flex-wrap">
                    {(editing && !roles.includes(role) ? [role, ...roles] : roles).map((r) => <Chip key={r} label={ROLE_NAMES[r]} on={role === r} disabled={!roles.includes(r)} onPress={() => setRole(r)} />)}
                </View>
                {(needsStore || scope.global) && (
                    <>
                        <Text className="mb-1 text-sm text-gray-500">Tienda{needsStore ? " (obligatoria)" : ""}</Text>
                        <View className="mb-3 flex-row flex-wrap">
                            {stores.filter((s) => s.active || s.id === storeId).map((s) => <Chip key={s.id} label={s.name} on={storeId === s.id} disabled={!scope.global} onPress={() => setStoreId(s.id)} />)}
                            {stores.length === 0 && <Text className="text-sm text-gray-400">No hay tiendas. Crea una en “Tiendas”.</Text>}
                        </View>
                        {!scope.global && <Text className="mb-3 text-xs text-gray-400">Solo puedes crear usuarios en tu tienda.</Text>}
                    </>
                )}
                {formError && <Text className="mb-3 text-sm text-red-500" accessibilityRole="alert">{formError}</Text>}
                <View className="mb-10 flex-row">
                    <TouchableOpacity onPress={onClose} disabled={saving} className="mr-3 flex-1 items-center rounded-xl bg-gray-100 py-3"><Text className="font-bold text-dark-100">Cancelar</Text></TouchableOpacity>
                    <TouchableOpacity onPress={submit} disabled={saving} className="flex-1 items-center rounded-xl bg-primary py-3" accessibilityRole="button">
                        {saving ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">{editing ? "Guardar" : "Crear usuario"}</Text>}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </Modal>
    );
};

export default UsersAdmin;
