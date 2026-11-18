import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { call, config, createTestContext, FakeDa, signIn, type TestContext } from './helpers.js'

const LAPTOP_SECRET = 'laptop-secret-0123456789abcdefghijklmnopqrstuv'

async function laptop(ctx: TestContext, phoneToken: string): Promise<string> {
  const issued = (await call(ctx, 'POST', '/v1/auth/qr/start', { body: { deviceName: 'MacBook', platform: 'macos', deviceSecret: LAPTOP_SECRET } })).json
  await call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan: issued.scanCode, code: Number(issued.confirmationCode) }, token: phoneToken })
  return (await call(ctx, 'POST', '/v1/auth/qr/complete', { body: { ticket: issued.id, deviceSecret: LAPTOP_SECRET } })).json.tokens.accessToken
}

async function browserReturns(ctx: TestContext, query: string): Promise<{ status: number; page: string }> {
  const response = await ctx.app.request(`/api/mafboard/v1/donationalerts/callback?${query}`)
  return { status: response.status, page: await response.text() }
}

describe('вход MafBoard Studio в DonationAlerts', () => {
  it('ноутбук получает ссылку, ведущий входит, токены забираются один раз', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    const begun = await call(ctx, 'POST', '/v1/studio/donationalerts/begin', { token })
    assert.equal(begun.status, 200)
    const url = new URL(begun.json.url)
    assert.equal(url.origin + url.pathname, 'https://www.donationalerts.com/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'da-client')
    assert.equal(url.searchParams.get('redirect_uri'), config.donationAlerts?.redirectUri)
    assert.equal(url.searchParams.get('scope'), 'oauth-user-show oauth-donation-subscribe')
    assert.ok(!begun.json.url.includes('da-secret'), 'секрет в ссылке не бывает')

    assert.equal((await call(ctx, 'GET', `/v1/studio/donationalerts/claim?state=${begun.json.state}`, { token })).status, 202)
    const back = await browserReturns(ctx, `code=good&state=${begun.json.state}`)
    assert.equal(back.status, 200)
    assert.ok(!back.page.includes('da-access'), 'токены в браузер не попадают')

    const claimed = await call(ctx, 'GET', `/v1/studio/donationalerts/claim?state=${begun.json.state}`, { token })
    assert.deepEqual(claimed.json, { accessToken: 'da-access', refreshToken: 'da-refresh', expiresIn: 31536000 })
    assert.equal((await call(ctx, 'GET', `/v1/studio/donationalerts/claim?state=${begun.json.state}`, { token })).status, 404)
  })

  it('входы VK и DonationAlerts не путаются', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const begun = await call(ctx, 'POST', '/v1/studio/donationalerts/begin', { token })
    assert.equal((await ctx.app.request(`/api/mafboard/v1/vk/callback?code=good&state=${begun.json.state}`)).status, 400)
    assert.equal((await call(ctx, 'GET', `/v1/studio/vk/claim?state=${begun.json.state}`, { token })).status, 404)
  })

  it('отказ ведущего и чужой state', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const refused = await call(ctx, 'POST', '/v1/studio/donationalerts/begin', { token })
    await browserReturns(ctx, `error=access_denied&state=${refused.json.state}`)
    const outcome = await call(ctx, 'GET', `/v1/studio/donationalerts/claim?state=${refused.json.state}`, { token })
    assert.equal(outcome.status, 400)
    assert.match(outcome.json.error.message, /не разрешён/)
    assert.equal((await browserReturns(ctx, 'code=good&state=forged')).status, 400)
    assert.deepEqual((ctx.deps.donationAlerts as FakeDa).calls, [])
  })

  it('обновление идёт с секретом сервера, отозванный вход — 401, выход всегда успешен', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const fresh = await call(ctx, 'POST', '/v1/studio/donationalerts/refresh', { token, body: { token: 'da-refresh' } })
    assert.deepEqual(fresh.json, { accessToken: 'da-access-2', refreshToken: 'da-refresh-2', expiresIn: 31536000 })
    const dead = await call(ctx, 'POST', '/v1/studio/donationalerts/refresh', { token, body: { token: 'dead-token' } })
    assert.equal(dead.status, 401)
    assert.equal(dead.json.error.code, 'da_revoked')
    assert.equal((await call(ctx, 'POST', '/v1/studio/donationalerts/revoke', { token, body: { token: 'da-refresh-2' } })).status, 200)
  })

  it('без настроек DonationAlerts на сервере вход выключен', async () => {
    const ctx = createTestContext({ config: { ...config, donationAlerts: null } })
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    const begun = await call(ctx, 'POST', '/v1/studio/donationalerts/begin', { token })
    assert.equal(begun.status, 503)
    assert.equal(begun.json.error.code, 'da_disabled')
  })
})
