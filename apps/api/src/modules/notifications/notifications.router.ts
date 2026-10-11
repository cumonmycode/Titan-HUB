import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { notifications, userNotificationSettings, pushSubscriptions, tgLinkRequests, profiles, spaces, checks, appDevices, eq, and, or, isNull, desc, sql, inArray } from '@titan/database'
import type { Database } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { Redis } from 'ioredis'
import { randomInt } from 'crypto'
import type { AppEnv } from '../../types.js'
import { notify, NOTIFICATION_TYPES } from './push.js'
import { raiseStaffAlert, requestOrigin } from './staff-calls.js'
import { round2, computeRental } from '../../lib/money.js'
import { notifChannel } from '../../lib/realtime.js'

// Сохранена ради совместимости вызовов в этом роутере: делегирует в notify(),
// который пишет в БД, публикует в SSE и шлёт web push персоналу. Возвращает
// «псевдо-строку» уведомления для ответа клиенту (id здесь не используется в UI).
// clubId прокидывается в notify → публикация в notifChannel(clubId) (изоляция
// канала по клубу; на основном домене → 'default').
async function publishStaffNotification(payload: {
  type: string
  title: string
  body: string
  meta?: Record<string, unknown>
}, database: Database, clubId?: string | null) {
  const id = await notify({ ...payload }, database, clubId)
  return {
    id,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    meta: payload.meta ?? {},
    createdAt: new Date(),
  }
}

export const notificationsRouter = new Hono<AppEnv>()
notificationsRouter.use('*', requireAuth)

// ── SSE-стрим для staff/owner ────────────────────────────────────────────
notificationsRouter.get('/stream', requireRole('owner', 'staff'), async (c) => {
  // Канал уведомлений персонала — пер-клубный: суффикс по c.var.club?.id (на
  // основном домене → 'default'). Тот же канал, что использует notify() при publish.
  const channel = notifChannel(c.var.club?.id)
  const me = c.get('user').sub
  return streamSSE(c, async (stream) => {
    const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379')
    let closed = false

    await redis.subscribe(channel).catch(() => {})

    redis.on('message', async (ch, message) => {
      if (closed || ch !== channel) return
      try {
        // «Звонок» Android-телефонам (staff-calls.ts) — именованным событием: веб и iOS
        // слушают только безымянные и не примут его за уведомление.
        const signal = message.startsWith('{"__event"') ? (JSON.parse(message) as { __event: string; data: unknown }) : null
        if (signal) await stream.writeSSE({ event: signal.__event, data: JSON.stringify(signal.data) })
        else {
          // Личное уведомление (userId задан) — только его адресату.
          const target = (JSON.parse(message) as { userId?: string | null }).userId
          if (target && target !== me) return
          await stream.writeSSE({ data: message })
        }
      } catch {}
    })

    const hb = setInterval(() => {
      if (closed) return
      stream.writeSSE({ event: 'ping', data: '1' }).catch(() => {})
    }, 25_000)

    stream.onAbort(() => {
      closed = true
      clearInterval(hb)
      redis.unsubscribe(channel).catch(() => {})
      redis.disconnect()
    })

    // Держать соединение открытым до отмены
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (closed) { clearInterval(check); resolve() }
      }, 1000)
    })
  })
})

// ── POST /staff-call — планшет вызывает персонал ─────────────────────────
notificationsRouter.post(
  '/staff-call',
  requireRole('tablet', 'staff', 'owner'),
  zValidator('json', z.object({
    spaceId: z.string().uuid().optional(),
    message: z.string().max(200).optional(),
  })),
  async (c) => {
    const db = c.var.db
    const user = c.get('user')
    const body = c.req.valid('json')

    // Планшет зовёт только в свою зону (spaceId из тела не принимаем).
    let resolvedSpaceId = user.role === 'tablet' ? undefined : body.spaceId
    if (!resolvedSpaceId) {
      const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.sub))
      resolvedSpaceId = profile?.linkedSpaceId ?? undefined
    }

    let spaceName = 'Неизвестная зона'
    let checkId: string | undefined
    if (resolvedSpaceId) {
      const [space] = await db.select().from(spaces).where(eq(spaces.id, resolvedSpaceId))
      spaceName = space?.name ?? spaceName
      // Открытый счёт зоны — чтобы по уведомлению/звонку открыть сразу его.
      const [open] = await db.select({ id: checks.id }).from(checks)
        .where(and(eq(checks.spaceId, resolvedSpaceId), eq(checks.status, 'open')))
        .limit(1)
      checkId = open?.id
    }

    const text = body.message ?? 'Гость запросил помощь'
    const notification = await publishStaffNotification({
      type: 'staff_call',
      title: `Вызов: ${spaceName}`,
      body: text,
      meta: { spaceId: resolvedSpaceId, checkId, fromTabletId: user.sub },
    }, db, c.var.club?.id)

    // Никто не прочитал за 30 с — «звонок» на телефоны персонала.
    if (user.role === 'tablet') {
      await raiseStaffAlert(db, {
        kind: 'staff_call',
        spaceId: resolvedSpaceId ?? null,
        checkId: checkId ?? null,
        notificationId: notification.id,
        title: spaceName,
        body: 'Гость зовёт персонал',
        origin: requestOrigin(c),
        clubId: c.var.club?.id ?? null,
      })
    }

    return c.json({ ok: true, notification }, 201)
  },
)

// ── POST /request-bill — планшет запрашивает счёт ────────────────────────
notificationsRouter.post(
  '/request-bill',
  requireRole('tablet', 'staff', 'owner'),
  zValidator('json', z.object({
    checkId: z.string().uuid(),
  })),
  async (c) => {
    const db = c.var.db
    const user = c.get('user')
    const { checkId } = c.req.valid('json')

    const [check] = await db.select().from(checks).where(eq(checks.id, checkId))
    if (!check) return c.json({ error: 'Check not found' }, 404)

    // Полная сумма к оплате = позиции−скидки (check.totalAmount) + аренда зоны +
    // база события. totalAmount НЕ включает аренду/событие, поэтому раньше персонал
    // видел сумму без аренды. Считаем так же, как computeCheckGrandTotal / webhook.
    let spaceName = ''
    let rental = 0
    if (check.spaceId) {
      const [space] = await db.select().from(spaces).where(eq(spaces.id, check.spaceId))
      spaceName = space?.name ?? ''
      rental = computeRental(check.spaceStartAt, check.spaceEndAt, space?.hourlyRate, Date.now())
    }
    const itemsTotal = parseFloat(check.totalAmount) || 0
    const eventBase = parseFloat(check.eventBaseAmount ?? '0') || 0
    const grandTotal = round2(itemsTotal + rental + eventBase)
    const rentalNote = rental > 0 ? ` (в т.ч. аренда ${rental.toLocaleString('ru')} ₽)` : ''

    const notification = await publishStaffNotification({
      type: 'request_bill',
      title: spaceName ? `Запрос счёта: ${spaceName}` : 'Запрос счёта',
      body: `Сумма: ${grandTotal.toLocaleString('ru')} ₽${rentalNote}`,
      meta: { checkId, spaceId: check.spaceId, fromTabletId: user.sub },
    }, db, c.var.club?.id)

    return c.json({ ok: true, notification }, 201)
  },
)

notificationsRouter.get('/', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  // Owner/staff видят свои персональные уведомления + broadcast'ы персонала
  // (userId IS NULL — вызов официанта / запрос счёта). Клиенты — только свои,
  // чтобы не утекали служебные broadcast'ы.
  const isStaff = user.role === 'owner' || user.role === 'staff'
  const where = isStaff
    ? or(eq(notifications.userId, user.sub), isNull(notifications.userId))
    : eq(notifications.userId, user.sub)
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(50)
  return c.json({ notifications: rows })
})

notificationsRouter.put('/:id/read', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const isStaff = user.role === 'owner' || user.role === 'staff'
  // Персонал может отметить прочитанным как свой row, так и общий broadcast
  // (userId IS NULL). Клиент — только свои. Broadcast — общий row, поэтому
  // отметка прочтения у него общая для всего персонала (компромисс текущей
  // схемы: один is_read на строку).
  const owns = isStaff
    ? or(eq(notifications.userId, user.sub), isNull(notifications.userId))
    : eq(notifications.userId, user.sub)
  await db.update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, c.req.param('id')), owns))
  return c.json({ ok: true })
})

// PUT /read-by-check — отметить прочитанными уведомления, относящиеся к чеку
// (meta.checkId) или пространству (meta.spaceId, для staff_call без checkId),
// опционально только заданных типов. Нужно, чтобы при открытии чека/чата гасить
// «пульс» карточки и помечать уведомление прочитанным.
notificationsRouter.put('/read-by-check', zValidator('json', z.object({
  checkId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
  types: z.array(z.string()).optional(),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const isStaff = user.role === 'owner' || user.role === 'staff'
  if (!isStaff) return c.json({ ok: true })
  const { checkId, spaceId, types } = c.req.valid('json')
  const matchers: any[] = []
  if (checkId) matchers.push(sql`${notifications.meta}->>'checkId' = ${checkId}`)
  if (spaceId) matchers.push(sql`${notifications.meta}->>'spaceId' = ${spaceId}`)
  if (!matchers.length) return c.json({ ok: true })
  const conds: any[] = [
    or(eq(notifications.userId, user.sub), isNull(notifications.userId)),
    or(...(matchers as [any, ...any[]])),
    eq(notifications.isRead, false),
  ]
  if (types?.length) conds.push(inArray(notifications.type, types))
  await db.update(notifications).set({ isRead: true }).where(and(...(conds as [any, ...any[]])))
  return c.json({ ok: true })
})

notificationsRouter.put('/read-all', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const isStaff = user.role === 'owner' || user.role === 'staff'
  const where = isStaff
    ? or(eq(notifications.userId, user.sub), isNull(notifications.userId))
    : eq(notifications.userId, user.sub)
  await db.update(notifications).set({ isRead: true }).where(where)
  return c.json({ ok: true })
})

notificationsRouter.get('/settings', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const [settings] = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, user.sub))
  const [prof] = await db.select({ tgId: profiles.tgId }).from(profiles).where(eq(profiles.id, user.sub))
  return c.json({ settings: settings ?? null, telegramLinked: !!prof?.tgId })
})

notificationsRouter.put('/settings', zValidator('json', z.object({
  types: z.record(z.object({ enabled: z.boolean(), channel: z.string().optional(), telegram: z.boolean().optional() })),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { types } = c.req.valid('json')
  const [existing] = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, user.sub))
  if (existing) {
    await db.update(userNotificationSettings).set({ types, updatedAt: new Date() }).where(eq(userNotificationSettings.userId, user.sub))
  } else {
    await db.insert(userNotificationSettings).values({ userId: user.sub, types })
  }
  return c.json({ ok: true })
})

// ── Типы уведомлений (для экрана настроек) ───────────────────────────────
notificationsRouter.get('/types', (c) => {
  return c.json({ types: NOTIFICATION_TYPES })
})

// ── VAPID public key для подписки на push на клиенте ──────────────────────
notificationsRouter.get('/vapid-public-key', (c) => {
  return c.json({ key: process.env['VAPID_PUBLIC_KEY'] ?? '' })
})

// ── Подписка на web push ──────────────────────────────────────────────────
notificationsRouter.post(
  '/push/subscribe',
  zValidator('json', z.object({
    endpoint: z.string(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
    userAgent: z.string().optional(),
  })),
  async (c) => {
    const db = c.var.db
    const user = c.get('user')
    const { endpoint, keys, userAgent } = c.req.valid('json')
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.sub,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.sub, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? null },
      })
    return c.json({ ok: true })
  },
)

// ── Отписка от web push ───────────────────────────────────────────────────
notificationsRouter.post(
  '/push/unsubscribe',
  zValidator('json', z.object({ endpoint: z.string() })),
  async (c) => {
    const db = c.var.db
    const user = c.get('user')
    const { endpoint } = c.req.valid('json')
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.sub)))
    return c.json({ ok: true })
  },
)

// ── Тестовое push-уведомление самому себе ─────────────────────────────────
// ── Устройства приложения персонала Titan HUB: push и «звонки» (VoIP) ──────────
// Телефон присылает токены после входа и при их смене. Токены уникальны: телефон
// мог раньше принадлежать другому сотруднику — запись переезжает.
const StaffDeviceSchema = z.object({
  platform: z.enum(['ios', 'android']),
  pushToken: z.string().min(10).max(400).nullable().optional(),
  voipToken: z.string().min(10).max(400).nullable().optional(),
  deviceName: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
})

notificationsRouter.post('/devices', requireRole('owner', 'staff'), zValidator('json', StaffDeviceSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const b = c.req.valid('json')
  if (!b.pushToken && !b.voipToken) return c.json({ error: 'Нет токенов устройства' }, 400)
  const same: any[] = []
  if (b.pushToken) same.push(eq(appDevices.pushToken, b.pushToken))
  if (b.voipToken) same.push(eq(appDevices.voipToken, b.voipToken))
  await db.delete(appDevices).where(or(...(same as [any, ...any[]])))
  await db.insert(appDevices).values({
    profileId: user.sub,
    app: 'staff',
    platform: b.platform,
    pushToken: b.pushToken ?? null,
    voipToken: b.voipToken ?? null,
    deviceName: b.deviceName ?? null,
    appVersion: b.appVersion ?? null,
  })
  return c.json({ ok: true })
})

// Выход из приложения: телефон больше не получает push и звонки этого сотрудника.
notificationsRouter.delete('/devices', requireRole('owner', 'staff'), zValidator('json', z.object({
  pushToken: z.string().max(400).nullable().optional(),
  voipToken: z.string().max(400).nullable().optional(),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const b = c.req.valid('json')
  const same: any[] = []
  if (b.pushToken) same.push(eq(appDevices.pushToken, b.pushToken))
  if (b.voipToken) same.push(eq(appDevices.voipToken, b.voipToken))
  if (same.length) {
    await db.delete(appDevices).where(and(eq(appDevices.profileId, user.sub), eq(appDevices.app, 'staff'), or(...(same as [any, ...any[]]))))
  }
  return c.json({ ok: true })
})

notificationsRouter.post('/push/test', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  void notify({
    type: 'test',
    title: 'Titan HUB',
    body: 'Тестовое уведомление 🔔',
    userId: user.sub,
  }, db, c.var.club?.id).catch(() => {})
  return c.json({ ok: true })
})

notificationsRouter.post('/tg-link', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  // Generate a 6-digit code stored as tgId pending (crypto-random)
  const code = String(randomInt(100000, 1000000))
  await db.insert(tgLinkRequests).values({
    profileId: user.sub,
    tgId: code,
    status: 'pending',
  })
  return c.json({ code })
})
