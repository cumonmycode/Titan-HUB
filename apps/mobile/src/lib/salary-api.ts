import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { formatMoney } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { NumericString } from './types';

/**
 * Зарплата: формулы (схемы), расчёт по сменам и выплаты. Получают только сотрудники,
 * которые работали на смене; выдаёт только владелец — сумму по формуле можно поправить.
 * Сервер: modules/salary/salary.router.ts, движок — apps/api/src/lib/salary.ts.
 */

const host = () => useSession.getState().club?.host ?? 'none';
const invalidate = (...keys: unknown[][]) => {
  const club = host();
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [club, ...key] });
};

/* ─────────────────────────── Формула ─────────────────────────── */

export type RevenueBase = 'shift' | 'split' | 'own';

export type SalaryRules = {
  base: number;
  percent: number;
  stepFrom: number;
  stepEvery: number;
  stepAdd: number;
  hourly: number;
  min: number;
  max: number;
  revenue: RevenueBase;
  events: boolean;
};

export const DEFAULT_RULES: SalaryRules = { base: 700, percent: 0, stepFrom: 7000, stepEvery: 1000, stepAdd: 100, hourly: 0, min: 0, max: 0, revenue: 'shift', events: false };

export const REVENUE_LABEL: Record<RevenueBase, { title: string; hint: string }> = {
  shift: { title: 'Вся смена', hint: 'Каждому — от всей выручки смены' },
  split: { title: 'Поровну', hint: 'Выручка смены делится на работавших' },
  own: { title: 'Свои чеки', hint: 'Только чеки, которые открыл сотрудник' },
};

export type SalaryLine = { label: string; amount: number };

const rub = (n: number) => formatMoney(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Зеркало computeSalary сервера (lib/salary.ts) — для живого расчёта в редакторе формулы. */
export function computeSalary(rules: SalaryRules, input: { revenue: number; hours: number }): { amount: number; lines: SalaryLine[] } {
  const revenue = Math.max(0, input.revenue);
  const lines: SalaryLine[] = [];
  if (rules.base > 0) lines.push({ label: 'Ставка за смену', amount: rules.base });
  if (rules.percent > 0) lines.push({ label: `${rules.percent}% от ${rub(revenue)}`, amount: round2((revenue * rules.percent) / 100) });
  if (rules.stepAdd > 0 && rules.stepEvery > 0 && revenue > rules.stepFrom) {
    const steps = Math.ceil((revenue - rules.stepFrom) / rules.stepEvery);
    lines.push({ label: `${steps} × ${rub(rules.stepAdd)} сверх ${rub(rules.stepFrom)}`, amount: steps * rules.stepAdd });
  }
  if (rules.hourly > 0 && input.hours > 0) {
    const hours = Math.round(input.hours * 4) / 4;
    lines.push({ label: `${hours.toLocaleString('ru-RU')} ч × ${rub(rules.hourly)}`, amount: round2(hours * rules.hourly) });
  }
  let amount = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (rules.min > 0 && amount < rules.min) {
    lines.push({ label: `До минимума ${rub(rules.min)}`, amount: round2(rules.min - amount) });
    amount = rules.min;
  }
  if (rules.max > 0 && amount > rules.max) {
    lines.push({ label: `Потолок ${rub(rules.max)}`, amount: round2(rules.max - amount) });
    amount = rules.max;
  }
  return { amount, lines };
}

/** Формула словами (как describeRules сервера). */
export function describeRules(rules: SalaryRules): string {
  const parts: string[] = [];
  if (rules.base > 0) parts.push(`${rub(rules.base)} за смену`);
  if (rules.percent > 0) parts.push(`${rules.percent}% выручки`);
  if (rules.stepAdd > 0 && rules.stepEvery > 0) parts.push(`${rub(rules.stepAdd)} за каждые начатые ${rub(rules.stepEvery)}${rules.stepFrom > 0 ? ` сверх ${rub(rules.stepFrom)}` : ''}`);
  if (rules.hourly > 0) parts.push(`${rub(rules.hourly)} в час`);
  const text = parts.length ? parts.join(' + ') : 'Без начислений';
  const limits = [rules.min > 0 ? `не меньше ${rub(rules.min)}` : '', rules.max > 0 ? `не больше ${rub(rules.max)}` : ''].filter(Boolean);
  return limits.length ? `${text}; ${limits.join(', ')}` : text;
}

export type SalaryScheme = { id: string; name: string; rules: SalaryRules; isDefault: boolean; text: string; revenueLabel: string; staffCount: number };

export function useSalarySchemes(enabled = true) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'salary', 'schemes'],
    queryFn: () => api.get<{ schemes: SalaryScheme[] }>('/salary/schemes').then((r) => r.schemes),
    enabled,
    staleTime: 30_000,
  });
}

export async function saveSalaryScheme(id: string | null, input: { name: string; rules: SalaryRules; isDefault?: boolean }): Promise<void> {
  if (id) await api.patch(`/salary/schemes/${id}`, { name: input.name, rules: input.rules, ...(input.isDefault ? { isDefault: true } : {}) });
  else await api.post('/salary/schemes', input);
  invalidate(['salary'], ['staff']);
}

export async function deleteSalaryScheme(id: string): Promise<void> {
  await api.delete(`/salary/schemes/${id}`);
  invalidate(['salary'], ['staff']);
}

/* ─────────────────────────── Расчёт по сменам ─────────────────────────── */

export type WorkerSalary = {
  profileId: string;
  nickname: string;
  photoUrl: string | null;
  scheme: { id: string; name: string; text: string };
  revenueLabel: string;
  revenue: number;
  calculated: number;
  lines: SalaryLine[];
  paid: { id: string; amount: number; method: string; at: string; calculated: number | null } | null;
};

export type ShiftSalary = {
  shift: { id: string; status: string; openedAt: string; closedAt: string | null; hours: number; revenue: number };
  workers: WorkerSalary[];
};

/** Зарплата по смене: владелец видит всех, сотрудник — себя. */
export function useShiftSalary(shiftId: string | null | undefined) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'salary', 'shift', shiftId],
    queryFn: () => api.get<ShiftSalary>(`/salary/shift/${shiftId}`),
    enabled: !!shiftId,
    staleTime: 0,
  });
}

/** Невыплаченная зарплата за 60 дней: смены и кто не получил. */
export function useUnpaidSalaries(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'salary', 'unpaid'],
    queryFn: () => api.get<{ shifts: ShiftSalary[] }>('/salary/unpaid').then((r) => r.shifts),
    enabled,
    staleTime: 15_000,
  });
}

/* ─────────────────────────── Выплаты ─────────────────────────── */

export type SalaryPayment = {
  id: string;
  staffId: string;
  staffName: string | null;
  staffRole: string | null;
  amount: NumericString;
  calculated: NumericString | null;
  paymentMethod: 'cash' | 'card' | 'transfer' | string;
  note: string | null;
  /** YYYY-MM-DD или YYYY-MM — у старых выплат «за день». */
  period: string | null;
  shiftId: string | null;
  shiftOpenedAt: string | null;
  createdAt: string;
};

export const METHOD_LABEL: Record<string, string> = { cash: 'наличными', transfer: 'переводом', card: 'картой' };

export function useSalaryPayments(enabled: boolean) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'salary', 'payments'],
    queryFn: () => api.get<{ payments: SalaryPayment[] }>('/salary').then((r) => r.payments),
    enabled,
    staleTime: 15_000,
  });
}

/** Кого можно поставить на смену (сотрудники клуба). */
export function useWorkers() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'salary', 'workers'],
    queryFn: () => api.get<{ staff: { id: string; nickname: string; photoUrl: string | null }[] }>('/salary/workers').then((r) => r.staff),
    staleTime: 60_000,
  });
}

const afterPayment = () => invalidate(['salary'], ['shifts'], ['expenses'], ['pos', 'shift-summary']);

/**
 * Выплата: за смену (shiftId — одна на сотрудника и смену) или разовая (аванс, премия).
 * Наличными — уходит из кассы открытой смены; переводом — только в расходы.
 */
export async function paySalary(input: { profileId: string; amount: number; method: 'cash' | 'transfer'; shiftId?: string | null; note?: string; idempotencyKey?: string }): Promise<{ duplicate: boolean; amount: number; method: string }> {
  try {
    const r = await api.post<{ payment: { amount: NumericString; paymentMethod: string }; duplicate?: boolean }>('/salary/pay', {
      profileId: input.profileId,
      amount: input.amount,
      paymentMethod: input.method,
      ...(input.shiftId ? { shiftId: input.shiftId } : {}),
      ...(input.note?.trim() ? { note: input.note.replace(/\s+/g, ' ').trim() } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    return { duplicate: !!r.duplicate, amount: Number(r.payment.amount), method: r.payment.paymentMethod };
  } finally {
    afterPayment();
  }
}

/** Отменить ошибочную выплату (владелец): наличные вернутся в кассу открытой смены. */
export async function cancelSalaryPayment(id: string): Promise<void> {
  try {
    await api.delete(`/salary/payments/${id}`);
  } finally {
    afterPayment();
  }
}

/* ─────────────────────────── Бизнес-день ─────────────────────────── */

const MSK_OFFSET_MS = 3 * 3_600_000;

/** Текущий бизнес-день клуба: до часа начала дня ещё идёт вчерашний. */
export function currentBusinessDay(startHour: number): string {
  // Как на сервере (bizDayStr): МСК — постоянные UTC+3, сдвигаем «сейчас» на +3 ч и назад
  // на час начала дня. Без Intl: его формат часа в Hermes не гарантирован.
  return new Date(Date.now() + MSK_OFFSET_MS - startHour * 3_600_000).toISOString().slice(0, 10);
}

/** Час начала бизнес-дня из настроек клуба (общий кэш с настройками). */
export function useBusinessDayStartHour(): number {
  const club = useClubKey();
  const settings = useQuery({
    queryKey: [club, 'system', 'settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings').then((r) => r.settings),
    staleTime: 5 * 60_000,
  });
  const hour = Number(settings.data?.business_day_start_hour);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9;
}
