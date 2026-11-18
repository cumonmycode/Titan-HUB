import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api } from './api';
import { formatMoney, toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { CheckDetail, NumericString } from './types';

/**
 * Лояльность: скидки с условиями, скидки клуба в кассе, сертификаты.
 * Сервер: modules/discounts, modules/certificates, /pos/checks/:id/club-discounts.
 */

const host = () => useSession.getState().club?.host ?? 'none';
const invalidate = (...keys: unknown[][]) => {
  const club = host();
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [club, ...key] });
};

/* ─────────────────────────── Скидки ─────────────────────────── */

export type DiscountScope = 'check' | 'categories' | 'items';
export type DiscountAudience = 'all' | 'tiers' | 'clients' | 'staff' | 'first';

export type Discount = {
  id: string;
  name: string;
  description: string | null;
  type: 'percent' | 'fixed';
  value: NumericString;
  isActive: boolean;
  isAuto: boolean;
  scope: DiscountScope;
  categoryIds: string[];
  itemIds: string[];
  audience: DiscountAudience;
  tiers: string[];
  clientIds: string[];
  birthdayDays: number | null;
  weekdays: number[];
  timeFrom: string | null;
  timeTo: string | null;
  startsOn: string | null;
  endsOn: string | null;
  minCheckSum: NumericString;
  minQuantity: number | null;
  combinable: boolean;
  sortOrder: number;
  /** simple — процент/сумма; free_units — каждый N-й бесплатно. */
  mechanic: 'simple' | 'free_units';
  freeEvery: number | null;
  /** Штамп-карта: считаются покупки прошлых визитов. */
  freeHistory: boolean;
  createdAt: string;
};

export type DiscountInput = Omit<Discount, 'id' | 'createdAt' | 'value' | 'minCheckSum' | 'sortOrder'> & { value: number; minCheckSum: number };

export const SCOPE_LABEL: Record<DiscountScope, string> = { check: 'Весь чек', categories: 'Категории меню', items: 'Позиции' };
export const AUDIENCE_LABEL: Record<DiscountAudience, string> = {
  all: 'Всем',
  tiers: 'Статусам',
  clients: 'Клиентам',
  staff: 'Команде',
  first: 'Первый визит',
};
/** 1 = Пн … 7 = Вс — как их нумерует сервер. */
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function useDiscounts() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'discounts'],
    queryFn: () => api.get<{ discounts: Discount[] }>('/discounts').then((r) => r.discounts),
    staleTime: 15_000,
  });
}

/** «−15 %», «−300 ₽» или «6-й в подарок». */
export const discountValueText = (discount: { type: 'percent' | 'fixed'; value: NumericString | number; mechanic?: string; freeEvery?: number | null }) =>
  discount.mechanic === 'free_units'
    ? discount.freeEvery === 2 ? '2 = 1' : `${discount.freeEvery ?? '?'}-й в подарок`
    : discount.type === 'percent' ? `−${toNumber(discount.value)} %` : `−${formatMoney(toNumber(discount.value))}`;

/** «Пн–Пт» для подряд идущих дней, иначе через запятую. */
export function weekdaysText(days: number[]): string | null {
  if (!days.length || days.length === 7) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return consecutive && sorted.length > 2 ? `${WEEKDAYS[sorted[0]! - 1]}–${WEEKDAYS[sorted[sorted.length - 1]! - 1]}` : sorted.map((d) => WEEKDAYS[d - 1]).join(', ');
}

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

type ConditionsLike = Pick<Discount, 'scope' | 'categoryIds' | 'itemIds' | 'weekdays' | 'timeFrom' | 'timeTo' | 'startsOn' | 'endsOn' | 'audience' | 'tiers' | 'birthdayDays'> & { minCheckSum: NumericString | number; minQuantity?: number | null };

/** Условия скидки одной строкой: «Бар · Пн–Пт · 17:00–19:00 · Резидент · от 1 000 ₽». */
export function discountSummary(d: ConditionsLike, names: { tier: (key: string) => string; category: (id: string) => string }): string {
  const parts: (string | null)[] = [
    d.scope === 'categories' ? (d.categoryIds.length === 1 ? names.category(d.categoryIds[0]!) : `${d.categoryIds.length} категории`) : d.scope === 'items' ? `${d.itemIds.length} поз.` : null,
    weekdaysText(d.weekdays),
    d.timeFrom && d.timeTo ? `${d.timeFrom}–${d.timeTo}` : null,
    d.startsOn || d.endsOn ? [d.startsOn ? `с ${shortDate(d.startsOn)}` : '', d.endsOn ? `по ${shortDate(d.endsOn)}` : ''].filter(Boolean).join(' ') : null,
    d.audience === 'tiers' ? d.tiers.map(names.tier).join(', ') : d.audience === 'all' ? null : AUDIENCE_LABEL[d.audience],
    d.birthdayDays !== null ? (d.birthdayDays === 0 ? 'в день рождения' : `ДР ±${d.birthdayDays} дн.`) : null,
    toNumber(d.minCheckSum) > 0 ? `от ${formatMoney(toNumber(d.minCheckSum))}` : null,
    d.minQuantity && d.minQuantity > 1 ? `от ${d.minQuantity} шт.` : null,
  ];
  return parts.filter(Boolean).join(' · ') || 'Без условий';
}

export const emptyDiscount = (): DiscountInput => ({
  name: '',
  description: null,
  type: 'percent',
  value: 10,
  isActive: true,
  isAuto: true,
  scope: 'check',
  categoryIds: [],
  itemIds: [],
  audience: 'all',
  tiers: [],
  clientIds: [],
  birthdayDays: null,
  weekdays: [],
  timeFrom: null,
  timeTo: null,
  startsOn: null,
  endsOn: null,
  minQuantity: 1,
  minCheckSum: 0,
  combinable: false,
  mechanic: 'simple',
  freeEvery: null,
  freeHistory: false,
});

/* ─────────────────────────── Шаблоны акций ─────────────────────────── */

export type LoyaltyTemplate = {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  /** Что открыть: скидку или правило бонусов. */
  kind: 'discount' | 'bonus-rule';
};

/** Готовые акции: открывают редактор с заполненными полями — останется поправить. */
export const LOYALTY_TEMPLATES: LoyaltyTemplate[] = [
  { key: 'happy-hours', title: 'Счастливые часы', subtitle: '−20% на бар по будням с 17 до 19', icon: 'clock.badge.checkmark', color: '#FF9500', kind: 'discount' },
  { key: 'stamp-card', title: 'Каждый 6-й в подарок', subtitle: 'Штамп-карта: считает прошлые визиты', icon: 'seal.fill', color: '#AF52DE', kind: 'discount' },
  { key: 'two-for-one', title: '2 по цене 1', subtitle: 'Вторая позиция в чеке бесплатно', icon: 'square.on.square', color: '#FF2D55', kind: 'discount' },
  { key: 'birthday-discount', title: 'Именинникам', subtitle: '−15% на чек ±3 дня от дня рождения', icon: 'birthday.cake.fill', color: '#FF3B30', kind: 'discount' },
  { key: 'double-weekdays', title: '×2 бонусов в будни', subtitle: 'Двойные бонусы Пн–Чт днём', icon: 'sparkles', color: '#34C759', kind: 'bonus-rule' },
  { key: 'visit-bonus', title: '+100 бонусов за визит', subtitle: 'За каждый чек от 1 000 ₽', icon: 'plus.circle.fill', color: '#007AFF', kind: 'bonus-rule' },
];

export function discountTemplate(key: string): DiscountInput | null {
  const base = emptyDiscount();
  switch (key) {
    case 'happy-hours': return { ...base, name: 'Счастливые часы', value: 20, scope: 'categories', weekdays: [1, 2, 3, 4, 5], timeFrom: '17:00', timeTo: '19:00' };
    case 'stamp-card': return { ...base, name: 'Каждый 6-й в подарок', mechanic: 'free_units', freeEvery: 6, freeHistory: true, value: 100, scope: 'items', combinable: true };
    case 'two-for-one': return { ...base, name: '2 по цене 1', mechanic: 'free_units', freeEvery: 2, value: 100, scope: 'items' };
    case 'birthday-discount': return { ...base, name: 'Именинникам', value: 15, birthdayDays: 3 };
    default: return null;
  }
}

/* ─────────────────────────── Правила начисления бонусов ─────────────────────────── */

export type BonusRuleKind = 'percent' | 'multiplier' | 'fixed';

export type BonusRule = Omit<Discount, 'type' | 'isAuto' | 'combinable' | 'minQuantity' | 'mechanic' | 'freeEvery' | 'freeHistory'> & { kind: BonusRuleKind };
export type BonusRuleInput = Omit<BonusRule, 'id' | 'createdAt' | 'value' | 'minCheckSum' | 'sortOrder' | 'clientIds'> & { value: number; minCheckSum: number };

export const RULE_KIND_LABEL: Record<BonusRuleKind, string> = { percent: 'Свой %', multiplier: 'Множитель', fixed: 'Бонусы за чек' };

export const ruleValueText = (r: { kind: BonusRuleKind; value: NumericString | number }) => {
  const v = toNumber(r.value);
  return r.kind === 'percent' ? `${v} %` : r.kind === 'multiplier' ? `×${v}` : `+${v.toLocaleString('ru')}`;
};

export const emptyBonusRule = (): BonusRuleInput => ({
  name: '', description: null, isActive: true, kind: 'multiplier', value: 2, scope: 'check', categoryIds: [], itemIds: [],
  audience: 'all', tiers: [], birthdayDays: null, weekdays: [], timeFrom: null, timeTo: null, startsOn: null, endsOn: null, minCheckSum: 0,
});

export function bonusRuleTemplate(key: string): BonusRuleInput | null {
  const base = emptyBonusRule();
  switch (key) {
    case 'double-weekdays': return { ...base, name: '×2 бонусов в будни', kind: 'multiplier', value: 2, weekdays: [1, 2, 3, 4], timeFrom: '12:00', timeTo: '18:00' };
    case 'visit-bonus': return { ...base, name: 'Бонус за визит', kind: 'fixed', value: 100, minCheckSum: 1000 };
    default: return null;
  }
}

export const ruleToInput = (r: BonusRule): BonusRuleInput => {
  const { id: _id, createdAt: _c, sortOrder: _s, clientIds: _ids, ...rest } = r;
  return { ...rest, value: toNumber(r.value), minCheckSum: toNumber(r.minCheckSum) };
};

export function useBonusRules() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'bonus-rules'],
    queryFn: () => api.get<{ rules: BonusRule[] }>('/loyalty/bonus-rules').then((r) => r.rules),
    staleTime: 15_000,
  });
}

export async function saveBonusRule(ruleId: string | null, input: BonusRuleInput): Promise<void> {
  const body = { ...input, name: input.name.trim(), description: input.description?.trim() || null };
  if (ruleId) await api.patch(`/loyalty/bonus-rules/${ruleId}`, body);
  else await api.post('/loyalty/bonus-rules', body);
  invalidate(['loyalty']);
}

export async function setBonusRuleActive(ruleId: string, isActive: boolean): Promise<void> {
  await api.patch(`/loyalty/bonus-rules/${ruleId}`, { isActive });
  invalidate(['loyalty']);
}

export async function deleteBonusRule(ruleId: string): Promise<void> {
  await api.delete(`/loyalty/bonus-rules/${ruleId}`);
  invalidate(['loyalty']);
}

/** Калькулятор: сколько бонусов получит гость. */
export type AccrualPreview = { amount: number; reason: string; applied: { ruleId: string; name: string }[]; welcome: number };

export function useAccrualPreview(args: { amount: number; tier: string; categoryId: string | null; firstVisit: boolean }) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'preview', args],
    queryFn: () => api.post<AccrualPreview>('/loyalty/preview', args),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

/* ─────────────────────────── Сводка ─────────────────────────── */

export type LoyaltyOverview = {
  days: number;
  bonus: { accrued: number; spent: number; expired: number; balance: number; holders: number; expiringSoon: number; checksWithBonus: number };
  discounts: { total: number; top: { name: string; amount: number; checks: number }[] };
  gifts: number;
  referrals: { rewarded: number; pending: number };
  certificates: { active: number; balance: number };
  daily: { day: string; accrued: number; spent: number }[];
};

export function useLoyaltyOverview(days: number) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'overview', days],
    queryFn: () => api.get<LoyaltyOverview>(`/loyalty/overview?days=${days}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export const toInput = (d: Discount): DiscountInput => {
  const { id: _id, createdAt: _createdAt, sortOrder: _sortOrder, ...rest } = d;
  return { ...rest, value: toNumber(d.value), minCheckSum: toNumber(d.minCheckSum), minQuantity: d.minQuantity ?? 1 };
};

export async function saveDiscount(discountId: string | null, input: DiscountInput): Promise<void> {
  const body = { ...input, name: input.name.trim(), description: input.description?.trim() || null, minQuantity: input.minQuantity ?? 1 };
  if (discountId) await api.patch(`/discounts/${discountId}`, body);
  else await api.post('/discounts', body);
  invalidate(['loyalty'], ['pos']);
}

export async function setDiscountActive(discountId: string, isActive: boolean): Promise<void> {
  await api.patch(`/discounts/${discountId}`, { isActive });
  invalidate(['loyalty'], ['pos']);
}

export async function deleteDiscount(discountId: string): Promise<void> {
  await api.delete(`/discounts/${discountId}`);
  invalidate(['loyalty'], ['pos']);
}

/* ─────────────────────────── Скидки клуба в кассе ─────────────────────────── */

export type ClubDiscount = {
  id: string;
  name: string;
  description: string | null;
  type: 'percent' | 'fixed';
  value: NumericString;
  scope: DiscountScope;
  applied: boolean;
  /** Подходит ли по «кому/когда» (кассир всё равно может применить). */
  fits: boolean;
  /** Сколько даст этому чеку, ₽; 0 — нет подходящих позиций. */
  amount: number;
};

export function useClubDiscounts(checkId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pos', 'checks', checkId, 'club-discounts'],
    queryFn: () => api.get<{ discounts: ClubDiscount[] }>(`/pos/checks/${checkId}/club-discounts`).then((r) => r.discounts),
    staleTime: 0,
  });
}

export async function applyClubDiscount(checkId: string, discountId: string): Promise<CheckDetail> {
  const { check } = await api.post<{ check: CheckDetail }>(`/pos/checks/${checkId}/club-discounts/${discountId}`, {});
  invalidate(['pos']);
  return check;
}

/* ─────────────────────────── Сертификаты ─────────────────────────── */

export type CertificateScope = 'all' | 'categories' | 'items' | 'events';
export type CertificateStatus = 'active' | 'used' | 'expired' | 'void';

export type Certificate = {
  id: string;
  code: string;
  title: string | null;
  amount: number;
  balance: number;
  status: CertificateStatus;
  scope: CertificateScope;
  categoryIds: string[];
  itemIds: string[];
  validUntil: string | null;
  series: string | null;
  recipient: string | null;
  note: string | null;
  usedAt: string | null;
  createdAt: string;
};

export type CertificateSeries = { series: string; title: string | null; total: number; active: number; nominal: number; first: string; last: string };

export const CERT_SCOPE_LABEL: Record<CertificateScope, string> = {
  all: 'На всё',
  categories: 'На категории меню',
  items: 'На позиции',
  events: 'На мероприятие',
};

export const CERT_STATUS_LOOK: Record<CertificateStatus, { label: string; color: string }> = {
  active: { label: 'Действует', color: '#34C759' },
  used: { label: 'Использован', color: '#8E8E93' },
  expired: { label: 'Истёк', color: '#FF9500' },
  void: { label: 'Погашен', color: '#FF3B30' },
};

export function useCertificates(q = '') {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'certificates', q],
    queryFn: () => api.get<{ certificates: Certificate[] }>(`/certificates${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => r.certificates),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useCertificateSeries() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'certificates', 'series'],
    queryFn: () => api.get<{ series: CertificateSeries[] }>('/certificates/series').then((r) => r.series),
    staleTime: 15_000,
  });
}

export type CertificateUse = { checkId: string; amount: number; closedAt: string | null; player: string | null };

export function useCertificate(id: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'loyalty', 'certificates', 'one', id],
    queryFn: () => api.get<{ certificate: Certificate; uses: CertificateUse[] }>(`/certificates/${id}`),
    staleTime: 10_000,
  });
}

export type CertificateTerms = {
  nominal: number;
  title: string | null;
  scope: CertificateScope;
  categoryIds: string[];
  itemIds: string[];
  validUntil: string | null;
  recipient: string | null;
  note: string | null;
};

/** Один сертификат: свой номер (с карточки) или пусто — сгенерирует сервер. */
export async function issueCertificate(terms: CertificateTerms & { code?: string }): Promise<Certificate> {
  const { certificate } = await api.post<{ certificate: Certificate }>('/certificates', terms);
  invalidate(['loyalty', 'certificates']);
  return certificate;
}

/** Серия номеров «префикс + число»: TK-0001…TK-0100. */
export async function issueSeries(terms: CertificateTerms & { prefix: string; from: number; to: number; pad: number; skipExisting?: boolean }): Promise<{ created: number; skipped: string[]; series: string; first: string | null; last: string | null }> {
  const r = await api.post<{ created: number; skipped: string[]; series: string; first: string | null; last: string | null }>('/certificates/batch', terms);
  invalidate(['loyalty', 'certificates']);
  return r;
}

export async function updateCertificate(id: string, patch: Partial<Omit<CertificateTerms, 'nominal'>>): Promise<void> {
  await api.patch(`/certificates/${id}`, patch);
  invalidate(['loyalty', 'certificates']);
}

/** Только владелец: погасить сертификат (больше не принимается в кассе). */
export async function deactivateCertificate(id: string): Promise<void> {
  await api.put(`/certificates/${id}/deactivate`, {});
  invalidate(['loyalty', 'certificates']);
}

/** «TK-0001 … TK-0100» по префиксу, диапазону и числу цифр — для предпросмотра серии. */
export function seriesPreview(prefix: string, from: number, to: number, pad: number): string {
  const code = (n: number) => `${prefix.trim().toUpperCase()}${String(n).padStart(pad, '0')}`;
  return from === to ? code(from) : `${code(from)} … ${code(to)}`;
}

/* ─────────────────────────── Выбор категорий и позиций ─────────────────────────── */

/**
 * Черновик выбора для экрана «Выбрать» (loyalty/pick): редактор кладёт текущий выбор и
 * открывает экран; экран возвращает отмеченное через onDone.
 */
type PickDraft = {
  kind: 'categories' | 'items';
  selected: string[];
  onDone: ((ids: string[]) => void) | null;
  start: (kind: 'categories' | 'items', selected: string[], onDone: (ids: string[]) => void) => void;
};

export const usePickDraft = create<PickDraft>((set) => ({
  kind: 'categories',
  selected: [],
  onDone: null,
  start: (kind, selected, onDone) => set({ kind, selected, onDone }),
}));
