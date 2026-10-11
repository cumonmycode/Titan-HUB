// Машина визита гостя — чистая функция без побочных эффектов (покрыта тестами).
//   idle    — счёта нет: меню для просмотра, вызов администратора;
//   session — администратор открыл счёт зоны: счёт, заказ, чат, оплата;
//   finish  — счёт оплачен или закрыт: «спасибо» и оценка вечера, затем снова idle.
// Сессия планшета (токен) при этом не сбрасывается.
import type { PreviousCheck } from '@/data/types';

export type Phase =
  | { kind: 'idle' }
  | { kind: 'session'; checkId: string }
  | { kind: 'finish'; checkId: string; paid: boolean; total: number | null };

export type VisitEvent =
  /** Ответ /tablet/state: открытый счёт зоны и судьба прошлого чека. */
  | { type: 'state'; openCheckId: string | null; previous: PreviousCheck | null }
  /** Поток зоны: чек оплачен (раньше, чем придёт следующее состояние). */
  | { type: 'paid'; checkId: string; total: number | null }
  /** Гость оценил вечер, пропустил оценку или ушёл. */
  | { type: 'done' }
  /** Планшет перенесли в другую кабинку или отвязали. */
  | { type: 'reset' };

export const IDLE: Phase = { kind: 'idle' };

const session = (checkId: string): Phase => ({ kind: 'session', checkId });

export function reduceVisit(phase: Phase, event: VisitEvent): Phase {
  switch (event.type) {
    case 'reset':
      return IDLE;

    case 'done':
      return phase.kind === 'finish' ? IDLE : phase;

    case 'paid':
      if (phase.kind === 'session' && phase.checkId === event.checkId) {
        return { kind: 'finish', checkId: event.checkId, paid: true, total: event.total };
      }
      if (phase.kind === 'finish' && phase.checkId === event.checkId && !phase.paid) return { ...phase, paid: true };
      return phase;

    case 'state': {
      const { openCheckId, previous } = event;
      // Гость оценивает вечер — новый счёт подхватим, когда он закончит.
      if (phase.kind === 'finish') return phase;
      if (phase.kind === 'idle') return openCheckId ? session(openCheckId) : phase;

      if (openCheckId === phase.checkId) return phase;
      const prev = previous?.id === phase.checkId ? previous : null;
      if (!prev) return phase; // судьба прошлого чека неизвестна — ждём следующего ответа
      switch (prev.outcome) {
        case 'closed': {
          const total = prev.paidTotal ?? null;
          return { kind: 'finish', checkId: phase.checkId, paid: (total ?? 0) > 0, total };
        }
        case 'open':
          // Прошлый чек ещё открыт, но в зоне есть более новый — показываем новый.
          return openCheckId ? session(openCheckId) : phase;
        case 'cancelled':
        case 'moved':
        case 'gone':
          return openCheckId ? session(openCheckId) : IDLE;
      }
    }
  }
}

/** Сменился ли визит (не просто данные внутри него). */
export function samePhase(a: Phase, b: Phase): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'idle') return true;
  return a.checkId === (b as { checkId: string }).checkId;
}
