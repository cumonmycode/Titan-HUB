import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VK_LOGIN_TTL_MS } from '../../src/modules/mafboard/vk.js'
import { call, config, createTestContext, FakeVk, signIn, type TestContext } from './helpers.js'

const LAPTOP_SECRET = 'laptop-secret-0123456789abcdefghijklmnopqrstuv'

/** Вход MBS по QR, подтверждённый телефоном: токен ноутбука. */
async function laptop(ctx: TestContext, phoneToken: string): Promise<string> {
  const issued = (await call(ctx, 'POST', '/v1/auth/qr/start', { body: { deviceName: 'MacBook', platform: 'macos', deviceSecret: LAPTOP_SECRET } })).json
  await call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan: issued.scanCode, code: Number(issued.confirmationCode) }, token: phoneToken })
  return (await call(ctx, 'POST', '/v1/auth/qr/complete', { body: { ticket: issued.id, deviceSecret: LAPTOP_SECRET } })).json.tokens.accessToken
}

/** Браузер ведущего возвращается от VK. */
async function browserReturns(ctx: TestContext, query: string): Promise<{ status: number; page: string }> {
  const response = await ctx.app.request(`/api/mafboard/v1/vk/callback?${query}`)
  return { status: response.status, page: await response.text() }
}

describe('вход MafBoard Studio в VK Видео Live', () => {
  it('ноутбук получает ссылку, ведущий входит, токены забираются один раз', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    const begun = await call(ctx, 'POST', '/v1/studio/vk/begin', { token })
    assert.equal(begun.status, 200)
    const url = new URL(begun.json.url)
    assert.equal(url.origin + url.pathname, 'https://auth.live.vkvideo.ru/app/oauth2/authorize')
    assert.equal(url.searchParams.get('client_id'), 'vk-client')
    assert.equal(url.searchParams.get('redirect_uri'), config.vk?.redirectUri)
    assert.equal(url.searchParams.get('state'), begun.json.state)
    assert.ok(!begun.json.url.includes('vk-secret'), 'секрет в ссылке не бывает')

    const early = await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token })
    assert.equal(early.status, 202)

    const back = await browserReturns(ctx, `code=good&state=${begun.json.state}`)
    assert.equal(back.status, 200)
    assert.ok(back.page.includes('Вход выполнен'))
    assert.ok(!back.page.includes('vk-access'), 'токены в браузер не попадают')

    const claimed = await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token })
    assert.deepEqual(claimed.json, { accessToken: 'vk-access', refreshToken: 'vk-refresh', expiresIn: 3600 })
    const again = await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token })
    assert.equal(again.status, 404)
  })

  it('чужой ведущий не может забрать чужие токены', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const stranger = await signIn(ctx, { id: 2002, is_bot: false, first_name: 'Чужой', username: 'stranger' })
    const begun = await call(ctx, 'POST', '/v1/studio/vk/begin', { token })
    await browserReturns(ctx, `code=good&state=${begun.json.state}`)
    const stolen = await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token: stranger.accessToken })
    assert.equal(stolen.status, 404)
    assert.equal((await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token })).status, 200)
  })

  it('отказ ведущего, неизвестный state и устаревший вход', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    const refused = await call(ctx, 'POST', '/v1/studio/vk/begin', { token })
    await browserReturns(ctx, `error=access_denied&state=${refused.json.state}`)
    const outcome = await call(ctx, 'GET', `/v1/studio/vk/claim?state=${refused.json.state}`, { token })
    assert.equal(outcome.status, 400)
    assert.match(outcome.json.error.message, /не разрешён/)

    assert.equal((await browserReturns(ctx, 'code=good&state=forged')).status, 400)
    assert.deepEqual((ctx.deps.vk as FakeVk).calls, [], 'по чужому state VK не спрашиваем')

    const stale = await call(ctx, 'POST', '/v1/studio/vk/begin', { token })
    ctx.clock.now = new Date(ctx.clock.now.getTime() + VK_LOGIN_TTL_MS + 1)
    assert.equal((await browserReturns(ctx, `code=good&state=${stale.json.state}`)).status, 400)
  })

  it('обновление и отзыв идут с секретом сервера, отозванный вход — 401', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const fresh = await call(ctx, 'POST', '/v1/studio/vk/refresh', { token, body: { token: 'vk-refresh' } })
    assert.deepEqual(fresh.json, { accessToken: 'vk-access-2', refreshToken: 'vk-refresh-2', expiresIn: 3600 })
    const dead = await call(ctx, 'POST', '/v1/studio/vk/refresh', { token, body: { token: 'dead-token' } })
    assert.equal(dead.status, 401)
    assert.equal(dead.json.error.code, 'vk_revoked')
    assert.equal((await call(ctx, 'POST', '/v1/studio/vk/revoke', { token, body: { token: 'vk-refresh-2' } })).status, 200)
    assert.ok((ctx.deps.vk as FakeVk).calls.includes('revoke:vk-refresh-2'))
  })

  it('без настроек VK на сервере вход выключен', async () => {
    const ctx = createTestContext({ config: { ...config, vk: null } })
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const begun = await call(ctx, 'POST', '/v1/studio/vk/begin', { token })
    assert.equal(begun.status, 503)
    assert.equal(begun.json.error.code, 'vk_disabled')
  })
})
