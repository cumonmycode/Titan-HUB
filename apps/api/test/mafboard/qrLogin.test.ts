import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { call, createTestContext, NOW, signIn, TG_USER, type TestContext } from './helpers.js'

const LAPTOP_SECRET = 'laptop-secret-0123456789abcdefghijklmnopqrstuv'
const LAPTOP = { deviceName: 'MacBook Кая', platform: 'macos', deviceSecret: LAPTOP_SECRET } as const

function later(ctx: TestContext, ms: number) {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + ms)
}

async function start(ctx: TestContext, overrides: Record<string, unknown> = {}) {
  const res = await call(ctx, 'POST', '/v1/auth/qr/start', { body: { ...LAPTOP, ...overrides } })
  assert.equal(res.status, 200)
  return res.json as { id: string; scanCode: string; confirmationCode: string; expiresAt: string }
}

const status = async (ctx: TestContext, id: string) => (await call(ctx, 'GET', `/v1/auth/qr/status?ticket=${id}`)).json.status as string
const ticket = (ctx: TestContext, scan: string, token: string) => call(ctx, 'GET', `/v1/auth/qr/ticket?scan=${encodeURIComponent(scan)}`, { token })
const approve = (ctx: TestContext, scan: string, code: number, token: string) =>
  call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan, code }, token })
const complete = (ctx: TestContext, id: string, deviceSecret = LAPTOP_SECRET) =>
  call(ctx, 'POST', '/v1/auth/qr/complete', { body: { ticket: id, deviceSecret } })

describe('вход в MBS по QR', () => {
  it('полный путь: ноутбук получает свою сессию, она видна на телефоне', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)

    const issued = await start(ctx)
    assert.match(issued.confirmationCode, /^\d{2}$/)
    assert.match(issued.scanCode, /^[A-Za-z0-9_-]{24}$/)
    assert.equal(issued.expiresAt, new Date(NOW.getTime() + 3 * 60_000).toISOString())
    assert.equal(await status(ctx, issued.id), 'pending')

    const shown = await ticket(ctx, issued.scanCode, phone.accessToken)
    assert.equal(shown.status, 200)
    assert.equal(shown.json.deviceName, 'MacBook Кая')
    assert.equal(shown.json.platform, 'macos')
    assert.equal(shown.json.expiresAt, issued.expiresAt)
    assert.equal(new Set(shown.json.codes).size, 3)
    assert.ok(shown.json.codes.includes(Number(issued.confirmationCode)))

    const approved = await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)
    assert.equal(approved.status, 200)
    assert.deepEqual(approved.json, { ok: true })
    assert.equal(await status(ctx, issued.id), 'confirmed')

    const session = await complete(ctx, issued.id)
    assert.equal(session.status, 200)
    assert.ok(session.json.tokens.accessToken)
    assert.ok(session.json.tokens.refreshToken)
    assert.equal(session.json.account.telegram.id, TG_USER.id)

    const fromLaptop = await call(ctx, 'GET', '/v1/me', { token: session.json.tokens.accessToken })
    assert.equal(fromLaptop.status, 200)
    assert.equal(fromLaptop.json.id, phone.account.id)

    const devices = await call(ctx, 'GET', '/v1/me/sessions', { token: phone.accessToken })
    assert.deepEqual(
      devices.json.sessions.map((s: { deviceName: string; platform: string; isCurrent: boolean }) => [s.deviceName, s.platform, s.isCurrent]),
      [['iPhone', 'ios', true], ['MacBook Кая', 'macos', false]],
    )
  })

  it('варианты кода не меняются между запросами: иначе настоящий вычисляется повторным чтением', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    const first = await ticket(ctx, issued.scanCode, phone.accessToken)
    for (let i = 0; i < 10; i += 1) {
      const next = await ticket(ctx, issued.scanCode, phone.accessToken)
      assert.deepEqual(next.json.codes, first.json.codes)
    }
  })

  it('неверный код закрывает билет: подобрать код второй попыткой нельзя', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    const real = Number(issued.confirmationCode)
    const wrong = (await ticket(ctx, issued.scanCode, phone.accessToken)).json.codes.find((code: number) => code !== real)

    const refused = await approve(ctx, issued.scanCode, wrong, phone.accessToken)
    assert.equal(refused.status, 200)
    assert.deepEqual(refused.json, { ok: false })
    assert.equal(await status(ctx, issued.id), 'rejected')

    assert.equal((await approve(ctx, issued.scanCode, real, phone.accessToken)).status, 422)
    assert.equal((await complete(ctx, issued.id)).status, 422)
    assert.equal((await ticket(ctx, issued.scanCode, phone.accessToken)).status, 404)
  })

  it('билет живёт 3 минуты: истёкший нельзя показать, подтвердить или обменять', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    later(ctx, 3 * 60_000 + 1)

    assert.equal(await status(ctx, issued.id), 'expired')
    assert.equal((await ticket(ctx, issued.scanCode, phone.accessToken)).status, 404)
    assert.equal((await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)).status, 422)
    assert.equal((await complete(ctx, issued.id)).status, 422)
  })

  it('подтверждённый, но не обменянный вовремя билет тоже истекает', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)
    later(ctx, 3 * 60_000 + 1)
    assert.equal(await status(ctx, issued.id), 'expired')
    assert.equal((await complete(ctx, issued.id)).status, 422)
  })

  it('подтверждать можно только войдя', async () => {
    const ctx = createTestContext()
    const issued = await start(ctx)
    assert.equal((await call(ctx, 'GET', `/v1/auth/qr/ticket?scan=${issued.scanCode}`)).status, 401)
    const unauthorized = await call(ctx, 'POST', '/v1/auth/qr/approve', {
      body: { scan: issued.scanCode, code: Number(issued.confirmationCode) },
    })
    assert.equal(unauthorized.status, 401)
    assert.equal(await status(ctx, issued.id), 'pending')
  })

  it('билет не обменять без секрета ноутбука, и он при этом не сгорает', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)

    assert.equal((await complete(ctx, issued.id, 'someone-else-0123456789abcdefghijklmnopqrstuv')).status, 422)
    assert.equal(await status(ctx, issued.id), 'confirmed')
    assert.equal((await complete(ctx, issued.id)).status, 200)
  })

  it('неподтверждённый билет не обменять', async () => {
    const ctx = createTestContext()
    const issued = await start(ctx)
    assert.equal((await complete(ctx, issued.id)).status, 422)
  })

  it('билет одноразовый', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    const real = Number(issued.confirmationCode)
    assert.deepEqual((await approve(ctx, issued.scanCode, real, phone.accessToken)).json, { ok: true })
    assert.equal((await approve(ctx, issued.scanCode, real, phone.accessToken)).status, 422)
    assert.equal((await complete(ctx, issued.id)).status, 200)
    assert.equal((await complete(ctx, issued.id)).status, 422)
    assert.equal(await status(ctx, issued.id), 'expired')
  })

  it('телефонная платформа сюда не проходит, а настольная — в обычный вход', async () => {
    const ctx = createTestContext()
    const phoneOnQr = await call(ctx, 'POST', '/v1/auth/qr/start', { body: { ...LAPTOP, platform: 'ios' } })
    assert.equal(phoneOnQr.status, 422)
    const laptopOnBot = await call(ctx, 'POST', '/v1/auth/telegram/start', { body: { ...LAPTOP } })
    assert.equal(laptopOnBot.status, 422)
  })

  it('имя устройства очищается: на экран телефона не попадут ссылки и разметка', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx, { deviceName: '<b>Подтвердите</b> https://evil.example/' })
    const shown = await ticket(ctx, issued.scanCode, phone.accessToken)
    assert.doesNotMatch(shown.json.deviceName, /[<>/:.]/)
  })

  it('некорректные запросы отклоняются', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    assert.equal((await call(ctx, 'GET', '/v1/auth/qr/status?ticket=not-a-uuid')).status, 422)
    assert.equal((await call(ctx, 'GET', '/v1/auth/qr/status?ticket=00000000-0000-4000-8000-999999999999')).status, 404)
    assert.equal((await ticket(ctx, 'bad scan', phone.accessToken)).status, 422)
    assert.equal((await ticket(ctx, 'AAAAAAAAAAAAAAAAAAAAAAAA', phone.accessToken)).status, 404)
    assert.equal((await approve(ctx, 'AAAAAAAAAAAAAAAAAAAAAAAA', 42, phone.accessToken)).status, 422)
    const issued = await start(ctx)
    for (const code of [9, 100, 42.5, '42']) {
      const res = await call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan: issued.scanCode, code }, token: phone.accessToken })
      assert.equal(res.status, 422)
    }
    assert.equal(await status(ctx, issued.id), 'pending')
    const shortSecret = await call(ctx, 'POST', '/v1/auth/qr/start', { body: { ...LAPTOP, deviceSecret: 'short' } })
    assert.equal(shortSecret.status, 422)
  })

  it('лимиты: 20 билетов и 30 обменов с IP, 30 подтверждений на пользователя за 10 минут', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    for (let i = 0; i < 20; i += 1) await start(ctx)
    assert.equal((await call(ctx, 'POST', '/v1/auth/qr/start', { body: LAPTOP })).status, 429)
    // Другой IP считается отдельно.
    const otherIp = await call(ctx, 'POST', '/v1/auth/qr/start', { body: LAPTOP, headers: { 'x-real-ip': '10.0.0.2' } })
    assert.equal(otherIp.status, 200)

    for (let i = 0; i < 30; i += 1) {
      assert.equal((await complete(ctx, '00000000-0000-4000-8000-999999999999')).status, 422)
    }
    assert.equal((await complete(ctx, '00000000-0000-4000-8000-999999999999')).status, 429)

    for (let i = 0; i < 30; i += 1) {
      assert.equal((await approve(ctx, 'AAAAAAAAAAAAAAAAAAAAAAAA', 42, phone.accessToken)).status, 422)
    }
    assert.equal((await approve(ctx, 'AAAAAAAAAAAAAAAAAAAAAAAA', 42, phone.accessToken)).status, 429)
  })

  it('удалённый аккаунт: подтверждённый им билет не обменять', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)
    await call(ctx, 'DELETE', '/v1/me', { token: phone.accessToken })
    assert.equal((await complete(ctx, issued.id)).status, 422)
  })

  it('чистка убирает истёкшие билеты QR', async () => {
    const ctx = createTestContext()
    const issued = await start(ctx)
    later(ctx, 3 * 60_000 + 1)
    const removed = await ctx.repo.purgeExpired(ctx.clock.now)
    assert.equal(removed.tickets, 1)
    assert.equal(await ctx.repo.qrTicketById(issued.id), null)
  })
})

describe('права сессии ноутбука', () => {
  async function laptop(ctx: TestContext, phoneToken: string) {
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phoneToken)
    return (await complete(ctx, issued.id)).json.tokens.accessToken as string
  }

  it('ноутбук не может сам подтвердить новый вход: украденным токеном себя не размножить', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    const another = await start(ctx)
    const shown = await ticket(ctx, another.scanCode, token)
    assert.equal(shown.status, 403)
    assert.equal(shown.json.error.code, 'desktop_session')
    assert.equal((await approve(ctx, another.scanCode, Number(another.confirmationCode), token)).status, 403)
    assert.equal(await status(ctx, another.id), 'pending')
    assert.equal((await complete(ctx, another.id)).status, 422)
  })

  it('ноутбуку доступно только его имя, остальное отвечает 403', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const token = await laptop(ctx, phone.accessToken)

    assert.equal((await call(ctx, 'GET', '/v1/me', { token })).status, 200)
    const forbidden: [string, string, unknown?][] = [
      ['DELETE', '/v1/me'],
      ['GET', '/v1/me/sessions'],
      ['DELETE', '/v1/me/sessions/00000000-0000-4000-8000-000000000001'],
      ['POST', '/v1/me/gomafia', { login: 'host', password: 'secret' }],
      ['DELETE', '/v1/me/gomafia'],
      ['GET', '/v1/me/games'],
      ['POST', '/v1/games', {}],
      ['GET', '/v1/gomafia/players?q=abc'],
    ]
    for (const [method, path, body] of forbidden) {
      const res = await call(ctx, method, path, { token, ...(body === undefined ? {} : { body }) })
      assert.equal(res.status, 403, `${method} ${path}`)
      assert.equal(res.json.error.code, 'desktop_session', `${method} ${path}`)
    }
    assert.ok(ctx.repo.users.size > 0, 'аккаунт на месте')
  })

  it('телефона это не касается', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    await laptop(ctx, phone.accessToken)
    assert.equal((await call(ctx, 'GET', '/v1/me/sessions', { token: phone.accessToken })).status, 200)
    assert.equal((await call(ctx, 'GET', '/v1/me/games', { token: phone.accessToken })).status, 200)
  })

  it('выход и обновление токена работают и с ноутбука: для них токен доступа не нужен', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phone.accessToken)
    const tokens = (await complete(ctx, issued.id)).json.tokens
    const refreshed = await call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken: tokens.refreshToken } })
    assert.equal(refreshed.status, 200)
    assert.equal((await call(ctx, 'POST', '/v1/auth/logout', { body: { refreshToken: refreshed.json.refreshToken } })).status, 200)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: refreshed.json.accessToken })).status, 401)
  })

  it('опрос статуса ограничен, но обычному окну хватает с запасом', async () => {
    const ctx = createTestContext()
    const issued = await start(ctx)
    for (let index = 0; index < 600; index += 1) {
      assert.equal((await call(ctx, 'GET', `/v1/auth/qr/status?ticket=${issued.id}`)).status, 200)
    }
    assert.equal((await call(ctx, 'GET', `/v1/auth/qr/status?ticket=${issued.id}`)).status, 429)
  })
})

describe('поздний повтор токена обновления', () => {
  async function laptopSession(ctx: TestContext, phoneToken: string) {
    const issued = await start(ctx)
    await approve(ctx, issued.scanCode, Number(issued.confirmationCode), phoneToken)
    return (await complete(ctx, issued.id)).json.tokens as { accessToken: string; refreshToken: string }
  }

  const refresh = (ctx: TestContext, refreshToken: string) => call(ctx, 'POST', '/v1/auth/refresh', { body: { refreshToken } })

  it('повтор с ноутбука закрывает только его сессию: телефон посреди партии не выкидывает', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const laptop = await laptopSession(ctx, phone.accessToken)

    const rotated = await refresh(ctx, laptop.refreshToken)
    assert.equal(rotated.status, 200)
    later(ctx, 31_000)
    assert.equal((await refresh(ctx, laptop.refreshToken)).status, 401)

    assert.equal((await call(ctx, 'GET', '/v1/me', { token: phone.accessToken })).status, 200)
    assert.equal((await refresh(ctx, phone.refreshToken)).status, 200)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: rotated.json.accessToken })).status, 401)
    assert.equal((await refresh(ctx, rotated.json.refreshToken)).status, 401)
  })

  it('повтор с телефона по-прежнему закрывает все сессии, включая ноутбук', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const laptop = await laptopSession(ctx, phone.accessToken)

    assert.equal((await refresh(ctx, phone.refreshToken)).status, 200)
    later(ctx, 31_000)
    assert.equal((await refresh(ctx, phone.refreshToken)).status, 401)

    assert.equal((await call(ctx, 'GET', '/v1/me', { token: phone.accessToken })).status, 401)
    assert.equal((await call(ctx, 'GET', '/v1/me', { token: laptop.accessToken })).status, 401)
    assert.equal((await refresh(ctx, laptop.refreshToken)).status, 401)
  })

  it('свежий повтор с ноутбука в пределах 30 секунд сессию не трогает', async () => {
    const ctx = createTestContext()
    const phone = await signIn(ctx)
    const laptop = await laptopSession(ctx, phone.accessToken)

    const rotated = await refresh(ctx, laptop.refreshToken)
    later(ctx, 5_000)
    assert.equal((await refresh(ctx, laptop.refreshToken)).status, 401)
    assert.equal((await refresh(ctx, rotated.json.refreshToken)).status, 200)
  })
})
