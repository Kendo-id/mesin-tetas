import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { registerWidgetTaskHandler, requestWidgetUpdate } from "react-native-android-widget";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { IncubatorProvider } from "@/context/IncubatorContext";
import { widgetTaskHandler } from "@/widgets/widgetTaskHandler";
import { TemperatureWidget } from "@/widgets/TemperatureWidget";
import { HumidityWidget } from "@/widgets/HumidityWidget";
import { IncubationWidget } from "@/widgets/IncubationWidget";

SplashScreen.preventAutoHideAsync();

try {
  registerWidgetTaskHandler(widgetTaskHandler);
} catch (error) {
  console.warn('Failed to register widget task handler:', error);
}

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Kembali" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="history"
        options={{ headerShown: false, presentation: "modal" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Update widgets from foreground when app starts.
  // This bypasses background task limitations — widget will show content
  // whenever user opens the app, even if background updates don't work.
  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    const timer = setTimeout(async () => {
      try {
        await Promise.allSettled([
          requestWidgetUpdate({
            widgetName: 'TemperatureWidget',
            renderWidget: () => <TemperatureWidget sensor={null} />,
            widgetNotFound: () => {},
          }),
          requestWidgetUpdate({
            widgetName: 'HumidityWidget',
            renderWidget: () => <HumidityWidget sensor={null} />,
            widgetNotFound: () => {},
          }),
          requestWidgetUpdate({
            widgetName: 'IncubationWidget',
            renderWidget: () => <IncubationWidget incubation={null} sensor={null} />,
            widgetNotFound: () => {},
          }),
        ]);
      } catch (e) {
        console.warn('Widget foreground update:', e);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <IncubatorProvider>
              <KeyboardProvider>
                <RootLayoutNav />
              </KeyboardProvider>
            </IncubatorProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
