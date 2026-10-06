import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useEffectEvent, useRef } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { sheetOptions } from '@/components/sheet';
import { api } from '@/lib/api';
import { openFromNotificationData, registerForPush, setBadge } from '@/lib/push';
import { queryClient, refreshMoney, useWallet } from '@/lib/queries';
import { tokenRefreshDue, useSession } from '@/lib/session';
import { backdrop, colors, IS_IOS } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync(colors.background);

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Root />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Root() {
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const inside = status === 'signedIn' || status === 'demo';

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  return (
    <>
      {status === 'signedIn' ? <SignedInEffects /> : null}
      {inside ? <NotificationRouting /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: backdrop,
          animation: IS_IOS ? 'default' : 'fade_from_bottom',
        }}
      >
        <Stack.Protected guard={inside}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="pay" options={sheetOptions([1])} />
          <Stack.Screen name="check/[id]" options={sheetOptions([0.7, 1])} />
          <Stack.Screen name="profile-edit" options={sheetOptions('fitToContents')} />
          <Stack.Screen name="bonus-rules" options={sheetOptions('fitToContents')} />
          <Stack.Screen name="notifications" options={sheetOptions([0.7, 1])} />
        </Stack.Protected>
        <Stack.Protected guard={!inside}>
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

/** Фоновые обязанности вошедшего клиента: push, бейдж, свежесть данных, продление сессии. */
function SignedInEffects() {
  const { data: wallet } = useWallet();
  const unread = wallet?.unreadNotifications;

  // Разрешение уже выдано — молча перерегистрируем токен (он мог смениться).
  useEffect(() => {
    void registerForPush(false);
  }, []);

  useEffect(() => {
    if (unread != null) void setBadge(unread);
  }, [unread]);

  const onForeground = useEffectEvent(async () => {
    refreshMoney();
    if (await tokenRefreshDue()) {
      try {
        const { token } = await api.post<{ token: string }>('/resident/session/refresh');
        await useSession.getState().replaceToken(token);
      } catch { /* продлим в следующий раз */ }
    }
  });

  useEffect(() => {
    void onForeground();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void onForeground();
    });
    return () => sub.remove();
  }, []);

  // Пришёл push при открытом приложении — баланс/лента уже изменились на сервере.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => refreshMoney());
    return () => sub.remove();
  }, []);

  return null;
}

/** Нажатие на уведомление (в том числе холодный старт) → нужный экран. */
function NotificationRouting() {
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    // Даём навигатору смонтироваться после входа/холодного старта.
    const t = setTimeout(() => {
      openFromNotificationData(last.notification.request.content.data as Record<string, unknown>);
      void Notifications.clearLastNotificationResponseAsync();
    }, 350);
    return () => clearTimeout(t);
  }, [last]);

  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
