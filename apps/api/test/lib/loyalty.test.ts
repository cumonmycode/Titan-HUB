import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BonusRule, Discount } from '@titan/database'
import { computeAccrual, parseBonusSettings, type AccrualInput } from '../../src/lib/bonusRules.js'
import { discountRows, freeUnitsCount, type DiscountContext } from '../../src/lib/discounts.js'
import { parseBirthdayGift } from '../../src/lib/birthdayGift.js'

const BAR = '11111111-1111-1111-1111-111111111111'
const GAME = '22222222-2222-2222-2222-222222222222'
// Вторник 2026-11-17, 20:00 МСК.
const TUESDAY_EVENING = new Date('2026-11-17T17:00:00Z')

function rule(over: Partial<BonusRule>): BonusRule {
  return {
    id: over.id ?? 'r1', name: 'Правило', description: null, isActive: true, kind: 'percent', value: '10',
    scope: 'check', categoryIds: [], itemIds: [], audience: 'all', tiers: [], clientIds: [], birthdayDays: null,
    weekdays: [], timeFrom: null, timeTo: null, startsOn: null, endsOn: null, minCheckSum: '0', sortOrder: 0,
    createdAt: new Date(), ...over,
  }
}

function input(over: Partial<AccrualInput> = {}): AccrualInput {
  return {
    playerId: 'p1',
    player: { role: 'client', clientTier: 'resident', birthday: null, closedChecks: 3 },
    openedAt: TUESDAY_EVENING,
    lines: [{ itemId: 'a', categoryId: BAR, amount: 600 }, { itemId: 'b', categoryId: GAME, amount: 400 }],
    paid: 1000,
    debt: 0,
    ...over,
  }
}

const settings = (raw: Record<string, string> = {}) => parseBonusSettings({ bonus_accrual_rate: '5', ...raw })

describe('начисление бонусов', () => {
  it('базовый процент от оплаченной суммы', () => {
    assert.equal(computeAccrual(settings(), [], input()).amount, 50)
  })

  it('свой процент статуса важнее общего', () => {
    const s = settings({ bonus_tier_rates: JSON.stringify({ resident: 7 }) })
    assert.equal(computeAccrual(s, [], input()).amount, 70)
  })

  it('исключённая категория не даёт бонусов', () => {
    const s = settings({ bonus_excluded_categories: JSON.stringify([GAME]) })
    assert.equal(computeAccrual(s, [], input()).amount, 30)
  })

  it('скидка уменьшает базу пропорционально позициям', () => {
    const s = settings({ bonus_excluded_categories: JSON.stringify([GAME]) })
    assert.equal(computeAccrual(s, [], input({ paid: 500 })).amount, 15)
  })

  it('процентное правило на категорию заменяет базовый процент', () => {
    const r = rule({ scope: 'categories', categoryIds: [BAR], value: '10', name: 'Бар 10%' })
    const res = computeAccrual(settings(), [r], input())
    assert.equal(res.amount, 60 + 20)
    assert.match(res.reason, /Бар 10%/)
  })

  it('явное правило включает исключённую категорию', () => {
    const s = settings({ bonus_excluded_categories: JSON.stringify([GAME]) })
    const r = rule({ scope: 'categories', categoryIds: [GAME], value: '3' })
    assert.equal(computeAccrual(s, [r], input()).amount, 30 + 12)
  })

  it('правило «на весь чек» не включает исключённую категорию', () => {
    const s = settings({ bonus_excluded_categories: JSON.stringify([GAME]) })
    const r = rule({ value: '10' })
    assert.equal(computeAccrual(s, [r], input()).amount, 60)
  })

  it('множитель по дню недели и времени', () => {
    const r = rule({ kind: 'multiplier', value: '2', weekdays: [2], timeFrom: '18:00', timeTo: '23:00' })
    assert.equal(computeAccrual(settings(), [r], input()).amount, 100)
    assert.equal(computeAccrual(settings(), [r], input({ openedAt: new Date('2026-11-18T17:00:00Z') })).amount, 50)
  })

  it('из нескольких множителей берётся наибольший', () => {
    const rules = [rule({ id: 'a', kind: 'multiplier', value: '2' }), rule({ id: 'b', kind: 'multiplier', value: '3' })]
    assert.equal(computeAccrual(settings(), rules, input()).amount, 150)
  })

  it('фиксированные бонусы складываются и зависят от минимальной суммы', () => {
    const rules = [rule({ id: 'a', kind: 'fixed', value: '100' }), rule({ id: 'b', kind: 'fixed', value: '50', minCheckSum: '2000' })]
    assert.equal(computeAccrual(settings(), rules, input()).amount, 150)
  })

  it('правило только для статуса', () => {
    const r = rule({ kind: 'fixed', value: '100', audience: 'tiers', tiers: ['student'] })
    assert.equal(computeAccrual(settings(), [r], input()).amount, 50)
  })

  it('выключенная программа, долг и минимальная покупка', () => {
    assert.equal(computeAccrual(settings({ bonus_enabled: 'false' }), [], input()).amount, 0)
    assert.equal(computeAccrual(settings(), [], input({ debt: 100 })).amount, 0)
    assert.equal(computeAccrual(settings({ bonus_accrual_on_debt: 'true' }), [], input({ debt: 100 })).amount, 50)
    assert.equal(computeAccrual(settings({ bonus_min_purchase: '2000' }), [], input()).amount, 0)
  })

  it('чек без позиций (только аренда) начисляет на сумму', () => {
    assert.equal(computeAccrual(settings(), [], input({ lines: [], paid: 900 })).amount, 45)
  })
})

describe('каждый N-й бесплатно', () => {
  it('считает бесплатные единицы с учётом прошлых покупок', () => {
    assert.equal(freeUnitsCount(6, 0, 5), 0)
    assert.equal(freeUnitsCount(6, 5, 1), 1)
    assert.equal(freeUnitsCount(6, 4, 9), 2)
    assert.equal(freeUnitsCount(2, 0, 5), 2)
    assert.equal(freeUnitsCount(1, 0, 5), 0)
  })

  const discount = (over: Partial<Discount>): Discount => ({
    id: 'd1', name: '2 по цене 1', type: 'percent', value: '100', isActive: true, isAuto: true, minQuantity: 1,
    itemId: null, clientRuleId: null, clientId: null, description: null, scope: 'categories', categoryIds: [BAR], itemIds: [],
    audience: 'all', tiers: [], clientIds: [], birthdayDays: null, weekdays: [], timeFrom: null, timeTo: null,
    startsOn: null, endsOn: null, minCheckSum: '0', combinable: false, sortOrder: 0,
    mechanic: 'free_units', freeEvery: 2, freeHistory: false, createdAt: new Date(), ...over,
  })
  const ctx = (history?: Record<string, number>): DiscountContext => ({
    playerId: 'p1', player: null, openedAt: TUESDAY_EVENING, gross: 1300, history,
    lines: [
      { id: 'l1', itemId: 'x', categoryId: BAR, price: 400, qty: 2 },
      { id: 'l2', itemId: 'y', categoryId: BAR, price: 250, qty: 1 },
      { id: 'l3', itemId: 'z', categoryId: GAME, price: 1000, qty: 1 },
    ],
  })

  it('внутри чека бесплатными становятся самые дешёвые', () => {
    const res = discountRows(discount({}), ctx())
    assert.ok(res)
    assert.equal(res.effect, 250)
    assert.deepEqual(res.rows.map((r) => [r.itemId, r.amount]), [['l2', '250']])
  })

  it('штамп-карта учитывает прошлые визиты', () => {
    const card = discount({ freeEvery: 5, freeHistory: true })
    assert.equal(discountRows(card, ctx({ d1: 1 })), null)
    assert.equal(discountRows(card, ctx({ d1: 2 }))?.effect, 250)
  })
})

describe('подарок ко дню рождения', () => {
  it('настройки по умолчанию и по статусам', () => {
    const g = parseBirthdayGift({ birthday_bonus_enabled: 'true', birthday_bonus_amount: '300', birthday_tier_amounts: '{"resident":500}', birthday_bonus_days_before: '3' })
    assert.equal(g.enabled, true)
    assert.equal(g.kind, 'bonus')
    assert.equal(g.tierAmounts.resident, 500)
    assert.equal(g.daysBefore, 3)
  })

  it('бонусы не дарятся при выключенной программе, сертификат — дарится', () => {
    assert.equal(parseBirthdayGift({ birthday_bonus_enabled: 'true', bonus_enabled: 'false' }).enabled, false)
    assert.equal(parseBirthdayGift({ birthday_bonus_enabled: 'true', bonus_enabled: 'false', birthday_gift_kind: 'certificate' }).enabled, true)
  })
})
