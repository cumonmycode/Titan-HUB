import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeTotals } from '../../src/lib/money.js'
import { computeAccrual, parseBonusSettings, type AccrualInput } from '../../src/lib/bonusRules.js'

// Свободная позиция «Другое» — возврат денег, оплаченных клубом за гостя:
// входит в сумму чека, но скидки и бонусы на неё не действуют.
const items = [
  { id: 'bar', priceAtTime: '1000', quantity: 1, customName: null },
  { id: 'pizza', priceAtTime: '1500', quantity: 1, customName: 'Пицца' },
]

describe('свободная позиция «Другое»', () => {
  it('входит в итог чека без скидок', () => {
    assert.deepEqual(computeTotals(items, [], []), { gross: 2500, discountTotal: 0, total: 2500 })
  })

  it('процентная скидка на чек не уменьшает «Другое»', () => {
    const r = computeTotals(items, [], [{ type: 'percent', value: '10', target: 'check', itemId: null }])
    assert.equal(r.discountTotal, 100)
    assert.equal(r.total, 2400)
  })

  it('фиксированная скидка не больше суммы позиций меню', () => {
    const r = computeTotals(items, [], [{ type: 'fixed', value: '5000', target: 'check', itemId: null }])
    assert.equal(r.discountTotal, 1000)
    assert.equal(r.total, 1500)
  })

  it('скидка на саму строку «Другое» не действует', () => {
    const r = computeTotals(items, [], [{ type: 'percent', value: '50', target: 'item', itemId: 'pizza' }])
    assert.equal(r.discountTotal, 0)
  })

  it('бонусы начисляются только на позиции меню', () => {
    const input: AccrualInput = {
      playerId: 'p1',
      player: { role: 'client', clientTier: 'resident', birthday: null, closedChecks: 3 },
      openedAt: new Date('2026-11-17T17:00:00Z'),
      lines: [
        { itemId: 'a', categoryId: null, amount: 1000 },
        { itemId: 'other', categoryId: null, amount: 1500, noBonus: true },
      ],
      paid: 2500,
      debt: 0,
    }
    assert.equal(computeAccrual(parseBonusSettings({ bonus_accrual_rate: '5' }), [], input).amount, 50)
  })
})

describe('выручка без «Другого»', () => {
  it('вычитает свободные позиции из итога чека', async () => {
    const { revenueOf } = await import('../../src/lib/money.js')
    assert.equal(revenueOf({ totalAmount: '2500.00', customAmount: '1500.00' }), 1000)
  })
  it('списание на персонал не уходит в минус', async () => {
    const { revenueOf } = await import('../../src/lib/money.js')
    assert.equal(revenueOf({ totalAmount: '0', customAmount: '1500' }), 0)
  })
  it('старые строки без custom_amount — как раньше', async () => {
    const { revenueOf } = await import('../../src/lib/money.js')
    assert.equal(revenueOf({ totalAmount: 800 }), 800)
  })
})
