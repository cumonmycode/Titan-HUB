import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { formatMoney, toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import { startStaffLink } from './staff-push';
import type { NumericString } from './types';

/**
 * Администрирование клуба: лояльность (скидки, бонусы, сертификаты), пользователи и права,
 * мой профиль и уведомления, настройки заведения, Telegram-опросы, «О системе».
 * Серверные роуты: discounts, certificates, staff, auth/me, notifications, system, club.
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

export function useBookingConfig() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'system', 'booking-config'],
    queryFn: () => api.get<{ enabled: boolean }>('/system/booking-config'),
    staleTime: 60_000,
  });
}

export async function saveBookingConfig(enabled: boolean): Promise<void> {
  await api.put('/system/booking-config', { enabled });
  invalidate(['system', 'booking-config']);
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

/* ─────────────────────────── Скидки ─────────────────────────── */

export type Discount = {
  id: string;
  name: string;
  type: 'percent' | 'fixed';
  value: NumericString;
  isActive: boolean;
  isAuto: boolean;
  minQuantity: number | null;
  itemId: string | null;
  clientId: string | null;
  createdAt: string;
};

export type TierRule = {
  id: string;
  name: string;
  clientTier: string;
  discountId: string | null;
  isActive: boolean;
  discount: { name: string | null; type: 'percent' | 'fixed' | null; value: NumericString | null } | null;
};

export function useDiscounts() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'discounts'],
    queryFn: () => api.get<{ discounts: Discount[] }>('/discounts').then((r) => r.discounts),
    staleTime: 15_000,
  });
}

export function useTierRules() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'tier-rules'],
    queryFn: () => api.get<{ rules: TierRule[] }>('/discounts/tier-rules').then((r) => r.rules),
    staleTime: 15_000,
  });
}

/** «−15 %» или «−300 ₽». */
export const discountValueText = (discount: { type: 'percent' | 'fixed'; value: NumericString }) =>
  discount.type === 'percent' ? `−${toNumber(discount.value)} %` : `−${formatMoney(toNumber(discount.value))}`;

export type DiscountInput = {
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  isActive: boolean;
  isAuto: boolean;
  minQuantity: number | null;
  itemId: string | null;
  clientId: string | null;
};

export async function saveDiscount(discountId: string | null, input: DiscountInput): Promise<void> {
  const body = {
    name: input.name.trim(),
    type: input.type,
    value: input.value,
    isActive: input.isActive,
    isAuto: input.isAuto,
    // «Без порога» = 1 (умолчание сервера): иначе при правке порог нельзя было снять.
    minQuantity: input.minQuantity ?? 1,
    itemId: input.itemId,
    clientId: input.clientId,
  };
  if (discountId) await api.patch(`/discounts/${discountId}`, body);
  else await api.post('/discounts', body);
  invalidate(['loyalty'], ['pos']);
}

export async function deleteDiscount(discountId: string): Promise<void> {
  await api.delete(`/discounts/${discountId}`);
  invalidate(['loyalty'], ['pos']);
}

export async function createTierRule(clientTier: string, discountId: string): Promise<void> {
  await api.post('/discounts/tier-rules', { clientTier, discountId, isActive: true });
  invalidate(['loyalty'], ['pos']);
}

export async function setTierRuleActive(ruleId: string, isActive: boolean): Promise<void> {
  await api.patch(`/discounts/tier-rules/${ruleId}`, { isActive });
  invalidate(['loyalty'], ['pos']);
}

export async function deleteTierRule(ruleId: string): Promise<void> {
  await api.delete(`/discounts/tier-rules/${ruleId}`);
  invalidate(['loyalty'], ['pos']);
}

/* ─────────────────────────── Сертификаты ─────────────────────────── */

export type Certificate = { id: string; code: string; amount: number; balance: number; status: 'active' | 'used'; createdAt: string };

export function useCertificates() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'certificates'],
    queryFn: () => api.get<{ certificates: Certificate[] }>('/certificates').then((r) => r.certificates),
    staleTime: 15_000,
  });
}

/** Выпуск сертификата; код генерирует сервер. Без идемпотентности — кнопку блокируем. */
export async function issueCertificate(nominal: number): Promise<{ code: string; nominal: NumericString }> {
  const { certificate } = await api.post<{ certificate: { code: string; nominal: NumericString } }>('/certificates', { nominal });
  invalidate(['loyalty', 'certificates']);
  return certificate;
}

/** Только владелец: погасить сертификат (больше не принимается в кассе). */
export async function deactivateCertificate(certificateId: string): Promise<void> {
  await api.put(`/certificates/${certificateId}/deactivate`, {});
  invalidate(['loyalty', 'certificates']);
}

/* ─────────────────────────── Сотрудники ─────────────────────────── */

export type StaffRow = {
  id: string;
  nickname: string;
  phone: string | null;
  role: 'owner' | 'staff';
  permissions: Record<string, boolean> | null;
  tgId: string | null;
  tgUsername: string | null;
  photoUrl: string | null;
  createdAt: string;
};

export const PERMISSIONS: { key: string; label: string; defaultOn: boolean }[] = [
  { key: 'menu', label: 'Меню', defaultOn: true },
  { key: 'inventory', label: 'Склад', defaultOn: true },
  { key: 'clients', label: 'Клиенты', defaultOn: true },
  { key: 'discounts', label: 'Скидки', defaultOn: true },
  { key: 'bonus', label: 'Бонусы', defaultOn: true },
  { key: 'debtors', label: 'Депозиты, долги и сборы', defaultOn: false },
  { key: 'expenses', label: 'Расходы', defaultOn: false },
  { key: 'staff', label: 'Персонал', defaultOn: false },
  { key: 'salary', label: 'Зарплата', defaultOn: false },
  { key: 'about', label: 'О заведении', defaultOn: true },
];

export const permissionOn = (row: Pick<StaffRow, 'permissions'>, key: string) => row.permissions?.[key] ?? PERMISSIONS.find((p) => p.key === key)?.defaultOn ?? true;

export function useStaffAdmin(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'staff', 'admin'],
    queryFn: () => api.get<{ staff: StaffRow[] }>('/staff').then((r) => r.staff),
    enabled,
    staleTime: 15_000,
  });
}

export function useStaffPasskeys(staffId: string, enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'staff', staffId, 'passkeys'],
    queryFn: () => api.get<{ passkeys: { id: string; deviceType: string | null; backedUp: boolean | null; createdAt: string }[] }>(`/staff/${staffId}/passkeys`).then((r) => r.passkeys),
    enabled,
    staleTime: 30_000,
  });
}

export async function createStaff(input: { nickname: string; password: string; pin: string | null; phone: string | null; role: 'owner' | 'staff' }): Promise<void> {
  await api.post('/staff', {
    nickname: input.nickname.trim(),
    password: input.password,
    role: input.role,
    ...(input.pin ? { pin: input.pin } : {}),
    ...(input.phone ? { phone: input.phone.trim() } : {}),
  });
  invalidate(['staff']);
}

export async function updateStaff(staffId: string, patch: { nickname?: string; phone?: string; role?: 'owner' | 'staff'; password?: string; permissions?: Record<string, boolean> }): Promise<void> {
  await api.patch(`/staff/${staffId}`, patch);
  invalidate(['staff'], ['me']);
}

export async function resetStaffPin(staffId: string, pin: string): Promise<void> {
  await api.post(`/staff/${staffId}/reset-pin`, { pin });
}

/** Увольнение: профиль скрывается, его passkey удаляются. Себя удалить нельзя. */
export async function deleteStaff(staffId: string): Promise<void> {
  await api.delete(`/staff/${staffId}`);
  invalidate(['staff']);
}

export async function deleteStaffPasskey(staffId: string, passkeyId: string): Promise<void> {
  await api.delete(`/staff/${staffId}/passkeys/${passkeyId}`);
  invalidate(['staff', staffId, 'passkeys']);
}

export async function staffTelegramLink(staffId: string): Promise<{ deepLink: string; linked: boolean; tgUsername: string | null }> {
  return api.post<{ deepLink: string; linked: boolean; tgUsername: string | null }>(`/staff/${staffId}/telegram-link`, {});
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
