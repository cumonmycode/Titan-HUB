import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { glassHeader, stackHeaderOptions } from '@/components/header-glass';
import { sheetLayout } from '@/components/sheet-grabber';
import { DialogHost } from '@/components/dialog-host';
import { LocalTour } from '@/components/local-tour';
import { NotificationBanner } from '@/components/notification-banner';
import { OfflineBanner } from '@/components/offline-banner';
import { SessionLock } from '@/components/session-lock';
import { CACHE_BUSTER, CACHE_MAX_AGE, queryClient, queryPersister, subscribeAppFocus, subscribeNetwork } from '@/lib/query';
import { NEEDS_WARMUP, SwiftUIWarmup } from '@/components/swiftui-warmup';
import { useRealtime } from '@/lib/realtime';
import { useStaffPush } from '@/lib/staff-push';
import { useDevicePrefs } from '@/lib/device-prefs';
import { devLogin, localAutoLogin, useSession } from '@/lib/session';
import { colors, accentHex } from '@/lib/theme';
import { sheetOptions } from '@/lib/sheet';

SplashScreen.preventAutoHideAsync();

/** Живые обновления клуба, push и «звонки» персоналу, пока есть вход. */
function Realtime() {
  useRealtime();
  useStaffPush();
  return null;
}

export default function RootLayout() {
  const scheme = useColorScheme();
  useEffect(() => {
    void useDevicePrefs.getState().hydrate();
  }, []);
  const hydrated = useSession((s) => s.hydrated);
  const club = useSession((s) => s.club);
  const token = useSession((s) => s.token);

  useEffect(() => {
    void useSession.getState().hydrate().then(localAutoLogin);
  }, []);

  // Заставка держится, пока не прогреты нативные вставки (components/swiftui-warmup.tsx).
  const [warm, setWarm] = useState(!NEEDS_WARMUP);
  const finishWarmup = useCallback(() => setWarm(true), []);
  useEffect(() => {
    if (hydrated && warm) void SplashScreen.hideAsync();
  }, [hydrated, warm]);

  // Служебная ссылка входа на локальный стенд (lib/session.ts → devLogin); в релизе пустая.
  useEffect(() => {
    if (!hydrated) return;
    void Linking.getInitialURL().then(devLogin);
    const subscription = Linking.addEventListener('url', (event) => void devLogin(event.url));
    return () => subscription.remove();
  }, [hydrated]);

  useEffect(() => subscribeAppFocus(), []);
  useEffect(() => subscribeNetwork(), []);

  // Кэш запросов (и его копия на диске) — данные вошедшего сотрудника: ключи содержат
  // клуб, но не сотрудника. Выход, 401, «Другой сотрудник», смена клуба — следующий не
  // должен увидеть чужие me/роль и данные. Переход из «до hydrate» не считаем.
  useEffect(() => {
    if (!hydrated) return;
    return useSession.subscribe((state, prev) => {
      if ((state.user?.id ?? null) === (prev.user?.id ?? null)) return;
      queryClient.clear();
      void queryPersister.removeClient();
    });
  }, [hydrated]);
  // Кэш на диске, сохранённый под другим сотрудником, при запуске не восстанавливаем.
  const cacheOwner = useSession((s) => s.user?.id ?? 'none');

  if (!hydrated) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: scheme === 'dark' ? accentHex.dark : accentHex.light },
  };
  const signedIn = !!club && !!token;

  return (
    <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider>
    <KeyboardProvider>
    <ThemeProvider value={theme}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister: queryPersister, maxAge: CACHE_MAX_AGE, buster: `${CACHE_BUSTER}:${cacheOwner}` }}>
        <Stack screenOptions={{ headerShown: false }} screenLayout={sheetLayout}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
            <Stack.Screen
              name="shift"
              options={{
                presentation: 'formSheet',
                ...sheetOptions,
                // Android раскладывает шторку с двумя высотами во весь рост и прячет её низ —
                // кнопка «Открыть смену» оказалась бы за экраном. Там шторка сразу полная.
                sheetAllowedDetents: Platform.OS === 'android' ? [1] : [0.6, 1],
                sheetGrabberVisible: true,
                headerShown: false,
                contentStyle: Platform.OS === 'android' ? { backgroundColor: colors.sheetBackground } : undefined,
              }}
            />
            <Stack.Screen
              name="new-check"
              options={{
                presentation: 'formSheet',
                ...sheetOptions,
                // Высота по содержимому, как модалка веб-кассы; клавиатура поднимает шторку.
                sheetAllowedDetents: 'fitToContents',
                sheetGrabberVisible: true,
                headerShown: false,
                // Контент без фона — под ним системное стекло шторки iOS 26.
                contentStyle: { backgroundColor: colors.sheetBackground },
              }}
            />
            <Stack.Screen
              name="pay"
              options={{ presentation: 'formSheet', ...sheetOptions, sheetAllowedDetents: [1], sheetGrabberVisible: true, headerShown: false }}
            />
            <Stack.Screen
              name="notifications"
              options={{ presentation: 'modal', headerShown: true, title: 'Уведомления', ...stackHeaderOptions }}
            />
            {/* Чат с кабинкой — полный экран мессенджера: стеклянная шапка, поле ввода у клавиатуры. */}
            <Stack.Screen name="chat" options={glassHeader({ headerShown: true, headerBackButtonDisplayMode: 'minimal', title: 'Чат' })} />
            {/* Tai — на весь экран, как Gemini: своя шапка с историей чатов и поле ввода внизу. */}
            <Stack.Screen name="tai" options={{ presentation: 'fullScreenModal', headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
          </Stack.Protected>
        </Stack>
        {!warm && <SwiftUIWarmup onDone={finishWarmup} />}
        {signedIn && <Realtime />}
        {signedIn && <LocalTour />}
        {signedIn && <NotificationBanner />}
        <OfflineBanner />
        <SessionLock />
        <DialogHost />
      </PersistQueryClientProvider>
    </ThemeProvider>
    </KeyboardProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
