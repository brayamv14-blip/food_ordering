import {SplashScreen, Stack} from "expo-router";
import { useFonts } from 'expo-font';
import { useEffect} from "react";

import './globals.css';
import * as Sentry from '@sentry/react-native';
import useAuthStore from "@/store/auth.store";

import { scrubEvent, sentryPrivacyOptions } from '@/lib/sentryConfig';

Sentry.init({
  dsn: 'https://94edd17ee98a307f2d85d750574c454a@o4506876178464768.ingest.us.sentry.io/4509588544094208',

  // Privacidad: la app maneja telefonos y direcciones de entrega. No se envia PII,
  // no se graban sesiones y los eventos se limpian antes de salir (ver lib/sentryConfig.ts).
  sendDefaultPii: sentryPrivacyOptions.sendDefaultPii,
  replaysSessionSampleRate: sentryPrivacyOptions.replaysSessionSampleRate,
  replaysOnErrorSampleRate: sentryPrivacyOptions.replaysOnErrorSampleRate,
  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: sentryPrivacyOptions.maskAllText,
      maskAllImages: sentryPrivacyOptions.maskAllImages,
      maskAllVectors: sentryPrivacyOptions.maskAllVectors
    }),
    Sentry.feedbackIntegration()
  ],
  beforeSend: (event) => scrubEvent(event),
});

export default Sentry.wrap(function RootLayout() {
  const { isLoading, fetchAuthenticatedUser } = useAuthStore();

  const [fontsLoaded, error] = useFonts({
    "QuickSand-Bold": require('../assets/fonts/Quicksand-Bold.ttf'),
    "QuickSand-Medium": require('../assets/fonts/Quicksand-Medium.ttf'),
    "QuickSand-Regular": require('../assets/fonts/Quicksand-Regular.ttf'),
    "QuickSand-SemiBold": require('../assets/fonts/Quicksand-SemiBold.ttf'),
    "QuickSand-Light": require('../assets/fonts/Quicksand-Light.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded, error]);

  useEffect(() => {
    fetchAuthenticatedUser();
  }, []);

  if (!fontsLoaded || isLoading) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
});
