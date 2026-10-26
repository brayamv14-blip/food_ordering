import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";

import CustomButton from "@/components/CustomButton";
import CustomInput from "@/components/CustomInput";
import { completePasswordRecovery } from "@/lib/appwrite";
import {
    describeAuthError,
    parseRecoveryLink,
    parseRecoveryParams,
    validateNewPassword
} from "@/lib/domain/auth";

/**
 * Paso 2 de la recuperacion. Se abre desde el enlace del correo (esquema fastfood://
 * reset-password?userId=...&secret=...) o manualmente pegando el enlace recibido.
 */
const ResetPassword = () => {
    const params = useLocalSearchParams<{ userId?: string; secret?: string }>();
    const fromLink = parseRecoveryParams(params);
    const [pasted, setPasted] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const credentials = fromLink ?? parseRecoveryLink(pasted);

    const submit = async () => {
        if (isSubmitting) return;
        if (!credentials) {
            return Alert.alert("Enlace no válido", "Pega el enlace completo que llegó a tu correo.");
        }
        const problem = validateNewPassword(password, confirm);
        if (problem) return Alert.alert("Revisa tus datos", problem);

        setIsSubmitting(true);
        try {
            await completePasswordRecovery({ ...credentials, password });
            Alert.alert("Contraseña actualizada", "Ya puedes iniciar sesión con tu nueva contraseña.", [
                { text: "Iniciar sesión", onPress: () => router.replace("/sign-in") }
            ]);
        } catch (error: any) {
            // 401 = enlace vencido o ya usado
            const message =
                error?.code === 401
                    ? "El enlace venció o ya se usó. Solicita uno nuevo."
                    : describeAuthError(error);
            Alert.alert("No se pudo cambiar la contraseña", message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <View className="gap-6 bg-white rounded-lg p-5 mt-5">
            <Text className="h3-bold text-dark-100">Nueva contraseña</Text>

            {!fromLink && (
                <CustomInput
                    placeholder="Pega aquí el enlace del correo"
                    value={pasted}
                    onChangeText={setPasted}
                    label="Enlace de recuperación"
                />
            )}

            <CustomInput
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChangeText={setPassword}
                label="Nueva contraseña"
                secureTextEntry={true}
            />
            <CustomInput
                placeholder="Repite la contraseña"
                value={confirm}
                onChangeText={setConfirm}
                label="Confirmar contraseña"
                secureTextEntry={true}
            />

            <CustomButton title="Cambiar contraseña" isLoading={isSubmitting} onPress={submit} />

            <View className="flex justify-center mt-2 flex-row gap-2">
                <Link href="/forgot-password" className="base-bold text-primary">
                    Solicitar otro enlace
                </Link>
            </View>
        </View>
    );
};

export default ResetPassword;
