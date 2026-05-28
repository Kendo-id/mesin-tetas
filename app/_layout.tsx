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
  import { registerWidgetTaskHandler } from "react-native-android-widget";
  import { SafeAreaProvider } from "react-native-safe-area-context";

  import { ErrorBoundary } from "@/components/ErrorBoundary";
  import { IncubatorProvider } from "@/context/IncubatorContext";
  import { widgetTaskHandler } from "@/widgets/widgetTaskHandler";

  SplashScreen.preventAutoHideAsync();

  // Register widget task handler with error boundary
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

    if (!fontsLoaded && !fontError) return null;

    return (
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <IncubatorProvider>
              <GestureHandlerRootView>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </IncubatorProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    );
  }
  