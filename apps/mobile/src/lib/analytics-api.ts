import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api, ApiError } from './api';
import { useClubKey } from './queries';
import { currentBusinessDay, useBusinessDayStartHour } from './salary-api';
import { useNow } from './use-now';
import type { NumericString } from './types';

/**
 * «Аналитика». Контракт — mobile-api-events-analytics.md, часть 2.
 * Периоды — бизнес-дни клуба (час начала из настроек); выручка — закрытые чеки по времени
 * открытия, возвраты вычитаются по дате возврата. Сотруднику сервер не отдаёт прибыль и
 * себестоимость в обзоре, но отдаёт их в /revenue и /checks — экраны прячут их сами.
 */

/* ─────────────────────────── Период ─────────────────────────── */

export type PeriodPreset = 'today' | 'yesterday' | 'thisWeek' | 'month' | 'days7' | 'days30' | 'lastWeek' | 'lastMonth' | 'days90' | 'year' | 'custom';

/** Быстрые периоды — сегментами над отчётом. */
export const QUICK_PRESETS: { key: 'today' | 'yesterday' | 'thisWeek' | 'month'; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'thisWeek', label: 'Эта неделя' },
  { key: 'month', label: 'Этот месяц' },
];

/** Остальные периоды — в меню календаря в шапке. */
export const MORE_PRESETS: { key: Exclude<PeriodPreset, 'custom' | (typeof QUICK_PRESETS)[number]['key']>; label: string }[] = [
  { key: 'days7', label: '7 дней' },
  { key: 'days30', label: '30 дней' },
  { key: 'lastWeek', label: 'Прошлая неделя' },
  { key: 'lastMonth', label: 'Прошлый месяц' },
  { key: 'days90', label: '90 дней' },
  { key: 'year', label: 'С начала года' },
];

export const PERIOD_PRESETS: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] = [...QUICK_PRESETS, ...MORE_PRESETS];

type PeriodState = {
  preset: PeriodPreset;
  customFrom: string | null;
  customTo: string | null;
  setPreset: (preset: Exclude<PeriodPreset, 'custom'>) => void;
  setCustom: (from: string, to: string) => void;
};

export const useAnalyticsPeriodStore = create<PeriodState>((set) => ({
  preset: 'today',
  customFrom: null,
  customTo: null,
  setPreset: (preset) => set({ preset }),
  setCustom: (from, to) => set({ preset: 'custom', customFrom: from <= to ? from : to, customTo: from <= to ? to : from }),
}));

/** Период по датам (переход из Tai): совпадение с готовым периодом подсветит его сегмент. */
export const setAnalyticsRange = (from: string, to: string) => useAnalyticsPeriodStore.getState().setCustom(from, to);

/** «2026-09-17» ± дни, в UTC — без сдвигов часового пояса устройства. */
export function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

const shortDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const formatDay = (key: string, long = false) => (long ? longDay : shortDay).format(new Date(`${key}T12:00:00Z`)).replace('.', '');

export type ResolvedPeriod = { from: string; to: string; days: number; label: string; preset: PeriodPreset; today: string };

/**
 * Текущий бизнес-день по серверу — единый источник «сегодня» для веба и приложения.
 * Пока ответа нет (или он устарел, например восстановлен из кэша на диске), считаем сами.
 */
function useServerBusinessDay(): string | null {
  const club = useClubKey();
  const query = useQuery({
    queryKey: [club, 'analytics', 'business-day'],
    queryFn: () => api.get<{ businessDay: string; startHour: number }>('/analytics/business-day'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const now = useNow(60_000);
  const fresh = query.dataUpdatedAt > now - 10 * 60_000;
  return fresh ? (query.data?.businessDay ?? null) : null;
}

/** Даты готового периода относительно «сегодня» клуба. Неделя — с понедельника. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): { from: string; to: string } {
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'thisWeek':
      return { from: monday, to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'days7':
      return { from: addDays(today, -6), to: today };
    case 'days30':
      return { from: addDays(today, -29), to: today };
    case 'lastWeek':
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case 'lastMonth': {
      const to = addDays(monthStart, -1);
      return { from: `${to.slice(0, 8)}01`, to };
    }
    case 'days90':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 5)}01-01`, to: today };
  }
}

export function useAnalyticsPeriod(): ResolvedPeriod {
  const startHour = useBusinessDayStartHour();
  const serverDay = useServerBusinessDay();
  const { preset: stored, customFrom, customTo } = useAnalyticsPeriodStore();
  const today = serverDay ?? currentBusinessDay(startHour);
  const { from, to } = stored === 'custom' ? { from: customFrom ?? today, to: customTo ?? today } : presetRange(stored, today);
  // Свои даты, совпавшие с готовым периодом (например, «эта неделя» из Tai), — это он и есть.
  const same =
    stored === 'custom'
      ? PERIOD_PRESETS.find((p) => {
          const range = presetRange(p.key, today);
          return range.from === from && range.to === to;
        })
      : undefined;
  const preset: PeriodPreset = same?.key ?? stored;
  const name = PERIOD_PRESETS.find((p) => p.key === preset)?.label;
  const range = from === to ? formatDay(from, true) : `${formatDay(from)} — ${formatDay(to)}`;
  const label = preset === 'custom' || !name ? range : `${name}, ${range}`;
  return { from, to, days: daysBetween(from, to), label, preset, today };
}

/** Предыдущий период той же длины — для сравнения. */
export const previousPeriod = (p: { from: string; days: number }) => ({ from: addDays(p.from, -p.days), to: addDays(p.from, -1) });

/* ─────────────────────────── Модели ─────────────────────────── */

export type NetBreakdown = {
  gross: number;
  revenueNet: number;
  checks: number;
  avgCheck: number;
  eventRevenue: number;
  eventChecks: number;
  clubChecks: number;
  refunds: number;
  /** Только владельцу. */
  eventCosts?: number;
  commission?: number;
  cogs?: number;
  opex?: number;
  salary?: number;
  expenses?: number;
  net?: number;
};

export type Overview = {
  period: { from: string; to: string; days: number };
  current: NetBreakdown & { margin?: number | null };
  previous: NetBreakdown;
  deltas: { revenue: number; checks: number; profit?: number; cogs?: number; expenses?: number };
  paymentBreakdown: { method: string; total: NumericString }[];
  today: NetBreakdown;
  businessDay: string;
};

export type RevenueSeries = {
  revenue: { date: string; revenue: number; count: number }[];
  refunds: { date: string; total: number }[];
  expenses: { date: string; total: NumericString }[];
  cogs: { date: string; total: NumericString }[];
};

export type ProductRow = {
  itemId: string;
  name: string | null;
  category: string | null;
  categoryId: string | null;
  totalQty: NumericString;
  totalRev: NumericString;
  share: number;
  cumulative: number;
  abc: 'A' | 'B' | 'C';
};

export type AnalyticsCheck = {
  id: string;
  createdAt: string;
  closedAt: string | null;
  totalAmount: number;
  discountTotal: number;
  bonusUsed: number;
  certificateUsed: number;
  playerId: string | null;
  guestName: string | null;
  playerPhoto: string | null;
  clientTier: string | null;
  staffId: string;
  staffNickname: string | null;
  shiftId: string;
  linkedEventId: string | null;
  hasRental: boolean;
  paymentMethod: string | null;
  itemCount: number;
  payments: { method: string; amount: number }[];
};

export type CheckDetail = {
  check: { id: string; status: string; createdAt: string; closedAt: string | null; totalAmount: number; discountTotal: number; bonusUsed: number; certificateUsed: number; tipAmount: number; eventBaseAmount: number | null };
  guestName: string | null;
  staffComp: boolean;
  retailTotal: number;
  costTotal: number;
  items: { id: string; itemId: string; name: string | null; quantity: number; priceAtTime: number; lineTotal: number; lineCost: number }[];
  payments: { method: string; amount: number }[];
  discounts: { id: string; name: string; type: 'percent' | 'fixed'; value: number; amount: number }[];
  player: { id: string; nickname: string; fullName: string | null; phone: string | null; clientTier: string } | null;
  staff?: { id: string; nickname: string };
  refunds: { id: string; totalAmount: number; reason: string; tenders: { method: string; amount: number }[] | null; createdAt: string }[];
};

export type ClientsAnalytics = {
  total: number;
  newThisPeriod: number;
  tierDist: { tier: string; count: number }[];
  retentionRate: number;
  segments: { new: number; active: number; sleeping: number };
  topSpenders: { playerId: string; nickname: string | null; clientTier: string | null; photoUrl: string | null; total: number; refundsTotal: number; visits: number }[];
  guestSales: { total: number; visits: number };
};

export type SegmentKey = 'new' | 'active' | 'sleeping';
export type SegmentMember = { playerId: string; nickname: string | null; clientTier: string | null; photoUrl: string | null; total: number; visits: number; lastVisit?: string };

export type PlayerCard = {
  profile: { id: string; nickname: string; fullName: string | null; clientTier: string; phone: string | null; balance: NumericString; bonusPoints: NumericString; createdAt: string };
  allTime: { spend: number; refundsTotal: number; checksCount: number; visitDays: number; avgCheck: number; firstVisit: string | null; lastVisit: string | null; daysSinceLast: number | null; visitsPerMonth: number };
  last30: { spend: number; refundsTotal: number; checksCount: number };
  recentChecks: { id: string; createdAt: string; totalAmount: NumericString }[];
};

export type EventsAnalytics = {
  totals: {
    count: number;
    hours: number;
    days: number;
    revenue: number;
    actualRevenue: number;
    plannedRevenue: number;
    attendees: number;
    cancelled: number;
    avgDuration: number;
    avgCheck: number;
    revenuePerHour: number;
    avgAttendees: number;
  };
  byCategory: { label: string; count: number; revenue: number; hours: number }[];
  byWeekday: { label: string; count: number }[];
  topCustomers: { name: string; phone: string | null; count: number; hours: number; revenue: number }[];
  topZones: { name: string; count: number; revenue: number }[];
};

export type TariffsAnalytics = {
  byTariff: { tariffId: string; name: string; count: number; revenue: number }[];
  byEvening: { eveningKey: string; label: string; count: number; revenue: number }[];
  gameEvenings: { eveningKey: string; label: string; count: number }[];
  gameEveningsTotal: number;
  total: { count: number; revenue: number };
};

/** Структура выручки, ритм клуба, гости и тренд за 12 месяцев (GET /analytics/insights). */
export type Insights = {
  period: { from: string; to: string };
  structure: { bar: number; games: number; rental: number; events: number; discounts: number; total: number };
  hours: { hour: number; checks: number; revenue: number }[];
  /** dow — ISO: 1 = понедельник … 7 = воскресенье (день бизнес-дня клуба). */
  weekdays: { dow: number; days: number; checks: number; revenue: number; avgRevenue: number }[];
  heat: { dow: number; hour: number; checks: number; revenue: number }[];
  guests: { unique: number; new: number; returning: number; anonymousChecks: number };
  months: { month: string; checks: number; revenue: number }[];
};

export type StaffComp = {
  staff: { staffId: string; nickname: string; photoUrl: string | null; checksCount: string | number; retail: number; cost: number }[];
  totals: { retail: number; cost: number };
  transactions: { id: string; createdAt: string; staffId: string; nickname: string; retail: number; cost: number }[];
};

/* ─────────────────────────── Запросы ─────────────────────────── */

export const analyticsErrorText = (error: unknown) => {
  // Текст «модуль выключен» собирает клиент API; остаётся ролевой запрет.
  if (error instanceof ApiError && error.status === 403 && (error.data as { error?: string } | null)?.error !== 'module_disabled') {
    return 'Этот отчёт доступен только владельцу.';
  }
  return error instanceof Error ? error.message : String(error);
};

const range = (from: string, to: string) => `from=${from}&to=${to}`;

function useAnalytics<T>(path: string, key: unknown[], options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'analytics', ...key],
    queryFn: ({ signal }) => api.get<T>(path, { signal }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: (count, error) => !(error instanceof ApiError && error.status === 403) && count < 2,
    ...options,
  });
}

export const useOverview = (from: string, to: string) => useAnalytics<Overview>(`/analytics/overview?${range(from, to)}`, ['overview', from, to], { refetchInterval: 60_000 });
export const useRevenueSeries = (from: string, to: string, enabled = true) => useAnalytics<RevenueSeries>(`/analytics/revenue?${range(from, to)}`, ['revenue', from, to], { enabled });
export const useProductsAnalytics = (from: string, to: string) => useAnalytics<{ products: ProductRow[]; totalRev: number }>(`/analytics/products?${range(from, to)}`, ['products', from, to]);
export const useAnalyticsChecks = (from: string, to: string, enabled = true) =>
  useAnalytics<{ summary: NetBreakdown; checks: AnalyticsCheck[] }>(`/analytics/checks?${range(from, to)}`, ['checks', from, to], { enabled });
export const useAnalyticsCheck = (checkId: string) => useAnalytics<CheckDetail>(`/analytics/checks/${checkId}`, ['check', checkId]);
export const useClientsAnalytics = (from: string, to: string) => useAnalytics<ClientsAnalytics>(`/analytics/clients?${range(from, to)}`, ['clients', from, to]);
export const useSegmentMembers = (segment: SegmentKey) => useAnalytics<{ players: SegmentMember[] }>(`/analytics/segment-members?segment=${segment}`, ['segment', segment]);
export const usePlayerCard = (playerId: string) => useAnalytics<PlayerCard>(`/analytics/players/${playerId}`, ['player', playerId]);
export const useEventsAnalytics = (from: string, to: string) => useAnalytics<EventsAnalytics>(`/analytics/events?${range(from, to)}`, ['events', from, to]);
export const useTariffsAnalytics = (from: string, to: string) => useAnalytics<TariffsAnalytics>(`/analytics/tariffs?${range(from, to)}`, ['tariffs', from, to]);
export const useInsights = (from: string, to: string) => useAnalytics<Insights>(`/analytics/insights?${range(from, to)}`, ['insights', from, to]);
export const useStaffComp = (from: string, to: string, enabled: boolean) => useAnalytics<StaffComp>(`/analytics/staff?${range(from, to)}`, ['staff', from, to], { enabled });

/** «+12%» / «−5%» / null при нуле. */
export const deltaText = (pct: number | undefined) => (pct === undefined || pct === 0 ? null : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`);
export const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0);
