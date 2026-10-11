import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Database } from '@titan/database'
import {
  events, eventHourlyRates, eventParticipants, checks, checkItems, checkPayments, inventory, customers, expenses, profiles, spaces,
  eq, and, gte, lte, asc, desc, sql, or, ne, isNull, inArray,
} from '@titan/database'

// Хелперы вызываются и вне транзакции (db = c.var.db), и внутри db.transaction
// (tx). Поверхность query-builder совпадает — принимаем оба.
type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getCurrentShift } from '../shifts/shifts.service.js'
import { reverseCheckMovements } from '../inventory/ledger.js'
import { bizDayStr } from '../../lib/dateFmt.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'
import { notify } from '../notifications/push.js'
import { publishEvent } from '../../lib/realtime.js'
import { cancelEventChecksTx, cancelEventTx, completeMinicapIfDone } from './eventLifecycle.js'

const num = (v: unknown) => { const n = parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0 }

// Расходы миникапа (приз/обед/иные) → строки expenses с привязкой к событию.
// Апсерт по idempotencyKey, чтобы редактирование не плодило дубликаты; 0 → удалить.
async function upsertEventCosts(exec: any, ev: { id: string; title: string | null; date: string; prizeFund: unknown; lunchCost: unknown; otherCost: unknown; createdBy: string }) {
  const buckets: [string, string, number][] = [
    ['prize', 'Призовой фонд', num(ev.prizeFund)],
    ['lunch', 'Обед', num(ev.lunchCost)],
    ['other', 'Иные расходы', num(ev.otherCost)],
  ]
  const label = ev.title ? ` «${ev.title}»` : ''
  for (const [key, name, amount] of buckets) {
    const idem = `minicap:${ev.id}:${key}`
    if (amount > 0) {
      await exec.insert(expenses).values({
        idempotencyKey: idem, category: 'other', amount: String(amount),
        description: `Миникап${label}: ${name}`, expenseDate: ev.date, eventId: ev.id, createdBy: ev.createdBy,
      }).onConflictDoUpdate({
        target: expenses.idempotencyKey,
        set: { amount: String(amount), description: `Миникап${label}: ${name}`, expenseDate: ev.date, eventId: ev.id },
      })
    } else {
      await exec.delete(expenses).where(eq(expenses.idempotencyKey, idem))
    }
  }
}

// Открыть индивидуальный чек участнику миникапа: игроку база = взнос; судье = 0
// (бар платит). prepaid_amount = взнос, если отмечена предоплата.
async function openParticipantCheck(exec: any, ev: any, p: any, shiftId: string, staffId: string): Promise<string> {
  const isJudge = p.role === 'judge'
  const fee = isJudge ? 0 : num(ev.participationFee)
  const prepaid = (!isJudge && p.prepaid) ? fee : 0
  const [chk] = await exec.insert(checks).values({
    staffId, shiftId, status: 'open', playerId: p.profileId,
    linkedEventId: ev.id, eventBaseAmount: String(fee), prepaidAmount: String(prepaid),
    note: `Миникап${ev.title ? ' «' + ev.title + '»' : ''}${isJudge ? ' · судья' : ''}`,
    totalAmount: '0',
  }).returning()
  await exec.update(eventParticipants).set({ checkId: chk!.id }).where(eq(eventParticipants.id, p.id))
  return chk!.id
}

// Привязанный чек годится при (повторном) старте, только если он ОТКРЫТ.
// Отмена мероприятия отменяет чеки, но ссылки events.checkId/participants.checkId
// остаются — при новом старте такой чек считаем отсутствующим и открываем новый.
// Закрытый (оплаченный) чек тоже не «живой»: иначе старт переиспользовал бы его и
// событие шло бы без открытого счёта.
async function hasLiveCheck(exec: DbOrTx, checkId: string | null | undefined): Promise<boolean> {
  if (!checkId) return false
  const [chk] = await exec.select({ status: checks.status }).from(checks).where(eq(checks.id, checkId)).limit(1)
  return !!chk && chk.status === 'open'
}

// Открытый чек на зоне (аренда идёт). Одна аренда на зону — как POST /pos/checks;
// иначе старт «По ставке зоны» падал бы на uniq_one_open_rental_per_space (500)
// или двоил тарификацию. exceptCheckId — собственный чек события.
async function openCheckOnSpace(exec: DbOrTx, spaceId: string, exceptCheckId?: string | null): Promise<boolean> {
  const conds = [eq(checks.spaceId, spaceId), eq(checks.status, 'open')]
  if (exceptCheckId) conds.push(ne(checks.id, exceptCheckId))
  const [row] = await exec.select({ id: checks.id }).from(checks).where(and(...conds)).limit(1)
  return !!row
}

const SPACE_OCCUPIED_ERROR = 'Зона уже занята другим открытым чеком — закройте его в кассе или выберите другую зону'

// Неуспех уникального индекса «одна открытая аренда на зону» (гонка двух стартов).
const isSpaceRentalConflict = (err: any) => err?.code === '23505' && err?.constraint === 'uniq_one_open_rental_per_space'

const EventSchema = z.object({
  type: z.enum(['titan', 'exit']).default('titan'),
  title: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  spaceId: z.string().uuid().optional().nullable(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string().optional().nullable(),
  paymentType: z.enum(['fixed', 'free']).default('fixed'),
  // amount = «Фикс» (ручная сумма fixedAmount), hourly = «Пакет по часам» (plannedHours →
  // тариф мероприятий), rental = «По ставке зоны» (аренда зоны живым счётчиком в чеке).
  billingMode: z.enum(['amount', 'hourly', 'rental']).default('amount'),
  fixedAmount: z.number().optional().nullable(),
  manualAmount: z.number().optional().nullable(),
  plannedHours: z.number().int().min(1).max(24).optional().nullable(),
  maxGuests: z.number().int().positive().optional().nullable(),
  status: z.enum(['planned', 'needs_clarification', 'active', 'completed', 'cancelled']).default('planned'),
  comment: z.string().optional().nullable(),
  reminders: z.array(z.string()).default([]),
  responsibleStaffId: z.string().uuid().optional().nullable(),
  customerName: z.string().optional().nullable(),
  customerPhone: z.string().optional().nullable(),
  // Миникап: формат + взнос + расходы события.
  format: z.enum(['regular', 'minicap']).default('regular'),
  participationFee: z.number().optional().nullable(),
  prizeFund: z.number().optional().nullable(),
  lunchCost: z.number().optional().nullable(),
  otherCost: z.number().optional().nullable(),
})

// Базовая сумма события для чека. «Фикс» (amount) → ручная/фикс сумма; «Пакет по часам»
// (hourly) → цена тарифа event_hourly_rates по plannedHours (за весь период);
// «По ставке зоны» (rental) → 0: деньги считает аренда зоны в самом чеке.
async function computeEventBase(database: DbOrTx, ev: {
  billingMode: string
  manualAmount: string | null; fixedAmount: string | null
  plannedHours: number | null
}): Promise<number> {
  if (ev.billingMode === 'rental') return 0
  if (ev.billingMode === 'hourly') {
    const h = ev.plannedHours ?? 0
    if (!h) return 0
    return hourlyPackagePrice(database, h)
  }
  if (ev.manualAmount != null) return parseFloat(ev.manualAmount) || 0
  if (ev.fixedAmount != null) return parseFloat(ev.fixedAmount) || 0
  return 0
}

// Цена пакета мероприятия на h часов. Точный тариф — как есть. Если на это число
// часов тарифа нет (раньше выходило 0 ₽ и чек «не считался»): берём ближайший
// меньший пакет и досчитываем остаток по его цене часа; если меньших нет — по цене
// часа ближайшего большего пакета.
async function hourlyPackagePrice(database: DbOrTx, h: number): Promise<number> {
  const rates = (await database.select().from(eventHourlyRates).orderBy(asc(eventHourlyRates.hours)))
    .map((r) => ({ hours: r.hours, price: parseFloat(String(r.price)) || 0 }))
    .filter((r) => r.hours > 0)
  const exact = rates.find((r) => r.hours === h)
  if (exact) return exact.price
  const lower = rates.filter((r) => r.hours < h).pop()
  if (lower) return Math.round(lower.price + (h - lower.hours) * (lower.price / lower.hours))
  const upper = rates.find((r) => r.hours > h)
  if (upper) return Math.round(h * (upper.price / upper.hours))
  return 0
}

// Часы события по времени начала/конца (через полночь — на следующий день),
// округление вверх: начатый час — целый. null — конец не задан.
function hoursBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const toMin = (t: string) => { const [hh, mm] = t.split(':').map(Number); return (hh || 0) * 60 + (mm || 0) }
  let diff = toMin(end) - toMin(start)
  if (diff <= 0) diff += 24 * 60
  const hours = Math.ceil(diff / 60)
  return hours >= 1 && hours <= 24 ? hours : null
}

export const eventsRouter = new Hono<AppEnv>()
eventsRouter.use('*', requireAuth)

// Стабильный ключ для advisory-lock брони: одна зона на одну календарную дату.
// Конкурентные брони этой пары сериализуются (см. POST/PATCH ниже и подтверждение
// онлайн-брони в bookings.router).
export const bookingLockKey = (spaceId: string, date: string) => `event-booking:${spaceId}:${date}`

// Ключи advisory-lock брони: дата события, а у ночного (конец на следующие сутки) —
// и следующая дата. Пересекающиеся по времени брони занимают хотя бы одни общие
// сутки → у них есть общий ключ. Порядок по возрастанию — у всех транзакций один,
// поэтому захват двух ключей не даёт дедлока.
export function bookingLockKeys(b: { spaceId: string; date: string; startTime: string; endTime?: string | null; plannedHours?: number | null }): string[] {
  const keys = [bookingLockKey(b.spaceId, b.date)]
  const next = crossesMidnight(b.startTime, b.endTime, b.plannedHours) ? shiftDate(b.date, 1) : null
  if (next) keys.push(bookingLockKey(b.spaceId, next))
  return keys.sort()
}

/** Взять advisory-lock'и брони зоны (см. bookingLockKeys) до конца транзакции. */
export async function lockEventBooking(tx: DbOrTx, b: Parameters<typeof bookingLockKeys>[0]) {
  for (const key of bookingLockKeys(b)) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
  }
}

// Пересечение брони, обнаруженное ВНУТРИ транзакции PATCH (под advisory-lock).
// Бросаем как ошибку, чтобы откатить транзакцию и вернуть 409 в catch.
class EventOverlapError extends Error {
  constructor(public event: typeof events.$inferSelect) {
    super('EVENT_OVERLAP')
  }
}

// ── Утилита: проверка пересечения событий по пространству ────────────────
// Время в БД — text (date='YYYY-MM-DD', start/end='HH:MM'). Сравнивать строки
// напрямую нельзя: (1) при endTime=null окно вырождалось в точку — события 19:00
// и 19:30 не пересекались; (2) лексикографическое сравнение ломается на событиях
// через полночь (22:00→02:00), где конец < начала. Поэтому строим из date+time
// настоящие timestamp'ы и применяем стандартный предикат aStart < bEnd AND bStart < aEnd.
//
// Длительность по умолчанию (если endTime не задан) берём из остального кода:
// hourly-аренда → plannedHours; иначе — 2 часа (типовая бронь зоны). Ночные
// события (end < start) считаем переходящими на следующие сутки (+1 день).
const defaultEventHours = (plannedHours?: number | null) => (plannedHours && plannedHours > 0 ? plannedHours : 2)

// Заканчивается ли событие на следующие сутки — по правилам eventEndExpr.
function crossesMidnight(start: string, end: string | null | undefined, plannedHours?: number | null): boolean {
  if (end) return end < start
  const [hh, mm] = start.split(':').map(Number)
  return (hh || 0) * 60 + (mm || 0) + defaultEventHours(plannedHours) * 60 > 24 * 60
}

// 'YYYY-MM-DD' ± дни по календарю. null — дата не в этом формате.
function shiftDate(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Начало и конец нового события как SQL-выражения timestamp (те же правила, что
// eventEndExpr). Сдвиг на сутки — интервалом: литерал '… +1 day' Postgres не разбирает.
function eventInterval(date: string, start: string, end: string | null | undefined, plannedHours?: number | null) {
  const startTs = `${date} ${start}`
  const aStart = sql`${startTs}::timestamp`
  const aEnd = end
    ? (end < start ? sql`${`${date} ${end}`}::timestamp + INTERVAL '1 day'` : sql`${`${date} ${end}`}::timestamp`)
    : sql`${startTs}::timestamp + (${defaultEventHours(plannedHours)} * INTERVAL '1 hour')`
  return { aStart, aEnd }
}

// SQL-выражение конца интервала строки events с теми же правилами по умолчанию.
const eventEndExpr = sql`
  CASE
    WHEN ${events.endTime} IS NOT NULL THEN
      (${events.date} || ' ' || ${events.endTime})::timestamp
      + (CASE WHEN ${events.endTime} < ${events.startTime} THEN INTERVAL '1 day' ELSE INTERVAL '0' END)
    ELSE
      (${events.date} || ' ' || ${events.startTime})::timestamp
      + (COALESCE(NULLIF(${events.plannedHours}, 0), 2) * INTERVAL '1 hour')
  END`

export async function findOverlappingEvent(
  database: DbOrTx,
  body: Partial<z.infer<typeof EventSchema>>,
  excludeEventId?: string,
) {
  if (body.type !== 'titan' || !body.spaceId || !body.date || !body.startTime) return null

  const { aStart, aEnd } = eventInterval(body.date, body.startTime, body.endTime, body.plannedHours)
  // Кандидаты — события зоны за соседние сутки: вчерашнее ночное (22:00→02:00)
  // заходит в эту дату, а ночное новое — в завтрашнюю. Длительность ≤ 24 ч, дальше
  // соседних суток пересечений нет; само пересечение решают timestamp'ы ниже.
  const dates = [shiftDate(body.date, -1), body.date, shiftDate(body.date, 1)].filter((d): d is string => !!d)

  const conditions = [
    inArray(events.date, dates),
    eq(events.spaceId, body.spaceId),
    ne(events.status, 'cancelled' as const),
    ne(events.status, 'completed' as const),
    // Стандартное пересечение полуоткрытых интервалов: aStart < bEnd AND bStart < aEnd.
    sql`${aStart} < ${eventEndExpr}`,
    sql`(${events.date} || ' ' || ${events.startTime})::timestamp < ${aEnd}`,
  ]
  if (excludeEventId) conditions.push(ne(events.id, excludeEventId))

  const rows = await database.select().from(events).where(and(...(conditions as [any, ...any[]]))).limit(1)
  return rows[0] ?? null
}

eventsRouter.get('/', async (c) => {
  const db = c.var.db
  const from = c.req.query('from')
  const to = c.req.query('to')
  const spaceId = c.req.query('spaceId')

  const conditions: any[] = []
  if (from) conditions.push(gte(events.date, from))
  if (to) conditions.push(lte(events.date, to))
  if (spaceId) conditions.push(eq(events.spaceId, spaceId))

  const rows = await db
    .select()
    .from(events)
    .where(conditions.length ? and(...(conditions as [any, ...any[]])) : undefined)
    .orderBy(desc(events.date), desc(events.startTime))

  // Число игроков миникапа — для карточки списка («8/10 игроков»). attendeesCount для
  // этого не годится: пишется только при старте и считает судью.
  const minicapIds = rows.filter((r) => r.format === 'minicap').map((r) => r.id)
  const counts = minicapIds.length
    ? await db.select({ eventId: eventParticipants.eventId, cnt: sql<number>`count(*)::int` })
        .from(eventParticipants)
        .where(and(inArray(eventParticipants.eventId, minicapIds), eq(eventParticipants.role, 'player')))
        .groupBy(eventParticipants.eventId)
    : []
  const playersBy = new Map(counts.map((r) => [r.eventId, Number(r.cnt)]))

  return c.json({ events: rows.map((r) => (r.format === 'minicap' ? { ...r, playersCount: playersBy.get(r.id) ?? 0 } : r)) })
})

// ── GET /events/active-for-space/:spaceId — для планшета ─────────────────
eventsRouter.get('/active-for-space/:spaceId', async (c) => {
  const db = c.var.db
  const spaceId = c.req.param('spaceId')
  // «Сегодня» — по МСК, а не по UTC (с 00:00 до 03:00 МСК UTC-дата — ещё вчерашняя).
  // Плюс текущий бизнес-день: ночное мероприятие, начатое вечером, после полуночи
  // датировано вчерашним числом. Приоритет — у более поздней даты.
  const startHour = await getBusinessDayStartHour(db)
  const dates = [...new Set([bizDayStr(0, 0), bizDayStr(0, startHour)])]
  const [event] = await db
    .select()
    .from(events)
    .where(and(
      eq(events.spaceId, spaceId),
      eq(events.status, 'active'),
      inArray(events.date, dates),
    ))
    .orderBy(desc(events.date), desc(events.startTime))
    .limit(1)
  return c.json({ event: event ?? null })
})

eventsRouter.post('/', requireRole('owner', 'staff'), zValidator('json', EventSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')

  // Новое мероприятие — только «Запланировано»/«Уточнить»: «Идёт» наступает стартом
  // (PATCH открывает чек), «Завершено»/«Отменено» — итог, а не начальное состояние.
  if (body.status !== 'planned' && body.status !== 'needs_clarification') {
    return c.json({ error: 'Новое мероприятие создаётся запланированным — начать его можно после создания' }, 400)
  }

  const isMinicap = body.format === 'minicap'
  // Проверка пересечения и вставка — в ОДНОЙ транзакции под advisory-lock по
  // (spaceId, date): иначе два одновременных POST на одну зону/время оба не нашли бы
  // конфликт и оба вставились (двойная бронь зоны). Lock держится до конца транзакции.
  let event: typeof events.$inferSelect | undefined
  let conflict: typeof events.$inferSelect | null = null
  await db.transaction(async (tx) => {
    if (body.type === 'titan' && body.spaceId && body.date) {
      await lockEventBooking(tx, { ...body, spaceId: body.spaceId })
      const overlap = await findOverlappingEvent(tx, body)
      if (overlap) { conflict = overlap; return }
    }
    const [created] = await tx.insert(events).values({
    // Миникап — это всегда TITAN (type titan, локация фиксирована).
    type: isMinicap ? 'titan' : body.type,
    title: body.title,
    location: isMinicap ? 'TITAN' : body.location,
    spaceId: isMinicap ? null : (body.spaceId ?? null),
    date: body.date,
    startTime: body.startTime,
    endTime: body.endTime ?? null,
    paymentType: body.paymentType,
    billingMode: body.billingMode,
    fixedAmount: body.fixedAmount != null ? String(body.fixedAmount) : null,
    manualAmount: body.manualAmount != null ? String(body.manualAmount) : null,
    plannedHours: body.plannedHours ?? null,
    maxGuests: body.maxGuests ?? null,
    status: body.status,
    comment: body.comment,
    reminders: body.reminders,
    responsibleStaffId: body.responsibleStaffId ?? null,
    customerName: body.customerName ?? null,
    customerPhone: body.customerPhone ?? null,
    format: body.format,
    participationFee: body.participationFee != null ? String(body.participationFee) : null,
    prizeFund: body.prizeFund != null ? String(body.prizeFund) : null,
    lunchCost: body.lunchCost != null ? String(body.lunchCost) : null,
    otherCost: body.otherCost != null ? String(body.otherCost) : null,
    createdBy: user.sub,
    }).returning()
    event = created

    // Расходы миникапа сразу материализуем в expenses (привязка к событию).
    if (isMinicap && event) {
      try { await upsertEventCosts(tx, { ...event, createdBy: user.sub }) } catch { /* non-fatal */ }
    }
  })

  // Пересечение по зоне/времени найдено под блокировкой — вставки не было.
  if (conflict) {
    const cf = conflict as typeof events.$inferSelect
    return c.json({
      error: 'На это время уже запланировано другое мероприятие в этом пространстве',
      conflict: { id: cf.id, title: cf.title, startTime: cf.startTime, endTime: cf.endTime },
    }, 409)
  }

  // Автосохранение заказчика в справочник (для автоподбора в следующих событиях).
  // Не блокирует создание события — любые ошибки гасим.
  if (body.customerName || body.customerPhone) {
    try {
      let exists = false
      if (body.customerPhone) {
        const found = await db.select().from(customers).where(eq(customers.phone, body.customerPhone)).limit(1)
        exists = found.length > 0
      }
      if (!exists) {
        await db.insert(customers).values({ name: body.customerName ?? null, phone: body.customerPhone ?? null })
      }
    } catch { /* non-fatal */ }
  }

  void notify({
    type: 'event_created',
    title: 'Мероприятие',
    body: event!.title ?? `${event!.date} ${event!.startTime}`.trim(),
    meta: { eventId: event!.id },
  }, db, c.var.club?.id ?? null).catch(() => {})

  return c.json({ event }, 201)
})

// ── GET /events/availability — занятость зон на время мероприятия ────────────
// Форма мероприятия показывает, какие зоны свободны на выбранные дату, начало и
// длительность, а какие заняты и чем. Проверка — та же findOverlappingEvent, что
// у POST/PATCH (ночные события, длительность по умолчанию), так что «свободна» здесь
// означает, что сохранение не получит 409. Зарегистрирован ДО '/:id', иначе тот
// перехватил бы «availability» как id.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const isCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const AvailabilityQuery = z.object({
  date: z.string().refine(isCalendarDate, 'date: ожидается YYYY-MM-DD'),
  startTime: z.string().regex(HHMM, 'startTime: ожидается HH:MM'),
  endTime: z.string().regex(HHMM, 'endTime: ожидается HH:MM').optional(),
  plannedHours: z.coerce.number().int().min(1).max(24).optional(),
  excludeEventId: z.string().uuid().optional(),
})

eventsRouter.get('/availability', requireRole('owner', 'staff'), zValidator('query', AvailabilityQuery), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  // Те же зоны и тот же порядок, что в кассе (GET /pos/spaces).
  const rows = await db
    .select({ id: spaces.id, name: spaces.name, hourlyRate: spaces.hourlyRate })
    .from(spaces)
    .where(eq(spaces.isActive, true))
  const result = await Promise.all(rows.map(async (space) => {
    const overlap = await findOverlappingEvent(db, {
      type: 'titan',
      spaceId: space.id,
      date: q.date,
      startTime: q.startTime,
      endTime: q.endTime ?? null,
      plannedHours: q.plannedHours ?? null,
    }, q.excludeEventId)
    return {
      ...space,
      free: !overlap,
      conflict: overlap
        ? { id: overlap.id, title: overlap.title, date: overlap.date, startTime: overlap.startTime, endTime: overlap.endTime }
        : null,
    }
  }))
  return c.json({ spaces: result })
})

eventsRouter.get('/:id', async (c) => {
  const db = c.var.db
  const [event] = await db.select().from(events).where(eq(events.id, c.req.param('id')))
  if (!event) return c.json({ error: 'Not found' }, 404)
  return c.json({ event })
})

eventsRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', EventSchema.partial()), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const eventId = c.req.param('id')
  const body = c.req.valid('json')

  const [prev] = await db.select().from(events).where(eq(events.id, eventId))
  if (!prev) return c.json({ error: 'Not found' }, 404)

  // Завершённое мероприятие обратно в работу не возвращается: его чек оплачен и
  // закрыт, итог посчитан. Допустима только отмена.
  if (prev.status === 'completed' && body.status !== undefined && body.status !== 'completed' && body.status !== 'cancelled') {
    return c.json({ error: 'Мероприятие уже завершено — вернуть его в работу нельзя' }, 409)
  }

  // Меняется ли время/пространство/длительность? Сравниваем с undefined (а не
  // truthiness): очистка endTime в null — это тоже изменение времени и должна
  // перезапускать проверку пересечений. Длительность (plannedHours) задаёт конец
  // события без endTime. Выход из отмены/завершения — тоже: пока событие не занимало
  // зону, её могли забронировать. Саму проверку выполняем ВНУТРИ транзакции под
  // advisory-lock (см. ниже), чтобы она была атомарна со вставкой/апдейтом чека и
  // сериализовалась против конкурентных броней той же зоны/даты.
  const reopening = body.status !== undefined && body.status !== 'cancelled' && body.status !== 'completed'
    && (prev.status === 'cancelled' || prev.status === 'completed')
  const timeChanged = body.spaceId !== undefined || body.startTime !== undefined
    || body.endTime !== undefined || body.date !== undefined || body.plannedHours !== undefined
    || body.type !== undefined || reopening

  const update: Record<string, any> = { ...body }
  // «Пакет по часам»: сдвинули начало/конец и часы явно не прислали — пересчитываем
  // plannedHours по новому времени (раньше база чека оставалась по старым часам).
  const nextMode = body.billingMode ?? prev.billingMode
  if (nextMode === 'hourly' && body.plannedHours === undefined && (body.startTime !== undefined || body.endTime !== undefined)) {
    const h = hoursBetween(body.startTime ?? prev.startTime, body.endTime !== undefined ? body.endTime : prev.endTime)
    if (h) update.plannedHours = h
  }
  if (body.fixedAmount !== undefined) update.fixedAmount = body.fixedAmount != null ? String(body.fixedAmount) : null
  if (body.manualAmount !== undefined) update.manualAmount = body.manualAmount != null ? String(body.manualAmount) : null
  if (body.participationFee !== undefined) update.participationFee = body.participationFee != null ? String(body.participationFee) : null
  if (body.prizeFund !== undefined) update.prizeFund = body.prizeFund != null ? String(body.prizeFund) : null
  if (body.lunchCost !== undefined) update.lunchCost = body.lunchCost != null ? String(body.lunchCost) : null
  if (body.otherCost !== undefined) update.otherCost = body.otherCost != null ? String(body.otherCost) : null

  // При финализации (completed/cancelled) приводим attendeesCount к фактическому
  // числу привязанных чеков.
  if (body.status === 'completed' || body.status === 'cancelled') {
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(checks)
      .where(eq(checks.linkedEventId, eventId))
    update.attendeesCount = cnt
  }

  // Поле РЕАЛЬНО меняется, а не пришло тем же значением: формы шлют весь набор полей
  // при любой правке. Суммы сравниваем числом — numeric из БД приходит как '5000.00'.
  const changed = (key: keyof typeof prev) => key in update && (update[key] ?? null) !== (prev[key] ?? null)
  const amountChanged = (key: 'fixedAmount' | 'manualAmount' | 'participationFee') => key in update
    && ((update[key] == null) !== (prev[key] == null) || num(update[key]) !== num(prev[key]))

  // Чеки, которых коснулись в транзакции, — для realtime-событий кассы после коммита
  // (иначе другие кассы ждали бы опроса).
  const touched = { created: [] as string[], updated: [] as string[], deleted: [] as string[] }

  let event
  try {
    event = await db.transaction(async (tx) => {
    // Слитое состояние события после апдейта — для расчёта базы чека.
    const merged = { ...prev, ...update }

    const isMinicap = (merged.format ?? 'regular') === 'minicap'

    // 0) ПЕРЕСЕЧЕНИЕ БРОНИ: при изменении времени/пространства — под advisory-lock
    //    по (spaceId, date) внутри транзакции, чтобы конкурентные брони сериализовались
    //    и не создали двойную бронь зоны. Вход — СЛИТАЯ запись: явный null (сняли
    //    конец/длительность/зону) не должен подменяться старым значением, как было при
    //    `body.x ?? prev.x`. Отменяемое/завершаемое событие зону не занимает.
    if (timeChanged && merged.status !== 'cancelled' && merged.status !== 'completed') {
      const overlapBody = {
        type: merged.type as any,
        spaceId: (merged.spaceId ?? undefined) as string | undefined,
        date: merged.date as string,
        startTime: merged.startTime as string,
        endTime: (merged.endTime ?? null) as string | null,
        plannedHours: (merged.plannedHours ?? null) as number | null,
      }
      if (overlapBody.type === 'titan' && overlapBody.spaceId && overlapBody.date) {
        await lockEventBooking(tx, { ...overlapBody, spaceId: overlapBody.spaceId })
        const overlap = await findOverlappingEvent(tx, overlapBody, eventId)
        if (overlap) throw new EventOverlapError(overlap)
      }
    }

    // 1) СТАРТ события: переход planned→active создаёт чек(и). Чек, отменённый
    //    прошлой отменой мероприятия, не в счёт — открываем новый и перепривязываем.
    const becomingActive = body.status === 'active' && prev.status !== 'active'
    if (becomingActive && isMinicap) {
      // Миникап: открываем по индивидуальному чеку каждому участнику (игроки + судья).
      const shift = await getCurrentShift(db)
      if (!shift) throw new Error('NO_SHIFT')
      const parts = await tx.select().from(eventParticipants).where(eq(eventParticipants.eventId, eventId))
      for (const p of parts) {
        if (!(await hasLiveCheck(tx, p.checkId))) touched.created.push(await openParticipantCheck(tx, merged, p, shift.id, user.sub))
      }
      update.attendeesCount = parts.filter((p: any) => p.role === 'player').length
    } else if (becomingActive && !(await hasLiveCheck(tx, prev.checkId))) {
      const shift = await getCurrentShift(db)
      if (!shift) throw new Error('NO_SHIFT')
      // «Фикс» и «Пакет по часам»: база события кладётся в eventBaseAmount чека,
      // без аренды зоны. «По ставке зоны»: чек открывается с зоной события и считает
      // аренду живым счётчиком с момента старта (как аренда-чек кассы), база = 0.
      const base = await computeEventBase(tx, merged as any)
      const rentalSpaceId = merged.billingMode === 'rental' ? ((merged.spaceId as string | null) ?? null) : null
      // Зону уже арендует открытый чек кассы — второй аренды на ней быть не может.
      if (rentalSpaceId && await openCheckOnSpace(tx, rentalSpaceId)) throw new Error('SPACE_OCCUPIED')
      const [chk] = await tx.insert(checks).values({
        staffId: (merged.responsibleStaffId as string) ?? user.sub,
        shiftId: shift.id,
        status: 'open',
        linkedEventId: eventId,
        spaceId: rentalSpaceId,
        spaceStartAt: rentalSpaceId ? new Date() : null,
        eventBaseAmount: String(base),
        guestNames: merged.title ? [merged.title as string] : [],
        note: `Мероприятие: ${merged.title ?? ''}`.trim(),
        totalAmount: '0',
      }).returning()
      update.checkId = chk!.id
      update.attendeesCount = 1
      touched.created.push(chk!.id)
    }

    // 2) СИНК с чеком активного события: база (сумма/режим/часы/время) и аренда зоны.
    const checkId = (update.checkId as string) ?? prev.checkId
    if (checkId && !becomingActive && !isMinicap) {
      // База пересчитывается, только если РЕАЛЬНО изменились влияющие на неё поля
      // (режим, сумма, часы): формы шлют их при любой правке, и раньше правка
      // комментария переоценивала чек идущего мероприятия по текущим тарифам.
      const amountTouched = changed('billingMode') || amountChanged('fixedAmount')
        || amountChanged('manualAmount') || changed('plannedHours')
      if (amountTouched) {
        const res = await tx.update(checks)
          .set({ eventBaseAmount: String(await computeEventBase(tx, merged as any)) })
          .where(and(eq(checks.id, checkId), eq(checks.status, 'open')))
          .returning({ id: checks.id })
        if (res.length) touched.updated.push(checkId)
      }
      // «По ставке зоны»: у чека та же зона, что у события; включили режим — аренда
      // стартует сейчас (если ещё не шла); выключили — аренда с чека снимается.
      const spaceTouched = changed('spaceId') || changed('billingMode')
      if (spaceTouched) {
        const [chk] = await tx.select().from(checks).where(eq(checks.id, checkId)).limit(1)
        if (chk && chk.status === 'open') {
          if (merged.billingMode === 'rental' && merged.spaceId) {
            // Новую зону уже арендует другой открытый чек кассы — переносить некуда.
            if (chk.spaceId !== merged.spaceId && await openCheckOnSpace(tx, merged.spaceId as string, checkId)) {
              throw new Error('SPACE_OCCUPIED')
            }
            await tx.update(checks).set({
              spaceId: merged.spaceId as string,
              spaceStartAt: chk.spaceStartAt ?? new Date(),
            }).where(eq(checks.id, checkId))
            touched.updated.push(checkId)
          } else if (prev.billingMode === 'rental' || merged.billingMode === 'rental') {
            await tx.update(checks).set({ spaceId: null, spaceStartAt: null, spaceEndAt: null }).where(eq(checks.id, checkId))
            touched.updated.push(checkId)
          }
        }
      }
    }

    // 2b) МИНИКАП: синк взноса на открытых чеках игроков + апсерт расходов события.
    if (isMinicap) {
      if (!becomingActive && amountChanged('participationFee')) {
        const players = await tx.select().from(eventParticipants)
          .where(and(eq(eventParticipants.eventId, eventId), eq(eventParticipants.role, 'player')))
        const fee = num(merged.participationFee)
        for (const p of players) {
          if (!p.checkId) continue
          const res = await tx.update(checks)
            .set({ eventBaseAmount: String(fee), prepaidAmount: String(p.prepaid ? fee : 0) })
            .where(and(eq(checks.id, p.checkId), eq(checks.status, 'open')))
            .returning({ id: checks.id })
          if (res.length) touched.updated.push(p.checkId)
        }
      }
      const costsTouched = body.prizeFund !== undefined || body.lunchCost !== undefined
        || body.otherCost !== undefined || body.date !== undefined || body.title !== undefined
      // Отменённый миникап расходов не несёт (сняты при отмене, см. шаг 3); при
      // восстановлении из отмены — материализуем их заново.
      const restoring = prev.status === 'cancelled' && body.status !== undefined && body.status !== 'cancelled'
      if ((costsTouched || restoring) && merged.status !== 'cancelled') {
        await upsertEventCosts(tx, { id: eventId, title: (merged.title as string) ?? null, date: merged.date as string, prizeFund: merged.prizeFund, lunchCost: merged.lunchCost, otherCost: merged.otherCost, createdBy: user.sub })
      }
    }

    // 3) ОТМЕНА события → отменяем открытые чеки (миникап — все чеки участников),
    //    возвращаем на склад списанное по ним (как DELETE /pos/checks/:id) и снимаем
    //    расходы события (при восстановлении из отмены они создаются заново, шаг 2b).
    //    Та же логика — у мягкого DELETE и отмены брони (eventLifecycle.ts).
    if (body.status === 'cancelled') {
      const ids = await cancelEventChecksTx(tx, { id: eventId, format: (merged.format as string) ?? null, checkId: prev.checkId }, user.sub)
      touched.deleted.push(...ids)
    }

    const [ev] = await tx.update(events).set(update).where(eq(events.id, eventId)).returning()
    return ev
    })
  } catch (err: any) {
    if (err instanceof EventOverlapError) {
      const o = err.event
      return c.json({
        error: 'На это время уже запланировано другое мероприятие в этом пространстве',
        conflict: { id: o.id, title: o.title, startTime: o.startTime, endTime: o.endTime },
      }, 409)
    }
    if (err?.message === 'NO_SHIFT') {
      return c.json({ error: 'Нет открытой смены — нельзя начать мероприятие (создать чек)' }, 400)
    }
    if (err?.message === 'SPACE_OCCUPIED' || isSpaceRentalConflict(err)) {
      return c.json({ error: SPACE_OCCUPIED_ERROR }, 409)
    }
    throw err
  }

  if (!event) return c.json({ error: 'Not found' }, 404)

  // Кассы видят открытые/изменённые/отменённые чеки мероприятия сразу, без опроса.
  const clubId = c.var.club?.id
  for (const id of touched.created) publishEvent(clubId, 'check:created', { checkId: id })
  for (const id of new Set(touched.updated)) publishEvent(clubId, 'check:updated', { checkId: id })
  for (const id of touched.deleted) publishEvent(clubId, 'check:deleted', { checkId: id })

  // Завершение мероприятия вручную (переход в 'completed') → уведомление.
  if (body.status === 'completed' && prev.status !== 'completed') {
    void notify({
      type: 'event_completed',
      title: 'Мероприятие завершено',
      body: event.title ?? `${event.date} ${event.startTime}`.trim(),
      meta: { eventId: event.id },
    }, db, c.var.club?.id ?? null).catch(() => {})
  }

  return c.json({ event })
})

eventsRouter.delete('/:id', requireRole('owner'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  // ?purge=true — ЖЁСТКОЕ удаление навсегда (участники + связанная бронь + событие).
  // Без флага — мягкая отмена (status=cancelled, событие остаётся в истории).
  // Расходы события (приз/обед/иные миникапа) уходят и при удалении, и при отмене —
  // иначе остаются в опексе аналитики (а FK expenses.event_id без ON DELETE не дал бы
  // удалить само событие).
  if (c.req.query('purge') === 'true') {
    await db.transaction(async (tx) => {
      await tx.delete(eventParticipants).where(eq(eventParticipants.eventId, id))
      await tx.execute(sql`DELETE FROM bookings WHERE event_id = ${id}`)
      await tx.delete(expenses).where(eq(expenses.eventId, id))
      await tx.delete(events).where(eq(events.id, id))
    })
    return c.json({ ok: true, purged: true })
  }
  // Мягкая отмена — та же логика, что PATCH status=cancelled: открытые чеки события
  // отменяются с возвратом списанного на склад (раньше здесь только менялся статус и
  // чек мероприятия оставался открытым в кассе), расходы снимаются.
  const cancelled = await db.transaction(async (tx) => cancelEventTx(tx, id, c.get('user').sub))
  if (!cancelled) return c.json({ error: 'Not found' }, 404)
  for (const checkId of cancelled.cancelledCheckIds) publishEvent(c.var.club?.id, 'check:deleted', { checkId })
  return c.json({ ok: true })
})

// ── Участники миникапа ──────────────────────────────────────────────────
eventsRouter.get('/:id/participants', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const eventId = c.req.param('id')
  const rows = await db
    .select({
      id: eventParticipants.id,
      profileId: eventParticipants.profileId,
      nickname: profiles.nickname,
      clientTier: profiles.clientTier,
      role: eventParticipants.role,
      prepaid: eventParticipants.prepaid,
      checkId: eventParticipants.checkId,
      checkStatus: checks.status,
      checkTotal: checks.totalAmount,
      eventBaseAmount: checks.eventBaseAmount,
      prepaidAmount: checks.prepaidAmount,
    })
    .from(eventParticipants)
    .leftJoin(profiles, eq(profiles.id, eventParticipants.profileId))
    .leftJoin(checks, eq(checks.id, eventParticipants.checkId))
    .where(eq(eventParticipants.eventId, eventId))
    .orderBy(eventParticipants.createdAt)
  return c.json({ participants: rows })
})

const AddParticipantSchema = z.object({ profileId: z.string().uuid(), role: z.enum(['player', 'judge']).default('player') })
eventsRouter.post('/:id/participants', requireRole('owner', 'staff'), zValidator('json', AddParticipantSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const eventId = c.req.param('id')
  const { profileId, role } = c.req.valid('json')
  const [ev] = await db.select().from(events).where(eq(events.id, eventId))
  if (!ev) return c.json({ error: 'Not found' }, 404)
  const existing = await db.select().from(eventParticipants).where(eq(eventParticipants.eventId, eventId))
  if (role === 'player' && existing.filter(p => p.role === 'player').length >= 10) return c.json({ error: 'Максимум 10 игроков' }, 400)
  if (role === 'judge' && existing.some(p => p.role === 'judge')) return c.json({ error: 'Судья уже назначен' }, 400)
  // Миникап уже идёт — новому участнику сразу нужен счёт, а счёт открывается в смене.
  // Раньше без смены (или при ошибке открытия чека, которую глотали) участник
  // сохранялся без чека и платить ему было не за что.
  const shift = ev.status === 'active' ? await getCurrentShift(db) : null
  if (ev.status === 'active' && !shift) {
    return c.json({ error: 'Откройте смену — без неё участнику идущего миникапа не открыть счёт' }, 400)
  }
  // Участник и его чек — одной транзакцией: либо оба, либо ничего.
  const added = await db.transaction(async (tx) => {
    const [p] = await tx.insert(eventParticipants).values({ eventId, profileId, role }).onConflictDoNothing().returning()
    if (!p) return null
    const checkId = shift ? await openParticipantCheck(tx, ev, p, shift.id, user.sub) : null
    return { participant: checkId ? { ...p, checkId } : p, checkId }
  })
  if (!added) return c.json({ error: 'Этот игрок уже в составе' }, 409)
  if (added.checkId) publishEvent(c.var.club?.id, 'check:created', { checkId: added.checkId })
  return c.json({ participant: added.participant }, 201)
})

const PatchParticipantSchema = z.object({ prepaid: z.boolean() })
eventsRouter.patch('/:id/participants/:pid', requireRole('owner', 'staff'), zValidator('json', PatchParticipantSchema), async (c) => {
  const db = c.var.db
  const eventId = c.req.param('id')
  const pid = c.req.param('pid')
  const { prepaid } = c.req.valid('json')
  const [p] = await db.select().from(eventParticipants).where(and(eq(eventParticipants.id, pid), eq(eventParticipants.eventId, eventId)))
  if (!p) return c.json({ error: 'Not found' }, 404)
  const [ev] = await db.select().from(events).where(eq(events.id, eventId))
  await db.update(eventParticipants).set({ prepaid }).where(eq(eventParticipants.id, pid))
  // Синк предоплаты на открытом чеке игрока (судья — без взноса).
  if (p.checkId && p.role === 'player') {
    const fee = num(ev?.participationFee)
    const res = await db.update(checks).set({ prepaidAmount: String(prepaid ? fee : 0) })
      .where(and(eq(checks.id, p.checkId), eq(checks.status, 'open'))).returning({ id: checks.id })
    if (res.length) publishEvent(c.var.club?.id, 'check:updated', { checkId: p.checkId })
  }
  return c.json({ ok: true })
})

eventsRouter.delete('/:id/participants/:pid', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const eventId = c.req.param('id')
  const pid = c.req.param('pid')
  const [p] = await db.select().from(eventParticipants).where(and(eq(eventParticipants.id, pid), eq(eventParticipants.eventId, eventId)))
  if (!p) return c.json({ error: 'Not found' }, 404)
  const checkId = p.checkId
  if (checkId) {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(checkItems).where(eq(checkItems.checkId, checkId))
    if (cnt > 0) return c.json({ error: 'У участника есть позиции в чеке — сначала закройте чек' }, 400)
  }
  const result = await db.transaction(async (tx) => {
    let cancelled: { id: string }[] = []
    if (checkId) {
      // Отмена чека участника — с возвратом на склад списанного по журналу (как DELETE /pos/checks/:id).
      cancelled = await tx.update(checks).set({ status: 'cancelled' })
        .where(and(eq(checks.id, checkId), eq(checks.status, 'open'))).returning({ id: checks.id })
      for (const ch of cancelled) await reverseCheckMovements(tx, ch.id, 'Участник снят с мероприятия', c.get('user').sub)
    }
    await tx.delete(eventParticipants).where(eq(eventParticipants.id, pid))
    // Сняли последнего участника с открытым счётом, остальные уже оплатили → миникап
    // завершается (иначе «Идёт» навсегда: завершение ждёт закрытия чека участника).
    const completedEvent = cancelled.length ? await completeMinicapIfDone(tx, eventId) : null
    return { cancelledIds: cancelled.map((ch) => ch.id), completedEvent }
  })
  for (const id of result.cancelledIds) publishEvent(c.var.club?.id, 'check:deleted', { checkId: id })
  if (result.completedEvent) {
    void notify({
      type: 'event_completed',
      title: 'Мероприятие завершено',
      body: result.completedEvent.title ?? 'Мероприятие завершено',
      meta: { eventId: result.completedEvent.id },
    }, db, c.var.club?.id ?? null).catch(() => {})
  }
  return c.json({ ok: true })
})

// ── Аналитика по событию ───────────────────────────────────────────────
eventsRouter.get('/:id/analytics', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const eventId = c.req.param('id')
  const [event] = await db.select().from(events).where(eq(events.id, eventId))
  if (!event) return c.json({ error: 'Not found' }, 404)

  // Все чеки, привязанные к событию
  const eventChecks = await db
    .select()
    .from(checks)
    .where(eq(checks.linkedEventId, eventId))

  const closedChecks = eventChecks.filter((c) => c.status === 'closed')
  const totalRevenue = closedChecks.reduce((s, c) => s + parseFloat(c.totalAmount), 0)
  const attendeesCount = eventChecks.length
  const avgCheckAmount = closedChecks.length > 0 ? totalRevenue / closedChecks.length : 0

  // Топ-5 позиций
  const topItemsRows = await db.execute(sql`
    SELECT
      ci.item_id,
      i.name,
      SUM(ci.quantity) AS qty,
      SUM(ci.quantity * ci.price_at_time::numeric) AS revenue
    FROM check_items ci
    JOIN checks ch ON ch.id = ci.check_id
    JOIN inventory i ON i.id = ci.item_id
    WHERE ch.linked_event_id = ${eventId}
    GROUP BY ci.item_id, i.name
    ORDER BY revenue DESC
    LIMIT 5
  `)
  const topItems = ((topItemsRows as any).rows ?? topItemsRows ?? []).map((r: any) => ({
    itemId: r.item_id,
    name: r.name,
    qty: parseInt(String(r.qty ?? 0)),
    revenue: parseFloat(String(r.revenue ?? 0)),
  }))

  // Раскладка по методам оплаты
  const paymentBreakdownRows = await db.execute(sql`
    SELECT cp.method, SUM(cp.amount::numeric) AS total
    FROM check_payments cp
    JOIN checks ch ON ch.id = cp.check_id
    WHERE ch.linked_event_id = ${eventId}
    GROUP BY cp.method
  `)
  const paymentBreakdown: Record<string, number> = {}
  for (const r of ((paymentBreakdownRows as any).rows ?? paymentBreakdownRows ?? [])) {
    paymentBreakdown[r.method as string] = parseFloat(String(r.total ?? 0))
  }

  // Расходы события (приз/обед/иные и пр. с привязкой) → нетто по мероприятию.
  const costRows = await db
    .select({ total: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses).where(eq(expenses.eventId, eventId))
  const costs = parseFloat(String(costRows[0]?.total ?? '0')) || 0

  // Длительность в минутах
  let durationMinutes: number | null = null
  if (event.endTime) {
    const [sh, sm] = event.startTime.split(':').map(Number)
    const [eh, em] = event.endTime.split(':').map(Number)
    durationMinutes = (eh! * 60 + em!) - (sh! * 60 + sm!)
    if (durationMinutes < 0) durationMinutes += 24 * 60
  }

  return c.json({
    costs,
    net: totalRevenue - costs,
    eventId,
    totalRevenue,
    attendeesCount,
    avgCheckAmount,
    topItems,
    paymentBreakdown,
    durationMinutes,
    maxGuests: event.maxGuests,
  })
})
