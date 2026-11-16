import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { clientIp } from '../../lib/clientIp.js'
import type { TgUpdate } from '../tg/types.js'
import { handleBotUpdate, type BotMessenger } from './bot.js'
import {
  DESKTOP_PLATFORMS, GOMAFIA_RESYNC_AFTER_MS, LOGIN_TICKET_TTL_MIN, QR_TICKET_TTL_MIN, REFRESH_TOKEN_TTL_DAYS, REVIEW_LOGIN, REVIEW_TG_ID, type MafboardConfig,
} from './config.js'
import { validateGameUpload } from './games.js'
import { MIN_QUERY_LENGTH, rankForHost, refreshLink, resolveLink, searchForHost, type GoMafiaGateway, type RosterCache } from './gomafia.js'
import type { ClubHub } from './hub.js'
import type { TitanConnectGateway, TitanRosterCache } from './titan.js'
import { registerTitanRoutes } from './titanRoutes.js'
import { GomafiaTakenError, type MafboardRepo } from './repo.js'
import type { AimAccounts, TournamentSource } from './aim.js'
import { registerTournamentRoutes } from './tournaments.js'
import { registerShareRoutes } from './shares.js'
import { errorBody, toAccountJSON, toPlayerJSON, toQrStatusJSON, toQrTicketJSON, toSessionsJSON, toTicketStatusJSON } from './serialize.js'
import {
  issueAccessToken, newConfirmCode, newDeepCode, newRefreshToken, passwordMatches, qrChoiceCodes, sha256, verifyAccessToken, webhookSecretValid,
} from './tokens.js'
import { openSecrets, sealSecrets, STUDIO_BODY_LIMIT_BYTES, STUDIO_SAVES_PER_HOUR, STUDIO_SECRETS_LIMIT_BYTES, studioPutSchema } from './studio.js'
import type { MafboardUser, StoredStudioSettings } from './types.js'
import { authorizeUrl, callbackPage, VkError, VkLogins, type VkGateway, type VkTokens } from './vk.js'

// ─────────────────────────────────────────────────────────────────────────────
// API приложения MafBoard (/api/mafboard). Контракт — docs/MAFBOARD.md; клиент —
// MafBoardClient в ios/ репозитория MafBoardStudio (Swift). Зависимости приходят снаружи (index.ts):
// в проде Postgres/Redis/Telegram/GoMafia, в тестах — заглушки.
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimiter {
  /**
   * true — запрос в пределах лимита. `failClosed` — при недоступном хранилище лимитов
   * отказать (для подбора паролей), иначе пропустить.
   */
  hit(key: string, limit: number, windowSec: number, options?: { failClosed?: boolean }): Promise<boolean>
}

export interface MafboardDeps {
  repo: MafboardRepo
  config: MafboardConfig
  gomafia: GoMafiaGateway
  roster: RosterCache
  /** Titan HUB клубов, где он есть: его клиенты идут в подборе первыми. */
  hub: ClubHub
  /** Titan Connect: обмен кода из HUB и клиенты подключённого клуба (titan.ts). */
  titan: TitanConnectGateway
  titanRoster: TitanRosterCache
  /** null — бот не настроен (нет MAFBOARD_BOT_TOKEN). */
  messenger: BotMessenger | null
  limiter: RateLimiter
  /** Обмен кода и токенов VK Видео Live с секретом приложения (vk.ts). */
  vk: VkGateway
  /** Вход в АИМ (admin.gomafia.pro) для турниров GoMafia: хранение пароля и сессии (aim.ts). */
  aimAccounts: AimAccounts
  /** Публичная рассадка турниров с gomafia.pro. */
  tournaments: TournamentSource
  /** Telegram повторяет доставку — true только при первой встрече ключа. */
  firstDelivery(key: string, ttlSec: number): Promise<boolean>
  now(): Date
  /** Фоновая задача (апдейт бота, обновление профиля GoMafia). */
  background(key: string, job: () => Promise<void>): void
}

export type DepsResolver = () => MafboardDeps | { error: string }

export type MafboardEnv = { Variables: { deps: MafboardDeps; user: MafboardUser; sessionId: string } }
export type Env = MafboardEnv

const GAMES_PAGE_LIMIT = 50
/** Запись одной игры с журналом — десятки килобайт; 256 КБ — с большим запасом. */
const GAME_BODY_LIMIT_BYTES = 256 * 1024
const GAMES_PER_DAY = 100
/** Снимок идущей игры уходит после каждого хода (с паузой) — запас на долгий вечер. */
const ACTIVE_SAVES_PER_HOUR = 1200
const ACTIVE_GAMES_LIMIT = 5
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const START_LIMIT = { count: 20, windowSec: 600 }
const COMPLETE_LIMIT = { count: 30, windowSec: 600 }
const QR_APPROVE_LIMIT = { count: 30, windowSec: 600 }
/** MBS спрашивает раз в 2 секунды, это 300 запросов за 10 минут. С запасом на два окна за одним адресом. */
const QR_STATUS_LIMIT = { count: 600, windowSec: 600 }
const REVIEW_LIMIT = { count: 10, windowSec: 600 }
const LINK_LIMIT = { count: 5, windowSec: 600 }
/** На один логин GoMafia и на один IP — против подбора чужого пароля через наш сервер. */
const LINK_TARGET_LIMIT = { count: 5, windowSec: 3600 }
const LINK_IP_LIMIT = { count: 20, windowSec: 3600 }
const SEARCH_LIMIT_PER_MIN = 60
const UPDATE_DEDUP_TTL_SEC = 3600
/** Повтор того же refresh в течение 30 с — сетевой повтор, а не кража: не отзываем все сессии. */
const REFRESH_REUSE_GRACE_MS = 30_000
/** Членство в клубе без подтверждения дольше недели не даёт прав клуба. */
const CLUB_TRUST_MAX_MS = 7 * 24 * 60 * 60_000
const GOMAFIA_INLINE_TIMEOUT_MS = 8_000
const SESSIONS_LIMIT = 50
/** «Последняя активность» сессии пишется не чаще раза в 5 минут — не на каждый запрос. */
const SESSION_TOUCH_EVERY_MS = 5 * 60_000

/** Ключ лимита по IP: для IPv6 — подсеть /64 (адресов в ней у одного клиента сколько угодно). */
/**
 * Что можно ноутбуку (MafBoard Studio): своё имя и свои настройки студии. Остальное — только с
 * телефона: ноутбук в клубе защищён слабее, и украденным токеном не должно быть видно ни игр,
 * ни сессий, ни GoMafia.
 */
function desktopAllowed(method: string, path: string): boolean {
  if (method === 'GET' && path.endsWith('/v1/me')) return true
  // Вход MBS в VK Видео Live: секрет приложения есть только у сервера.
  if (path.includes('/v1/studio/vk/')) return true
  return (method === 'GET' || method === 'PUT') && path.endsWith('/v1/studio/settings')
}

export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const value = (ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '').toLowerCase()
  const mappedV4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedV4?.[1]) return mappedV4[1]
  // Разворачиваем «::», чтобы разные записи одного адреса давали одну подсеть.
  const [head = '', tail] = value.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  const prefix = groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16))
  return `${prefix.join(':')}::/64`
}

/** Имя устройства для сообщения бота: только буквы, цифры и простая пунктуация — без ссылок и управляющих символов. */
export function sanitizeDeviceName(raw: string): string {
  const clean = raw.replace(/[^\p{L}\p{N} _'’()-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return clean || 'Устройство'
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

export const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503, code: string, message: string) =>
  c.json(errorBody(code, message), status)

/** zod с ответом в формате приложения (а не сырым результатом zod). */
export function body<T extends z.ZodTypeAny>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json(errorBody('validation', 'Некорректные данные запроса'), 422)
  })
}

const deviceSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/)
const vkTokenSchema = z.object({ token: z.string().min(8).max(4096) })
/** Входов в VK в час на ведущего: каждая попытка держит место в памяти сервера 10 минут. */
const VK_BEGINS_PER_HOUR = 20
const startSchema = z.object({
  deviceName: z.string().max(200).transform(sanitizeDeviceName),
  platform: z.enum(['ios', 'android']),
  deviceSecret: deviceSecretSchema,
})
const completeSchema = z.object({ ticket: z.string().uuid(), deviceSecret: z.string().min(32).max(128) })
const qrStartSchema = z.object({
  deviceName: z.string().max(200).transform(sanitizeDeviceName),
  platform: z.enum(['macos', 'windows']),
  deviceSecret: deviceSecretSchema,
})
const scanCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/)
const qrApproveSchema = z.object({ scan: scanCodeSchema, code: z.number().int().min(10).max(99) })
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(128) })
const reviewSchema = z.object({
  login: z.string().trim().max(100),
  password: z.string().max(200),
  deviceName: z.string().max(200).transform(sanitizeDeviceName),
  platform: z.enum(['ios', 'android']),
})
const linkSchema = z.object({ login: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) })
/** Снимок идущей игры: журнал движка и игроки. Проверяем только то, на что опирается сервер. */
const activeGameSchema = z.object({
  revision: z.number().int().min(0).max(10_000_000),
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Некорректная дата'),
  snapshot: z
    .object({
      session: z
        .object({
          setup: z
            .object({
              gameID: z.string().uuid(),
              host: z.object({ userID: z.string().uuid() }).passthrough(),
            })
            .passthrough(),
          log: z.array(z.unknown()).max(5000),
        })
        .passthrough(),
      players: z.array(z.unknown()).max(40),
    })
    .passthrough(),
})

function parseSince(value: string | undefined): Date | null | 'invalid' {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'invalid' : date
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60_000)
}

/**
 * Пользователь со свежим членством в клубе: если профиль GoMafia старше суток —
 * обновляем сразу (до 8 с). Не удалось, а подтверждение старше недели — права клуба снимаются.
 */
async function withFreshClub(deps: MafboardDeps, user: MafboardUser): Promise<MafboardUser> {
  const link = user.gomafia
  if (!link) return user
  const age = deps.now().getTime() - link.syncedAt.getTime()
  if (age <= GOMAFIA_RESYNC_AFTER_MS) return user

  const fresh = await withTimeout(refreshLink(deps.gomafia, link).catch(() => null), GOMAFIA_INLINE_TIMEOUT_MS)
  if (fresh) return (await deps.repo.setGomafiaLink(user.id, fresh, deps.now())) ?? user
  return age > CLUB_TRUST_MAX_MS ? { ...user, gomafia: { ...link, club: null } } : user
}

/** Вход на устройстве: новая сессия и первая пара токенов. */
async function issueSession(deps: MafboardDeps, user: MafboardUser, device: { name: string; platform: string }) {
  const now = deps.now()
  const refreshToken = newRefreshToken()
  const session = await deps.repo.createSession({
    userId: user.id,
    deviceName: device.name,
    platform: device.platform,
    refreshTokenHash: sha256(refreshToken),
    at: now,
    expiresAt: addDays(now, REFRESH_TOKEN_TTL_DAYS),
  })
  const access = await issueAccessToken({ userId: user.id, sessionId: session.id }, deps.config, now)
  return { accessToken: access.token, refreshToken, accessExpiresAt: access.expiresAt.toISOString() }
}

export function createMafboardRouter(resolveDeps: DepsResolver): Hono<Env> {
  const router = new Hono<Env>()
  const vkLogins = new VkLogins()

  // Модуль выключен (нет БД/секрета) — 503, остальной API работает.
  router.use('*', async (c, next) => {
    const deps = resolveDeps()
    if ('error' in deps) {
      console.warn('[mafboard] модуль не настроен:', deps.error)
      return fail(c, 503, 'not_configured', 'Сервер MafBoard не настроен')
    }
    c.set('deps', deps)
    await next()
  })

  /** Действующий access-токен живой сессии: отзыв сессии с другого устройства действует сразу. */
  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const deps = c.get('deps')
    const header = c.req.header('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const claims = token ? await verifyAccessToken(token, deps.config) : null
    const session = claims ? await deps.repo.sessionById(claims.sessionId) : null
    const live = session && !session.revokedAt && session.userId === claims?.userId
    const user = live ? await deps.repo.userById(session.userId) : null
    if (!session || !user) return fail(c, 401, 'unauthorized', 'Сессия истекла — войдите снова')
    // Ноутбук в клубе защищён слабее телефона, а MafBoard Studio нужно только имя ведущего.
    // Запрет по умолчанию: новая ручка тоже недоступна с ноутбука, пока её не разрешат здесь.
    const isDesktop = session.platform != null && DESKTOP_PLATFORMS.has(session.platform)
    if (isDesktop && !desktopAllowed(c.req.method, c.req.path)) {
      return fail(c, 403, 'desktop_session', 'Это действие доступно только с телефона')
    }

    const now = deps.now()
    if (now.getTime() - session.lastUsedAt.getTime() > SESSION_TOUCH_EVERY_MS) await deps.repo.touchSession(session.id, now)
    c.set('user', user)
    c.set('sessionId', session.id)
    await next()
  }

  // ─── Бот: приёмник вебхука ──────────────────────────────────────────────────

  /** Вебхук бота MafBoard. Защита — secret_token Telegram; отвечаем 200 сразу, обработка — в фоне. */
  router.post('/tg-webhook', async (c) => {
    const deps = c.get('deps')
    if (!webhookSecretValid(c.req.header('x-telegram-bot-api-secret-token'), deps.config)) {
      return c.json({ ok: false }, 403)
    }
    const update = (await c.req.json().catch(() => null)) as TgUpdate | null
    const messenger = deps.messenger
    if (!messenger || !update || typeof update.update_id !== 'number') return c.json({ ok: true })
    if (!(await deps.firstDelivery(`mb:upd:${update.update_id}`, UPDATE_DEDUP_TTL_SEC))) return c.json({ ok: true })

    const chat = update.message?.chat.id ?? update.callback_query?.from.id ?? 'other'
    deps.background(`mb:chat:${chat}`, () =>
      handleBotUpdate(update, { repo: deps.repo, messenger, config: deps.config, now: () => deps.now() }),
    )
    return c.json({ ok: true })
  })

  // ─── Вход через Telegram ────────────────────────────────────────────────────

  /**
   * Начать вход: билет на 10 минут, ссылка на бота и код сверки, который приложение
   * показывает пользователю (в боте нужно нажать тот же). Секрет устройства хранится только хэшем.
   */
  router.post('/v1/auth/telegram/start', body(startSchema), async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:start:${ipKey(clientIp(c))}`, START_LIMIT.count, START_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток входа, подождите немного')
    }
    const botUsername = deps.config.botUsername ?? (await deps.messenger?.username()) ?? null
    if (!botUsername) return fail(c, 503, 'bot_unavailable', 'Бот входа временно недоступен')

    const input = c.req.valid('json')
    const deepCode = newDeepCode()
    const ticket = await deps.repo.createTicket({
      deepCode,
      confirmCode: newConfirmCode(),
      deviceSecretHash: sha256(input.deviceSecret),
      deviceName: input.deviceName,
      platform: input.platform,
      expiresAt: new Date(deps.now().getTime() + LOGIN_TICKET_TTL_MIN * 60_000),
    })
    return c.json({
      id: ticket.id,
      deepLink: `https://t.me/${botUsername}?start=login_${deepCode}`,
      expiresAt: ticket.expiresAt.toISOString(),
      confirmationCode: ticket.confirmCode,
    })
  })

  /** Статус билета: pending (opened) / confirmed / rejected / expired. */
  router.get('/v1/auth/telegram/status', async (c) => {
    const deps = c.get('deps')
    const id = c.req.query('ticket') ?? ''
    if (!z.string().uuid().safeParse(id).success) return fail(c, 422, 'validation', 'Некорректный билет')
    const ticket = await deps.repo.ticketById(id)
    if (!ticket) return fail(c, 404, 'not_found', 'Билет не найден')
    return c.json(toTicketStatusJSON(ticket, deps.now()))
  })

  /** Обменять подтверждённый билет + секрет устройства на сессию. Билет одноразовый. */
  router.post('/v1/auth/telegram/complete', body(completeSchema), async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:complete:${ipKey(clientIp(c))}`, COMPLETE_LIMIT.count, COMPLETE_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток, подождите немного')
    }
    const input = c.req.valid('json')
    const ticket = await deps.repo.claimTicket(input.ticket, sha256(input.deviceSecret), deps.now())
    const user = ticket?.userId ? await deps.repo.userById(ticket.userId) : null
    if (!ticket || !user) return fail(c, 422, 'invalid_ticket', 'Вход не подтверждён или устарел — начните заново')

    const tokens = await issueSession(deps, user, { name: ticket.deviceName, platform: ticket.platform })
    return c.json({ tokens, account: toAccountJSON(user) })
  })

  // ─── Вход в MBS по QR ───────────────────────────────────────────────────────

  /**
   * MBS показывает QR-код и двузначный код. Секрет ноутбука хранится только хэшем: без него
   * подтверждённый билет не обменять на сессию, даже зная всё, что есть в QR-коде.
   */
  router.post('/v1/auth/qr/start', body(qrStartSchema), async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:qr:start:${ipKey(clientIp(c))}`, START_LIMIT.count, START_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток входа, подождите немного')
    }
    const input = c.req.valid('json')
    const confirmCode = newConfirmCode()
    const ticket = await deps.repo.createQrTicket({
      scanCode: newDeepCode(),
      confirmCode,
      choiceCodes: qrChoiceCodes(confirmCode),
      deviceSecretHash: sha256(input.deviceSecret),
      deviceName: input.deviceName,
      platform: input.platform,
      expiresAt: new Date(deps.now().getTime() + QR_TICKET_TTL_MIN * 60_000),
    })
    return c.json({
      id: ticket.id,
      scanCode: ticket.scanCode,
      confirmationCode: ticket.confirmCode,
      expiresAt: ticket.expiresAt.toISOString(),
    })
  })

  /** Опрос с ноутбука: pending / confirmed / rejected / expired. */
  router.get('/v1/auth/qr/status', async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:qr:status:${ipKey(clientIp(c))}`, QR_STATUS_LIMIT.count, QR_STATUS_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов, подождите немного')
    }
    const id = c.req.query('ticket') ?? ''
    if (!z.string().uuid().safeParse(id).success) return fail(c, 422, 'validation', 'Некорректный билет')
    const ticket = await deps.repo.qrTicketById(id)
    if (!ticket) return fail(c, 404, 'not_found', 'Билет не найден')
    return c.json(toQrStatusJSON(ticket, deps.now()))
  })

  /** Телефон показывает, какое устройство просит вход, и три кода на выбор. */
  router.get('/v1/auth/qr/ticket', requireUser, async (c) => {
    const deps = c.get('deps')
    const scan = scanCodeSchema.safeParse(c.req.query('scan') ?? '')
    if (!scan.success) return fail(c, 422, 'validation', 'Некорректный код')
    const ticket = await deps.repo.qrTicketByScan(scan.data)
    if (!ticket || ticket.status !== 'pending' || ticket.expiresAt <= deps.now()) {
      return fail(c, 404, 'not_found', 'Этот QR-код уже недействителен, отсканируйте новый')
    }
    return c.json(toQrTicketJSON(ticket))
  })

  /** Ведущий выбрал код с экрана ноутбука. Первая же ошибка закрывает билет: код не подобрать. */
  router.post('/v1/auth/qr/approve', requireUser, body(qrApproveSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:qr:approve:${user.id}`, QR_APPROVE_LIMIT.count, QR_APPROVE_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток, подождите немного')
    }
    const input = c.req.valid('json')
    const ticket = await deps.repo.decideQrTicket(input.scan, String(input.code), user.id, deps.now())
    if (!ticket) return fail(c, 422, 'invalid_ticket', 'Этот QR-код уже недействителен, отсканируйте новый')
    return c.json({ ok: ticket.status === 'confirmed' })
  })

  /** Ноутбук обменивает подтверждённый билет и свой секрет на сессию. Билет одноразовый. */
  router.post('/v1/auth/qr/complete', body(completeSchema), async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:qr:complete:${ipKey(clientIp(c))}`, COMPLETE_LIMIT.count, COMPLETE_LIMIT.windowSec))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток, подождите немного')
    }
    const input = c.req.valid('json')
    const ticket = await deps.repo.claimQrTicket(input.ticket, sha256(input.deviceSecret), deps.now())
    const user = ticket?.userId ? await deps.repo.userById(ticket.userId) : null
    if (!ticket || !user) return fail(c, 422, 'invalid_ticket', 'Вход не подтверждён или устарел, начните заново')

    const tokens = await issueSession(deps, user, { name: ticket.deviceName, platform: ticket.platform })
    return c.json({ tokens, account: toAccountJSON(user) })
  })

  /**
   * Вход проверяющего App Store по логину и паролю из заметок для App Review — у него нет нашего
   * Telegram-бота. Отдельный аккаунт без GoMafia (только фанки); удалённый создаётся заново при входе.
   */
  router.post('/v1/auth/review', body(reviewSchema), async (c) => {
    const deps = c.get('deps')
    const password = deps.config.reviewPassword
    if (!password) return fail(c, 404, 'not_found', 'Не найдено')
    const allowed = await deps.limiter.hit(`mb:review:${ipKey(clientIp(c))}`, REVIEW_LIMIT.count, REVIEW_LIMIT.windowSec, { failClosed: true })
    if (!allowed) return fail(c, 429, 'rate_limited', 'Слишком много попыток, подождите немного')
    const input = c.req.valid('json')
    if (input.login.toLowerCase() !== REVIEW_LOGIN || !passwordMatches(input.password, password)) {
      return fail(c, 422, 'bad_credentials', 'Неверный логин или пароль')
    }
    const user = await deps.repo.upsertUserFromTelegram({
      tgId: REVIEW_TG_ID, tgUsername: null, tgFirstName: 'App Review', tgLastName: null,
      phone: '', termsVersion: deps.config.termsVersion,
    })
    const tokens = await issueSession(deps, user, { name: input.deviceName, platform: input.platform })
    return c.json({ tokens, account: toAccountJSON(user) })
  })

  /**
   * Обновить токены. Refresh одноразовый: каждый вызов выдаёт новый токен той же сессии.
   * Повторное предъявление уже заменённого токена живой сессии — признак кражи:
   * отзываем все сессии пользователя, а для настольного приложения только его сессию.
   * Токен завершённой сессии просто не принимается.
   */
  router.post('/v1/auth/refresh', body(refreshSchema), async (c) => {
    const deps = c.get('deps')
    const now = deps.now()
    const hash = sha256(c.req.valid('json').refreshToken)
    const row = await deps.repo.refreshToken(hash)
    if (!row) return fail(c, 401, 'unauthorized', 'Сессия истекла — войдите снова')
    if (row.sessionRevokedAt) return fail(c, 401, 'unauthorized', 'Сессия завершена — войдите снова')
    if (row.revokedAt) {
      // Свежий повтор (потерянный ответ, параллельный запрос) — не кража: сессии не трогаем.
      if (now.getTime() - row.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
        // Ноутбук мог уснуть посреди обновления, и телефон ведущего посреди партии из-за этого не страдает.
        if (row.sessionPlatform && DESKTOP_PLATFORMS.has(row.sessionPlatform)) {
          await deps.repo.revokeSession(row.userId, row.sessionId, now)
        } else {
          await deps.repo.revokeAllSessions(row.userId, now)
        }
      }
      return fail(c, 401, 'unauthorized', 'Сессия уже обновлена — войдите снова')
    }
    const user = row.expiresAt > now ? await deps.repo.userById(row.userId) : null
    if (!user) return fail(c, 401, 'unauthorized', 'Сессия истекла — войдите снова')

    const next = newRefreshToken()
    if (!(await deps.repo.revokeRefreshToken(hash, now, sha256(next)))) {
      return fail(c, 401, 'unauthorized', 'Сессия уже обновлена на другом запросе')
    }
    const extended = await deps.repo.extendSession({
      sessionId: row.sessionId, refreshTokenHash: sha256(next), at: now, expiresAt: addDays(now, REFRESH_TOKEN_TTL_DAYS),
    })
    // Сессию отозвали с другого устройства, пока шёл этот запрос.
    if (!extended) return fail(c, 401, 'unauthorized', 'Сессия завершена — войдите снова')
    const access = await issueAccessToken({ userId: user.id, sessionId: row.sessionId }, deps.config, now)
    return c.json({ accessToken: access.token, refreshToken: next, accessExpiresAt: access.expiresAt.toISOString() })
  })

  /** Выход: завершить сессию этого устройства (её refresh-токены и access-токены перестают действовать). */
  router.post('/v1/auth/logout', body(refreshSchema), async (c) => {
    const deps = c.get('deps')
    const row = await deps.repo.refreshToken(sha256(c.req.valid('json').refreshToken))
    if (row) await deps.repo.revokeSession(row.userId, row.sessionId, deps.now())
    return c.json({ ok: true })
  })

  // ─── Сессии устройств ───────────────────────────────────────────────────────

  /** Устройства, где выполнен вход. Текущее (по сессии access-токена) — первым, с `isCurrent`. */
  router.get('/v1/me/sessions', requireUser, async (c) => {
    const deps = c.get('deps')
    const sessions = await deps.repo.sessionsByUser(c.get('user').id, deps.now(), SESSIONS_LIMIT)
    return c.json({ sessions: toSessionsJSON(sessions, c.get('sessionId')) })
  })

  /** Завершить сессию на другом устройстве. Своё устройство — через /v1/auth/logout. */
  router.delete('/v1/me/sessions/:id', requireUser, async (c) => {
    const deps = c.get('deps')
    const id = c.req.param('id').toLowerCase()
    if (!z.string().uuid().safeParse(id).success) return fail(c, 422, 'validation', 'Некорректная сессия')
    if (id === c.get('sessionId')) {
      return fail(c, 409, 'current_session', 'Это текущее устройство — чтобы выйти на нём, нажмите «Выйти» внизу профиля')
    }
    if (!(await deps.repo.revokeSession(c.get('user').id, id, deps.now()))) {
      return fail(c, 404, 'not_found', 'Сессия не найдена или уже завершена')
    }
    return c.json({ ok: true })
  })

  // ─── Аккаунт и GoMafia ──────────────────────────────────────────────────────

  /** Текущий аккаунт. Профиль GoMafia старше суток обновляется в фоне. */
  router.get('/v1/me', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const link = user.gomafia
    if (link && deps.now().getTime() - link.syncedAt.getTime() > GOMAFIA_RESYNC_AFTER_MS) {
      deps.background(`mb:sync:${user.id}`, async () => {
        const fresh = await refreshLink(deps.gomafia, link)
        if (fresh) await deps.repo.setGomafiaLink(user.id, fresh, deps.now())
      })
    }
    return c.json(toAccountJSON(user))
  })

  /**
   * Привязать GoMafia: вход в GoMafia проверяет владение. Пароль GoMafia не сохраняется; если тем же
   * паролем открывается АИМ, сохраняется вход в АИМ (шифротекстом) — для турниров GoMafia.
   */
  router.post('/v1/me/gomafia', requireUser, body(linkSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const { login, password } = c.req.valid('json')
    const strict = { failClosed: true }
    const allowed =
      (await deps.limiter.hit(`mb:link:${user.id}`, LINK_LIMIT.count, LINK_LIMIT.windowSec, strict)) &&
      (await deps.limiter.hit(`mb:link:login:${sha256(login.toLowerCase())}`, LINK_TARGET_LIMIT.count, LINK_TARGET_LIMIT.windowSec, strict)) &&
      (await deps.limiter.hit(`mb:link:ip:${ipKey(clientIp(c))}`, LINK_IP_LIMIT.count, LINK_IP_LIMIT.windowSec, strict))
    if (!allowed) return fail(c, 429, 'rate_limited', 'Слишком много попыток привязки, попробуйте позже')
    const link = await resolveLink(deps.gomafia, login, password)
    if (!link.ok) {
      return link.reason === 'bad_credentials'
        ? fail(c, 422, 'bad_credentials', link.message)
        : fail(c, 502, 'gomafia_unavailable', link.message)
    }
    const taken = () => fail(c, 409, 'gomafia_taken', 'Этот аккаунт GoMafia уже привязан к другому пользователю')
    const owner = await deps.repo.userByGomafiaId(link.player.id)
    if (owner && owner.id !== user.id) return taken()
    try {
      const updated = await deps.repo.setGomafiaLink(user.id, { player: link.player, club: link.club }, deps.now())
      // Обычно пароль АИМ тот же, что у GoMafia: сразу подключаем турниры. Не вышло — привязка
      // всё равно состоялась, АИМ подключается отдельно (POST /v1/me/gomafia/aim).
      await withTimeout(deps.aimAccounts.connect(user.id, login, password).catch(() => undefined), GOMAFIA_INLINE_TIMEOUT_MS)
      return c.json(toAccountJSON(updated ?? user))
    } catch (error) {
      if (error instanceof GomafiaTakenError) return taken()
      throw error
    }
  })

  /**
   * Удалить аккаунт (Профиль → «Удалить аккаунт»). Все сессии завершаются, токены этого
   * пользователя перестают действовать: requireUser не найдёт его.
   */
  router.delete('/v1/me', requireUser, async (c) => {
    const deps = c.get('deps')
    await deps.repo.deleteUser(c.get('user').id)
    return c.json({ ok: true })
  })

  /** Отвязать GoMafia — останутся только фанки. */
  router.delete('/v1/me/gomafia', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const updated = await deps.repo.setGomafiaLink(user.id, null, deps.now())
    await deps.aimAccounts.disconnect(user.id)
    return c.json(toAccountJSON(updated ?? user))
  })

  /** Подбор игроков одним списком: клиенты Titan HUB клуба (если он есть), свой клуб GoMafia, затем общий поиск. */
  router.get('/v1/gomafia/players', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const query = (c.req.query('q') ?? '').trim()
    if (query.length < MIN_QUERY_LENGTH) return fail(c, 422, 'validation', 'Введите хотя бы 2 символа')
    if (!(await deps.limiter.hit(`mb:search:${user.id}`, SEARCH_LIMIT_PER_MIN, 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов поиска')
    }
    const hostClub = user.gomafia?.club?.id ?? null
    const [players, hubNicknames] = await Promise.all([
      searchForHost(deps.gomafia, deps.roster, query, hostClub),
      hostClub == null ? new Set<string>() : deps.hub.nicknames(hostClub, query).catch(() => new Set<string>()),
    ])
    const verified = await deps.repo.verifiedGomafiaIds(players.map((p) => p.id)).catch(() => new Set<number>())
    return c.json({ players: rankForHost(players, hubNicknames, verified) })
  })

  router.get('/v1/gomafia/players/:id', requireUser, async (c) => {
    const deps = c.get('deps')
    const id = c.req.param('id')
    if (!/^\d+$/.test(id)) return fail(c, 422, 'validation', 'Некорректный номер игрока')
    const detail = await deps.gomafia.player(id).catch(() => null)
    const hostClub = c.get('user').gomafia?.club?.id
    const player = detail ? toPlayerJSON(detail, hostClub != null && String(hostClub) === detail.clubId) : null
    if (!player) return fail(c, 404, 'not_found', 'Игрок не найден в GoMafia')
    return c.json(player)
  })

  router.get('/v1/gomafia/clubs/:id/players', requireUser, async (c) => {
    const deps = c.get('deps')
    const id = c.req.param('id')
    const page = Number(c.req.query('page') ?? '1')
    if (!/^\d+$/.test(id) || !Number.isInteger(page) || page < 1 || page > 100) {
      return fail(c, 422, 'validation', 'Некорректный клуб или страница')
    }
    const roster = await deps.gomafia.club(id, page).catch(() => null)
    if (!roster) return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отвечает, попробуйте позже')
    const inClub = c.get('user').gomafia?.club?.id === Number(id)
    const players = roster.residents.map((p) => toPlayerJSON(p, inClub)).filter((p) => p != null)
    const verified = await deps.repo.verifiedGomafiaIds(players.map((p) => p.id)).catch(() => new Set<number>())
    return c.json({ players: players.map((p) => ({ ...p, isVerified: verified.has(p.id) })) })
  })

  registerTitanRoutes(router, requireUser)

  // ─── История игр ────────────────────────────────────────────────────────────

  /** Сохранить завершённую игру. Повторная отправка той же игры безопасна (офлайн-очередь). */
  const gameBodyLimit = bodyLimit({
    maxSize: GAME_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody('too_large', 'Запись игры слишком большая'), 413),
  })

  router.post('/v1/games', gameBodyLimit, requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:games:${user.id}`, GAMES_PER_DAY, 24 * 60 * 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много игр за сутки')
    }
    const payload = await c.req.json().catch(() => null)
    const result = validateGameUpload(payload, await withFreshClub(deps, user), deps.now())
    if (!result.ok) return fail(c, result.status, result.code, result.message)

    const outcome = await deps.repo.insertGame(result.game)
    if (outcome === 'conflict') return fail(c, 409, 'game_conflict', 'Игра с таким номером уже сохранена другим ведущим')
    // Игра закончена — её черновик больше не нужен.
    await deps.repo.deleteActiveGame(user.id, result.game.id)
    return c.json({ id: result.game.id }, outcome === 'inserted' ? 201 : 200)
  })

  /** Все игры, проведённые ведущим (включая фанки). */
  router.get('/v1/me/games', requireUser, async (c) => {
    const deps = c.get('deps')
    const since = parseSince(c.req.query('since'))
    if (since === 'invalid') return fail(c, 422, 'validation', 'Некорректная дата since')
    const games = await deps.repo.gamesByHost(c.get('user').id, since, GAMES_PAGE_LIMIT)
    return c.json({ games: games.map((g) => g.record) })
  })

  /** История игр клуба — только для участников клуба. */
  router.get('/v1/clubs/:id/games', requireUser, async (c) => {
    const deps = c.get('deps')
    const clubId = Number(c.req.param('id'))
    if (!Number.isInteger(clubId)) return fail(c, 422, 'validation', 'Некорректный клуб')
    const member = await withFreshClub(deps, c.get('user'))
    if (member.gomafia?.club?.id !== clubId) return fail(c, 403, 'not_club_member', 'История доступна только участникам клуба')
    const since = parseSince(c.req.query('since'))
    if (since === 'invalid') return fail(c, 422, 'validation', 'Некорректная дата since')
    const games = await deps.repo.gamesByClub(clubId, since, GAMES_PAGE_LIMIT)
    return c.json({ games: games.map((g) => g.record) })
  })

  // ─── Настройки MafBoard Studio ──────────────────────────────────────────────

  const studioBodyLimit = bodyLimit({
    maxSize: STUDIO_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody('too_large', 'Настройки студии слишком большие'), 413),
  })

  const studioJSON = (deps: MafboardDeps, settings: StoredStudioSettings | null) => ({
    revision: settings?.revision ?? 0,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
    document: settings?.document ?? null,
    // Не расшифровался — значит, сменился ключ сервера: MBS попросит ввести ключи заново.
    secrets: settings?.secrets ? openSecrets(deps.config.studioSecretsKey, settings.secrets) : null,
  })

  /** Профили и секреты ведущего: MBS берёт их при входе и при смене ведущего. */
  router.get('/v1/studio/settings', requireUser, async (c) => {
    const deps = c.get('deps')
    return c.json(studioJSON(deps, await deps.repo.studioSettings(c.get('user').id)))
  })

  /** Запись от ревизии `baseRevision`. Новее уже сохранили на другом Mac — 409 с текущей версией. */
  router.put('/v1/studio/settings', studioBodyLimit, requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:studio:${user.id}`, STUDIO_SAVES_PER_HOUR, 60 * 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком частые сохранения настроек')
    }
    const parsed = studioPutSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 422, 'validation', 'Настройки студии повреждены')
    const { baseRevision, document, secrets } = parsed.data
    if (secrets && Buffer.byteLength(JSON.stringify(secrets)) > STUDIO_SECRETS_LIMIT_BYTES) {
      return fail(c, 422, 'validation', 'Слишком много секретов')
    }
    const result = await deps.repo.saveStudioSettings({
      userId: user.id,
      baseRevision,
      document,
      secrets: secrets ? sealSecrets(deps.config.studioSecretsKey, secrets) : null,
      updatedAt: deps.now(),
    })
    if (!result.saved) {
      return c.json({ error: { code: 'revision_conflict', message: 'Настройки изменили на другом устройстве' }, current: studioJSON(deps, result.current) }, 409)
    }
    return c.json({ revision: result.revision })
  })

  // ─── Вход MafBoard Studio в VK Видео Live (vk.ts) ──────────────────────────

  const vkTokensJSON = (tokens: VkTokens) => ({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn })
  const vkFail = (c: Context, error: unknown) => {
    if (error instanceof VkError && error.kind === 'revoked') return fail(c, 401, 'vk_revoked', 'Вход в VK Видео Live не действует, войдите снова')
    if (error instanceof VkError) return fail(c, 502, 'vk_failed', error.message)
    throw error
  }

  /** Ссылка на вход VK для MBS. Итог MBS забирает через claim по тому же state. */
  router.post('/v1/studio/vk/begin', requireUser, async (c) => {
    const deps = c.get('deps')
    const app = deps.config.vk
    if (!app) return fail(c, 503, 'vk_disabled', 'Вход в VK Видео Live на сервере не настроен')
    if (!(await deps.limiter.hit(`mb:vk:${c.get('user').id}`, VK_BEGINS_PER_HOUR, 60 * 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много попыток входа, подождите немного')
    }
    const state = vkLogins.begin(c.get('user').id, deps.now().getTime())
    if (!state) return fail(c, 429, 'rate_limited', 'Сервер занят, попробуйте войти чуть позже')
    return c.json({ state, url: authorizeUrl(app, state) })
  })

  /** Сюда VK возвращает браузер ведущего. Ведущий видит простую страницу, токены ждут MBS. */
  router.get('/v1/vk/callback', async (c) => {
    const deps = c.get('deps')
    const state = c.req.query('state') ?? ''
    const code = c.req.query('code') ?? ''
    const app = deps.config.vk
    if (!app || !state || !vkLogins.waiting(state, deps.now().getTime())) return c.html(callbackPage(false), 400)
    if (!code) {
      vkLogins.finish(state, { message: 'Доступ не разрешён. Чтобы войти, разрешите его на странице VK' })
      return c.html(callbackPage(false))
    }
    try {
      vkLogins.finish(state, { tokens: await deps.vk.exchange(app, code) })
      return c.html(callbackPage(true))
    } catch (error) {
      vkLogins.finish(state, { message: error instanceof VkError ? error.message : 'VK не ответил' })
      return c.html(callbackPage(false))
    }
  })

  /** Итог входа: 202, пока ведущий в браузере. Готовые токены отдаются один раз. */
  router.get('/v1/studio/vk/claim', requireUser, async (c) => {
    const deps = c.get('deps')
    const result = vkLogins.claim(c.req.query('state') ?? '', c.get('user').id, deps.now().getTime())
    if (!result) return fail(c, 404, 'not_found', 'Вход не найден или устарел, войдите снова')
    if (result.status === 'waiting') return c.json({ pending: true }, 202)
    if (result.status === 'failed') return fail(c, 400, 'vk_failed', result.message)
    return c.json(vkTokensJSON(result.tokens))
  })

  /** Новый токен доступа по токену обновления MBS: сервер подставляет секрет приложения. */
  router.post('/v1/studio/vk/refresh', requireUser, body(vkTokenSchema), async (c) => {
    const deps = c.get('deps')
    const app = deps.config.vk
    if (!app) return fail(c, 503, 'vk_disabled', 'Вход в VK Видео Live на сервере не настроен')
    try {
      return c.json(vkTokensJSON(await deps.vk.refresh(app, c.req.valid('json').token)))
    } catch (error) {
      return vkFail(c, error)
    }
  })

  /** Выход ведущего: отзыв токена обновления у VK. */
  router.post('/v1/studio/vk/revoke', requireUser, body(vkTokenSchema), async (c) => {
    const deps = c.get('deps')
    const app = deps.config.vk
    if (!app) return fail(c, 503, 'vk_disabled', 'Вход в VK Видео Live на сервере не настроен')
    try {
      await deps.vk.revoke(app, c.req.valid('json').token, 'refresh_token')
      return c.json({ ok: true })
    } catch (error) {
      return vkFail(c, error)
    }
  })

  // ─── Идущие игры ────────────────────────────────────────────────────────────

  /** Снимок идущей игры с телефона. Старший снимок не перезаписывается младшим. */
  router.put('/v1/games/active/:id', gameBodyLimit, requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return fail(c, 422, 'validation', 'Некорректный номер игры')
    if (!(await deps.limiter.hit(`mb:active:${user.id}`, ACTIVE_SAVES_PER_HOUR, 60 * 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком частые сохранения игры')
    }
    const parsed = activeGameSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 422, 'invalid_snapshot', 'Снимок игры повреждён или неполный')
    const { revision, updatedAt, snapshot } = parsed.data
    if (snapshot.session.setup.gameID.toLowerCase() !== id.toLowerCase()) {
      return fail(c, 422, 'id_mismatch', 'Номер игры не совпадает со снимком')
    }
    if (snapshot.session.setup.host.userID.toLowerCase() !== user.id.toLowerCase()) {
      return fail(c, 403, 'host_mismatch', 'Игру может сохранить только её ведущий')
    }
    const outcome = await deps.repo.saveActiveGame({
      id: id.toLowerCase(), hostUserId: user.id, revision, updatedAt: new Date(updatedAt), snapshot,
    })
    if (outcome === 'conflict') return fail(c, 409, 'game_conflict', 'Игра с таким номером принадлежит другому ведущему')
    return c.json({ stored: outcome === 'saved' })
  })

  /** Идущие игры ведущего — чтобы продолжить после переустановки или на другом устройстве. */
  router.get('/v1/games/active', requireUser, async (c) => {
    const deps = c.get('deps')
    const games = await deps.repo.activeGamesByHost(c.get('user').id, ACTIVE_GAMES_LIMIT)
    return c.json({
      games: games.map((g) => ({ id: g.id, revision: g.revision, updatedAt: g.updatedAt.toISOString(), snapshot: g.snapshot })),
    })
  })

  /** Ведущий удалил идущую игру. */
  router.delete('/v1/games/active/:id', requireUser, async (c) => {
    const id = c.req.param('id')
    if (!UUID_PATTERN.test(id)) return fail(c, 422, 'validation', 'Некорректный номер игры')
    await c.get('deps').repo.deleteActiveGame(c.get('user').id, id.toLowerCase())
    return c.json({ ok: true })
  })

  registerTournamentRoutes(router, requireUser)
  registerShareRoutes(router, requireUser)

  return router
}
