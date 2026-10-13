import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import { startStaffLink } from './staff-push';

/**
 * Администрирование клуба: мой профиль и уведомления, настройки заведения, Telegram-опросы,
 * «О системе». Команда — lib/staff-api.ts, скидки и сертификаты — lib/loyalty-api.ts.
 * Серверные роуты: auth/me, notifications, system, club.
 * Настройки клуба на сервере — строки: булевы значения отправляем как "true"/"false"
 * (скидка персоналу — "1"/"0", как в вебе).
 */

const host = () => useSession.getState().club?.host ?? 'none';
const invalidate = (...keys: unknown[][]) => {
  const club = host();
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [club, ...key] });
};

/* ─────────────────────────── Настройки ─────────────────────────── */

export function useSettings() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings').then((r) => r.settings),
    staleTime: 60_000,
  });
}

/** Только владелец: 1–50 ключей за раз, значения — строки. */
export async function saveSettings(patch: Record<string, string>): Promise<void> {
  await api.patch('/system/settings', patch);
  invalidate(['system', 'settings'], ['pos'], ['analytics'], ['salary']);
}

export type IntegrationItem = { key: string; label: string; configured: boolean; masked: string | null };

export function useIntegrations(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'integrations'],
    queryFn: () => api.get<{ items: IntegrationItem[] }>('/system/integrations').then((r) => r.items),
    enabled,
    staleTime: 60_000,
  });
}

/* ───────────────────── Оплата, бронь, отзывы (владелец) ───────────────────── */

export type PaymentConfig = {
  sbpProvider: string;
  sbpProviderLabel: string;
  sbpConfigured: boolean;
  fiscalProvider: string;
  fiscalLabel: string;
  fiscalStandalone: boolean;
  testMode: boolean;
  vatCode: number;
  defaultPhone: string;
  itemized: boolean;
  fiscalMethods: string[];
  receiptFooter: string;
};

/** Способы оплаты, которые можно исключить из фискализации (как в веб-настройках). */
export const FISCAL_METHODS: { key: string; label: string }[] = [
  { key: 'cash', label: 'Наличные' },
  { key: 'card', label: 'Карта' },
  { key: 'transfer', label: 'СБП и перевод' },
  { key: 'split', label: 'Раздельная оплата' },
  { key: 'certificate', label: 'Сертификат' },
  { key: 'deposit', label: 'Депозит' },
  { key: 'debt', label: 'Долг' },
  { key: 'bonus', label: 'Бонусы' },
];

export function usePaymentConfig() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'payment-config'],
    queryFn: () => api.get<PaymentConfig>('/system/payment-config'),
    staleTime: 60_000,
  });
}

export async function savePaymentConfig(patch: Partial<Pick<PaymentConfig, 'fiscalProvider' | 'testMode' | 'defaultPhone' | 'itemized' | 'fiscalMethods' | 'receiptFooter'>>): Promise<void> {
  await api.put('/system/payment-config', patch);
  invalidate(['system', 'payment-config'], ['system', 'settings']);
}

export type ReviewsConfig = { yandexUrl: string; twogisUrl: string; inviteText: string };

export function useReviewsConfig() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'reviews-config'],
    queryFn: () => api.get<ReviewsConfig>('/system/reviews-config'),
    staleTime: 60_000,
  });
}

export async function saveReviewsConfig(patch: Partial<ReviewsConfig>): Promise<void> {
  await api.put('/system/reviews-config', patch);
  invalidate(['system', 'reviews-config']);
}

/* ─────────────────────────── Мой профиль и уведомления ─────────────────────────── */

export async function updateMe(patch: { nickname?: string; fullName?: string | null; phone?: string | null; birthday?: string | null; photoUrl?: string | null }): Promise<void> {
  await api.patch('/auth/me', patch);
  invalidate(['me'], ['staff']);
}

export async function setMyPin(pin: string): Promise<void> {
  await api.post('/auth/pin/set', { pin });
}

export type NotificationType = { key: string; label: string; description: string; defaultEnabled: boolean };
export type NotificationPrefs = Record<string, { enabled: boolean; channel?: string; telegram?: boolean }>;

export function useNotificationTypes() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'notifications', 'types'],
    queryFn: () => api.get<{ types: NotificationType[] }>('/notifications/types').then((r) => r.types),
    staleTime: 60 * 60_000,
  });
}

export function useNotificationPrefs() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'notifications', 'prefs'],
    queryFn: () => api.get<{ settings: { types: NotificationPrefs } | null; telegramLinked?: boolean }>('/notifications/settings'),
    staleTime: 30_000,
  });
}

export async function saveNotificationPrefs(types: NotificationPrefs): Promise<void> {
  await api.put('/notifications/settings', { types });
  invalidate(['notifications', 'prefs']);
  // Android-служба фильтрует уведомления по настройкам — перезапускаем её с новыми.
  void startStaffLink(false).catch(() => {});
}

/* ─────────────────────────── Опросы ─────────────────────────── */

export type PollConfig = {
  id: string;
  kind: string;
  enabled: boolean;
  chatId: string;
  threadId: number | null;
  title: string;
  subtitleDay: string;
  autoDay?: boolean;
  subtitleTime: string;
  options: string[];
  /** 1 = Пн … 7 = Вс — дни выкладки. */
  weekdays: number[];
  /** HH:MM по Москве. */
  postTime: string;
  lastPostedAt?: string | null;
};

/** 1 = Пн … 7 = Вс — как их нумерует сервер. */
export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const POLL_DEFAULT_OPTIONS = ['Да', 'Нет', 'Думаю', 'Опоздаю'];

export type PollChat = { id: string; title: string | null; type: string | null; topics: { threadId: string; name: string | null }[] };

export function usePolls() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'polls'],
    queryFn: () => api.get<{ configs: PollConfig[]; tokenConfigured: boolean; tokenMasked: string | null; commandsAdminOnly: boolean }>('/system/polls'),
    staleTime: 15_000,
  });
}

export function usePollChats() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'polls', 'chats'],
    queryFn: () => api.get<{ chats: PollChat[] }>('/system/polls/chats').then((r) => r.chats),
    staleTime: 60_000,
  });
}

export function usePollCollect() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'polls', 'collect'],
    queryFn: () => api.get<{ enabled: boolean; tokenConfigured: boolean }>('/system/polls/collect'),
    staleTime: 30_000,
  });
}

/** Конфиги опросов сохраняются только целиком. */
export async function savePolls(configs: PollConfig[]): Promise<void> {
  await api.put('/system/polls', { configs: configs.map(({ lastPostedAt: _lastPostedAt, ...rest }) => rest) });
  invalidate(['polls']);
}

export async function testPoll(pollId: string): Promise<void> {
  await api.post('/system/polls/test', { id: pollId });
}

/** Реальная выкладка на сегодня: плановый постинг сегодня уже не повторит опрос. */
export async function postPollToday(pollId: string): Promise<void> {
  await api.post('/system/polls/post-today', { id: pollId });
  invalidate(['polls']);
}

export async function setPollCommandsAdminOnly(adminOnly: boolean): Promise<void> {
  await api.post('/system/polls/commands', { adminOnly });
  invalidate(['polls']);
}

export async function setPollCollect(enabled: boolean): Promise<void> {
  if (enabled) await api.post('/system/polls/collect', {});
  else await api.delete('/system/polls/collect');
  invalidate(['polls', 'collect']);
}

/* ─────────────────────────── О системе ─────────────────────────── */

export type ClubContext = {
  club: { slug: string; name: string } | null;
  subscription: { state: 'active' | 'expiring' | 'grace' | 'expired' | 'suspended' | 'none' | 'unknown'; blocked: boolean; paidUntil: string | null; graceUntil: string | null; daysLeft: number | null } | null;
  modules: Record<string, boolean>;
};

export function useClubContext() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'club', 'context'],
    queryFn: () => api.get<ClubContext>('/club/context'),
    staleTime: 5 * 60_000,
  });
}

export function useSystemInfo() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'info'],
    queryFn: () => api.get<{ version: string; shift: { id: string } | null; eveningName?: string | null; env?: string }>('/system/info'),
    staleTime: 60_000,
  });
}

export type BackupEntry = { name: string; size: number; at: string; location: 'drive' | 'local' };

export function useBackupStatus() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'backup'],
    queryFn: () => api.get<{ last: BackupEntry | null; driveConfigured: boolean }>('/system/backup/status'),
    staleTime: 60_000,
  });
}

/** Полная копия базы клуба сейчас (и в Google Drive, если настроен). Только владелец. */
export async function createBackup(): Promise<{ name: string; uploaded: boolean }> {
  const r = await api.post<{ name: string; uploaded: boolean }>('/system/backup', {});
  invalidate(['system', 'backup']);
  return r;
}

/* Права сотрудника переехали в lib/staff-api.ts; реэкспорт — для старых импортов. */
export { PERMISSIONS, permissionOn } from './staff-api';
