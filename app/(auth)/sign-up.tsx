import {View, Text, Button, Alert} from 'react-native'
import {Link, router} from "expo-router";
import CustomInput from "@/components/CustomInput";
import CustomButton from "@/components/CustomButton";
import {useState} from "react";
import {createUser} from "@/lib/appwrite";
import useAuthStore from "@/store/auth.store";
import {describeAuthError, validateSignUp} from "@/lib/domain/auth";

const SignUp = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { fetchAuthenticatedUser } = useAuthStore();
    const [form, setForm] = useState({ name: '', email: '', password: '' });

    const submit = async () => {
        const { name, email, password } = form;

        const problem = validateSignUp({ name, email: email.trim(), password });
        if (problem) return Alert.alert('Revisa tus datos', problem);

        setIsSubmitting(true)

        try {
            await createUser({ email: email.trim(), password, name: name.trim() });

            // Sin esto el guard de las pestañas no sabe que ya hay sesión y regresa a iniciar sesión.
            await fetchAuthenticatedUser();

            router.replace('/');
        } catch(error: any) {
            Alert.alert('No se pudo crear la cuenta', describeAuthError(error));
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <View className="gap-10 bg-white rounded-lg p-5 mt-5">
            <CustomInput
                placeholder="Escribe tu nombre completo"
                value={form.name}
                onChangeText={(text) => setForm((prev) => ({ ...prev, name: text }))}
                label="Nombre completo"
            />
            <CustomInput
                placeholder="Escribe tu correo"
                value={form.email}
                onChangeText={(text) => setForm((prev) => ({ ...prev, email: text }))}
                label="Correo"
                keyboardType="email-address"
            />
            <CustomInput
                placeholder="Escribe tu contraseña (mínimo 8 caracteres)"
                value={form.password}
                onChangeText={(text) => setForm((prev) => ({ ...prev, password: text }))}
                label="Contraseña"
                secureTextEntry={true}
            />

            <CustomButton
                title="Crear cuenta"
                isLoading={isSubmitting}
                onPress={submit}
            />

            <View className="flex justify-center mt-5 flex-row gap-2">
                <Text className="base-regular text-gray-100">
                    ¿Ya tienes cuenta?
                </Text>
                <Link href="/sign-in" className="base-bold text-primary">
                    Iniciar sesión
                </Link>
            </View>
        </View>
    )
}

export default SignUp
