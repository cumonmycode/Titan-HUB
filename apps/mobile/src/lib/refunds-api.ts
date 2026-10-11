import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from './api';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import { newIdempotencyKey } from './shift-api';
import type { NumericString } from './types';

/**
 * Возвраты по закрытым чекам. Контракт — mobile-api-refunds.md. Правила денег:
 * - запрос отправляется ровно один раз на подтверждение, без автоповторов, с ключом
 *   идемпотентности (миграция 074): повтор того же возврата уходит с тем же ключом, и
 *   сервер не проведёт его дважды; после неясного исхода результат сверяется по
 *   `refundedTotal` — не сразу, а после паузы (сервер мог ещё держать возврат за локом чека);
 * - суммы — только из свежего `availableByMethod`, в копейках, по одному тендеру на способ;
 * - товары на склад схлопываются по `itemId` и ограничиваются непроданным остатком.
 */

export type RefundMethod = 'cash' | 'card' | 'transfer' | 'deposit' | 'bonus' | 'certificate' | 'debt';
export type RefundReason = 'return' | 'exchange' | 'discount' | 'damage';

export const REFUND_METHODS: RefundMethod[] = ['cash', 'card', 'transfer', 'deposit', 'debt', 'bonus', 'certificate'];

export const REFUND_REASONS: Record<RefundReason, string> = {
  return: 'Возврат товара',
  exchange: 'Обмен',
  discount: 'Скидка',
  damage: 'Брак',
};

export type RefundRow = {
  id: string;
  checkId: string;
  totalAmount: NumericString;
  refundType: 'full' | 'partial';
  reason: RefundReason;
  note: string | null;
  tenders: { method: string; amount: number }[] | null;
  /** Актуально в списке и GET /refunds/:id; в ответе POST всегда пусто. */
  restoredItems: { itemId: string; quantity: number }[];
  createdBy: string;
  createdAt: string;
};

export type RefundPrepare = {
  check: { id: string; status: 'open' | 'closed' | 'cancelled'; totalAmount: NumericString; closedAt: string | null; playerId: string | null; certificateId: string | null };
  items: { itemId: string; name: string; quantity: number; priceAtTime: number; trackStock: boolean }[];
  paidTotal: number;
  refundedTotal: number;
  maxRefund: number;
  paidByMethod: Partial<Record<string, number>>;
  availableByMethod: Partial<Record<string, number>>;
};

export type ClosedCheck = {
  id: string;
  totalAmount: NumericString;
  closedAt: string | null;
  paymentMethod: string | null;
  itemCount: number;
  guestName: string | null;
};

/* ─────────────────────────── Деньги в копейках ─────────────────────────── */

export const toKopecks = (rub: number) => Math.round((rub + Number.EPSILON) * 100);
export const fromKopecks = (kopecks: number) => kopecks / 100;

/** «150,5» → 15050; пусто или мусор → null. */
export function parseKopecks(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? toKopecks(n) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─────────────────────────── Запросы ─────────────────────────── */

export function useRefunds() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'refunds', 'list'],
    queryFn: () => api.get<{ refunds: RefundRow[] }>('/refunds').then((r) => r.refunds),
    staleTime: 15_000,
  });
}

export function useClosedChecks() {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'refunds', 'closed-checks'],
    queryFn: () => api.get<{ checks: ClosedCheck[] }>('/pos/checks/closed?limit=50').then((r) => r.checks),
    staleTime: 15_000,
  });
}

/** Свежие данные формы: кэш не используется — лимиты меняются после каждого возврата. */
export function useRefundPrepare(checkId: string) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'refunds', 'prepare', checkId],
    queryFn: () => fetchRefundPrepare(checkId),
    enabled: UUID.test(checkId),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });
}

export function fetchRefundPrepare(checkId: string): Promise<RefundPrepare> {
  if (!UUID.test(checkId)) return Promise.reject(new Error('Некорректный чек'));
  return api.get<RefundPrepare>(`/refunds/prepare/${checkId}`);
}

/* ─────────────────────────── Оформление ─────────────────────────── */

export type RefundInput = {
  checkId: string;
  tenders: { method: RefundMethod; kopecks: number }[];
  reason: RefundReason;
  note: string;
  items: { itemId: string; quantity: number }[];
  /** Для честного `refundType`. */
  maxRefundKopecks: number;
};

export type RefundResult = { refund: RefundRow | null; verified: boolean };

/** Ответы 4xx — сервер откатил всё; сеть, таймаут и 5xx — исход неизвестен, его надо сверить. */
const isDefiniteFailure = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

/**
 * Ключи идемпотентности по «намерению» возврата: тот же чек, те же суммы и товары, та же
 * база «уже возвращено». Повтор после неясного исхода уходит с ТЕМ ЖЕ ключом — сервер
 * вернёт уже записанный возврат, а не проведёт второй. Ключ забывается, когда исход ясен.
 */
const intentKeys = new Map<string, string>();

/** Паузы перед сверкой после неясного исхода: сервер мог ещё обрабатывать возврат. */
const RECHECK_DELAYS_MS = [2_000, 5_000];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Оформляет возврат ровно одним запросом. Если ответ потерян, после паузы сверяет
 * `refundedTotal` чека: вырос на сумму запроса — возврат прошёл. Повторять запрос сама
 * не будет никогда.
 */
export async function createRefund(input: RefundInput, refundedBeforeKopecks: number): Promise<RefundResult> {
  const totalKopecks = input.tenders.reduce((sum, t) => sum + t.kopecks, 0);
  const body = {
    checkId: input.checkId,
    tenders: input.tenders.filter((t) => t.kopecks > 0).map((t) => ({ method: t.method, amount: fromKopecks(t.kopecks) })),
    refundType: totalKopecks >= input.maxRefundKopecks ? 'full' : 'partial',
    reason: input.reason,
    ...(input.note.trim() ? { note: input.note.trim() } : {}),
    itemsToRestore: input.items.filter((i) => i.quantity > 0),
  };
  const intent = JSON.stringify([body, refundedBeforeKopecks]);
  const idempotencyKey = intentKeys.get(intent) ?? newIdempotencyKey();
  intentKeys.set(intent, idempotencyKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const { refund } = await api.post<{ refund: RefundRow }>('/refunds', { ...body, idempotencyKey }, { signal: controller.signal });
    intentKeys.delete(intent);
    return { refund, verified: false };
  } catch (error) {
    if (isDefiniteFailure(error)) {
      intentKeys.delete(intent);
      throw error;
    }
    // Исход неизвестен: сервер мог ещё держать возврат за локом чека — сверяемся не
    // сразу, а после паузы, и не один раз.
    for (const delay of RECHECK_DELAYS_MS) {
      await wait(delay);
      let after: RefundPrepare;
      try {
        after = await fetchRefundPrepare(input.checkId);
      } catch {
        throw new Error('Связь прервалась, и проверить результат не удалось. Не оформляйте возврат повторно — сначала откройте историю возвратов.');
      }
      if (toKopecks(after.refundedTotal) - refundedBeforeKopecks >= totalKopecks - 1) {
        intentKeys.delete(intent);
        return { refund: null, verified: true };
      }
    }
    throw new Error('Сервер не ответил, и возврат в чеке пока не появился. Повтор безопасен: тот же возврат уйдёт с тем же ключом, и сервер не проведёт его дважды.');
  } finally {
    clearTimeout(timer);
    invalidateAfterRefund();
  }
}

/** Возврат затрагивает кассу, смены, клиента, склад и аналитику — обновляем всё. */
export function invalidateAfterRefund() {
  const club = useSession.getState().club?.host ?? 'none';
  for (const key of [['refunds'], ['pos'], ['shifts'], ['inventory'], ['clients'], ['client'], ['analytics']]) {
    void queryClient.invalidateQueries({ queryKey: [club, ...key] });
  }
}
