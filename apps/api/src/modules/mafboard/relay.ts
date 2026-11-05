import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { z } from 'zod'
import { DESKTOP_PLATFORMS } from './config.js'
import { ipKey, type DepsResolver, type MafboardDeps } from './router.js'
import { verifyAccessToken } from './tokens.js'

// ─────────────────────────────────────────────────────────────────────────────
// Облачный канал пульта MafBoard Studio, когда телефон и ноутбук не в одной сети.
// Сервер только пересылает двоичные кадры между телефоном и ноутбуком одного ведущего:
// ключ шифрования есть только у них, и содержимое кадров здесь не читается и не пишется в журнал.
// Комнаты живут в памяти: экземпляр API один, при нескольких понадобится Redis.
// ─────────────────────────────────────────────────────────────────────────────

export const RELAY_PATH = '/api/mafboard/v1/studio/relay'

export const RELAY_MAX_FRAME_BYTES = 64 * 1024
const MAX_BUFFERED_BYTES = 1024 * 1024
const MAX_CONNECTIONS = 2000
const MAX_ROOMS_PER_USER = 8
const CONNECT_LIMIT = { count: 60, windowSec: 600 }
const CLOSE_GRACE_MS = 1_500

/** Коды закрытия соединения: клиент по ним решает, переподключаться ли. */
export const RelayClose = {
  badRequest: 4400,
  unauthorized: 4401,
  wrongRole: 4403,
  replaced: 4409,
  tooFast: 4429,
} as const

export interface RelayOptions {
  authTimeoutMs: number
  maxFramesPerSec: number
  /** Как часто проверять, что соединение живо и сессию не отозвали. */
  checkEveryMs: number
}

const DEFAULT_OPTIONS: RelayOptions = { authTimeoutMs: 5_000, maxFramesPerSec: 60, checkEveryMs: 25_000 }

type Role = 'desktop' | 'phone'

const authSchema = z.object({
  type: z.literal('auth'),
  token: z.string().min(1).max(4096),
  studioId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  role: z.enum(['desktop', 'phone']),
})

interface Member {
  socket: WebSocket
  userId: string
  sessionId: string
  studioId: string
  role: Role
  windowStartedAt: number
  framesInWindow: number
  alive: boolean
}

type Room = Partial<Record<Role, Member>>

function reject(socket: Duplex, status: 404 | 429 | 503): void {
  const reason = { 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' }[status]
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** Адрес клиента за nginx, тем же способом, что и lib/clientIp.ts для обычных запросов. */
function requestIp(request: IncomingMessage): string {
  const realIp = request.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp) return realIp
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',').pop()?.trim() || 'unknown'
  return request.socket.remoteAddress ?? 'unknown'
}

const peerOf = (role: Role): Role => (role === 'desktop' ? 'phone' : 'desktop')
const roomKey = (userId: string, studioId: string) => `${userId}:${studioId}`

export class StudioRelay {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_FRAME_BYTES, perMessageDeflate: false })
  private readonly rooms = new Map<string, Room>()
  private readonly members = new Set<Member>()
  private readonly timer: NodeJS.Timeout
  private readonly options: RelayOptions
  private checking = false

  constructor(private readonly resolveDeps: DepsResolver, options: Partial<RelayOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.timer = setInterval(() => void this.checkMembers(), this.options.checkEveryMs)
    this.timer.unref()
  }

  async accept(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const deps = this.resolveDeps()
    if ('error' in deps) return reject(socket, 503)
    if (this.server.clients.size >= MAX_CONNECTIONS) return reject(socket, 503)
    const allowed = await deps.limiter.hit(`mb:relay:${ipKey(requestIp(request))}`, CONNECT_LIMIT.count, CONNECT_LIMIT.windowSec)
    if (!allowed) return reject(socket, 429)
    this.server.handleUpgrade(request, socket, head, (ws) => this.awaitAuth(ws, deps))
  }

  /** Токен приходит первым сообщением, а не в адресе: адреса попадают в журналы nginx. */
  private awaitAuth(socket: WebSocket, deps: MafboardDeps): void {
    socket.on('error', () => socket.terminate())
    const timer = setTimeout(() => socket.close(RelayClose.unauthorized, 'auth timeout'), this.options.authTimeoutMs)
    socket.once('close', () => clearTimeout(timer))
    socket.once('message', (data, isBinary) => {
      clearTimeout(timer)
      // До ответа клиент обязан ждать: кадры, пришедшие раньше времени, — нарушение протокола.
      const early = () => socket.close(RelayClose.badRequest, 'wait for ready')
      socket.on('message', early)
      void this.authenticate(socket, deps, data, isBinary)
        .then((member) => {
          socket.off('message', early)
          if (member) this.join(member)
        })
        .catch((error: unknown) => {
          console.error('[mafboard] релей: ошибка входа', error instanceof Error ? error.message : 'неизвестная ошибка')
          socket.close(1011, 'internal error')
        })
    })
  }

  private async authenticate(socket: WebSocket, deps: MafboardDeps, data: RawData, isBinary: boolean): Promise<Member | null> {
    const refuse = (code: number, reason: string) => {
      socket.close(code, reason)
      return null
    }
    if (isBinary) return refuse(RelayClose.badRequest, 'auth first')
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText(data))
    } catch {
      return refuse(RelayClose.badRequest, 'bad json')
    }
    const auth = authSchema.safeParse(parsed)
    if (!auth.success) return refuse(RelayClose.badRequest, 'bad auth')

    const claims = await verifyAccessToken(auth.data.token, deps.config)
    const session = claims ? await deps.repo.sessionById(claims.sessionId) : null
    const user = session && !session.revokedAt && session.userId === claims?.userId ? await deps.repo.userById(session.userId) : null
    if (!session || !user) return refuse(RelayClose.unauthorized, 'session')

    // Роль следует из сессии: телефон не войдёт вместо ноутбука, даже зная номер студии.
    const isDesktop = session.platform != null && DESKTOP_PLATFORMS.has(session.platform)
    if (isDesktop !== (auth.data.role === 'desktop')) return refuse(RelayClose.wrongRole, 'role')
    if (socket.readyState !== WebSocket.OPEN) return null

    const key = roomKey(user.id, auth.data.studioId)
    if (!this.rooms.has(key) && this.roomsOf(user.id) >= MAX_ROOMS_PER_USER) return refuse(RelayClose.tooFast, 'too many studios')

    return {
      socket,
      userId: user.id,
      sessionId: session.id,
      studioId: auth.data.studioId,
      role: auth.data.role,
      windowStartedAt: deps.now().getTime(),
      framesInWindow: 0,
      alive: true,
    }
  }

  private roomsOf(userId: string): number {
    let count = 0
    for (const key of this.rooms.keys()) if (key.startsWith(`${userId}:`)) count += 1
    return count
  }

  private join(member: Member): void {
    const key = roomKey(member.userId, member.studioId)
    const room = this.rooms.get(key) ?? {}
    this.rooms.set(key, room)

    // Одно соединение на роль: новое заменяет старое, например после смены сети.
    const previous = room[member.role]
    if (previous) {
      this.members.delete(previous)
      room[member.role] = undefined
      previous.socket.close(RelayClose.replaced, 'replaced')
    }
    room[member.role] = member
    this.members.add(member)

    const peer = room[peerOf(member.role)]
    send(member.socket, { type: 'ready', peerOnline: Boolean(peer) })
    if (peer && !previous) send(peer.socket, { type: 'peer', online: true })

    member.socket.on('pong', () => {
      member.alive = true
    })
    member.socket.on('message', (data, isBinary) => this.forward(member, room, data, isBinary))
    member.socket.on('close', () => this.leave(member, key))
  }

  private forward(member: Member, room: Room, data: RawData, isBinary: boolean): void {
    if (!isBinary) {
      member.socket.close(RelayClose.badRequest, 'binary only')
      return
    }
    const now = Date.now()
    if (now - member.windowStartedAt >= 1000) {
      member.windowStartedAt = now
      member.framesInWindow = 0
    }
    member.framesInWindow += 1
    if (member.framesInWindow > this.options.maxFramesPerSec) {
      member.socket.close(RelayClose.tooFast, 'too many frames')
      return
    }
    const peer = room[peerOf(member.role)]
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) return
    // Отставший получатель теряет кадр. Счётчик кадров допускает пропуски, а копить очередь на сервере нельзя.
    if (peer.socket.bufferedAmount > MAX_BUFFERED_BYTES) return
    peer.socket.send(data, { binary: true })
  }

  private leave(member: Member, key: string): void {
    this.members.delete(member)
    const room = this.rooms.get(key)
    if (!room || room[member.role] !== member) return
    room[member.role] = undefined
    const peer = room[peerOf(member.role)]
    if (peer) send(peer.socket, { type: 'peer', online: false })
    else this.rooms.delete(key)
  }

  /** Живы ли соединения и не отозвали ли сессию с другого устройства. */
  private async checkMembers(): Promise<void> {
    // Проходы не накладываются: при большом числе соединений один проход может идти дольше интервала.
    if (this.checking) return
    this.checking = true
    try {
      const deps = this.resolveDeps()
      for (const member of [...this.members]) {
        if (!member.alive) {
          member.socket.terminate()
          continue
        }
        member.alive = false
        member.socket.ping()
        if ('error' in deps) continue
        const session = await deps.repo.sessionById(member.sessionId).catch(() => undefined)
        // undefined — база недоступна: это не повод рвать соединение.
        if (session === null || session?.revokedAt) member.socket.close(RelayClose.unauthorized, 'session')
      }
    } catch (error) {
      console.error('[mafboard] релей: проверка соединений', error instanceof Error ? error.message : 'неизвестная ошибка')
    } finally {
      this.checking = false
    }
  }

  /** При остановке сервера: клиент, не ответивший на закрытие, не задержит её. */
  close(): void {
    clearInterval(this.timer)
    for (const client of this.server.clients) client.close(1001, 'server stopping')
    this.server.close()
    setTimeout(() => {
      for (const client of this.server.clients) client.terminate()
    }, CLOSE_GRACE_MS).unref()
  }
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data as ArrayBuffer).toString('utf8')
}

function send(socket: WebSocket, message: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/** Путь запроса. Адрес приходит от клиента и может быть любым: разбор без исключений. */
function requestPath(request: IncomingMessage): string | null {
  try {
    return new URL(request.url ?? '/', 'http://relay').pathname
  } catch {
    return null
  }
}

export function attachStudioRelay(server: Server, resolveDeps: DepsResolver, options: Partial<RelayOptions> = {}): StudioRelay {
  const relay = new StudioRelay(resolveDeps, options)
  server.on('upgrade', (request, socket, head) => {
    // Node снимает свой обработчик ошибок сокета перед этим событием. Без своего любой обрыв соединения
    // стал бы необработанной ошибкой и уронил весь API, причём запрос может прийти на любой путь.
    socket.on('error', () => socket.destroy())
    if (requestPath(request) !== RELAY_PATH) {
      socket.destroy()
      return
    }
    relay.accept(request, socket, head).catch((error: unknown) => {
      console.error('[mafboard] релей: соединение не принято', error instanceof Error ? error.message : 'неизвестная ошибка')
      reject(socket, 503)
    })
  })
  return relay
}
