import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';

import { api } from './api';
import { todayMsk } from './events-api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';

/**
 * «Сбор средств» — взносы резидентов мимо кассы: ежемесячный «Фонд клуба» и разовые сборы.
 * Контракт — mobile-api-manage-clients.md §5. Наличные, перевод и СБП копятся отдельно,
 * депозит и долг меняют баланс клиента.
 *
 * Подвох сервера: просмотр месяца СОЗДАЁТ период и долги за него, поэтому листать можно
 * только по уже существующим периодам и текущему месяцу.
 */

export type CollectionKind = 'recurring' | 'oneoff';
export type ContributionMethod = 'cash' | 'transfer' | 'sbp' | 'deposit' | 'debt';
export type ExcludeDuration = '1m' | '3m' | 'forever';

export type PeriodRef = { id: string; key: string; label: string; amount: number };

export type CollectionListItem = {
  id: string;
  name: string;
  description: string | null;
  kind: CollectionKind;
  isMandatory: boolean;
  defaultAmount: number;
  /** Текущий период, если он уже создан. */
  period: PeriodRef | null;
  collected: number;
  paidCount: number;
  expectedCount: number;
};

export type RosterRow = {
  playerId: string;
  nickname: string;
  fullName: string | null;
  clientTier: string;
  photoUrl: string | null;
  balance: number;
  /** Персональная сумма или сумма периода. */
  expected: number;
  amountOverride: number | null;
  excluded: boolean;
  excludedForever: boolean;
  excludedUntil: string | null;
  paid: boolean;
  /** Сколько доплатить: долг прошлых месяцев или недобор разового сбора. */
  topUp: number;
  prepaid: number;
  prepaidMonths: number;
  coveredByPrepay: boolean;
  contribution: { id: string; amount: number; method: ContributionMethod; paidAt: string; note: string | null } | null;
};

export type CollectionDetail = {
  collection: { id: string; name: string; description: string | null; kind: CollectionKind; isMandatory: boolean; defaultAmount: number; isActive: boolean };
  period: PeriodRef & { status: 'open' | 'closed' };
  totals: {
    collected: number;
    paidCount: number;
    eligibleCount: number;
    excludedCount: number;
    byMethod: Partial<Record<ContributionMethod, { total: number; count: number }>>;
  };
  roster: RosterRow[];
};

export const CONTRIBUTION_METHODS: Record<ContributionMethod, { label: string; color: string; symbol: SFSymbol }> = {
  cash: { label: 'Наличные', color: '#10B981', symbol: 'banknote' },
  transfer: { label: 'Перевод', color: '#3B82F6', symbol: 'arrow.left.arrow.right' },
  sbp: { label: 'СБП', color: '#8B5CF6', symbol: 'qrcode' },
  deposit: { label: 'Депозит', color: '#06B6D4', symbol: 'wallet.bifold' },
  debt: { label: 'Долг', color: '#F43F5E', symbol: 'creditcard.and.123' },
};

const host = () => useSession.getState().club?.host ?? 'none';
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Текущий месяц сбора — по Москве, как на сервере. */
export const currentPeriodKey = () => todayMsk().slice(0, 7);

/* ─────────────────────────── Запросы ─────────────────────────── */

export function useCollections() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'collections', 'list'],
    queryFn: () => api.get<{ eligibleCount: number; collections: CollectionListItem[] }>('/collections'),
    staleTime: 15_000,
  });
}

/** Существующие периоды (новые сверху) — границы листания месяцев. */
export function useCollectionPeriods(collectionId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'collections', collectionId, 'periods'],
    queryFn: () => api.get<{ periods: (PeriodRef & { status: string })[] }>(`/collections/${collectionId}/periods`).then((r) => r.periods),
    staleTime: 60_000,
  });
}

/** Детализация периода. `periodKey` — только существующий период или текущий месяц. */
export function useCollection(collectionId: string, periodKey: string | null) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'collections', collectionId, 'detail', periodKey ?? 'current'],
    queryFn: () => api.get<CollectionDetail>(`/collections/${collectionId}${periodKey ? `?period=${periodKey}` : ''}`),
    enabled: !!collectionId,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

/* ─────────────────────────── Изменения ─────────────────────────── */

function refreshCollection(collectionId?: string) {
  const club = host();
  void queryClient.invalidateQueries({ queryKey: collectionId ? [club, 'collections', collectionId] : [club, 'collections'] });
  void queryClient.invalidateQueries({ queryKey: [club, 'collections', 'list'] });
}

export type CollectionInput = { name: string; description: string | null; defaultAmount: number; isMandatory: boolean };

export async function createCollection(input: CollectionInput & { kind: CollectionKind }): Promise<{ id: string }> {
  const { collection } = await api.post<{ collection: { id: string } }>('/collections', input);
  refreshCollection();
  return collection;
}

export async function updateCollection(collectionId: string, input: Partial<CollectionInput>): Promise<void> {
  await api.patch(`/collections/${collectionId}`, input);
  refreshCollection(collectionId);
}

/** Архив: сбор скрывается, история взносов остаётся. */
export async function archiveCollection(collectionId: string): Promise<void> {
  await api.delete(`/collections/${collectionId}`);
  const club = host();
  queryClient.removeQueries({ queryKey: [club, 'collections', collectionId] });
  void queryClient.invalidateQueries({ queryKey: [club, 'collections', 'list'] });
}

export async function setPeriodAmount(collectionId: string, periodId: string, amount: number): Promise<void> {
  await api.patch(`/collections/${collectionId}/periods/${periodId}`, { amount });
  refreshCollection(collectionId);
}

/**
 * Взнос за период. Депозит и долг меняют баланс клиента — обновляем и его.
 * Если отметка за период уже есть, наличные/перевод/СБП сервер добавляет к ней (доплата);
 * депозит и долг с отметкой не складываются — 409, отметку сначала снимают.
 */
export async function payContribution(
  collectionId: string,
  input: { periodId: string; playerId: string; amount: number; method: ContributionMethod },
): Promise<void> {
  try {
    await api.post(`/collections/${collectionId}/pay`, input);
  } finally {
    refreshCollection(collectionId);
    if (input.method === 'deposit' || input.method === 'debt') refreshClient(input.playerId);
  }
}

/** Снять отметку: для депозита и долга сервер возвращает деньги на баланс. */
export async function removeContribution(collectionId: string, row: RosterRow): Promise<void> {
  if (!row.contribution) return;
  await api.delete(`/collections/${collectionId}/contributions/${row.contribution.id}`);
  refreshCollection(collectionId);
  if (row.contribution.method === 'deposit' || row.contribution.method === 'debt') refreshClient(row.playerId);
}

export async function excludeMember(collectionId: string, playerId: string, duration: ExcludeDuration): Promise<void> {
  await api.post(`/collections/${collectionId}/exclude`, { playerId, duration });
  refreshCollection(collectionId);
}

export async function includeMember(collectionId: string, playerId: string): Promise<void> {
  await api.post(`/collections/${collectionId}/include`, { playerId });
  refreshCollection(collectionId);
}

/** Персональная сумма взноса; `null` — вернуть общую. Действует и на прошлые месяцы. */
export async function setMemberAmount(collectionId: string, playerId: string, amount: number | null): Promise<void> {
  await api.post(`/collections/${collectionId}/member-amount`, { playerId, amount });
  refreshCollection(collectionId);
}

function refreshClient(playerId: string) {
  const club = host();
  void queryClient.invalidateQueries({ queryKey: [club, 'client', playerId] });
  void queryClient.invalidateQueries({ queryKey: [club, 'clients'] });
}

/* ─────────────────────────── Представление ─────────────────────────── */

export type RosterState = 'excluded' | 'prepaid' | 'paid' | 'topUp' | 'due';

export function rosterState(row: RosterRow): RosterState {
  if (row.excluded) return 'excluded';
  if (row.coveredByPrepay) return 'prepaid';
  if (row.paid) return 'paid';
  if (row.topUp > 0.004) return 'topUp';
  return 'due';
}

/** Сумма, которую предлагаем отметить: долг с прошлых месяцев или взнос периода. */
export const suggestedAmount = (row: RosterRow) => round2(row.topUp > 0.004 ? row.topUp : row.expected);
