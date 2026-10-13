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

/** «−15 %» или «−300 ₽». */
export const discountValueText = (discount: { type: 'percent' | 'fixed'; value: NumericString | number }) =>
  discount.type === 'percent' ? `−${toNumber(discount.value)} %` : `−${formatMoney(toNumber(discount.value))}`;

/** «Пн–Пт» для подряд идущих дней, иначе через запятую. */
export function weekdaysText(days: number[]): string | null {
  if (!days.length || days.length === 7) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  return consecutive && sorted.length > 2 ? `${WEEKDAYS[sorted[0]! - 1]}–${WEEKDAYS[sorted[sorted.length - 1]! - 1]}` : sorted.map((d) => WEEKDAYS[d - 1]).join(', ');
}

const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;

/** Условия скидки одной строкой: «Бар · Пн–Пт · 17:00–19:00 · Резидент · от 1 000 ₽». */
export function discountSummary(d: Discount, names: { tier: (key: string) => string; category: (id: string) => string }): string {
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
});

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
