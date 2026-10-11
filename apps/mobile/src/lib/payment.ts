import { useQuery } from '@tanstack/react-query';
import type { SFSymbol } from 'sf-symbols-typescript';
import { create } from 'zustand';

import { api, ApiError } from './api';
import { checkTotals } from './checks';
import { toNumber } from './format';
import { queryClient } from './query';
import { useClubKey } from './queries';
import { useSession } from './session';
import type { CheckDetail, NumericString } from './types';

/**
 * Оплата чека — POST /pos/checks/:id/pay и СБП (POST …/qr).
 *
 * Сервер — источник истины: перед оплатой чек перечитывается, суммы округляются до копеек,
 * безнал не превышает остаток, бонусы выводятся из частей. Правила — mobile-api-v1 «Money safety rules».
 */

/** Способы, которые уходят в /pay. `split` — режим веб-интерфейса, не метод; `transfer` — только подтверждённый СБП. */
export type TenderMethod = 'cash' | 'card' | 'transfer' | 'bonus' | 'deposit' | 'debt' | 'certificate';

export type PaymentPart = {
  id: string;
  method: TenderMethod;
  amount: number;
  /** Оплата, подтверждённая банком по СБП: менять и удалять нельзя. */
  locked?: boolean;
};

export const METHODS: Record<TenderMethod, { title: string; symbol: SFSymbol; color: string }> = {
  cash: { title: 'Наличные', symbol: 'banknote', color: '#10B981' },
  // «Перевод» — перевод на карту с ручным подтверждением (в базе — card).
  card: { title: 'Перевод', symbol: 'creditcard', color: '#3B82F6' },
  // «СБП» — QR эквайринга (в базе — transfer).
  transfer: { title: 'СБП', symbol: 'qrcode', color: '#8B5CF6' },
  bonus: { title: 'Бонусы', symbol: 'star.circle', color: '#F59E0B' },
  deposit: { title: 'Депозит', symbol: 'wallet.bifold', color: '#06B6D4' },
  debt: { title: 'В долг', symbol: 'person.badge.clock', color: '#F43F5E' },
  certificate: { title: 'Сертификат', symbol: 'giftcard', color: '#EAB308' },
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.01;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────────────── Суммы ─────────────────────────── */

export type PayTotals = {
  items: number;
  rental: number;
  eventBase: number;
  total: number;
  prepaid: number;
  due: number;
  /** Списание на персонал: сервер закрывает чек за 0 ₽. */
  staffComp: boolean;
};

/** Итог так, как его посчитает /pay: округление до копеек, staffComp обнуляет всё. */
export function payTotals(check: CheckDetail, now = Date.now()): PayTotals {
  const t = checkTotals(check, now);
  if (check.staffCompId) return { ...t, total: 0, prepaid: 0, due: 0, staffComp: true };
  const total = round2(t.total);
  const prepaid = round2(Math.min(t.prepaid, total));
  return { ...t, total, prepaid, due: round2(Math.max(0, total - prepaid)), staffComp: false };
}

/* ─────────────────────────── Данные ─────────────────────────── */

export type PosPlayer = {
  id: string;
  nickname: string;
  clientTier: string;
  /** > 0 — депозит, < 0 — долг. */
  balance: NumericString;
  bonusPoints: NumericString;
  photoUrl: string | null;
};

export function usePosPlayer(playerId: string | null) {
  const club = useClubKey();
  return useQuery({
    queryKey: [club, 'pos', 'player', playerId],
    queryFn: () => api.get<{ player: PosPlayer }>(`/pos/players/${playerId}`).then((r) => r.player),
    enabled: !!playerId,
    staleTime: 0,
  });
}

export type PaySettings = { bonusMaxSpend: number; maxClientDebt: number };

const DEFAULT_SETTINGS: PaySettings = { bonusMaxSpend: 50, maxClientDebt: 0 };

export function usePaySettings(): PaySettings {
  const club = useClubKey();
  const query = useQuery({
    queryKey: [club, 'system', 'settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings').then((r) => r.settings),
    staleTime: 5 * 60_000,
  });
  const s = query.data;
  if (!s) return DEFAULT_SETTINGS;
  const pct = Number(s.bonus_max_spend);
  return {
    // Как сервер: вне 0..100 или не число — 50%.
    bonusMaxSpend: s.bonus_max_spend !== undefined && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 50,
    maxClientDebt: Math.max(0, toNumber(s.max_client_debt)),
  };
}

/* ─────────────────────────── Черновик оплаты ─────────────────────────── */

export type Certificate = { code: string; remaining: number };

type DraftState = {
  checkId: string | null;
  parts: PaymentPart[];
  certificate: Certificate | null;
  /** Подсказка над частями — например, что банк уже подтвердил СБП. */
  notice: string | null;
  begin: (checkId: string) => void;
  setParts: (parts: PaymentPart[]) => void;
  remove: (id: string) => void;
  setCertificate: (certificate: Certificate | null) => void;
  confirmQr: (checkId: string, amount: number) => void;
  clear: () => void;
};

let partSeq = 0;
export const newPartId = () => `part-${Date.now()}-${partSeq++}`;

/** Части оплаты живут вне экрана: шаг СБП возвращает в композитор подтверждённую часть. */
export const usePaymentDraft = create<DraftState>((set, get) => ({
  checkId: null,
  parts: [],
  certificate: null,
  notice: null,
  begin: (checkId) => {
    // Подтверждённую банком часть не теряем, даже если шторку закрыли и открыли снова.
    const s = get();
    if (s.checkId === checkId && s.parts.some((p) => p.locked)) return;
    set({ checkId, parts: [], certificate: null, notice: null });
  },
  setParts: (parts) => set({ parts }),
  remove: (id) =>
    set((s) => {
      const parts = s.parts.filter((p) => p.id !== id || p.locked);
      const hasCertificate = parts.some((p) => p.method === 'certificate');
      return { parts, certificate: hasCertificate ? s.certificate : null };
    }),
  setCertificate: (certificate) => set({ certificate }),
  confirmQr: (checkId, amount) =>
    set({
      checkId,
      parts: [{ id: newPartId(), method: 'transfer', amount: round2(amount), locked: true }],
      certificate: null,
      notice: 'Банк подтвердил оплату по СБП, но чек ещё открыт. Проведите оплату, чтобы закрыть его.',
    }),
  clear: () => set({ checkId: null, parts: [], certificate: null, notice: null }),
}));

/* ─────────────────────────── Лимиты ─────────────────────────── */

export type Ledger = {
  paid: number;
  remaining: number;
  change: number;
  bonusCap: number;
  depositCap: number;
  debtCap: number;
  sumOf: (method: TenderMethod) => number;
  /** Сколько всего может быть в части этого способа при остальных частях. */
  capFor: (method: TenderMethod, currentAmount?: number) => number;
  /** Почему способ сейчас нельзя добавить; `null` — можно. */
  blockedReason: (method: TenderMethod) => string | null;
};

export function paymentLedger(input: {
  parts: PaymentPart[];
  totals: PayTotals;
  player: PosPlayer | null | undefined;
  hasPlayer: boolean;
  settings: PaySettings;
  certificate: Certificate | null;
}): Ledger {
  const { parts, totals, player, hasPlayer, settings, certificate } = input;
  const sumOf = (method: TenderMethod) => round2(parts.filter((p) => p.method === method).reduce((a, p) => a + p.amount, 0));
  const paid = round2(parts.reduce((a, p) => a + p.amount, 0));
  const nonCash = round2(paid - sumOf('cash'));
  const remaining = Math.max(0, round2(totals.due - paid));
  const change = Math.max(0, round2(paid - totals.due));

  const balance = toNumber(player?.balance);
  const bonusCap = player ? Math.max(0, Math.min(Math.floor(toNumber(player.bonusPoints)), Math.floor((totals.total * settings.bonusMaxSpend) / 100))) : 0;
  const depositCap = player ? Math.max(0, round2(balance)) : 0;
  // Сервер сначала списывает депозит, потом проверяет лимит долга по уже уменьшенному балансу.
  const debtCap = !player
    ? 0
    : settings.maxClientDebt > 0
      ? Math.max(0, round2(balance - sumOf('deposit') + settings.maxClientDebt))
      : Number.POSITIVE_INFINITY;

  const capFor = (method: TenderMethod, currentAmount = 0): number => {
    if (method === 'cash') return Number.POSITIVE_INFINITY; // переплатить можно только наличными — это сдача
    const nonCashRoom = Math.max(0, round2(totals.due - (nonCash - currentAmount)));
    switch (method) {
      case 'bonus':
        return Math.min(nonCashRoom, bonusCap);
      case 'deposit':
        return Math.min(nonCashRoom, depositCap);
      case 'debt':
        return Math.min(nonCashRoom, debtCap);
      case 'certificate':
        return Math.min(nonCashRoom, certificate?.remaining ?? 0);
      default:
        return nonCashRoom;
    }
  };

  const blockedReason = (method: TenderMethod): string | null => {
    if (totals.due <= 0) return 'Чек за 0 ₽';
    if (method === 'transfer') {
      if (totals.staffComp) return 'Списание';
      if (totals.prepaid > EPS) return 'Есть предоплата';
      if (parts.length > 0) return 'Только на весь чек';
      return null;
    }
    if ((method === 'bonus' || method === 'deposit' || method === 'debt') && !hasPlayer) return 'Нужен клиент';
    if (!player && (method === 'bonus' || method === 'deposit' || method === 'debt')) return 'Загружаем…';
    if (method === 'deposit' && depositCap <= 0) return 'Депозит пуст';
    if (method === 'bonus' && bonusCap <= 0) return 'Нет бонусов';
    if (method === 'debt' && debtCap <= 0) return 'Лимит долга';
    if (remaining <= 0) return 'Оплачено';
    const current = sumOf(method);
    if (method !== 'cash' && capFor(method, current) - current < EPS) return 'Лимит';
    return null;
  };

  return { paid, remaining, change, bonusCap, depositCap, debtCap, sumOf, capFor, blockedReason };
}

/** Добавить способ на остаток; части одного способа сливаются в одну. */
export function addTender(parts: PaymentPart[], method: TenderMethod, ledger: Ledger, amount?: number): PaymentPart[] {
  const existing = parts.find((p) => p.method === method && !p.locked);
  const current = existing?.amount ?? 0;
  const cap = ledger.capFor(method, current);
  const target = round2(Math.min(current + (amount ?? ledger.remaining), cap));
  if (target - current < EPS) return parts;
  if (existing) return parts.map((p) => (p === existing ? { ...p, amount: target } : p));
  return [...parts, { id: newPartId(), method, amount: target }];
}

/** Изменить сумму части с учётом лимитов; ≤ 0 — удалить. */
export function setTenderAmount(parts: PaymentPart[], id: string, amount: number, ledger: Ledger): PaymentPart[] {
  const part = parts.find((p) => p.id === id);
  if (!part || part.locked) return parts;
  const value = round2(Math.min(Math.max(0, amount), ledger.capFor(part.method, part.amount)));
  if (value < EPS) return parts.filter((p) => p.id !== id);
  return parts.map((p) => (p.id === id ? { ...p, amount: value } : p));
}

/* ─────────────────────────── Проведение ─────────────────────────── */

async function fetchCheck(checkId: string): Promise<CheckDetail> {
  return api.get<{ check: CheckDetail }>(`/pos/checks/${checkId}`).then((r) => r.check);
}

export function invalidateAfterPayment(checkId: string) {
  const host = useSession.getState().club?.host ?? 'none';
  // Оплата чека мероприятия завершает событие (миникап — последним чеком участника):
  // перечитываем и мероприятия, иначе лента ждёт своего опроса со статусом «Идёт».
  for (const key of [['pos', 'checks'], ['pos', 'check', checkId], ['pos', 'shift-summary'], ['shifts'], ['events'], ['event']]) {
    void queryClient.invalidateQueries({ queryKey: [host, ...key] });
  }
}

/** Итог чека изменился между показом и оплатой (например, аренда перешла на новый час). */
export class DueChangedError extends Error {
  constructor(public due: number) {
    super('Сумма чека изменилась');
    this.name = 'DueChangedError';
  }
}

export type PayResult = {
  paid: number;
  due: number;
  change: number;
  /** Чек закрыли раньше — вебхук СБП или другой кассир. */
  alreadyClosed?: boolean;
};

const PAY_ERRORS: Record<string, string> = {
  'Invalid or used certificate': 'Сертификат недействителен или уже использован',
  'Check not open': 'Чек уже закрыт',
  'Internal error': 'Сервер не смог провести оплату',
};

/**
 * Проводит оплату. Перед отправкой перечитывает чек; на любую ошибку перечитывает снова —
 * закрытый чек значит, что оплата прошла (ответ мог потеряться).
 */
export async function payCheck(checkId: string, input: { parts: PaymentPart[]; certificate: Certificate | null; expectedDue: number }): Promise<PayResult> {
  const fresh = await fetchCheck(checkId);
  if (fresh.status === 'closed') return { paid: 0, due: 0, change: 0, alreadyClosed: true };
  if (fresh.status !== 'open') throw new Error('Чек отменён');

  const totals = payTotals(fresh);
  if (Math.abs(totals.due - input.expectedDue) > EPS) throw new DueChangedError(totals.due);

  const merged = new Map<TenderMethod, number>();
  if (totals.due > 0) {
    for (const part of input.parts) merged.set(part.method, round2((merged.get(part.method) ?? 0) + part.amount));
  }
  const payments = [...merged].filter(([, amount]) => amount >= EPS).map(([method, amount]) => ({ method, amount }));
  const paid = round2(payments.reduce((a, p) => a + p.amount, 0));
  const nonCash = round2(payments.filter((p) => p.method !== 'cash').reduce((a, p) => a + p.amount, 0));
  const bonusAmount = merged.get('bonus') ?? 0;
  const certificateAmount = merged.get('certificate') ?? 0;

  if (paid < totals.due - EPS) throw new Error('Недостаточная сумма оплаты');
  if (nonCash > totals.due + EPS) throw new Error('Безналичная часть больше суммы чека');
  if (certificateAmount > 0 && !input.certificate) throw new Error('Укажите сертификат');

  const body = {
    payments,
    bonusAmount: bonusAmount > 0 ? bonusAmount : undefined,
    certificateCode: certificateAmount > 0 ? input.certificate?.code : undefined,
    // Без playerId и note сервер обнулит плательщика и заметку чека.
    playerId: fresh.playerId ?? undefined,
    note: fresh.note ?? undefined,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    await api.post(`/pos/checks/${checkId}/pay`, body, { signal: controller.signal });
  } catch (error) {
    const after = await fetchCheck(checkId).catch(() => null);
    if (after?.status !== 'closed') {
      if (error instanceof ApiError && error.status === 0 && !after) {
        throw new Error('Нет ответа от сервера. Проверьте чек, прежде чем повторять оплату.');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(PAY_ERRORS[message] ?? message);
    }
  } finally {
    clearTimeout(timer);
    invalidateAfterPayment(checkId);
  }
  return { paid, due: totals.due, change: Math.max(0, round2(paid - totals.due)) };
}

/* ─────────────────────────── Сертификат ─────────────────────────── */

const CERTIFICATE_ERRORS: Record<string, string> = {
  'Not found': 'Сертификат не найден',
  'Already used': 'Сертификат уже использован',
  Depleted: 'На сертификате не осталось средств',
};

export async function validateCertificate(rawCode: string): Promise<Certificate> {
  const code = rawCode.trim().toUpperCase();
  if (!code) throw new Error('Введите код сертификата');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await api.get<{ remaining: number | string }>(`/certificates/validate/${encodeURIComponent(code)}`);
      return { code, remaining: round2(toNumber(r.remaining)) };
    } catch (error) {
      lastError = error;
      // Ответ сервера о самом сертификате повторять бессмысленно — только сбои сети.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) break;
      await delay(attempt === 0 ? 500 : 1000);
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'Не удалось проверить сертификат';
  throw new Error(CERTIFICATE_ERRORS[message] ?? message);
}

/* ─────────────────────────── СБП ─────────────────────────── */

export type QrPayment = {
  transactionId: string | null;
  /** SVG-картинка QR (data URL). */
  qrDataUrl: string | null;
  /** Страница оплаты эквайера — когда QR не пришёл или эквайер работает через ссылку. */
  redirectUrl: string | null;
  chargedAmount: number | null;
  baseAmount: number | null;
  surcharge8: boolean;
  /** Транзакция создана, но QR сервер не получил. */
  warning: string | null;
};

type QrResponse = {
  transactionId: string;
  qrDataUrl?: string;
  redirectUrl?: string;
  chargedAmount: number | string;
  baseAmount: number | string;
  surcharge8: boolean;
};

/** Каждый вызов — новая живая транзакция у эквайера, отменить её нельзя. Только по явному действию кассира. */
export async function createQrPayment(checkId: string, surcharge8: boolean): Promise<QrPayment> {
  try {
    const r = await api.post<QrResponse>(`/pos/checks/${checkId}/qr`, { surcharge8 });
    return {
      transactionId: r.transactionId,
      qrDataUrl: r.qrDataUrl ?? null,
      redirectUrl: r.redirectUrl ?? null,
      chargedAmount: toNumber(r.chargedAmount),
      baseAmount: toNumber(r.baseAmount),
      surcharge8: r.surcharge8,
      warning: null,
    };
  } catch (error) {
    // 502 с transactionId: транзакция существует и может быть оплачена — ждём, а не показываем ошибку.
    if (error instanceof ApiError && error.data && typeof error.data === 'object') {
      const d = error.data as { transactionId?: string; redirectUrl?: string };
      if (d.transactionId || d.redirectUrl) {
        return {
          transactionId: d.transactionId ?? null,
          qrDataUrl: null,
          redirectUrl: d.redirectUrl ?? null,
          chargedAmount: null,
          baseAmount: null,
          surcharge8,
          warning: error.message,
        };
      }
    }
    throw error;
  }
}

const QR_FAILED = new Set(['DECLINED', 'CANCELLED', 'CANCELED', 'FAILED', 'EXPIRED', 'ERROR', 'REJECTED']);

export async function qrPaymentStatus(checkId: string, transactionId: string): Promise<'confirmed' | 'failed' | 'pending'> {
  const r = await api.get<{ status?: string }>(`/pos/checks/${checkId}/qr/${transactionId}/status`);
  const status = String(r.status ?? '').toUpperCase();
  if (status === 'CONFIRMED') return 'confirmed';
  if (QR_FAILED.has(status)) return 'failed';
  return 'pending';
}

/** После подтверждения банка чек закрывает вебхук — ждём его, как веб: до 4 проверок. */
export async function waitForCheckClosed(checkId: string, attempts = 4): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const check = await fetchCheck(checkId).catch(() => null);
    if (check?.status === 'closed') return true;
    await delay(800);
  }
  return false;
}
