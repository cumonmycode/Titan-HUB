import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { db as mainDb, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { clientIp } from '../../lib/clientIp.js'
import { getClubDbById } from '../../lib/clubResolver.js'
import { dropCodeRoute, exchangeBlocked, isConnectToken, normalizeCode, readCodeRoute, recordExchangeFail, sha256 } from './codes.js'
import { consumeCode, deleteConnection, findByToken, rotateToken, touchUsage, type ConnectConnection } from './repo.js'
import { DEFAULT_PAGE, MAX_PAGE, decodeCursor, encodeCursor, getClientRow, listClientRows, serializeClients } from './clients.js'
import { CONNECT_SCOPES } from './scopes.js'

/**
 * Titan Connect — публичный API для сторонних сервисов (/api/connect/v1).
 *
 *   POST /exchange          одноразовый код из HUB → постоянный ключ (без авторизации)
 *   GET  /scopes            справочник прав
 *   GET  /me                что за подключение, клуб и права
 *   GET  /clients           клиенты: поиск, синхронизация по курсору / updatedSince
 *   GET  /clients/:id       один клиент
 *   POST /token/rotate      сменить ключ (старый перестаёт работать)
 *   DELETE /connection      сервис отключается сам
 *
 * Авторизация: `Authorization: Bearer tcn_…`. Ключ живёт в БД клуба, поэтому запросы
 * идут на адрес клуба — его возвращает /exchange в apiBase. Формат — docs/TITAN_CONNECT.md.
 */

type ConnectEnv = AppEnv & { Variables: AppEnv['Variables'] & { connection: ConnectConnection } }

export const API_VERSION = 'v1'

const requestProto = (c: Context): string => c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')

/** Хост запроса (с портом, если он есть) — для маршрута кода в Redis и apiBase. */
export const requestHost = (c: Context): string => (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').trim().toLowerCase()

/** Адрес, с которого пришёл запрос (https за nginx): от него строятся apiBase и ссылки на фото. */
export function requestOrigin(c: Context): string {
  return `${requestProto(c)}://${requestHost(c)}`
}

const apiBaseFor = (origin: string): string => `${origin}/api/connect/${API_VERSION}`

const fail = (c: Context, status: 400 | 401 | 403 | 404 | 429, code: string, message: string) => c.json({ error: { code, message } }, status)

export const connectPublicRouter = new Hono<ConnectEnv>()

// Сторонние сервисы зовут API с сервера; ответы с личными данными не кэшируются.
connectPublicRouter.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('X-Titan-Connect', API_VERSION)
})

// ── Обмен кода на ключ ───────────────────────────────────────────────────────

const ExchangeSchema = z.object({
  code: z.string().min(4).max(32),
  service: z
    .object({
      name: z.string().trim().min(1).max(80).optional(),
      url: z.string().trim().url().max(300).optional(),
    })
    .optional(),
})

/**
 * БД клуба, выдавшего код. Код с поддомена клуба можно ввести и на основном домене:
 * маршрут «код → клуб» лежит в общем Redis. Без маршрута — БД текущего домена.
 */
async function databaseForCode(c: Context<ConnectEnv>, codeHash: string): Promise<{ db: Database; origin: string }> {
  const route = await readCodeRoute(codeHash)
  if (!route) return { db: c.var.db, origin: requestOrigin(c) }
  const origin = `${requestProto(c)}://${route.host}`
  if (route.clubId === (c.var.club?.id ?? null)) return { db: c.var.db, origin }
  if (route.clubId === null) return { db: mainDb, origin }
  const clubDb = await getClubDbById(route.clubId).catch(() => null)
  return clubDb ? { db: clubDb, origin } : { db: c.var.db, origin: requestOrigin(c) }
}

connectPublicRouter.post('/exchange', async (c) => {
  const ip = clientIp(c)
  if (await exchangeBlocked(ip)) return fail(c, 429, 'too_many_attempts', 'Слишком много неверных кодов. Попробуйте через 15 минут.')

  const parsed = ExchangeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return fail(c, 400, 'invalid_request', 'Нужен JSON вида { "code": "K7QM-3XPA" }.')
  const code = normalizeCode(parsed.data.code)
  if (!code) {
    await recordExchangeFail(ip)
    return fail(c, 400, 'invalid_code', 'Код — 8 букв и цифр, например K7QM-3XPA.')
  }

  const codeHash = sha256(code)
  const target = await databaseForCode(c, codeHash)
  const service = { name: parsed.data.service?.name ?? null, url: parsed.data.service?.url ?? null }
  const result = await consumeCode(target.db, codeHash, service)
  if (!result) {
    await recordExchangeFail(ip)
    return fail(c, 400, 'invalid_code', 'Код неверный, уже использован или истёк. Получите новый в Titan HUB.')
  }
  await dropCodeRoute(codeHash)

  return c.json({
    accessToken: result.token,
    tokenType: 'Bearer',
    // Ключ бессрочный: сохраните его у себя — повторно вводить код не нужно.
    expiresAt: null,
    connectionId: result.connection.id,
    name: result.connection.name,
    scopes: result.connection.scopes,
    apiBase: apiBaseFor(target.origin),
  })
})

/** Справочник прав — чтобы сервис мог показать пользователю, что ему доступно. */
connectPublicRouter.get('/scopes', (c) => c.json({ items: CONNECT_SCOPES }))

// ── Авторизация по ключу ─────────────────────────────────────────────────────

const requireConnectToken = createMiddleware<ConnectEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (!isConnectToken(token)) return fail(c, 401, 'unauthorized', 'Нужен заголовок Authorization: Bearer tcn_…')
  const connection = await findByToken(c.var.db, sha256(token))
  if (!connection) {
    return fail(c, 401, 'invalid_token', 'Ключ не действует: подключение отключено в Titan HUB или запрос ушёл не на адрес клуба (apiBase).')
  }
  c.set('connection', connection)
  // Учёт использования не должен задерживать или ронять ответ.
  void touchUsage(c.var.db, connection.id, clientIp(c)).catch((err: unknown) => console.warn('[connect] touchUsage:', err))
  await next()
})

connectPublicRouter.use('/me', requireConnectToken)
connectPublicRouter.use('/clients', requireConnectToken)
connectPublicRouter.use('/clients/*', requireConnectToken)
connectPublicRouter.use('/token/*', requireConnectToken)
connectPublicRouter.use('/connection', requireConnectToken)

connectPublicRouter.get('/me', (c) => {
  const conn = c.var.connection
  return c.json({
    connectionId: conn.id,
    name: conn.name,
    scopes: conn.scopes,
    connectedAt: conn.connectedAt,
    club: { name: c.var.club?.name ?? null, slug: c.var.club?.slug ?? null },
    apiBase: apiBaseFor(requestOrigin(c)),
  })
})

// ── Клиенты ──────────────────────────────────────────────────────────────────

const ListSchema = z.object({
  search: z.string().trim().min(1).max(80).optional(),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(10).max(15))
    .optional(),
  cursor: z.string().max(200).optional(),
  updatedSince: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Дата в формате ISO 8601')
    .optional(),
  includeDeleted: z.enum(['true', 'false', '1', '0']).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
})

connectPublicRouter.get('/clients', async (c) => {
  const parsed = ListSchema.safeParse(c.req.query())
  if (!parsed.success) return fail(c, 400, 'invalid_request', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const q = parsed.data
  const conn = c.var.connection
  if (q.phone && !conn.scopes.includes('clients:contacts')) return fail(c, 403, 'scope_required', 'Поиск по телефону требует права clients:contacts.')

  const cursor = q.cursor ? decodeCursor(q.cursor) : null
  if (q.cursor && !cursor) return fail(c, 400, 'invalid_cursor', 'Курсор повреждён — начните с первой страницы.')

  const syncing = !!(q.updatedSince || q.cursor)
  const page = await listClientRows(c.var.db, {
    search: q.search,
    phone: q.phone,
    cursor,
    updatedSince: q.updatedSince ?? null,
    // При синхронизации по изменениям сервису нужно знать и об удалённых.
    includeDeleted: q.includeDeleted ? q.includeDeleted === 'true' || q.includeDeleted === '1' : syncing,
    limit: q.limit,
  })
  const items = await serializeClients(c.var.db, page.items, conn.scopes, requestOrigin(c))
  const last = page.items[page.items.length - 1]
  return c.json({
    items,
    nextCursor: page.next ? encodeCursor(page.next) : null,
    // Сохраните и передайте в следующий раз как ?cursor= — придут только изменения.
    syncCursor: last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : (q.cursor ?? null),
  })
})

connectPublicRouter.get('/clients/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(c, 404, 'not_found', 'Клиент не найден.')
  const row = await getClientRow(c.var.db, id)
  if (!row) return fail(c, 404, 'not_found', 'Клиент не найден.')
  const [client] = await serializeClients(c.var.db, [row], c.var.connection.scopes, requestOrigin(c))
  return c.json(client)
})

// ── Ключ и подключение ───────────────────────────────────────────────────────

connectPublicRouter.post('/token/rotate', async (c) => {
  const token = await rotateToken(c.var.db, c.var.connection.id)
  return c.json({ accessToken: token, tokenType: 'Bearer', expiresAt: null })
})

connectPublicRouter.delete('/connection', async (c) => {
  await deleteConnection(c.var.db, c.var.connection.id)
  return c.json({ ok: true })
})
