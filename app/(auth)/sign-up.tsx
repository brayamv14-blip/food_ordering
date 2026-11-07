import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Link, router } from "expo-router";

import CustomInput from "@/components/CustomInput";
import CustomButton from "@/components/CustomButton";
import { createUser } from "@/lib/appwrite";
import { normalizePhone } from "@/lib/domain/address";
import {
    describeAuthError,
    validateSignUp,
} from "@/lib/domain/auth";
import useAuthStore from "@/store/auth.store";

const SignUp = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchAuthenticatedUser = useAuthStore(
        (state) => state.fetchAuthenticatedUser
    );

    const [form, setForm] = useState({
        name: "",
        email: "",
        password: "",
        phone: "",
    });

    const submit = async () => {
        if (isSubmitting) return;

        const name = form.name.trim().replace(/\s+/g, " ");
        const email = form.email.trim();
        const phone = normalizePhone(form.phone);

        const problem = validateSignUp({
            name,
            email,
            password: form.password,
            phone,
        });

        if (problem) {
            Alert.alert("Revisa tus datos", problem);
            return;
        }

        setIsSubmitting(true);

        try {
            await createUser({
                name,
                email,
                password: form.password,
                phone,
            });

            await fetchAuthenticatedUser();

            const authState = useAuthStore.getState();

            if (!authState.isAuthenticated || !authState.user) {
                throw new Error(
                    "La cuenta se creó, pero no se pudo cargar el perfil. " +
                    "Intenta iniciar sesión con los mismos datos."
                );
            }

            router.replace("/");
        } catch (error: unknown) {
            Alert.alert(
                "No se pudo crear la cuenta",
                describeAuthError(error)
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <View className="mt-5 gap-6 rounded-lg bg-white p-5">
            <CustomInput
                label="Nombre completo"
                placeholder="Escribe tu nombre completo"
                value={form.name}
                onChangeText={(text) =>
                    setForm((previous) => ({
                        ...previous,
                        name: text,
                    }))
                }
            />

            <CustomInput
                label="Correo"
                placeholder="Escribe tu correo"
                value={form.email}
                onChangeText={(text) =>
                    setForm((previous) => ({
                        ...previous,
                        email: text,
                    }))
                }
                keyboardType="email-address"
            />

            <CustomInput
                label="Teléfono"
                placeholder="Tu número de teléfono"
                value={form.phone}
                onChangeText={(text) =>
                    setForm((previous) => ({
                        ...previous,
                        phone: text,
                    }))
                }
                keyboardType="phone-pad"
            />

            <CustomInput
                label="Contraseña"
                placeholder="Mínimo 8 caracteres"
                value={form.password}
                onChangeText={(text) =>
                    setForm((previous) => ({
                        ...previous,
                        password: text,
                    }))
                }
                secureTextEntry
            />

            <CustomButton
                title="Crear cuenta"
                isLoading={isSubmitting}
                onPress={submit}
            />

            <View className="mt-2 flex-row justify-center gap-2">
                <Text className="base-regular text-gray-500">
                    ¿Ya tienes cuenta?
                </Text>

                <Link
                    href="/sign-in"
                    className="base-bold text-primary"
                >
                    Iniciar sesión
                </Link>
            </View>
        </View>
    );
};

export default SignUp;