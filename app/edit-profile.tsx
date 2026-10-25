import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { getCurrentUser } from "@/lib/appwrite";
import { ProfileInput, validateProfile } from "@/lib/domain/address";
import { getCurrentPosition } from "@/lib/services/location";
import { changeAvatar } from "@/lib/services/avatar.service";
import {
    Profile,
    ProfileValidationError,
    mapProfileRow,
    saveProfile
} from "@/lib/services/profile.service";

type Field = keyof ProfileInput;

const EditProfile = () => {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [form, setForm] = useState<ProfileInput>({ name: "", email: "", phone: "", homeAddress: "", workAddress: "" });
    const [selected, setSelected] = useState<"home" | "work">("home");
    const [coords, setCoords] = useState({
        homeLatitude: null as number | null,
        homeLongitude: null as number | null,
        workLatitude: null as number | null,
        workLongitude: null as number | null
    });
    const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [locating, setLocating] = useState<"home" | "work" | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);

    const set = (field: Field) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

    const loadProfile = async () => {
        try {
            setLoading(true);
            const row: any = await getCurrentUser();
            const p = mapProfileRow(row);
            setProfile(p);
            setForm({ name: p.name, email: p.email, phone: p.phone, homeAddress: p.homeAddress, workAddress: p.workAddress ?? "" });
            setSelected(p.selectedAddress);
            setCoords({ homeLatitude: p.homeLatitude, homeLongitude: p.homeLongitude, workLatitude: p.workLatitude, workLongitude: p.workLongitude });
        } catch (error) {
            console.log("Error al cargar perfil:", error);
            Alert.alert("Error", "No se pudo cargar tu información.");
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(useCallback(() => { loadProfile(); }, []));

    const handleChangePhoto = async () => {
        if (!profile || uploadingPhoto) return;
        setUploadingPhoto(true);
        const result = await changeAvatar({
            profileRowId: profile.rowId,
            accountId: profile.accountId,
            currentAvatarUrl: profile.avatar
        });
        setUploadingPhoto(false);
        if (result.status === "updated") setProfile({ ...profile, avatar: result.url });
        else if (result.status === "error") Alert.alert("Foto de perfil", result.message);
    };

    const pinCurrentLocation = async (which: "home" | "work") => {
        setLocating(which);
        const result = await getCurrentPosition();
        setLocating(null);
        if (!result.ok) {
            Alert.alert("Ubicación", result.message);
            return;
        }
        setCoords((c) =>
            which === "home"
                ? { ...c, homeLatitude: result.coords.latitude, homeLongitude: result.coords.longitude }
                : { ...c, workLatitude: result.coords.latitude, workLongitude: result.coords.longitude }
        );
    };

    const handleSave = async () => {
        if (!profile || saving) return;
        const check = validateProfile(form);
        setErrors(check.errors);
        if (!check.valid) return;

        // Si el domicilio elegido está vacío no tiene sentido preferirlo.
        const effectiveSelected = selected === "work" && !check.values.workAddress ? "home" : selected;

        try {
            setSaving(true);
            await saveProfile(profile.rowId, form, {
                selectedAddress: effectiveSelected,
                homeLatitude: check.values.homeAddress ? coords.homeLatitude : null,
                homeLongitude: check.values.homeAddress ? coords.homeLongitude : null,
                workLatitude: check.values.workAddress ? coords.workLatitude : null,
                workLongitude: check.values.workAddress ? coords.workLongitude : null
            });
            Alert.alert("Perfil actualizado", "Tus datos se guardaron correctamente.", [{ text: "OK", onPress: () => router.back() }]);
        } catch (error) {
            if (error instanceof ProfileValidationError) {
                setErrors(error.errors as any);
                return;
            }
            console.log("Error al guardar perfil:", error);
            Alert.alert("Error", "No se pudieron guardar tus cambios. Inténtalo de nuevo.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <View className="flex-1 items-center justify-center bg-white">
                <ActivityIndicator size="large" color="#FF9C01" />
                <Text className="mt-3 text-gray-400">Cargando información...</Text>
            </View>
        );
    }

    const input = (label: string, field: Field, props: Record<string, any> = {}) => (
        <View className="mb-4">
            <Text className="mb-2 text-sm font-semibold text-dark-100">{label}</Text>
            <TextInput
                value={form[field] ?? ""}
                onChangeText={set(field)}
                className={`rounded-2xl border bg-gray-50 px-4 py-4 text-base text-dark-100 ${errors[field] ? "border-red-400" : "border-gray-100"}`}
                accessibilityLabel={label}
                {...props}
            />
            {errors[field] && <Text className="mt-1 text-xs text-red-500">{errors[field]}</Text>}
        </View>
    );

    const pinRow = (which: "home" | "work") => {
        const has = which === "home" ? coords.homeLatitude !== null : coords.workLatitude !== null;
        return (
            <TouchableOpacity onPress={() => pinCurrentLocation(which)} disabled={locating !== null} className="mb-4 flex-row items-center">
                {locating === which ? <ActivityIndicator size="small" color="#FF9C01" /> : <Ionicons name="locate-outline" size={18} color="#FF9C01" />}
                <Text className="ml-2 text-sm font-semibold text-primary">
                    {has ? "Ubicación guardada · actualizar con mi ubicación actual" : "Fijar coordenadas con mi ubicación actual"}
                </Text>
            </TouchableOpacity>
        );
    };

    return (
        <KeyboardAvoidingView className="flex-1 bg-white" behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <ScrollView className="flex-1 px-5 pt-14" contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
                <View className="mb-8 flex-row items-center">
                    <TouchableOpacity onPress={() => router.back()} className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-gray-100" accessibilityLabel="Volver">
                        <Ionicons name="arrow-back" size={22} color="#221F1F" />
                    </TouchableOpacity>
                    <Text className="text-2xl font-bold text-dark-100">Editar perfil</Text>
                </View>

                <View className="mb-8 items-center">
                    <View className="h-28 w-28 overflow-hidden rounded-full bg-orange-50">
                        {profile?.avatar ? (
                            <Image source={{ uri: profile.avatar }} className="h-full w-full" accessibilityLabel="Foto de perfil" />
                        ) : (
                            <View className="flex-1 items-center justify-center"><Ionicons name="person" size={55} color="#FF9C01" /></View>
                        )}
                    </View>
                    <TouchableOpacity onPress={handleChangePhoto} disabled={uploadingPhoto} className="mt-3" accessibilityRole="button">
                        {uploadingPhoto ? <ActivityIndicator size="small" color="#FF9C01" /> : <Text className="font-semibold text-primary">Cambiar foto</Text>}
                    </TouchableOpacity>
                </View>

                {input("Nombre completo", "name", { autoCapitalize: "words" })}

                <View className="mb-4">
                    <Text className="mb-2 text-sm font-semibold text-dark-100">Correo electrónico</Text>
                    <Text className="rounded-2xl border border-gray-100 bg-gray-100 px-4 py-4 text-base text-gray-400">{form.email}</Text>
                    <Text className="mt-1 text-xs text-gray-400">El correo es el de tu cuenta y no se puede cambiar desde aquí.</Text>
                </View>

                {input("Teléfono", "phone", { keyboardType: "phone-pad", placeholder: "10 dígitos" })}
                {input("Dirección de casa", "homeAddress", { multiline: true, placeholder: "Calle, número, colonia, municipio" })}
                {pinRow("home")}
                {input("Dirección de trabajo (opcional)", "workAddress", { multiline: true, placeholder: "Calle, número, colonia, municipio" })}
                {pinRow("work")}

                <Text className="mb-2 text-sm font-semibold text-dark-100">Dirección preferida para tus pedidos</Text>
                <View className="mb-8 flex-row">
                    {(["home", "work"] as const).map((key) => (
                        <TouchableOpacity
                            key={key}
                            onPress={() => setSelected(key)}
                            className={`mr-2 rounded-full border px-5 py-2 ${selected === key ? "border-primary bg-primary" : "border-gray-200"}`}
                            accessibilityState={{ selected: selected === key }}
                        >
                            <Text className={selected === key ? "font-bold text-white" : "font-semibold text-dark-100"}>
                                {key === "home" ? "Casa" : "Trabajo"}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                <TouchableOpacity onPress={handleSave} disabled={saving} className="items-center rounded-2xl bg-primary py-4" accessibilityRole="button">
                    {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">Guardar cambios</Text>}
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default EditProfile;
