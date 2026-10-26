import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Link, router } from "expo-router";

import CustomButton from "@/components/CustomButton";
import CustomInput from "@/components/CustomInput";
import { RecoveryNotConfiguredError, requestPasswordRecovery } from "@/lib/appwrite";
import { describeAuthError, validateEmailOnly } from "@/lib/domain/auth";

/**
 * Paso 1 de la recuperacion: Appwrite envia un correo con un enlace de 1 hora.
 * Para no revelar que correos tienen cuenta, un correo desconocido (404) muestra
 * el mismo mensaje de exito.
 */
const ForgotPassword = () => {
    const [email, setEmail] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submit = async () => {
        if (isSubmitting) return;
        const problem = validateEmailOnly(email);
        if (problem) return Alert.alert("Revisa tus datos", problem);

        setIsSubmitting(true);
        try {
            await requestPasswordRecovery(email);
            notifySent();
        } catch (error: any) {
            if (error?.code === 404) {
                notifySent();
            } else if (error instanceof RecoveryNotConfiguredError) {
                Alert.alert("Configuración pendiente", error.message);
            } else {
                Alert.alert("No se pudo enviar el correo", describeAuthError(error));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const notifySent = () =>
        Alert.alert(
            "Revisa tu correo",
            "Si existe una cuenta con ese correo, te enviamos un enlace para cambiar tu contraseña. El enlace vence en 1 hora.",
            [{ text: "Ya tengo el enlace", onPress: () => router.push("/reset-password") }, { text: "Cerrar" }]
        );

    return (
        <View className="gap-6 bg-white rounded-lg p-5 mt-5">
            <Text className="h3-bold text-dark-100">Recuperar contraseña</Text>
            <Text className="base-regular text-gray-200">
                Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.
            </Text>

            <CustomInput
                placeholder="Escribe tu correo"
                value={email}
                onChangeText={setEmail}
                label="Correo"
                keyboardType="email-address"
            />

            <CustomButton title="Enviar enlace" isLoading={isSubmitting} onPress={submit} />

            <View className="flex justify-center mt-2 flex-row gap-2">
                <Link href="/sign-in" className="base-bold text-primary">
                    Volver a iniciar sesión
                </Link>
            </View>
        </View>
    );
};

export default ForgotPassword;
