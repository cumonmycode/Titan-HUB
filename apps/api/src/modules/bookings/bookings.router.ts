/**
 * Онлайн-бронирование зон — клиентский конструктор мероприятия.
 *
 * Публичная сторона (без авторизации, ДО requireActiveSubscription): /config —
 * данные виджета (локации, кабинки+ставка, тарифы по часам); POST / — заявка с
 * выдачей claim_token (узнавание клиента); GET/PATCH /:token — статус и правки по
 * токену без авторизации (токен = секрет в localStorage гостя). Внутренняя (auth):
 * список + смена статуса; подтверждение создаёт planned-мероприятие (titan/exit,
 * кабинка, плановые часы) и пишет event_id.
 *
 * Таблица bookings — raw SQL; мероприятия/справочники — drizzle.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sql, events, spaces, appSettings, eventHourlyRates, profiles, customers, eq, and, isNull, inArray, asc } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { notify } from '../notifications/push.js'
import { getSharedRedis } from '../../lib/redis.js'
import { clientIp } from '../../lib/clientIp.js'
import { findOverlappingEvent, lockEventBooking } from '../events/events.router.js'
import { cancelEventTx } from '../events/eventLifecycle.js'
import { publishEvent } from '../../lib/realtime.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}
function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h! * 60 + m!) + Math.round(hours * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
// timestamptz → дата/время в МСК.
function mskParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }
}

// ─── Анти-перебор для публичного lookup ──────────────────────────────────────
// Отдельный (поверх глобального per-IP) узкий лимит ИМЕННО на /lookup: перебор
// телефонов жертв для раскрытия их броней. Лимитируем И по IP, И по телефону —
// чтобы нельзя было ни долбить один номер, ни сканировать диапазон номеров с
// одного IP. Скоупим ключ по клубу (мультитенант), чтобы лимит одного клуба не
// влиял на другой. Fail-open при недоступности Redis (как глобальный rateLimit).
const LOOKUP_MAX_PER_WINDOW = parseInt(process.env['BOOKING_LOOKUP_LIMIT'] ?? '10')
const LOOKUP_WINDOW_SECONDS = 60
// Создание брони (POST /): тот же приём, но окно шире — заявки не шлют пачками;
// защита от спама заявками владельцу (каждая — пуш) и засорения списка броней.
const CREATE_MAX_PER_WINDOW = parseInt(process.env['BOOKING_CREATE_LIMIT'] ?? '5')
const CREATE_WINDOW_SECONDS = 600

async function publicRateLimited(
  prefix: string, clubId: string, ip: string, phoneTail: string, max: number, windowSeconds: number,
): Promise<boolean> {
  try {
    const redis = getSharedRedis()
    const scope = clubId || 'default'
    // Два независимых окна: по IP и по телефону. Превышение любого = блок.
    const keys = [`${prefix}:ip:${scope}:${ip}`, `${prefix}:ph:${scope}:${phoneTail}`]
    for (const key of keys) {
      const current = await redis.incr(key)
      if (current === 1) await redis.expire(key, windowSeconds)
      if (current > max) return true
    }
    return false
  } catch {
    // Redis недоступен — не блокируем легитимных гостей (доступность важнее).
    return false
  }
}
const lookupRateLimited = (clubId: string, ip: string, phoneTail: string) =>
  publicRateLimited('bl', clubId, ip, phoneTail, LOOKUP_MAX_PER_WINDOW, LOOKUP_WINDOW_SECONDS)
const createRateLimited = (clubId: string, ip: string, phoneTail: string) =>
  publicRateLimited('bc', clubId, ip, phoneTail, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_SECONDS)

// Начало брони гостя: календарно существующая дата + время 00:00–23:59, не в прошлом.
// Иначе Postgres падал на касте «2026-02-31»/«25:99» (500), а заявка «на вчера»
// уходила владельцу. Возвращает текст ошибки для 400 или null.
function startError(date: string, time: string): string | null {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return 'Такой даты нет — проверьте день и месяц'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Время указано неверно — нужно ЧЧ:ММ от 00:00 до 23:59'
  if (new Date(`${date}T${time}:00+03:00`).getTime() < Date.now()) return 'Это время уже прошло — выберите будущую дату'
  return null
}

// Дата/время/зона/часы, которые видит гость: после подтверждения бронь живёт как
// мероприятие, и персонал может его перенести (время, зона) — показываем актуальное
// из events, а не исходную заявку. ev/es/s — алиасы events/spaces в запросах ниже.
const guestStartsAt = sql`CASE WHEN ev.id IS NOT NULL THEN ((ev.date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Europe/Moscow') ELSE b.starts_at END`
const guestZoneName = sql`CASE WHEN ev.id IS NOT NULL THEN es.name ELSE s.name END`
const guestHours = sql`COALESCE(ev.planned_hours, b.tariff_hours)`

// ─── Публичный роутер (без авторизации) ──────────────────────────────────────
export const bookingsPublicRouter = new Hono<AppEnv>()

bookingsPublicRouter.get('/config', async (c) => {
  const db = c.var.db
  const sx = await db.select().from(appSettings)
    .where(inArray(appSettings.key, ['booking_enabled', 'venue_name', 'venue_address', 'hours_open', 'hours_close']))
  const m = Object.fromEntries(sx.map((r) => [r.key, r.value]))
  if (m['booking_enabled'] !== 'true') return c.json({ enabled: false })

  const cabins = await db.select({ id: spaces.id, name: spaces.name, capacity: spaces.capacity, hourlyRate: spaces.hourlyRate })
    .from(spaces).where(eq(spaces.isActive, true))
  const tariffs = await db.select({ hours: eventHourlyRates.hours, price: eventHourlyRates.price })
    .from(eventHourlyRates).orderBy(asc(eventHourlyRates.hours))

  return c.json({
    enabled: true,
    clubName: m['venue_name'] || 'Titan',
    venueAddress: m['venue_address'] || '',
    hoursOpen: m['hours_open'] || '',
    hoursClose: m['hours_close'] || '',
    cabins,
    tariffs,
  })
})

// Узнавание клиента по номеру телефона: возвращает его брони (по цифрам, последние
// 10 — без привязки к устройству). Регистрируется ДО /:token, чтобы не перехватился.
//
// БЕЗОПАСНОСТЬ (P1): этот эндпоинт публичный и не подтверждает владение номером.
// Раньше он отдавал claim_token — секрет УПРАВЛЕНИЯ бронью (PATCH/отмена по токену).
// Любой, зная 10 цифр телефона жертвы, получал её токен и мог угнать/отменить бронь.
// Теперь:
//   1) claim_token из ответа УБРАН — lookup даёт только ПРОСМОТР брони (статус, дата,
//      зона, число гостей). Управление осталось доступно лишь владельцу токена,
//      который выдаётся ОДИН раз при создании брони (POST /) и хранится у гостя в
//      localStorage (то же устройство). Это сохраняет полезную функцию «увидеть свою
//      бронь по телефону», но не раздаёт управляющий секрет произвольному запросившему.
//   2) ПДн ужаты: телефон/имя/комментарий из ответа убраны — по чужому номеру нельзя
//      выкачать персональные данные. Гость и так знает свои имя/телефон.
//   3) Добавлен узкий per-IP + per-phone rate-limit против перебора номеров.
bookingsPublicRouter.get('/lookup', async (c) => {
  const db = c.var.db
  const tail = (c.req.query('phone') || '').replace(/\D/g, '').slice(-10)
  if (tail.length < 10) return c.json({ bookings: [] })

  // Анти-перебор: блокируем сканирование диапазона номеров с одного IP и долбёжку
  // одного номера. Возвращаем 429, а не пустой список, чтобы не маскировать причину.
  const limited = await lookupRateLimited(c.var.club?.id ?? '', clientIp(c), tail)
  if (limited) return c.json({ error: 'Слишком много запросов, попробуйте позже' }, 429)

  const res = await db.execute(sql`
    SELECT b.id, b.status, b.location, b.address, b.title, ${guestZoneName} AS zone_name, ${guestHours} AS tariff_hours, b.guests,
           ${guestStartsAt} AS starts_at, b.created_at, ev.status AS event_status
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN events ev ON ev.id = b.event_id
    LEFT JOIN spaces es ON es.id = ev.space_id
    WHERE right(regexp_replace(coalesce(b.phone, ''), '[^0-9]', '', 'g'), 10) = ${tail}
    ORDER BY starts_at DESC -- выходной столбец (актуальное время мероприятия)
    LIMIT 20
  `)
  return c.json({ bookings: rows(res) })
})

const CreateSchema = z.object({
  location: z.enum(['titan', 'exit']),
  title: z.string().max(160).optional(),
  address: z.string().max(300).optional(),
  spaceId: z.string().uuid().optional(),
  tariffHours: z.number().int().min(1).max(24).optional(),
  guests: z.number().int().min(1).max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  comment: z.string().max(500).optional(),
})

bookingsPublicRouter.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = c.var.db
  const [en] = await db.select().from(appSettings).where(eq(appSettings.key, 'booking_enabled')).limit(1)
  if (en?.value !== 'true') return c.json({ error: 'Бронирование отключено' }, 403)
  const b = c.req.valid('json')
  const phoneTail = b.phone.replace(/\D/g, '').slice(-10)
  if (phoneTail.length < 10) return c.json({ error: 'Укажите номер телефона полностью' }, 400)

  // Анти-спам: узкий лимит заявок по IP и по телефону (как у /lookup).
  if (await createRateLimited(c.var.club?.id ?? '', clientIp(c), phoneTail)) {
    return c.json({ error: 'Слишком много заявок, попробуйте позже' }, 429)
  }

  const badStart = startError(b.date, b.time)
  if (badStart) return c.json({ error: badStart }, 400)

  // Зона — только существующая и активная (виджет показывает лишь активные).
  if (b.spaceId) {
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, b.spaceId), eq(spaces.isActive, true))).limit(1)
    if (!space) return c.json({ error: 'Эта зона сейчас недоступна для брони — выберите другую' }, 400)
  }

  const startsAt = `${b.date}T${b.time}:00+03:00`
  const token = randomUUID()

  // Дедуп: та же ожидающая заявка (телефон + начало) — повторная отправка формы /
  // двойной тап. Проверка и вставка — под advisory-lock по (телефон, начало), чтобы два
  // одновременных запроса не создали две брони. Токен существующей брони НЕ отдаём:
  // знание телефона и времени не даёт права управлять чужой бронью (см. /lookup) —
  // гость, отправивший её первым, токен уже получил.
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`booking-create:${phoneTail}:${startsAt}`}, 0))`)
    const dup = await tx.execute(sql`
      SELECT id FROM bookings
      WHERE status = 'new' AND starts_at = ${startsAt}::timestamptz
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneTail}
      LIMIT 1
    `)
    const existingId = rows<{ id: string }>(dup)[0]?.id
    if (existingId) return { id: existingId, duplicate: true }
    const res = await tx.execute(sql`
      INSERT INTO bookings (space_id, name, phone, guests, starts_at, duration_hours, comment, status, source, location, address, tariff_hours, claim_token, title)
      VALUES (${b.spaceId ?? null}, ${b.name}, ${b.phone}, ${b.guests ?? null}, ${startsAt}::timestamptz,
              ${b.tariffHours ?? null}, ${b.comment ?? null}, 'new', 'widget',
              ${b.location}, ${b.location === 'exit' ? (b.address ?? null) : null}, ${b.tariffHours ?? null}, ${token}, ${b.title ?? null})
      RETURNING id
    `)
    return { id: rows<{ id: string }>(res)[0]?.id, duplicate: false }
  })
  if (created.duplicate) return c.json({ ok: true, id: created.id, token: null, duplicate: true })
  const id = created.id

  // Выезд = заказчик мероприятия: сохраняем имя+телефон в справочник «Заказчики».
  // Дедуп по ЦИФРАМ номера (последние 10) — устойчиво к формату и префиксу 8/+7,
  // чтобы тот же телефон в другом написании не плодил дубль. Не валит ответ гостю.
  if (b.location === 'exit' && b.phone) {
    try {
      const tail = b.phone.replace(/\D/g, '').slice(-10)
      let exists = false
      if (tail.length >= 10) {
        const found = await db.execute(sql`
          SELECT id FROM customers
          WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${tail}
          LIMIT 1
        `)
        exists = rows(found).length > 0
      }
      if (!exists) await db.insert(customers).values({ name: b.name ?? null, phone: b.phone })
    } catch { /* non-fatal */ }
  }

  try {
    const owners = await db.select({ id: profiles.id }).from(profiles)
      .where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))
    const where = b.location === 'exit' ? 'выезд' : 'Штаб'
    const body = `${b.title ? b.title + ' · ' : ''}${b.name} · ${where} · ${b.date} ${b.time}${b.guests ? ` · ${b.guests} гост.` : ''}`
    for (const o of owners) {
      await notify({ type: 'booking', title: '🗓️ Новая бронь', body, meta: { bookingId: id, url: '/events' }, userId: o.id }, db, c.var.club?.id)
    }
  } catch { /* non-fatal */ }

  return c.json({ ok: true, id, token })
})

// Статус брони по токену (узнавание клиента, без авторизации).
bookingsPublicRouter.get('/:token', async (c) => {
  const db = c.var.db
  const token = c.req.param('token')
  const res = await db.execute(sql`
    SELECT b.id, b.status, b.location, b.address, b.title, ${guestZoneName} AS zone_name, ${guestHours} AS tariff_hours, b.guests,
           ${guestStartsAt} AS starts_at, b.name, b.phone, b.comment, b.created_at, ev.status AS event_status
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN events ev ON ev.id = b.event_id
    LEFT JOIN spaces es ON es.id = ev.space_id
    WHERE b.claim_token = ${token} LIMIT 1
  `)
  const bk = rows(res)[0]
  if (!bk) return c.json({ error: 'not found' }, 404)
  return c.json({ booking: bk })
})

const PublicPatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  guests: z.number().int().min(1).max(500).nullable().optional(),
  tariffHours: z.number().int().min(1).max(24).nullable().optional(),
  address: z.string().max(300).optional(),
  comment: z.string().max(500).optional(),
  cancel: z.boolean().optional(),
})

// Правка/отмена брони гостем по токену — пока статус 'new'.
bookingsPublicRouter.patch('/:token', zValidator('json', PublicPatchSchema), async (c) => {
  const db = c.var.db
  const token = c.req.param('token')
  const b = c.req.valid('json')
  const res = await db.execute(sql`SELECT * FROM bookings WHERE claim_token = ${token} LIMIT 1`)
  const bk = rows<Record<string, unknown>>(res)[0]
  if (!bk) return c.json({ error: 'not found' }, 404)
  if (bk['status'] !== 'new') return c.json({ error: 'Бронь уже обработана — правки недоступны' }, 409)

  // Проверка статуса выше — по снимку; персонал мог подтвердить бронь между чтением
  // и записью. Поэтому и в UPDATE условие status = 'new': иначе гость отменил бы/
  // перенёс уже подтверждённую бронь, у которой есть мероприятие.
  const processed = () => c.json({ error: 'Бронь уже обработана — правки недоступны' }, 409)

  if (b.cancel) {
    const cancelled = await db.execute(sql`
      UPDATE bookings SET status = 'cancelled', updated_at = now()
      WHERE claim_token = ${token} AND status = 'new' RETURNING id
    `)
    if (!rows(cancelled).length) return processed()
    return c.json({ ok: true, status: 'cancelled' })
  }

  const cur = mskParts(bk['starts_at'] as string)
  const date = b.date ?? cur.date
  const time = b.time ?? cur.time
  // Проверяем только перенос: форма шлёт дату/время и при правке одного комментария.
  if (date !== cur.date || time !== cur.time) {
    const badStart = startError(date, time)
    if (badStart) return c.json({ error: badStart }, 400)
  }
  const startsAt = `${date}T${time}:00+03:00`

  const upd = await db.execute(sql`
    UPDATE bookings SET
      starts_at = ${startsAt}::timestamptz,
      guests = ${b.guests !== undefined ? b.guests : (bk['guests'] as number | null)},
      tariff_hours = ${b.tariffHours !== undefined ? b.tariffHours : (bk['tariff_hours'] as number | null)},
      duration_hours = ${b.tariffHours !== undefined ? b.tariffHours : (bk['duration_hours'] as number | null)},
      address = ${b.address !== undefined ? b.address : (bk['address'] as string | null)},
      comment = ${b.comment !== undefined ? b.comment : (bk['comment'] as string | null)},
      updated_at = now()
    WHERE claim_token = ${token} AND status = 'new'
    RETURNING id
  `)
  if (!rows(upd).length) return processed()
  return c.json({ ok: true })
})

// ─── Внутренний роутер (авторизация) ─────────────────────────────────────────
export const bookingsRouter = new Hono<AppEnv>()
bookingsRouter.use('*', requireAuth)

bookingsRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const status = c.req.query('status')
  const res = await db.execute(sql`
    SELECT b.id, b.space_id, s.name AS zone_name, b.name, b.phone, b.guests, b.title,
           b.starts_at, b.duration_hours, b.tariff_hours, b.location, b.address,
           b.comment, b.status, b.source, b.event_id, b.created_at
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    ${status ? sql`WHERE b.status = ${status}` : sql``}
    ORDER BY b.starts_at DESC
    LIMIT 300
  `)
  return c.json({ bookings: rows(res) })
})

// «Старые брони» — брони пространств штаба, чьё мероприятие уже завершено (чек
// закрыт → событие completed). Для одноимённого раздела в «Мероприятиях».
bookingsRouter.get('/archive', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  // Дата/время/зона/часы — фактические, из мероприятия (персонал мог его перенести).
  const res = await db.execute(sql`
    SELECT b.id, COALESCE(ev.space_id, b.space_id) AS space_id, ${guestZoneName} AS zone_name, b.name, b.phone, b.guests, b.title,
           ${guestStartsAt} AS starts_at, ${guestHours} AS tariff_hours, b.location, b.address, b.comment, b.status,
           b.event_id, ev.status AS event_status, ch.total_amount AS check_total
    FROM bookings b
    JOIN events ev ON ev.id = b.event_id
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN spaces es ON es.id = ev.space_id
    LEFT JOIN checks ch ON ch.id = ev.check_id
    WHERE b.space_id IS NOT NULL AND b.location = 'titan' AND ev.status = 'completed'
    ORDER BY starts_at DESC -- выходной столбец (актуальное время мероприятия)
    LIMIT 200
  `)
  return c.json({ bookings: rows(res) })
})

const PatchSchema = z.object({ status: z.enum(['new', 'confirmed', 'cancelled', 'done']) })

bookingsRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', PatchSchema), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const { status } = c.req.valid('json')
  const user = c.get('user')

  // Подтверждение — в ОДНОЙ транзакции: строка брони под FOR UPDATE (два параллельных
  // подтверждения не создадут два мероприятия — второе увидит event_id первого), а
  // проверка пересечения и вставка события — под тем же advisory-lock (зона, дата),
  // что и POST /events, иначе бронь с сайта могла занять уже занятую зону.
  type R =
    | { kind: 'not_found' }
    | { kind: 'conflict'; event: typeof events.$inferSelect }
    | { kind: 'refused'; error: string }
    | { kind: 'ok'; eventId: string | null; cancelledCheckIds: string[] }
  const result = await db.transaction<R>(async (tx) => {
    const res = await tx.execute(sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1 FOR UPDATE`)
    const bk = rows<Record<string, unknown>>(res)[0]
    if (!bk) return { kind: 'not_found' }

    // Подтверждается только новая заявка: отменённую гостем (или персоналом) бронь
    // подтверждение воскрешало бы — с мероприятием на уже освобождённое время.
    if (status === 'confirmed' && bk['status'] !== 'new') {
      return { kind: 'refused', error: bk['status'] === 'cancelled' ? 'Бронь уже отменена — подтвердить её нельзя' : 'Бронь уже обработана' }
    }

    let eventId = (bk['event_id'] as string | null) ?? null

    // Отмена брони, по которой уже создано мероприятие: отменяем и его (та же логика,
    // что отмена мероприятия — чеки, склад, расходы), иначе гостю «Отменена», а в
    // календаре клуба мероприятие живёт дальше. Идущее/завершённое — не трогаем.
    let cancelledCheckIds: string[] = []
    if (status === 'cancelled' && eventId) {
      const [ev] = await tx.select({ status: events.status }).from(events).where(eq(events.id, eventId)).for('update')
      if (ev?.status === 'active') return { kind: 'refused', error: 'Мероприятие уже идёт — сначала завершите или отмените его' }
      if (ev?.status === 'completed') return { kind: 'refused', error: 'Мероприятие по этой брони уже завершено' }
      if (ev && ev.status !== 'cancelled') {
        cancelledCheckIds = (await cancelEventTx(tx, eventId, user.sub))?.cancelledCheckIds ?? []
      }
    }
    if (status === 'confirmed' && !eventId) {
      const { date, time } = mskParts(bk['starts_at'] as string)
      const hours = bk['tariff_hours'] != null ? Number(bk['tariff_hours']) : (bk['duration_hours'] != null ? Number(bk['duration_hours']) : 0)
      const endTime = hours > 0 ? addHours(time, hours) : null
      const isExit = bk['location'] === 'exit'
      const spaceId = (bk['space_id'] as string | null) ?? null
      if (!isExit && spaceId) {
        // Те же блокировки, что у POST /events: дата брони и, если она за полночь, следующая.
        await lockEventBooking(tx, { spaceId, date, startTime: time, endTime, plannedHours: hours > 0 ? hours : null })
        const overlap = await findOverlappingEvent(tx, {
          type: 'titan', spaceId, date, startTime: time, endTime, plannedHours: hours > 0 ? hours : null,
        })
        if (overlap) return { kind: 'conflict', event: overlap }
      }
      const [ev] = await tx.insert(events).values({
        type: isExit ? 'exit' : 'titan',
        title: (bk['title'] as string | null) || `Бронь: ${String(bk['name'])}`,
        location: isExit ? ((bk['address'] as string | null) ?? null) : 'TITAN',
        spaceId,
        date,
        startTime: time,
        endTime,
        paymentType: 'fixed',
        // Кабинка в клубе: виджет обещает гостю «ставка зоны × часы, итог по факту» —
        // значит, чек по ставке зоны живым счётчиком. Выезд — пакет мероприятия по часам.
        billingMode: !isExit && spaceId ? 'rental' : 'hourly',
        plannedHours: hours > 0 ? hours : null,
        status: 'planned',
        customerName: String(bk['name']),
        customerPhone: String(bk['phone']),
        comment: (bk['comment'] as string | null) ?? null,
        format: 'regular',
        createdBy: user.sub,
      }).returning()
      eventId = ev?.id ?? null
    }

    await tx.execute(sql`UPDATE bookings SET status = ${status}, event_id = ${eventId}, updated_at = now() WHERE id = ${id}`)
    return { kind: 'ok', eventId, cancelledCheckIds }
  })

  if (result.kind === 'not_found') return c.json({ error: 'not found' }, 404)
  if (result.kind === 'refused') return c.json({ error: result.error }, 409)
  if (result.kind === 'conflict') {
    const cf = result.event
    return c.json({
      error: 'На это время зона уже занята другим мероприятием — измените время брони или зону',
      conflict: { id: cf.id, title: cf.title, startTime: cf.startTime, endTime: cf.endTime },
    }, 409)
  }
  for (const checkId of result.cancelledCheckIds) publishEvent(c.var.club?.id, 'check:deleted', { checkId })
  const eventId = result.eventId
  return c.json({ ok: true, status, eventId })
})
