// Вход по номеру телефона с подтверждением в Telegram-боте клуба.
// 1) /auth/app/start: номер есть в клубе → запрос входа; нет → анкета и запрос регистрации.
// 2) Клиент открывает бота и подтверждает; бот показывает кнопку «Открыть приложение».
// 3) Приложение опрашивает /auth/app/status и получает токен.
// Незавершённый вход хранится в защищённом хранилище: если система выгрузила
// приложение, пока клиент был в Telegram, вход продолжится при следующем запуске.
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';

import { api } from './api';
import { photoFile } from './photo';
import type { LoginMode, LoginStart, LoginStatus, Registration } from './types';

const PENDING_KEY = 'titan_pending_login';

export interface PendingLogin {
  ticket: string;
  deepLink: string;
  botUsername: string;
  mode: LoginMode;
  /** Номер в виде «+7 999 123-45-67» — для подписи на экране подтверждения. */
  phone: string;
  expiresAt: string;
}

export async function savePending(pending: PendingLogin): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending)).catch(() => {});
}

export async function clearPending(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => {});
}

/** Незавершённый вход, если он ещё не истёк. */
export async function loadPending(): Promise<PendingLogin | null> {
  const raw = await SecureStore.getItemAsync(PENDING_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingLogin;
    if (pending.ticket && new Date(pending.expiresAt).getTime() > Date.now()) return pending;
  } catch { /* битая запись — начнём заново */ }
  await clearPending();
  return null;
}

/** Номер → вход (pending) или «нужна анкета» (register); с анкетой — запрос регистрации. */
export function startLogin(phone: string, register?: Registration): Promise<LoginStart> {
  return api.post<LoginStart>('/auth/app/start', {
    phone,
    deviceName: Device.modelName ?? (Platform.OS === 'ios' ? 'iPhone' : 'Android'),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    register,
  }, { auth: false });
}

export async function uploadRegistrationPhoto(ticket: string, uri: string): Promise<void> {
  const form = new FormData();
  form.append('ticket', ticket);
  form.append('file', photoFile(uri));
  await api.post('/auth/app/photo', form, { auth: false, timeoutMs: 45_000 });
}

export function loginStatus(ticket: string): Promise<LoginStatus> {
  return api.get<LoginStatus>(`/auth/app/status?ticket=${encodeURIComponent(ticket)}`, { auth: false });
}

/** Открыть бота в приложении Telegram (tg://), а без него — через t.me в браузере. */
export async function openTelegram(deepLink: string): Promise<void> {
  try {
    const url = new URL(deepLink);
    const domain = url.pathname.replace(/^\//, '');
    const start = url.searchParams.get('start');
    await Linking.openURL(`tg://resolve?domain=${domain}${start ? `&start=${start}` : ''}`);
  } catch {
    await Linking.openURL(deepLink);
  }
}
