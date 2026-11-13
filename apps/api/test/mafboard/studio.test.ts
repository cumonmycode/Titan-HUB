import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { openSecrets, sealSecrets, studioSecretsKey } from '../../src/modules/mafboard/studio.js'
import { call, config, createTestContext, signIn, TG_USER, type TestContext } from './helpers.js'

const LAPTOP_SECRET = 'laptop-secret-0123456789abcdefghijklmnopqrstuv'

/** Вход MBS по QR, подтверждённый телефоном: токен ноутбука. */
async function laptop(ctx: TestContext, phoneToken: string): Promise<string> {
  const issued = (await call(ctx, 'POST', '/v1/auth/qr/start', { body: { deviceName: 'MacBook', platform: 'macos', deviceSecret: LAPTOP_SECRET } })).json
  await call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan: issued.scanCode, code: Number(issued.confirmationCode) }, token: phoneToken })
  return (await call(ctx, 'POST', '/v1/auth/qr/complete', { body: { ticket: issued.id, deviceSecret: LAPTOP_SECRET } })).json.tokens.accessToken
}

const DOCUMENT = { schema: 1, active: 'main', profiles: [{ id: 'main', name: 'Основной', theme: 'orange' }] }
const SECRETS = { platforms: { main: { youtube: { server: 'rtmp://a.rtmp.youtube.com/live2', key: 'abcd-efgh-ijkl' } } }, youtubeApiKey: 'AIzaTest' }

describe('настройки MafBoard Studio', () => {
  it('ноутбук сохраняет и читает свои профили и секреты', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    const empty = await call(ctx, 'GET', '/v1/studio/settings', { token })
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, { revision: 0, updatedAt: null, document: null, secrets: null })

    const saved = await call(ctx, 'PUT', '/v1/studio/settings', { token, body: { baseRevision: 0, document: DOCUMENT, secrets: SECRETS } })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json, { revision: 1 })

    const read = await call(ctx, 'GET', '/v1/studio/settings', { token })
    assert.equal(read.json.revision, 1)
    assert.deepEqual(read.json.document, DOCUMENT)
    assert.deepEqual(read.json.secrets, SECRETS)
  })

  it('ключи потоков на сервере лежат только шифротекстом', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    await call(ctx, 'PUT', '/v1/studio/settings', { token, body: { baseRevision: 0, document: DOCUMENT, secrets: SECRETS } })
    const stored = ctx.repo.studio.get(phone.account.id)
    assert.ok(stored?.secrets)
    assert.ok(!stored.secrets.includes('abcd-efgh-ijkl'))
    assert.ok(!stored.secrets.includes('AIzaTest'))
    assert.deepEqual(openSecrets(config.studioSecretsKey, stored.secrets), SECRETS)
  })

  it('запись от устаревшей ревизии отклоняется и отдаёт текущую версию', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const first = await laptop(ctx, phone.accessToken)
    const second = await laptop(ctx, phone.accessToken)
    await call(ctx, 'PUT', '/v1/studio/settings', { token: first, body: { baseRevision: 0, document: DOCUMENT, secrets: null } })

    const stale = await call(ctx, 'PUT', '/v1/studio/settings', { token: second, body: { baseRevision: 0, document: { schema: 1, profiles: [] }, secrets: null } })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error.code, 'revision_conflict')
    assert.equal(stale.json.current.revision, 1)
    assert.deepEqual(stale.json.current.document, DOCUMENT)

    const merged = await call(ctx, 'PUT', '/v1/studio/settings', { token: second, body: { baseRevision: 1, document: { ...DOCUMENT, active: 'cup' }, secrets: null } })
    assert.deepEqual(merged.json, { revision: 2 })
  })

  it('у каждого ведущего свои настройки', async () => {
    const ctx = createTestContext()
    const kai = await signIn(ctx)
    const other = await signIn(ctx, { ...TG_USER, id: TG_USER.id + 1, username: 'other' })
    await call(ctx, 'PUT', '/v1/studio/settings', { token: kai.accessToken, body: { baseRevision: 0, document: DOCUMENT, secrets: SECRETS } })
    const theirs = await call(ctx, 'GET', '/v1/studio/settings', { token: other.accessToken })
    assert.deepEqual(theirs.json, { revision: 0, updatedAt: null, document: null, secrets: null })
  })

  it("кривые настройки не проходят, остальное ноутбуку всё так же закрыто", async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)
    for (const body of [null, { baseRevision: -1, document: {}, secrets: null }, { baseRevision: 0, document: [], secrets: null }, { baseRevision: 0, secrets: null }]) {
      assert.equal((await call(ctx, 'PUT', '/v1/studio/settings', { token, body })).status, 422, JSON.stringify(body))
    }
    assert.equal((await call(ctx, 'GET', '/v1/me/games', { token })).status, 403)
    assert.equal((await call(ctx, 'GET', '/v1/studio/settings')).status, 401)
  })

  it('удаление аккаунта уносит и настройки студии', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    await call(ctx, 'PUT', '/v1/studio/settings', { token: phone.accessToken, body: { baseRevision: 0, document: DOCUMENT, secrets: SECRETS } })
    assert.equal((await call(ctx, 'DELETE', '/v1/me', { token: phone.accessToken })).status, 200)
    assert.equal(ctx.repo.studio.size, 0)
  })
})

describe('шифрование секретов студии', () => {
  it('другой ключ и испорченная запись не читаются', () => {
    const sealed = sealSecrets(config.studioSecretsKey, SECRETS)
    assert.equal(openSecrets(new Uint8Array(32).fill(1), sealed), null)
    assert.equal(openSecrets(config.studioSecretsKey, sealed.slice(0, -4) + 'AAAA'), null)
    assert.equal(openSecrets(config.studioSecretsKey, 'v2.x.y.z'), null)
    assert.notEqual(sealSecrets(config.studioSecretsKey, SECRETS), sealed, 'каждый раз свой вектор')
  })

  it('ключ берётся из своей переменной или выводится из JWT-секрета', () => {
    const jwt = new TextEncoder().encode('jwt-secret-0123456789-0123456789-xyz')
    const derived = studioSecretsKey({}, jwt)
    assert.ok(derived instanceof Uint8Array && derived.length === 32)
    assert.deepEqual(studioSecretsKey({}, jwt), derived)
    const own = Buffer.alloc(32, 9).toString('base64')
    assert.deepEqual(studioSecretsKey({ MAFBOARD_STUDIO_SECRETS_KEY: own }, jwt), new Uint8Array(32).fill(9))
    assert.equal(typeof studioSecretsKey({ MAFBOARD_STUDIO_SECRETS_KEY: 'short' }, jwt), 'string')
  })
})
