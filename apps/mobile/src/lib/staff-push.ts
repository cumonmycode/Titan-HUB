// Push и «звонки» персоналу. Нажатие на уведомление или принятый звонок открывает
// чат или счёт кабинки.
// • iOS: устройство регистрируется на сервере клуба — обычные уведомления (APNs)
//   и «звонки» из Titan Home (VoIP → CallKit, модуль modules/titan-calls).
// • Android: телефон сам держит связь с клубом (служба модуля modules/titan-calls,
//   без Google-сервисов) — по ней приходят и уведомления, и «звонок» на весь экран.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useRef } from 'react';
import { Alert, Platform } from 'react-native';

import { type AnsweredCall, StaffCalls } from '../../modules/titan-calls';
import { api } from './api';
import { isChatOnScreen } from './chat';
import { hostOrigin, useSession } from './session';

// При открытом приложении уведомление тоже видно — кроме сообщений чата, который сейчас на экране.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Target;
    const visible = !(data.type === 'chat_message' && isChatOnScreen(data.checkId));
    return { shouldShowBanner: visible, shouldShowList: visible, shouldPlaySound: visible, shouldSetBadge: false };
  },
});

type Registered = { host: string; userId: string | null; push: string | null; voip: string | null };
let registered: Registered | null = null;

// Любой выход (в том числе по 401 и «Другой сотрудник») забывает регистрацию: следующий
// сотрудник на этом телефоне заново привязывает к себе push и звонки (сервер переносит запись).
useSession.subscribe((state, prev) => {
  if (!prev.token || state.token) return;
  registered = null;
  StaffCalls?.stop?.(); // Android: связь с клубом под прежним токеном больше не нужна
});

async function apnsToken(ask: boolean): Promise<string | null> {
  if (Platform.OS !== 'ios' || !Device.isDevice) return null;
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain && ask) {
    perm = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
  }
  if (!perm.granted) return null;
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Сообщить серверу клуба токены этого iPhone. «Звонки» (VoIP) приходят даже без
 * разрешения на уведомления, обычные push — только с ним (спрашиваем один раз).
 */
export async function registerStaffDevice(ask: boolean): Promise<void> {
  const { club, token, user } = useSession.getState();
  if (!club || !token || Platform.OS !== 'ios') return;
  const userId = user?.id ?? null;
  const push = await apnsToken(ask);
  const voip = StaffCalls?.getVoipToken() ?? null;
  if (!push && !voip) return;
  if (
    registered &&
    registered.host === club.host &&
    registered.userId === userId &&
    registered.push === push &&
    registered.voip === voip
  ) {
    return;
  }
  await api.post('/notifications/devices', {
    platform: 'ios',
    pushToken: push,
    voipToken: voip,
    deviceName: Device.deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version,
  });
  registered = { host: club.host, userId, push, voip };
}

/** Выключенные сотрудником типы уведомлений — Android-служба их не показывает. */
async function disabledTypes(): Promise<string[]> {
  try {
    const { settings } = await api.get<{ settings: { types?: Record<string, { enabled?: boolean }> } | null }>('/notifications/settings');
    return Object.entries(settings?.types ?? {})
      .filter(([, t]) => t?.enabled === false)
      .map(([type]) => type);
  } catch {
    return [];
  }
}

/**
 * Android: запустить (или перезапустить с новыми настройками) постоянную связь с клубом.
 * При первом входе просим разрешения: уведомления, звонок на весь экран, работа в фоне.
 */
export async function startStaffLink(ask: boolean): Promise<void> {
  const { club, token } = useSession.getState();
  const calls = StaffCalls;
  if (Platform.OS !== 'android' || !club || !token || !calls?.start) return;
  if (ask) await Notifications.requestPermissionsAsync().catch(() => null);
  calls.start(hostOrigin(club.host), token, await disabledTypes());
  if (!ask) return;

  if (calls.canUseFullScreenIntent?.() === false && calls.firstTime?.('full-screen')) {
    await new Promise<void>((resolve) =>
      Alert.alert(
        'Звонки из кабинок',
        'Чтобы вызов гостя звонил на весь экран, даже когда телефон заблокирован, разрешите Titan HUB полноэкранные уведомления.',
        [
          { text: 'Позже', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Разрешить',
            onPress: () => {
              calls.openFullScreenIntentSettings?.();
              resolve();
            },
          },
        ],
        { onDismiss: () => resolve() },
      ),
    );
  }
  if (calls.isIgnoringBatteryOptimizations?.() === false && calls.firstTime?.('battery')) {
    // Системный диалог: без него Android в простое разрывает связь, и вызовы приходят с опозданием.
    calls.requestIgnoreBatteryOptimizations?.();
  }
}

/** Выход сотрудника: телефон больше не получает его push и звонки. */
export async function unregisterStaffDevice(): Promise<void> {
  StaffCalls?.stop?.();
  if (!registered) return;
  const { push, voip } = registered;
  registered = null;
  await api.delete('/notifications/devices', { pushToken: push, voipToken: voip }).catch(() => {});
}

type Target = { kind?: string; type?: string; checkId?: string | null };

/** Чат кабинки — для сообщений (поверх её чека: «назад» ведёт в чек); счёт — для вызова; без счёта — касса. */
function openTarget(t: Target) {
  const checkId = t.checkId || null;
  const chat = t.kind === 'chat' || t.type === 'chat_message';
  if (!checkId) {
    router.push('/pos');
    return;
  }
  if (isChatOnScreen(checkId)) return;
  router.push({ pathname: '/pos/[checkId]', params: { checkId } });
  if (chat) router.push({ pathname: '/chat', params: { checkId } });
}

/** Пока сотрудник вошёл: регистрация устройства, переходы по уведомлениям и звонкам. */
export function useStaffPush() {
  const host = useSession((s) => s.club?.host ?? null);
  const token = useSession((s) => s.token);
  const handled = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!host || !token) return;
    if (Platform.OS === 'android') void startStaffLink(true).catch(() => {});
    else void registerStaffDevice(true).catch(() => {});
  }, [host, token]);

  // Токен VoIP или APNs сменился — переотправляем.
  useEffect(() => {
    const voip = StaffCalls?.addListener('onVoipToken', () => void registerStaffDevice(false).catch(() => {}));
    const push = Notifications.addPushTokenListener(() => void registerStaffDevice(false).catch(() => {}));
    return () => {
      voip?.remove();
      push.remove();
    };
  }, []);

  const onNotification = useEffectEvent((response: Notifications.NotificationResponse) => {
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = (response.notification.request.content.data ?? {}) as Target & { notificationId?: string | null };
    if (data.notificationId) void api.put(`/notifications/${data.notificationId}/read`).catch(() => {});
    // Даём навигатору смонтироваться после холодного старта.
    setTimeout(() => {
      openTarget(data);
      void Notifications.clearLastNotificationResponseAsync();
    }, 350);
  });

  useEffect(() => {
    if (lastResponse && token) onNotification(lastResponse);
  }, [lastResponse, token]);

  const onCall = useEffectEvent((call: AnsweredCall) => {
    if (call.notificationId) void api.put(`/notifications/${call.notificationId}/read`).catch(() => {});
    setTimeout(() => openTarget(call), 350);
  });

  // Звонок приняли: сразу (приложение работало) или при запуске (будили с экрана блокировки).
  useEffect(() => {
    if (!token) return;
    const pending = StaffCalls?.consumePendingCall();
    if (pending) onCall(pending);
    const sub = StaffCalls?.addListener('onCallAnswered', (call) => onCall(call));
    return () => sub?.remove();
  }, [token]);
}
