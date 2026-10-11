import { describe, expect, test } from '@jest/globals';

import { IDLE, reduceVisit, samePhase, type Phase } from './machine';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const session = (checkId: string): Phase => ({ kind: 'session', checkId });

describe('reduceVisit', () => {
  test('idle → session, когда администратор открыл счёт', () => {
    expect(reduceVisit(IDLE, { type: 'state', openCheckId: A, previous: null })).toEqual(session(A));
  });

  test('idle остаётся idle без счёта', () => {
    expect(reduceVisit(IDLE, { type: 'state', openCheckId: null, previous: null })).toBe(IDLE);
  });

  test('тот же счёт — визит не меняется', () => {
    const s = session(A);
    expect(reduceVisit(s, { type: 'state', openCheckId: A, previous: null })).toBe(s);
  });

  test('счёт закрыт с оплатой → благодарность «оплата прошла» с суммой', () => {
    expect(reduceVisit(session(A), { type: 'state', openCheckId: null, previous: { id: A, outcome: 'closed', paidTotal: 4350 } }))
      .toEqual({ kind: 'finish', checkId: A, paid: true, total: 4350 });
  });

  test('счёт закрыт без оплаты (0 ₽) → «счёт закрыт»', () => {
    expect(reduceVisit(session(A), { type: 'state', openCheckId: null, previous: { id: A, outcome: 'closed', paidTotal: 0 } }))
      .toEqual({ kind: 'finish', checkId: A, paid: false, total: 0 });
  });

  test('закрытый счёт важнее нового: сначала благодарность', () => {
    const next = reduceVisit(session(A), { type: 'state', openCheckId: B, previous: { id: A, outcome: 'closed', paidTotal: 100 } });
    expect(next.kind).toBe('finish');
  });

  test.each(['cancelled', 'moved', 'gone'] as const)('счёт %s → снова idle', (outcome) => {
    expect(reduceVisit(session(A), { type: 'state', openCheckId: null, previous: { id: A, outcome } })).toBe(IDLE);
  });

  test('счёт переехал, а в зоне уже новый → сразу новый визит', () => {
    expect(reduceVisit(session(A), { type: 'state', openCheckId: B, previous: { id: A, outcome: 'moved' } })).toEqual(session(B));
  });

  test('судьба прошлого чека неизвестна → ждём, визит не трогаем', () => {
    const s = session(A);
    expect(reduceVisit(s, { type: 'state', openCheckId: null, previous: null })).toBe(s);
    expect(reduceVisit(s, { type: 'state', openCheckId: null, previous: { id: B, outcome: 'closed', paidTotal: 1 } })).toBe(s);
  });

  test('прошлый чек ещё открыт, но есть новее → показываем новый', () => {
    expect(reduceVisit(session(A), { type: 'state', openCheckId: B, previous: { id: A, outcome: 'open' } })).toEqual(session(B));
  });

  test('SSE «оплачено» переводит в благодарность сразу', () => {
    expect(reduceVisit(session(A), { type: 'paid', checkId: A, total: 900 })).toEqual({ kind: 'finish', checkId: A, paid: true, total: 900 });
  });

  test('«оплачено» для чужого чека игнорируется', () => {
    const s = session(A);
    expect(reduceVisit(s, { type: 'paid', checkId: B, total: 1 })).toBe(s);
  });

  test('в благодарности новый счёт не перебивает оценку', () => {
    const f: Phase = { kind: 'finish', checkId: A, paid: true, total: 1 };
    expect(reduceVisit(f, { type: 'state', openCheckId: B, previous: null })).toBe(f);
  });

  test('«закрыт» уточняется до «оплачен», если пришло событие оплаты', () => {
    const f: Phase = { kind: 'finish', checkId: A, paid: false, total: null };
    expect(reduceVisit(f, { type: 'paid', checkId: A, total: null })).toEqual({ ...f, paid: true });
  });

  test('done завершает только благодарность', () => {
    expect(reduceVisit({ kind: 'finish', checkId: A, paid: true, total: 1 }, { type: 'done' })).toBe(IDLE);
    const s = session(A);
    expect(reduceVisit(s, { type: 'done' })).toBe(s);
  });

  test('reset из любого состояния → idle', () => {
    expect(reduceVisit(session(A), { type: 'reset' })).toBe(IDLE);
  });
});

describe('samePhase', () => {
  test('сравнивает вид и чек', () => {
    expect(samePhase(IDLE, IDLE)).toBe(true);
    expect(samePhase(session(A), session(A))).toBe(true);
    expect(samePhase(session(A), session(B))).toBe(false);
    expect(samePhase(session(A), { kind: 'finish', checkId: A, paid: true, total: 1 })).toBe(false);
  });
});
