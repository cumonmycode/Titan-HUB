import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { signToken } from '@titan/auth'
import { tgWebhookSecret } from '../../src/lib/tgWebhook.js'
import { webhookSecret } from '../../src/modules/mafboard/tokens.js'
import { call, config, createTestContext, DEVICE_SECRET, message, signIn, TG_USER } from './helpers.js'

describe('вход через Telegram (HTTP)', () => {
  it('старт выдаёт билет и ссылку на бота в формате приложения', async () => {
    const ctx = createTestContext()
    const res = await call(ctx, 'POST', '/v1/auth/telegram/start', {
      body: { deviceName: 'iPhone', platform: 'ios', deviceSecret: DEVICE_SECRET },
    })
    assert.equal(res.status, 200)
    assert.match(res.json.deepLink, /^https:\/\/t\.me\/mafboard_test_bot\?start=login_[A-Za-z0-9_-]{24}$/)
    assert.equal(res.json.expiresAt, '2026-10-16T18:10:00.000Z')

    const status = await call(ctx, 'GET', `/v1/auth/telegram/status?ticket=${res.json.id}`)
    assert.deepEqual(status.json, { status: 'pending', opened: false })
  })

  it('кривые данные старта — 422 в формате {error: {code, message}}', async () => {
    const ctx = createTestContext()
    const res = await call(ctx, 'POST', '/v1/auth/telegram/start', {
      body: { deviceName: '', platform: 'symbian', deviceSecret: 'short' },
    })
    assert.equal(res.status, 422)
    assert.equal(res.json.error.code, 'validation')
  })

  it('полный вход выдаёт токены и аккаунт; билет одноразовый, чужой секрет не подходит', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    assert.ok(session.accessToken && session.refreshToken)
    assert.deepEqual(session.account.telegram, { id: 1001, username: 'kai', firstName: 'Кай', lastName: null })
    assert.equal(session.account.maskedPhone, '+7 *** ***-45-67')
    assert.equal(session.account.goMafia, null)

    const me = await call(ctx, 'GET', '/v1/me', { token: session.accessToken })
    assert.equal(me.status, 200)
    assert.equal(me.json.id, session.account.id)

    const ticket = [...ctx.repo.tickets.values()][0]!
    const again = await call(ctx, 'POST', '/v1/auth/telegram/complete', { body: { ticket: ticket.id, deviceSecret: DEVICE_SECRET } })
    assert.equal(again.status, 422)
    assert.equal(again.json.error.code, 'invalid_ticket')
  })

  it('неподтверждённый билет и неверный секрет не дают сессию', async () => {
    const ctx = createTestContext()
    const start = await call(ctx, 'POST', '/v1/auth/telegram/start', {
      body: { deviceName: 'iPhone', platform: 'ios', deviceSecret: DEVICE_SECRET },
    })
    const early = await call(ctx, 'POST', '/v1/auth/telegram/complete', { body: { ticket: start.json.id, deviceSecret: DEVICE_SECRET } })
    assert.equal(early.status, 422)

    await ctx.repo.updateTicket(start.json.id, { status: 'confirmed', userId: 'nobody' })
    const wrong = await call(ctx, 'POST', '/v1/auth/telegram/complete', {
      body: { ticket: start.json.id, deviceSecret: 'another-secret-0123456789abcdefghijklmnop' },
    })
    assert.equal(wrong.status, 422)
  })

  it('refresh одноразовый: повторное использование отзывает все сессии', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)

    const first = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: session.refreshToken } })
    assert.equal(first.status, 200)
    assert.notEqual(first.json.refreshToken, session.refreshToken)

    // Повтор сразу (потерянный ответ) — 401, но новая сессия жива.
    const quickRetry = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: session.refreshToken } })
    assert.equal(quickRetry.status, 401)
    const stillValid = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: first.json.refreshToken } })
    assert.equal(stillValid.status, 200)

    // Повтор спустя минуту — кража: отзываются все сессии.
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 60_000)
    const replay = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: session.refreshToken } })
    assert.equal(replay.status, 401)
    const afterTheft = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: stillValid.json.refreshToken } })
    assert.equal(afterTheft.status, 401)
  })

  it('выход отзывает refresh-токен', async () => {
    const ctx = createTestContext()
    const session = await signIn(ctx)
    await call(ctx, 'POST', '/v1/auth/logout', { body: { refreshToken: session.refreshToken } })
    const res = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: session.refreshToken } })
    assert.equal(res.status, 401)
  })

  it('токен Titan HUB не открывает ручки MafBoard', async () => {
    const ctx = createTestContext()
    const titanToken = await signToken({ sub: 'staff-1', role: 'owner', nickname: 'Owner' })
    const res = await call(ctx, 'GET', '/v1/me', { token: titanToken })
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'unauthorized')
  })

  it('лимит на старт входа с одного IP', async () => {
    const ctx = createTestContext()
    const body = { deviceName: 'iPhone', platform: 'ios', deviceSecret: DEVICE_SECRET }
    for (let i = 0; i < 20; i++) await call(ctx, 'POST', '/v1/auth/telegram/start', { body })
    const blocked = await call(ctx, 'POST', '/v1/auth/telegram/start', { body })
    assert.equal(blocked.status, 429)
  })

  it('модуль без настроек отвечает 503, не роняя API', async () => {
    const { Hono } = await import('hono')
    const { createMafboardRouter } = await import('../../src/modules/mafboard/router.js')
    const app = new Hono().route('/api/mafboard', createMafboardRouter(() => ({ error: 'MAFBOARD_DATABASE_URL не задан' })))
    const res = await app.request('/api/mafboard/v1/me')
    assert.equal(res.status, 503)
    const payload = (await res.json()) as { error: { code: string } }
    assert.equal(payload.error.code, 'not_configured')
  })
})

describe('вебхук бота', () => {
  it('без секрета — 403; повтор апдейта обрабатывается один раз', async () => {
    const ctx = createTestContext()
    const update = message(TG_USER, { text: '/start' })

    const forged = await call(ctx, 'POST', '/tg-webhook', { body: update, headers: { 'x-telegram-bot-api-secret-token': 'nope' } })
    assert.equal(forged.status, 403)
    // Секрет, выведенный из JWT_SECRET Titan HUB, больше не подходит.
    const titanDerived = await call(ctx, 'POST', '/tg-webhook', {
      body: update, headers: { 'x-telegram-bot-api-secret-token': tgWebhookSecret('mafboard') },
    })
    assert.equal(titanDerived.status, 403)

    const headers = { 'x-telegram-bot-api-secret-token': webhookSecret(config) }
    assert.equal((await call(ctx, 'POST', '/tg-webhook', { body: update, headers })).status, 200)
    assert.equal((await call(ctx, 'POST', '/tg-webhook', { body: update, headers })).status, 200)
    await ctx.flush()
    assert.equal(ctx.messenger.sent.length, 1)
    assert.match(ctx.messenger.last?.text ?? '', /бот входа в MafBoard/)
  })
})
