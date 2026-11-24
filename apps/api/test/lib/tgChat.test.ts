import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accessReason, durationText, funDue, parseDuration } from '../../src/modules/tg/rules.js'
import type { Profile } from '@titan/database'

const MSK_MS = 3 * 3600_000
/** Момент по МСК: 2026-11-24 hh:mm. */
const msk = (h: number, m = 0) => Date.UTC(2026, 10, 24, h, m) - MSK_MS

describe('срок модерации', () => {
  it('понимает минуты, часы, дни и голое число как минуты', () => {
    assert.equal(parseDuration('10м'), 600)
    assert.equal(parseDuration('2ч'), 7200)
    assert.equal(parseDuration('1д'), 86400)
    assert.equal(parseDuration('15'), 900)
    assert.equal(parseDuration('30s'), 30)
  })
  it('не срок — null', () => {
    assert.equal(parseDuration('@vasya'), null)
    assert.equal(parseDuration('0'), null)
    assert.equal(parseDuration(undefined), null)
  })
  it('подпись срока', () => {
    assert.equal(durationText(600), '10 мин')
    assert.equal(durationText(7200), '2 ч')
    assert.equal(durationText(86400 * 3), '3 дн.')
  })
})

describe('расписание приколов', () => {
  const fun = { on: true, perDay: 2, from: 12, to: 22, kinds: ['fact' as const], threadId: null }
  it('вне часов и сверх нормы — нет', () => {
    assert.equal(funDue(fun, 0, 0, msk(9), 0), false)
    assert.equal(funDue(fun, 2, 0, msk(15), 0), false)
  })
  it('слишком скоро после прошлого поста — нет', () => {
    assert.equal(funDue(fun, 1, msk(14), msk(15), 0), false)
  })
  it('последний тик окна добирает норму', () => {
    assert.equal(funDue(fun, 1, msk(14), msk(21, 55), 0.99), true)
  })
})

describe('доступ к чатам', () => {
  const profile = (extra: Partial<Profile> = {}) => ({ id: '11111111-1111-4111-8111-111111111111', role: 'client', registrationStatus: null, ...extra }) as Profile
  const access = { invite: true, everyone: false, games: ['sport' as const], staff: true, allow: [] as string[], guard: true }
  it('городской игрок не попадает в спортивный чат, спортивный — попадает', () => {
    assert.equal(accessReason(access, { profile: profile(), games: 'city' }), null)
    assert.equal(accessReason(access, { profile: profile(), games: 'sport' }), 'games')
    assert.equal(accessReason(access, { profile: profile(), games: 'both' }), 'games')
  })
  it('ручной доступ важнее правил, неподтверждённая анкета — только вручную', () => {
    const p = profile({ registrationStatus: 'pending' })
    assert.equal(accessReason(access, { profile: p, games: 'sport' }), null)
    assert.equal(accessReason({ ...access, allow: [p.id] }, { profile: p, games: 'city' }), 'manual')
  })
  it('незнакомец — только если чат открыт всем', () => {
    assert.equal(accessReason(access, { profile: null, games: null }), null)
    assert.equal(accessReason({ ...access, everyone: true }, { profile: null, games: null }), 'everyone')
  })
  it('сотрудник — если разрешено сотрудникам', () => {
    assert.equal(accessReason(access, { profile: profile({ role: 'staff' }), games: null }), 'staff')
  })
})
