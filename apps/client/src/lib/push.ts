// Push-уведомления: разрешение, токен устройства → сервер, каналы Android, бейдж,
// переходы по нажатию на уведомление.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from './api';
import { refreshMoney } from './queries';
import { useSession } from './session';

// Уведомление, пришедшее при открытом приложении, всё равно показываем баннером.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let registeredToken: string | null = null;

export async function ensureAndroidChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('wallet', {
    name: 'Баланс и оплаты',
    description: 'Бонусы, депозит, долг и онлайн-оплаты',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#8B5CF6',
    vibrationPattern: [0, 180, 120, 180],
  });
  await Notifications.setNotificationChannelAsync('news', {
    name: 'Новости клуба',
    description: 'Турниры, события и объявления Titan',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#8B5CF6',
  });
}

/**
 * Токен, по которому сервер достанет телефон, — нативный токен устройства, без Expo:
 * iPhone — токен APNs (сервер шлёт в Apple, apns.ts), Android — токен FCM (сервер шлёт
 * в Firebase, fcm.ts; нужен google-services.json в сборке). Не вышло получить — остаются
 * лента в приложении и Telegram-бот.
 */
async function devicePushToken(): Promise<string | null> {
  const { data } = await Notifications.getDevicePushTokenAsync();
  return typeof data === 'string' && data ? data : null;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export async function pushPermission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Зарегистрировать устройство для push. ask=true — показать системный запрос
 * разрешения (только по действию пользователя). Возвращает итоговое разрешение.
 */
export async function registerForPush(ask: boolean): Promise<PushPermission> {
  if (!Device.isDevice) return 'denied';
  await ensureAndroidChannels();
  let perm = await pushPermission();
  if (perm === 'undetermined' && ask) {
    const r = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    perm = r.granted ? 'granted' : r.canAskAgain ? 'undetermined' : 'denied';
  }
  if (perm !== 'granted') return perm;
  if (useSession.getState().status !== 'signedIn') return perm;

  try {
    const token = await devicePushToken();
    if (token && token !== registeredToken) {
      await api.post('/resident/devices', {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        deviceName: Device.modelName ?? undefined,
        appVersion: Constants.expoConfig?.version,
      });
      registeredToken = token;
    }
  } catch (e) {
    console.warn('[push] register failed', e);
  }
  return perm;
}

/** Отвязать устройство при выходе, чтобы push чужого аккаунта не приходили. */
export async function unregisterPush() {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api.delete('/resident/devices', { token }).catch(() => {});
}

export async function setBadge(count: number) {
  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => {});
}

/** Куда вести по данным уведомления (meta.screen с сервера). */
export function openFromNotificationData(data: Record<string, unknown> | undefined) {
  const screen = typeof data?.screen === 'string' ? data.screen : null;
  refreshMoney();
  switch (screen) {
    case 'check':
      if (typeof data?.checkId === 'string') router.push({ pathname: '/check/[id]', params: { id: data.checkId } });
      return;
    case 'pay':
      router.push({ pathname: '/pay', params: typeof data?.purpose === 'string' ? { purpose: data.purpose } : {} });
      return;
    case 'history':
      router.navigate('/history');
      return;
    case 'home':
      router.navigate('/');
      return;
    default:
      router.push('/notifications');
  }
}
