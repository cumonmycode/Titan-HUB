import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { NumericString, PaymentMethod, Shift } from './types';

/** Ключи вечера, которые принимает POST /shifts/open (жёсткий enum на сервере). */
export const OPEN_SHIFT_EVENING_KEYS = ['sport_mafia', 'city_mafia', 'kids_mafia', 'board_games', 'none'] as const;
export type EveningKey = (typeof OPEN_SHIFT_EVENING_KEYS)[number];

export type EveningType = { key: string; label: string; color: string; sortOrder: number };

export type CashBalance = {
  expected: number;
  cashStart: number;
  cashPayments?: number;
  deposits?: number;
  withdrawals?: number;
  salaries?: number;
  cashRefundTotal?: number;
};

export function useLastCashEnd() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'shifts', 'last-cash-end'],
    queryFn: () => api.get<{ cashEnd: number | null }>('/shifts/last-cash-end').then((r) => r.cashEnd),
    staleTime: 0,
  });
}

export function useEveningTypes() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pricing', 'evening-types'],
    queryFn: () => api.get<{ eveningTypes: EveningType[] }>('/pricing/evening-types').then((r) => r.eveningTypes),
    staleTime: 10 * 60_000,
  });
}

export function useCashBalance() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'shifts', 'cash-balance'],
    queryFn: () => api.get<CashBalance>('/shifts/cash-balance'),
    staleTime: 0,
  });
}

/** После любой операции со сменой обновляем всё, что от неё зависит. */
export function invalidateShift() {
  const host = useSession.getState().club?.host ?? 'none';
  for (const key of [['pos', 'shift-summary'], ['pos', 'checks'], ['shifts']]) {
    void queryClient.invalidateQueries({ queryKey: [host, ...key] });
  }
}

/** Состав смены: открытую правит персонал, закрытую — владелец. */
export async function setShiftStaff(shiftId: string, staffIds: string[]): Promise<void> {
  await api.put(`/shifts/${shiftId}/staff`, { staffIds });
  invalidateShift();
  const host = useSession.getState().club?.host ?? 'none';
  void queryClient.invalidateQueries({ queryKey: [host, 'salary'] });
}

/** Внесение или изъятие, которое проводится вместе с открытием смены. */
export type OpeningCashOp = { type: 'deposit' | 'withdrawal'; amount: number; description?: string };

/** Сумма из поля ввода: «1 500,50» → 1500.5; пусто или мусор → null. */
export function parseAmount(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
}

/** Ключ идемпотентности кассовой операции (UUID v4). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) cryptoObj.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ─────────────────────────── «Управление» → «Смены» ─────────────────────────── */

export const EVENING_LABEL: Record<string, string> = {
  sport_mafia: 'Спортивная мафия',
  city_mafia: 'Городская мафия',
  kids_mafia: 'Детская мафия',
  board_games: 'Настольные игры',
};

export type CashOpItem = {
  id: string;
  type: 'deposit' | 'withdrawal' | 'salary';
  amount: NumericString;
  description: string | null;
  createdAt: string;
  /** Ник автора. */
  createdBy: string | null;
};

/** Операции и остаток ТЕКУЩЕЙ смены; веб опрашивает раз в 15 с. */
export function useCashOps(enabled = true) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'shifts', 'cashops'],
    queryFn: () => api.get<{ operations: CashOpItem[]; balance: CashBalance }>('/cashops'),
    enabled,
    refetchInterval: 15_000,
  });
}

export type ShiftHistoryRow = { shift: Shift & { closedBy?: string | null }; openedByNickname: string | null };

const HISTORY_PAGE = 20;

/** История смен, новые сверху, по 20 на страницу. */
export function useShiftHistory() {
  const club = useClubKey();
  return useInfiniteQuery({
    queryKey: [club, 'shifts', 'history'],
    queryFn: ({ pageParam }) => api.get<{ shifts: ShiftHistoryRow[] }>(`/shifts/history?page=${pageParam}`).then((r) => r.shifts),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.length === HISTORY_PAGE ? pages.length + 1 : undefined),
  });
}

export type ShiftReport = {
  overview: { totalRevenue: number; refundsTotal: number; checksCount: number; avgCheck: number; uniquePlayers: number };
  checks: {
    id: string;
    playerId: string | null;
    totalAmount: NumericString;
    paymentMethod: PaymentMethod | null;
    guestNames: string[] | null;
    spaceId: string | null;
    linkedEventId: string | null;
    createdAt: string;
    closedAt: string | null;
  }[];
  payments: { method: PaymentMethod; total: NumericString | null }[];
  topItems: { itemId: string; name: string | null; totalQty: NumericString; totalRev: NumericString; share: number; abc: 'A' | 'B' | 'C' }[];
  playerStats: { playerId: string | null; nickname: string | null; clientTier: string | null; total: number; cnt: number }[];
};

/** Подробный отчёт смены (модуль аналитики). Для несуществующей смены сервер отдаёт нули, а не 404. */
export function useShiftReport(shiftId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'shifts', 'report', shiftId],
    queryFn: () => api.get<ShiftReport>(`/analytics/shifts/${shiftId}`),
    staleTime: 60_000,
  });
}
