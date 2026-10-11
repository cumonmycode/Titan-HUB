import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { preloadCache } from '@/data/cache';
import { queryClient } from '@/data/query';
import { useSession } from '@/data/session';
import { hydrateSmartHome } from '@/data/smart-home';
import { hydrateStateFromCache } from '@/data/sync';
import { useGuestDriver } from '@/features/visit/driver';
import { markActivity } from '@/lib/activity';
import { applyKioskWindow, usePrefs } from '@/lib/prefs';
import { ErrorBoundary } from '@/ui/error-boundary';
import { setScreenSize } from '@/ui/screen';
import { ToastHost } from '@/ui/toast';
import { color } from '@/ui/tokens';

void SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync(color.ground);

export default function RootLayout() {
  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: color.ground }}
      onLayout={(e) => setScreenSize(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
    >
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" hidden />
          <Root />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const hydrated = useSession((s) => s.hydrated);
  const prefsLoaded = usePrefs((s) => s.loaded);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const ready = hydrated && prefsLoaded && cacheLoaded && (fontsLoaded || false);

  useEffect(() => {
    void useSession.getState().hydrate();
    void usePrefs.getState().load();
    void Promise.all([hydrateSmartHome(), preloadCache()]).finally(() => setCacheLoaded(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    hydrateStateFromCache();
    void SplashScreen.hideAsync();
    void applyKioskWindow();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void applyKioskWindow();
    });
    return () => sub.remove();
  }, [ready]);

  if (!ready) return null;
  return (
    <View style={{ flex: 1 }} onTouchStart={markActivity}>
      <ErrorBoundary>
        <Routes />
      </ErrorBoundary>
      <ToastHost />
    </View>
  );
}

function Routes() {
  const signedIn = useSession((s) => !!s.club && !!s.space && !!s.token);
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.ground }, animation: 'fade' }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="staff/index" />
          <Stack.Screen name="staff/booths" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="staff/room" options={{ animation: 'slide_from_right' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="setup" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <SignedIn /> : null}
    </>
  );
}

function SignedIn() {
  useGuestDriver();
  return null;
}
