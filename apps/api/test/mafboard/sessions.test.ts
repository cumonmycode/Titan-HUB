import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { call, createTestContext, NOW, signIn, TG_USER, type TestContext } from './helpers.js'

const PIXEL = { deviceName: 'Pixel 8', platform: 'android' } as const
const OTHER_USER = { id: 2002, is_bot: false, first_name: 'Лис', username: 'fox' }

function later(ctx: TestContext, ms: number) {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + ms)
}

async function sessionsOf(ctx: TestContext, accessToken: string) {
  const res = await call(ctx, 'GET', '/v1/me/sessions', { token: accessToken })
  assert.equal(res.status, 200)
  return res.json.sessions as { id: string; deviceName: string; platform: string; createdAt: string; lastUsedAt: string; isCurrent: boolean }[]
}

describe('сессии устройств', () => {
  it('список: текущее устройство первым и помечено, у остальных — время входа и активности', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    later(ctx, 60 * 60_000)
    const pixel = await signIn(ctx, TG_USER, PIXEL)

    const fromPhone = await sessionsOf(ctx, phone.accessToken)
    assert.deepEqual(fromPhone.map((s) => [s.deviceName, s.platform, s.isCurrent]), [['iPhone', 'ios', true], ['Pixel 8', 'android', false]])
    assert.equal(fromPhone[1]?.createdAt, '2026-10-16T19:00:00.000Z')
    assert.equal(fromPhone[1]?.lastUsedAt, '2026-10-16T19:00:00.000Z')

    const fromPixel = await sessionsOf(ctx, pixel.accessToken)
    assert.deepEqual(fromPixel.map((s) => [s.deviceName, s.isCurrent]), [['Pixel 8', true], ['iPhone', false]])
  })

  it('без входа список сессий недоступен', async () => {
    const ctx = createTestContext()
    assert.equal((await call(ctx, 'GET', '/v1/me/sessions')).status, 401)
  })

  it('обновление токенов продлевает ту же сессию и отмечает активность', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    later(ctx, 2 * 60 * 60_000)
    const refreshed = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: phone.refreshToken } })
    assert.equal(refreshed.status, 200)

    const [session, ...rest] = await sessionsOf(ctx, refreshed.json.accessToken)
    assert.equal(rest.length, 0)
    assert.equal(session?.isCurrent, true)
    assert.equal(session?.createdAt, NOW.toISOString())
    assert.equal(session?.lastUsedAt, '2026-10-16T20:00:00.000Z')
  })

  it('активность записывается не чаще раза в 5 минут', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const lastUsed = () => [...ctx.repo.sessions.values()][0]?.lastUsedAt.toISOString()

    later(ctx, 3 * 60_000)
    await call(ctx, 'GET', '/v1/me', { token: phone.accessToken })
    assert.equal(lastUsed(), NOW.toISOString())

    later(ctx, 3 * 60_000)
    await call(ctx, 'GET', '/v1/me', { token: phone.accessToken })
    assert.equal(lastUsed(), '2026-10-16T18:06:00.000Z')
  })

  it('отзыв другого устройства сразу закрывает ему доступ, не трогая остальные', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const pixel = await signIn(ctx, TG_USER, PIXEL)
    const pixelId = (await sessionsOf(ctx, pixel.accessToken))[0]!.id

    // Swift отдаёт UUID в верхнем регистре — сервер принимает любой.
    const revoked = await call(ctx, 'DELETE', `/v1/me/sessions/${pixelId.toUpperCase()}`, { token: phone.accessToken })
    assert.equal(revoked.status, 200)
    assert.deepEqual(revoked.json, { ok: true })

    // Access-токен отозванной сессии не ждёт истечения часа.
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: pixel.accessToken })).status, 401)
    assert.equal((await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: pixel.refreshToken } })).status, 401)
    // Повтор отозванного токена спустя минуту — не кража: другие сессии живы.
    later(ctx, 60_000)
    assert.equal((await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: pixel.refreshToken } })).status, 401)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: phone.accessToken })).status, 200)
    assert.equal((await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: phone.refreshToken } })).status, 200)

    assert.deepEqual((await sessionsOf(ctx, phone.accessToken)).map((s) => s.deviceName), ['iPhone'])
    const again = await call(ctx, 'DELETE', `/v1/me/sessions/${pixelId}`, { token: phone.accessToken })
    assert.equal(again.status, 404)
  })

  it('текущую сессию так не завершить, чужую — тем более', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const stranger = await signIn(ctx, OTHER_USER)
    const [own] = await sessionsOf(ctx, phone.accessToken)
    const [foreign] = await sessionsOf(ctx, stranger.accessToken)

    const current = await call(ctx, 'DELETE', `/v1/me/sessions/${own!.id}`, { token: phone.accessToken })
    assert.equal(current.status, 409)
    assert.equal(current.json.error.code, 'current_session')

    const notMine = await call(ctx, 'DELETE', `/v1/me/sessions/${foreign!.id}`, { token: phone.accessToken })
    assert.equal(notMine.status, 404)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: stranger.accessToken })).status, 200)

    const garbage = await call(ctx, 'DELETE', '/v1/me/sessions/not-a-uuid', { token: phone.accessToken })
    assert.equal(garbage.status, 422)
  })

  it('выход завершает сессию устройства: её access-токен больше не действует', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const pixel = await signIn(ctx, TG_USER, PIXEL)

    assert.equal((await call(ctx, 'POST', '/v1/auth/logout', { body: { refreshToken: pixel.refreshToken } })).status, 200)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: pixel.accessToken })).status, 401)
    assert.deepEqual((await sessionsOf(ctx, phone.accessToken)).map((s) => s.deviceName), ['iPhone'])
  })
})
