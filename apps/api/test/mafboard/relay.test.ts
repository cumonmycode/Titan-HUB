import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { connect as connectTcp, type AddressInfo } from 'node:net'
import { afterEach, describe, it } from 'node:test'
import { WebSocket } from 'ws'
import { attachStudioRelay, RELAY_MAX_FRAME_BYTES, RELAY_PATH, RelayClose, type RelayOptions, type StudioRelay } from '../../src/modules/mafboard/relay.js'
import { call, createTestContext, signIn, type TestContext } from './helpers.js'

const STUDIO = 'studio-0001'
const OTHER_USER = { id: 2002, is_bot: false, first_name: 'Лис', username: 'fox' }

interface Fixture {
  ctx: TestContext
  server: Server
  relay: StudioRelay
  url: string
}

const opened: Fixture[] = []

afterEach(async () => {
  for (const fixture of opened.splice(0)) {
    fixture.relay.close()
    await new Promise((resolve) => fixture.server.close(resolve))
  }
})

/** Настоящий HTTP-сервер и настоящий WebSocket: релей подключён так же, как в index.ts. */
async function fixture(options: Partial<RelayOptions> = {}): Promise<Fixture> {
  const ctx = createTestContext({ now: () => new Date(), limiter: { hit: async () => true } })
  const server = createServer((_request, response) => response.writeHead(404).end())
  const relay = attachStudioRelay(server, () => ctx.deps, options)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const result = { ctx, server, relay, url: `ws://127.0.0.1:${port}${RELAY_PATH}` }
  opened.push(result)
  return result
}

/** Ноутбук входит только по QR: его сессия с настольной платформой. */
async function desktopToken(ctx: TestContext, phoneToken: string): Promise<string> {
  const start = await call(ctx, 'POST', '/v1/auth/qr/start', {
    body: { deviceName: 'MacBook', platform: 'macos', deviceSecret: 'laptop-secret-0123456789abcdefghijklmnopqrstuv' },
  })
  await call(ctx, 'POST', '/v1/auth/qr/approve', { body: { scan: start.json.scanCode, code: Number(start.json.confirmationCode) }, token: phoneToken })
  const complete = await call(ctx, 'POST', '/v1/auth/qr/complete', {
    body: { ticket: start.json.id, deviceSecret: 'laptop-secret-0123456789abcdefghijklmnopqrstuv' },
  })
  return complete.json.tokens.accessToken
}

interface Client {
  socket: WebSocket
  texts: Record<string, unknown>[]
  binaries: Buffer[]
  closed: Promise<number>
}

function connect(url: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const client: Client = {
      socket,
      texts: [],
      binaries: [],
      closed: new Promise((done) => socket.once('close', (code) => done(code))),
    }
    socket.on('message', (data, isBinary) => {
      if (isBinary) client.binaries.push(data as Buffer)
      else client.texts.push(JSON.parse(String(data)) as Record<string, unknown>)
    })
    socket.once('open', () => resolve(client))
    socket.once('error', reject)
  })
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`не дождались: ${what}`)
}

async function join(url: string, token: string, role: 'desktop' | 'phone', studioId = STUDIO): Promise<Client> {
  const client = await connect(url)
  client.socket.send(JSON.stringify({ type: 'auth', token, studioId, role }))
  await until(() => client.texts.some((text) => text['type'] === 'ready'), `вход ${role}`)
  return client
}

async function pair(context: Fixture) {
  const phone = await signIn(context.ctx)
  const desktop = await desktopToken(context.ctx, phone.accessToken)
  return { phone, desktop }
}

describe('релей пульта', () => {
  it('пересылает двоичные кадры без изменений в обе стороны', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')

    const fromPhone = Buffer.from([1, 2, 3, 0, 255, 4])
    phone.socket.send(fromPhone)
    await until(() => laptop.binaries.length === 1, 'кадр на ноутбуке')
    assert.deepEqual(laptop.binaries[0], fromPhone)

    const fromLaptop = Buffer.alloc(1000, 7)
    laptop.socket.send(fromLaptop)
    await until(() => phone.binaries.length === 1, 'кадр на телефоне')
    assert.deepEqual(phone.binaries[0], fromLaptop)
  })

  it('сообщает о появлении и пропаже второй стороны', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    assert.deepEqual(laptop.texts[0], { type: 'ready', peerOnline: false })

    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    assert.deepEqual(phone.texts[0], { type: 'ready', peerOnline: true })
    await until(() => laptop.texts.some((t) => t['type'] === 'peer' && t['online'] === true), 'телефон появился')

    phone.socket.close()
    await until(() => laptop.texts.some((t) => t['type'] === 'peer' && t['online'] === false), 'телефон пропал')
  })

  it('кадр без второй стороны просто теряется, соединение живёт', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    laptop.socket.send(Buffer.from([1]))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(laptop.socket.readyState, WebSocket.OPEN)
  })

  it('разные ведущие не видят кадры друг друга, даже с одним номером студии', async () => {
    const context = await fixture()
    const first = await pair(context)
    const secondPhone = await signIn(context.ctx, OTHER_USER)
    const laptop = await join(context.url, first.desktop, 'desktop')
    const stranger = await join(context.url, secondPhone.accessToken, 'phone')
    assert.deepEqual(stranger.texts[0], { type: 'ready', peerOnline: false })

    stranger.socket.send(Buffer.from([9, 9, 9]))
    laptop.socket.send(Buffer.from([8, 8, 8]))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(laptop.binaries.length, 0)
    assert.equal(stranger.binaries.length, 0)
  })

  it('разные студии одного ведущего — разные комнаты', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop', 'studio-0001')
    const phone = await join(context.url, tokens.phone.accessToken, 'phone', 'studio-0002')
    phone.socket.send(Buffer.from([1]))
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(laptop.binaries.length, 0)
  })

  it('без верного токена не войти', async () => {
    const context = await fixture()
    const client = await connect(context.url)
    client.socket.send(JSON.stringify({ type: 'auth', token: 'not-a-token', studioId: STUDIO, role: 'phone' }))
    assert.equal(await client.closed, RelayClose.unauthorized)
  })

  it('токен в адресе ничего не даёт: только первым сообщением', async () => {
    const context = await fixture({ authTimeoutMs: 30 })
    const tokens = await pair(context)
    const client = await connect(`${context.url}?token=${tokens.phone.accessToken}`)
    assert.equal(await client.closed, RelayClose.unauthorized)
    assert.equal(client.texts.length, 0)
  })

  it('молчащий клиент закрывается по таймауту', async () => {
    const context = await fixture({ authTimeoutMs: 20 })
    const client = await connect(context.url)
    assert.equal(await client.closed, RelayClose.unauthorized)
  })

  it('неверные первые сообщения закрывают соединение', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const samples: (string | Buffer)[] = [
      Buffer.from([1, 2, 3]),
      'not json',
      JSON.stringify({ type: 'hello' }),
      JSON.stringify({ type: 'auth', token: tokens.phone.accessToken, studioId: 'x', role: 'phone' }),
      JSON.stringify({ type: 'auth', token: tokens.phone.accessToken, studioId: '../../etc/passwd', role: 'phone' }),
      JSON.stringify({ type: 'auth', token: tokens.phone.accessToken, studioId: STUDIO, role: 'admin' }),
    ]
    for (const sample of samples) {
      const client = await connect(context.url)
      client.socket.send(sample)
      assert.equal(await client.closed, RelayClose.badRequest, String(sample).slice(0, 40))
    }
  })

  it('телефон не войдёт как ноутбук, а ноутбук как телефон', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const fakeDesktop = await connect(context.url)
    fakeDesktop.socket.send(JSON.stringify({ type: 'auth', token: tokens.phone.accessToken, studioId: STUDIO, role: 'desktop' }))
    assert.equal(await fakeDesktop.closed, RelayClose.wrongRole)

    const fakePhone = await connect(context.url)
    fakePhone.socket.send(JSON.stringify({ type: 'auth', token: tokens.desktop, studioId: STUDIO, role: 'phone' }))
    assert.equal(await fakePhone.closed, RelayClose.wrongRole)
  })

  it('отозванная сессия не входит', async () => {
    const context = await fixture()
    const phone = await signIn(context.ctx)
    await call(context.ctx, 'POST', '/v1/auth/logout', { body: { refreshToken: phone.refreshToken } })
    const client = await connect(context.url)
    client.socket.send(JSON.stringify({ type: 'auth', token: phone.accessToken, studioId: STUDIO, role: 'phone' }))
    assert.equal(await client.closed, RelayClose.unauthorized)
  })

  it('сессию отозвали на ходу: соединение закрывается при проверке', async () => {
    const context = await fixture({ checkEveryMs: 15 })
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    await call(context.ctx, 'POST', '/v1/auth/logout', { body: { refreshToken: tokens.phone.refreshToken } })
    assert.equal(await phone.closed, RelayClose.unauthorized)
    assert.equal(laptop.socket.readyState, WebSocket.OPEN)
  })

  it('новое соединение той же роли заменяет старое, вторая сторона не видит обрыва', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    const firstPhone = await join(context.url, tokens.phone.accessToken, 'phone')
    await until(() => laptop.texts.some((t) => t['type'] === 'peer' && t['online'] === true), 'телефон появился')
    const peerNotices = () => laptop.texts.filter((t) => t['type'] === 'peer').length

    const before = peerNotices()
    const secondPhone = await join(context.url, tokens.phone.accessToken, 'phone')
    assert.equal(await firstPhone.closed, RelayClose.replaced)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(peerNotices(), before)

    secondPhone.socket.send(Buffer.from([5]))
    await until(() => laptop.binaries.length === 1, 'кадр нового телефона')
  })

  it('кадр больше 64 КБ закрывает соединение', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    phone.socket.send(Buffer.alloc(RELAY_MAX_FRAME_BYTES + 1))
    assert.equal(await phone.closed, 1009)
  })

  it('кадр ровно 64 КБ проходит', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const laptop = await join(context.url, tokens.desktop, 'desktop')
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    phone.socket.send(Buffer.alloc(RELAY_MAX_FRAME_BYTES))
    await until(() => laptop.binaries.length === 1, 'большой кадр')
  })

  it('слишком частые кадры закрывают соединение', async () => {
    const context = await fixture({ maxFramesPerSec: 5 })
    const tokens = await pair(context)
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    for (let index = 0; index < 20; index += 1) phone.socket.send(Buffer.from([index]))
    assert.equal(await phone.closed, RelayClose.tooFast)
  })

  it('текст после входа запрещён: только двоичные кадры', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    phone.socket.send('hello')
    assert.equal(await phone.closed, RelayClose.badRequest)
  })

  it('кадры до ответа сервера — нарушение протокола', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const client = await connect(context.url)
    client.socket.send(JSON.stringify({ type: 'auth', token: tokens.phone.accessToken, studioId: STUDIO, role: 'phone' }))
    client.socket.send(Buffer.from([1]))
    const code = await Promise.race([client.closed, new Promise<number>((resolve) => setTimeout(() => resolve(-1), 100))])
    // Если вход успел завершиться раньше кадра, кадр просто теряется. Пересылки в обоих случаях нет.
    assert.ok(code === RelayClose.badRequest || code === -1, String(code))
  })

  it('чужой адрес WebSocket отклоняется', async () => {
    const context = await fixture()
    const wrong = context.url.replace(RELAY_PATH, '/api/other')
    await assert.rejects(connect(wrong))
  })

  it('оборванное соединение и странный адрес не роняют процесс', async () => {
    const context = await fixture()
    const { port } = context.server.address() as AddressInfo
    const upgrade = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`
    // Необработанная ошибка сокета завершила бы процесс теста целиком.
    for (const path of ['/api/other', RELAY_PATH, '//[', '/%%%']) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise<void>((resolve) => {
          const socket = connectTcp(port, '127.0.0.1', () => {
            socket.write(upgrade(path), () => {
              socket.resetAndDestroy()
              resolve()
            })
          })
          socket.on('error', () => resolve())
        })
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30))

    const tokens = await pair(context)
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    assert.equal(phone.socket.readyState, WebSocket.OPEN, 'сервер продолжает работать')
  })

  it('модуль не настроен: 503', async () => {
    const server = createServer()
    const relay = attachStudioRelay(server, () => ({ error: 'нет базы' }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    await assert.rejects(connect(`ws://127.0.0.1:${port}${RELAY_PATH}`), /503/)
    relay.close()
    await new Promise((resolve) => server.close(resolve))
  })

  it('лимит подключений с одного адреса', async () => {
    const context = await fixture()
    let hits = 0
    context.ctx.deps.limiter = { hit: async () => (hits += 1) <= 2 }
    await connect(context.url)
    await connect(context.url)
    await assert.rejects(connect(context.url), /429/)
  })

  it('при остановке сервера соединения закрываются', async () => {
    const context = await fixture()
    const tokens = await pair(context)
    const phone = await join(context.url, tokens.phone.accessToken, 'phone')
    context.relay.close()
    assert.equal(await phone.closed, 1001)
  })

  it('в журнал не попадают ни токены, ни содержимое кадров', async () => {
    const lines: string[] = []
    const original = { log: console.log, error: console.error, warn: console.warn }
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
    console.log = capture
    console.error = capture
    console.warn = capture
    try {
      const context = await fixture()
      const tokens = await pair(context)
      const laptop = await join(context.url, tokens.desktop, 'desktop')
      const phone = await join(context.url, tokens.phone.accessToken, 'phone')
      phone.socket.send(Buffer.from('секретное-содержимое'))
      await until(() => laptop.binaries.length === 1, 'кадр')
      assert.ok(!lines.some((line) => line.includes('секретное') || line.includes(tokens.desktop)), lines.join('\n'))
    } finally {
      Object.assign(console, original)
    }
  })
})
