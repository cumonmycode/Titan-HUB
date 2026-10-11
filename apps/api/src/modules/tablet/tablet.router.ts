import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { createHash } from 'crypto'
import { Redis } from 'ioredis'
import {
  checks, checkItems, checkItemModifiers, checkPayments, pendingOrders, chatMessages,
  profiles, spaces, events, inventory, menuCategories,
  eq, and, asc, desc, inArray, isNull, sql,
} from '@titan/database'
import type { Database } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getCurrentShift } from '../shifts/shifts.service.js'
import { computeRental, round2 } from '../../lib/money.js'
import { clubChannelSuffix, updatesChannel } from '../../lib/realtime.js'
import { getSharedRedis } from '../../lib/redis.js'

// Titan Home 2.0 — всё, что нужно экрану гостя на планшете кабинки:
//   GET /tablet/state  — счёт зоны с итогом, посчитанным сервером, заказы на
//                         подтверждении, непрочитанные, мероприятие — одним запросом;
//   GET /tablet/stream — один SSE-поток событий своей зоны вместо опросов;
//   GET /tablet/menu   — меню планшета с версией (ETag → 304, пока не изменилось).
// Старые маршруты /pos/* для планшета не трогаем: веб-киоск /tablet и APK 1.x
// работают с ними и дальше.

export const tabletRouter = new Hono<AppEnv>()
tabletRouter.use('*', requireAuth)
tabletRouter.use('*', requireRole('tablet'))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const num = (v: string | null | undefined) => parseFloat(v ?? '0') || 0

type Space = { id: string; name: string; hourlyRate: string | null }

/** Зона (кабинка) планшета: tablet-профиль привязан к ней linkedSpaceId. */
async function tabletSpace(db: Database, userId: string): Promise<Space | null> {
  const [row] = await db
    .select({ id: spaces.id, name: spaces.name, hourlyRate: spaces.hourlyRate })
    .from(profiles)
    .innerJoin(spaces, eq(spaces.id, profiles.linkedSpaceId))
    .where(eq(profiles.id, userId))
  return row ?? null
}

// ─── GET /tablet/state ───────────────────────────────────────────────────────

type CheckRow = typeof checks.$inferSelect

/** Счёт для экрана гостя: только то, что гость видит, суммы — с сервера. */
async function checkView(db: Database, check: CheckRow, hourlyRate: string | null, nowMs: number) {
  const rows = await db
    .select({ id: checkItems.id, quantity: checkItems.quantity, priceAtTime: checkItems.priceAtTime, name: inventory.name })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .where(eq(checkItems.checkId, check.id))
  const ids = rows.map((r) => r.id)
  const mods = ids.length
    ? await db
        .select({ checkItemId: checkItemModifiers.checkItemId, priceAtTime: checkItemModifiers.priceAtTime })
        .from(checkItemModifiers)
        .where(inArray(checkItemModifiers.checkItemId, ids))
    : []
  const modsPerUnit = new Map<string, number>()
  for (const m of mods) modsPerUnit.set(m.checkItemId, (modsPerUnit.get(m.checkItemId) ?? 0) + num(m.priceAtTime))
  const items = rows
    .map((r) => ({
      id: r.id,
      name: r.name ?? 'Позиция',
      quantity: r.quantity,
      sum: round2((num(r.priceAtTime) + (modsPerUnit.get(r.id) ?? 0)) * r.quantity),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const pending = await db
    .select({ id: pendingOrders.id, items: pendingOrders.items, createdAt: pendingOrders.createdAt })
    .from(pendingOrders)
    .where(and(eq(pendingOrders.checkId, check.id), eq(pendingOrders.status, 'pending')))
    .orderBy(asc(pendingOrders.createdAt))

  const [unreadRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(and(eq(chatMessages.checkId, check.id), eq(chatMessages.sender, 'staff'), isNull(chatMessages.readAt)))

  let guestName: string | null = check.guestNames?.[0] ?? null
  if (check.playerId) {
    const [player] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, check.playerId))
    guestName = player?.nickname ?? guestName
  }

  // Итог — та же математика, что у кассы и QR: позиции − скидки (totalAmount,
  // пересчитывается при каждом изменении чека) + аренда на «сейчас» + база события.
  const comp = !!check.staffCompId
  const itemsTotal = comp ? 0 : num(check.totalAmount)
  const rental = comp ? 0 : computeRental(check.spaceStartAt, check.spaceEndAt, hourlyRate, nowMs)
  const eventBase = comp ? 0 : num(check.eventBaseAmount)
  const rentalMinutes = check.spaceStartAt
    ? Math.floor(Math.max(0, (check.spaceEndAt ? new Date(check.spaceEndAt).getTime() : nowMs) - new Date(check.spaceStartAt).getTime()) / 60000)
    : 0

  return {
    id: check.id,
    openedAt: check.createdAt,
    guestName,
    staffComp: comp,
    items,
    itemsCount: items.reduce((s, i) => s + i.quantity, 0),
    pendingOrders: pending.map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      items: (o.items ?? []).map((it) => ({ name: it.name, quantity: it.quantity, sum: round2(num(it.price) * it.quantity) })),
    })),
    rental: check.spaceStartAt ? { startAt: check.spaceStartAt, running: !check.spaceEndAt, minutes: rentalMinutes } : null,
    totals: {
      items: round2(itemsTotal + (comp ? 0 : num(check.discountTotal))),
      discount: comp ? 0 : num(check.discountTotal),
      rental: round2(rental),
      event: round2(eventBase),
      total: round2(itemsTotal + rental + eventBase),
    },
    unread: unreadRow?.count ?? 0,
  }
}

/** Что стало с чеком, который планшет показывал до этого. */
async function previousCheck(db: Database, checkId: string, spaceId: string) {
  const [row] = await db
    .select({ id: checks.id, status: checks.status, spaceId: checks.spaceId })
    .from(checks)
    .where(eq(checks.id, checkId))
  if (!row) return { id: checkId, outcome: 'gone' as const }
  if (row.spaceId !== spaceId) return { id: checkId, outcome: 'moved' as const }
  if (row.status === 'cancelled') return { id: checkId, outcome: 'cancelled' as const }
  if (row.status !== 'closed') return { id: checkId, outcome: 'open' as const }
  const pays = await db.select({ amount: checkPayments.amount }).from(checkPayments).where(eq(checkPayments.checkId, checkId))
  const paidTotal = round2(pays.reduce((s, p) => s + num(p.amount), 0))
  return { id: checkId, outcome: 'closed' as const, paidTotal }
}

async function activeEvent(db: Database, spaceId: string) {
  const today = new Date().toISOString().split('T')[0]!
  const [event] = await db
    .select({ id: events.id, title: events.title, startTime: events.startTime, endTime: events.endTime })
    .from(events)
    .where(and(eq(events.spaceId, spaceId), eq(events.status, 'active'), eq(events.date, today)))
    .limit(1)
  return event ?? null
}

tabletRouter.get('/state', async (c) => {
  const db = c.var.db
  const space = await tabletSpace(db, c.get('user').sub)
  if (!space) return c.json({ error: 'Планшет не привязан к кабинке' }, 403)

  const shift = await getCurrentShift(db)
  const [open] = shift
    ? await db
        .select()
        .from(checks)
        .where(and(eq(checks.shiftId, shift.id), eq(checks.status, 'open'), eq(checks.spaceId, space.id)))
        .orderBy(desc(checks.createdAt))
        .limit(1)
    : []
  const nowMs = Date.now()
  const prevId = c.req.query('checkId')
  const [check, previous, event] = await Promise.all([
    open ? checkView(db, open, space.hourlyRate, nowMs) : Promise.resolve(null),
    prevId && UUID.test(prevId) && prevId !== open?.id ? previousCheck(db, prevId, space.id) : Promise.resolve(null),
    activeEvent(db, space.id),
  ])
  return c.json({ serverTime: new Date(nowMs).toISOString(), space: { id: space.id, name: space.name }, check, previous, event })
})

// ─── GET /tablet/menu ────────────────────────────────────────────────────────

tabletRouter.get('/menu', async (c) => {
  const db = c.var.db
  const cats = await db
    .select({ id: menuCategories.id, name: menuCategories.name })
    .from(menuCategories)
    .where(and(eq(menuCategories.isActive, true), eq(menuCategories.isTabletVisible, true)))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name))
  const rows = await db
    .select({
      id: inventory.id, name: inventory.name, price: inventory.price, categoryId: inventory.category,
      isTop: inventory.isTop, tags: inventory.searchTags, trackStock: inventory.trackStock, stock: inventory.stockQuantity,
    })
    .from(inventory)
    .where(and(eq(inventory.isActive, true), isNull(inventory.deletedAt), eq(inventory.isTabletVisible, true), eq(inventory.kind, 'goods')))
    .orderBy(asc(inventory.sortOrder), asc(inventory.name))
  // Закончившееся (учёт остатков и ноль на складе) гостю не показываем.
  const items = rows
    .filter((r) => !(r.trackStock && r.stock <= 0))
    .map((r) => ({ id: r.id, name: r.name, price: num(r.price), categoryId: r.categoryId, isTop: r.isTop, tags: r.tags ?? [] }))
  const used = new Set(items.map((i) => i.categoryId))
  const categories = cats.filter((cat) => used.has(cat.id))
  const body = { categories, items }
  const version = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16)
  const etag = `"${version}"`
  c.header('ETag', etag)
  c.header('Cache-Control', 'no-cache')
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304)
  return c.json({ version, ...body })
})

// ─── GET /tablet/stream ──────────────────────────────────────────────────────
// Один поток на планшет: событие любого чека ЭТОЙ зоны (открыт, позиции, заказ
// решён, сообщение, оплачен, закрыт, переехал, удалён). Планшет по событию
// перезапрашивает /tablet/state — в потоке только тип события, без данных чека.

const KNOWN_LIMIT = 200

tabletRouter.get('/stream', async (c) => {
  const db = c.var.db
  const space = await tabletSpace(db, c.get('user').sub)
  if (!space) return c.json({ error: 'Планшет не привязан к кабинке' }, 403)
  const channel = updatesChannel(c.var.club?.id)
  // nginx не должен копить поток в буфере — иначе события приходят пачками.
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379')
    let closed = false
    // Чеки этой зоны, о которых поток уже сообщал: если чек переедет в другую зону
    // или будет удалён, планшет всё равно узнает об этом.
    const known = new Set<string>()

    const relevant = async (checkId: string) => {
      if (known.has(checkId)) return true
      const [row] = await db.select({ spaceId: checks.spaceId }).from(checks).where(eq(checks.id, checkId))
      if (row?.spaceId !== space.id) return false
      if (known.size >= KNOWN_LIMIT) known.delete(known.values().next().value as string)
      known.add(checkId)
      return true
    }

    redis.on('message', async (_ch, msg) => {
      if (closed) return
      try {
        const parsed = JSON.parse(msg) as { event?: string; data?: { checkId?: unknown; status?: unknown; sender?: unknown } }
        const checkId = parsed.data?.checkId
        if (typeof parsed.event !== 'string' || typeof checkId !== 'string' || !UUID.test(checkId)) return
        if (!(await relevant(checkId))) return
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'zone',
            event: parsed.event,
            checkId,
            status: typeof parsed.data?.status === 'string' ? parsed.data.status : null,
            sender: typeof parsed.data?.sender === 'string' ? parsed.data.sender : null,
          }),
        })
      } catch {
        /* битое сообщение канала — пропускаем */
      }
    })
    await redis.subscribe(channel).catch(() => {})
    await stream.writeSSE({ data: JSON.stringify({ type: 'ready', spaceId: space.id }) })

    const hb = setInterval(() => {
      if (!closed) stream.writeSSE({ event: 'ping', data: '1' }).catch(() => {})
    }, 25_000)
    stream.onAbort(() => {
      closed = true
      clearInterval(hb)
      redis.unsubscribe(channel).catch(() => {})
      redis.disconnect()
    })
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (closed) {
          clearInterval(t)
          resolve()
        }
      }, 1000)
    })
  })
})

// ─── Heartbeat планшетов ─────────────────────────────────────────────────────
// Планшет раз в 5 минут сообщает версию приложения и связь (HA, поток событий).
// Храним в Redis сутки — это живой статус для «Управление → Экраны», не история.

const HB_TTL_S = 24 * 3600
const hbKey = (clubId: string | null | undefined, spaceId: string) => `titan:tablet-hb:${clubChannelSuffix(clubId)}:${spaceId}`

const HeartbeatSchema = z.object({
  app: z.string().max(40),
  ha: z.enum(['idle', 'connecting', 'connected', 'auth_failed', 'offline']),
  stream: z.boolean(),
  orientation: z.enum(['portrait', 'landscape']),
  model: z.string().max(80).optional(),
  android: z.string().max(20).optional(),
})

tabletRouter.post('/heartbeat', zValidator('json', HeartbeatSchema), async (c) => {
  const space = await tabletSpace(c.var.db, c.get('user').sub)
  if (!space) return c.json({ error: 'Планшет не привязан к кабинке' }, 403)
  const beat = { ...c.req.valid('json'), at: new Date().toISOString() }
  await getSharedRedis().set(hbKey(c.var.club?.id, space.id), JSON.stringify(beat), 'EX', HB_TTL_S).catch(() => {})
  return c.json({ ok: true })
})

/** HUB: планшеты Titan Home клуба — кабинки с привязанным планшетом и их последний сигнал. */
export const tabletsRouter = new Hono<AppEnv>()
tabletsRouter.use('*', requireAuth)
tabletsRouter.use('*', requireRole('owner', 'staff'))

tabletsRouter.get('/', async (c) => {
  const db = c.var.db
  const rows = await db
    .selectDistinct({ id: spaces.id, name: spaces.name })
    .from(profiles)
    .innerJoin(spaces, eq(spaces.id, profiles.linkedSpaceId))
    .where(and(eq(profiles.role, 'tablet'), isNull(profiles.deletedAt), eq(spaces.isActive, true)))
    .orderBy(asc(spaces.name))
  const redis = getSharedRedis()
  const raws = rows.length ? await redis.mget(...rows.map((r) => hbKey(c.var.club?.id, r.id))).catch(() => rows.map(() => null)) : []
  const tablets = rows.map((r, i) => {
    let beat: (z.infer<typeof HeartbeatSchema> & { at: string }) | null = null
    try {
      beat = raws[i] ? JSON.parse(raws[i] as string) : null
    } catch {
      beat = null
    }
    return { spaceId: r.id, name: r.name, lastSeenAt: beat?.at ?? null, app: beat?.app ?? null, ha: beat?.ha ?? null, stream: beat?.stream ?? null, orientation: beat?.orientation ?? null, model: beat?.model ?? null }
  })
  return c.json({ tablets })
})
