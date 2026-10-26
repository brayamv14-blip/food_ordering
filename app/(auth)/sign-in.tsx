import { View, Text, Alert } from 'react-native';
import { Link, router } from 'expo-router';
import CustomInput from '@/components/CustomInput';
import CustomButton from '@/components/CustomButton';
import { useState } from 'react';
import { signIn } from '@/lib/appwrite';
import { describeAuthError, validateSignIn } from '@/lib/domain/auth';
import * as Sentry from '@sentry/react-native';
import useAuthStore from '@/store/auth.store';

const SignIn = () => {
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { fetchAuthenticatedUser } = useAuthStore();

    const [form, setForm] = useState({
        email: '',
        password: ''
    });

    const submit = async () => {
        const { email, password } = form;

        const problem = validateSignIn({ email, password });
        if (problem) {
            return Alert.alert('Revisa tus datos', problem);
        }

        setIsSubmitting(true);

        try {
            await signIn({
                email: email.trim(),
                password
            });

            await fetchAuthenticatedUser();

            router.replace('/');
        } catch (error: any) {
            Alert.alert(
                'No se pudo iniciar sesión',
                describeAuthError(error)
            );

            Sentry.captureException(error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <View className="gap-10 bg-white rounded-lg p-5 mt-5">

            <CustomInput
                placeholder="Escribe tu correo"
                value={form.email}
                onChangeText={(text) =>
                    setForm((prev) => ({
                        ...prev,
                        email: text
                    }))
                }
                label="Correo"
                keyboardType="email-address"
            />

            <CustomInput
                placeholder="Escribe tu contraseña"
                value={form.password}
                onChangeText={(text) =>
                    setForm((prev) => ({
                        ...prev,
                        password: text
                    }))
                }
                label="Contraseña"
                secureTextEntry={true}
            />

            <CustomButton
                title="Iniciar sesión"
                isLoading={isSubmitting}
                onPress={submit}
            />

            <View className="flex justify-center mt-4 flex-row">
                <Link href={"/forgot-password" as never} className="base-bold text-primary">
                    ¿Olvidaste tu contraseña?
                </Link>
            </View>

            <View className="flex justify-center mt-5 flex-row gap-2">
                <Text className="base-regular text-gray-100">
                    ¿No tienes cuenta?
                </Text>

                <Link
                    href="/sign-up"
                    className="base-bold text-primary"
                >
                    Crear cuenta
                </Link>
            </View>

        </View>
    );
};

export default SignIn;