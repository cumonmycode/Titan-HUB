import type { AppEnv } from '../../types.js'
import type { Database } from '@titan/database'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  checks, checkItems, checkPayments, checkDiscounts, inventory, menuCategories, profiles, shifts, expenses, events, spaces,
  salaryPayments, refunds, tariffs, eveningTypes, analyticsEvents, stockMovements, guestFeedback,
  eq, and, gte, lte, lt, desc, asc, sql, sum, count, avg, isNull, isNotNull, ne, inArray,
} from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'

export const analyticsRouter = new Hono<AppEnv>()
analyticsRouter.use('*', requireAuth, requireRole('owner', 'staff'))

// ─── Телеметрия аналитики (лёгкие UX-события) ──────────────────────────────────
// Фронт шлёт fire-and-forget: открытие раздела, смена периода, drill-down. Никогда
// не блокирует UI и не роняет запрос — при ошибке просто игнорируем.
analyticsRouter.post('/track', zValidator('json', z.object({
  event: z.string().min(1).max(64),
  props: z.record(z.unknown()).optional(),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { event, props } = c.req.valid('json')
  try {
    await db.insert(analyticsEvents).values({ userId: user.sub, event, props: props ?? {} })
  } catch { /* телеметрия не критична */ }
  return c.json({ ok: true })
})

// ─── Helper ──────────────────────────────────────────────────────────────────
function parseNum(v: unknown) {
  return parseFloat(String(v ?? 0)) || 0
}

// ─── Возвраты и net-выручка ────────────────────────────────────────────────────
// ПОЧЕМУ вычитаем возвраты ВЕЗДЕ, где показывается «выручка» (P0):
// при полном/частичном возврате исходный чек НЕ трогается — `status` остаётся
// 'closed', а `total_amount` полным (см. refunds.router.ts: возврат пишет строку в
// `refunds` + проводку `transactions`, но чек не меняет). Поэтому «грязная»
// (gross) выручка sum(checks.total_amount) завышена на сумму возвратов. Net-ветка
// (netBreakdown) это уже учитывала; здесь выносим ту же логику в переиспользуемые
// SQL-фрагменты, чтобы привести ВСЕ витрины выручки (overview/revenue/shifts/
// players/top-spenders/dashboard) к net-of-refunds.
//
// КОНСИСТЕНТНОСТЬ ОКНА: возвраты вычитаются по ДАТЕ ВОЗВРАТА (refunds.created_at)
// в том же окне, что и выручка чека — ровно как netBreakdown (:124-127). Это даёт
// «чистую кассу периода»: возврат, оформленный в периоде, уменьшает выручку периода,
// даже если сам чек был пробит раньше.

// Коррелированный under-select: сумма возвратов по чеку `checkRef`, чья дата
// возврата попала в окно [start, end). Используется как `total_amount − refunds`
// прямо в SELECT-выражении выручки конкретной витрины (player/top-spenders).
function refundedInWindow(checkRef: any, start: Date, end: Date) {
  return sql<number>`coalesce((
    select sum(r.total_amount) from refunds r
    where r.check_id = ${checkRef}
      and r.created_at >= ${start.toISOString()}::timestamptz
      and r.created_at <  ${end.toISOString()}::timestamptz
  ), 0)`
}

// Суммарные возвраты за окно [start, end) по дате возврата (как в netBreakdown).
// Отдаём отдельной цифрой `refundsTotal`, чтобы фронт мог показать «возвраты»
// строкой, а основную выручку — уже net.
async function refundsTotalInWindow(database: Database, start: Date, end: Date): Promise<number> {
  const [row] = await database
    .select({ total: sum(refunds.totalAmount) })
    .from(refunds)
    .where(and(gte(refunds.createdAt, start), lt(refunds.createdAt, end)))
  return parseNum(row?.total)
}

// ─── Доступ owner-only к финблоку и ПДн ────────────────────────────────────────
// ПОЧЕМУ режем поля для staff (P1): рядовой кассир (role='staff') не должен видеть
// коммерческую тайну (прибыль/COGS/ФОТ/себестоимость) и ПДн клиентов (телефон/ФИО).
// Роутер пускает обе роли (выручка смены нужна staff), поэтому чувствительные поля
// вырезаем/обнуляем точечно внутри хендлеров по факту роли, а на чисто финансовых
// эндпоинтах (/staff — ФОТ-комплименты с себестоимостью) отдаём 403.
function isOwner(c: any): boolean {
  return c.get('user')?.role === 'owner'
}

// ─── Date-range query validation ───────────────────────────────────────────────
// from/to — необязательные строки YYYY-MM-DD. Раньше значения из query шли прямо в
// new Date()/границы окна без проверки, и мусор («», «abc», «2026-13-99») давал
// Invalid Date → NaN-границы → пустые/нулевые витрины (прежний баг с 0/NaN).
// Здесь: регэксп пропускает только корректный календарный YYYY-MM-DD, всё прочее
// отбрасывается (становится undefined) и эндпоинт берёт значения по умолчанию.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDateStr(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false
  const t = Date.parse(`${s}T00:00:00+03:00`)
  if (Number.isNaN(t)) return false
  // Защита от «2026-02-31» и подобных: JS-Date нормализует такие даты, поэтому
  // сверяем, что строка совпадает с обратной сериализацией компонентов.
  const d = new Date(t)
  const back = new Date(d.getTime() + MSK_OFFSET_MS).toISOString().split('T')[0]
  return back === s
}
const dateRangeQuerySchema = z.object({
  from: z.string().optional().transform(v => (v && isValidDateStr(v) ? v : undefined)),
  to: z.string().optional().transform(v => (v && isValidDateStr(v) ? v : undefined)),
})

// Все витрины считаются по календарю Москвы (UTC+3), а не UTC, иначе около
// полуночи «сегодня/вчера/30 дней» съезжают, а expenseDate (text-дата в местном
// времени) сравнивается с UTC-границей с ошибкой на сутки. Паттерн как в
// cron/birthdays.ts: сдвигаем «сейчас» на +3ч и берём UTC-компоненты.
const MSK_OFFSET_MS = 3 * 3600 * 1000

// YYYY-MM-DD по МСК для даты, отстоящей от текущего момента на `daysAgo` суток.
function mskDateStr(daysAgo = 0): string {
  const d = new Date(Date.now() + MSK_OFFSET_MS - daysAgo * 86400000)
  return d.toISOString().split('T')[0]
}

// Граница полуночи МСК для YYYY-MM-DD как абсолютный момент (UTC = local − 3ч).
function mskBoundary(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+03:00`)
}

// ─── Бизнес-день (09:00 → 06:00 следующих суток) ───────────────────────────────
// Заведение работает с 9 утра до 6 утра. «Итоги дня» считаются за этот промежуток,
// а не за календарные сутки. Бизнес-день D = [D 09:00 МСК, D+1 09:00 МСК):
// активность 09:00–06:00 + пустой технический интервал 06:00–09:00. Чек в 02:00
// относится к бизнес-дню предыдущей календарной даты.
// Дефолт границы бизнес-дня. Реальное значение — настройка business_day_start_hour
// (app_settings), читается в хендлере и прокидывается параметром startHour ниже.
// При startHour=9 (дефолт) поведение байт-в-байт прежнее (09:00→06:00).
const BIZ_START_HOUR = 9

// YYYY-MM-DD бизнес-дня, которому принадлежит момент `daysAgo` суток назад.
// Сдвигаем «сейчас» назад на startHour часов, чтобы 00:00..(startHour−1):59 МСК
// отнести к прошлой дате. startHour по умолч. 9 (прежнее поведение).
function bizDayStr(daysAgo = 0, startHour = BIZ_START_HOUR): string {
  const d = new Date(Date.now() + MSK_OFFSET_MS - startHour * 3600000 - daysAgo * 86400000)
  return d.toISOString().split('T')[0]
}

// Границы бизнес-дня как абсолютные моменты: [dateStr startHour:00 МСК, +24ч).
// startHour по умолч. 9 → 09:00 МСК (прежнее поведение байт-в-байт).
function bizDayBounds(dateStr: string, startHour = BIZ_START_HOUR): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T${String(startHour).padStart(2, '0')}:00:00+03:00`)
  return { start, end: new Date(start.getTime() + 86400000) }
}

// ─── Себестоимость проданного (COGS) ───────────────────────────────────────────
// Склад списывается В МОМЕНТ ДОБАВЛЕНИЯ позиции в открытый чек (addCheckItemTx:
// движение 'sale', source_type='check'), а выручка считается только по ЗАКРЫТЫМ
// чекам. Раньше COGS брался по дате движения без оглядки на статус чека, поэтому
// пока гость сидел с непробитым счётом, его себестоимость уже вычиталась из
// прибыли, а выручки ещё не было → «Прибыль сегодня» уходила в минус в реалтайме.
//
// Теперь движения по чекам (sale/return с source_type='check') учитываются ТОЛЬКО
// у закрытых чеков и относятся к окну ПО ДАТЕ ЧЕКА (checks.created_at) — ровно как
// выручка, поэтому выручка и её себестоимость всегда в одном периоде. Открытые чеки
// не дают ни выручки, ни COGS; отменённые — тем более (там sale+return = 0).
// Прочие движения (возвраты по refunds, исторические без источника) — по дате
// движения, как и вычет возвратов из выручки (по дате возврата).
const cogsSumExpr = sql<number>`sum((0 - ${stockMovements.delta})::numeric * coalesce(${stockMovements.unitCost}, ${inventory.costPrice}, 0)::numeric)`

// Счётчик чеков БЕЗ списаний на персонал (staff_comp, итог 0 ₽): они не продажи и
// не должны раздувать «чеки» и знаменатель среднего чека (как в /insights). Суммы
// выручки не трогаем — у списаний итог 0.
const nonCompCount = sql<number>`(count(*) filter (where ${checks.staffCompId} is null))::int`
const notCheckSource = sql`${stockMovements.sourceType} is distinct from 'check'`

async function cogsInWindow(database: Database, start: Date, end: Date): Promise<number> {
  const [[checkRow], [otherRow]] = await Promise.all([
    database
      .select({ total: cogsSumExpr })
      .from(stockMovements)
      .innerJoin(checks, eq(checks.id, stockMovements.sourceId))
      .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
      .where(and(
        eq(stockMovements.sourceType, 'check'), inArray(stockMovements.type, ['sale', 'return']),
        eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end),
      )),
    database
      .select({ total: cogsSumExpr })
      .from(stockMovements)
      .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
      .where(and(
        notCheckSource, inArray(stockMovements.type, ['sale', 'return']),
        gte(stockMovements.createdAt, start), lt(stockMovements.createdAt, end),
      )),
  ])
  return parseNum(checkRow?.total) + parseNum(otherRow?.total)
}

// Чистая разбивка за окно [start, end): валовая выручка, возвраты, эквайринг (8%
// от СБП-переводов), себестоимость проданного, операционные расходы (без ЗП) и ЗП.
// Возвращает и «грязные», и «чистые» показатели — фронт сам решает, что показывать.
async function netBreakdown(database: Database, start: Date, end: Date, expFrom: string, expTo: string) {
  const [grossRow] = await database
    .select({ revenue: sum(checks.totalAmount), cnt: nonCompCount })
    .from(checks)
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end)))

  // Чеки мероприятий за окно: event-чек = есть привязка к событию ИЛИ задана база
  // мероприятия. Их выводим ОТДЕЛЬНО (полная выручка + кол-во) и исключаем из
  // «среднего чека», чтобы крупная база мероприятия не раздувала клубный средний.
  // В общую выручку/прибыль мероприятия по-прежнему входят (gross/net не меняем).
  const [eventRow] = await database
    .select({ revenue: sum(checks.totalAmount), cnt: nonCompCount })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end),
      sql`(${checks.linkedEventId} is not null or coalesce(${checks.eventBaseAmount}, 0) > 0)`,
    ))

  // Возвраты за окно (по дате возврата).
  const [refundRow] = await database
    .select({ total: sum(refunds.totalAmount) })
    .from(refunds)
    .where(and(gte(refunds.createdAt, start), lt(refunds.createdAt, end)))

  // Эквайринг СБП (ПОТЕРЯ ВЛАДЕЛЬЦА): 8% от суммы переводов (method='transfer')
  // закрытых чеков окна — но ТОЛЬКО по чекам, где надбавку НЕ доплатил клиент
  // (acquiring_surcharge = 0). Если комиссию закрыл покупатель — для владельца это
  // не потеря, и такой чек в расчёт не входит.
  const [sbpRow] = await database
    .select({ total: sum(checkPayments.amount) })
    .from(checkPayments)
    .leftJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(
      eq(checks.status, 'closed'), eq(checkPayments.method, 'transfer'),
      sql`coalesce(${checks.acquiringSurcharge}, 0) = 0`,
      // Предоплата взноса миникапа пишется отдельной строкой «перевод» на сумму
      // prepaid_amount — она получена заранее, не через эквайринг клуба.
      sql`NOT (coalesce(${checks.prepaidAmount}, 0) > 0 AND ${checkPayments.amount} = ${checks.prepaidAmount})`,
      gte(checks.createdAt, start), lt(checks.createdAt, end),
    ))

  // Себестоимость ПРОДАННОГО за окно (COGS): движения склада продажа МИНУС возврат.
  // Берём зафиксированную на момент списания себестоимость (stock_movements.unit_cost,
  // см. ledger.ts), а не текущий WAC карточки — иначе COGS прошлых периодов «плывёт»
  // при каждой новой закупке. Продажа: delta<0 → (−delta) добавляет к COGS; возврат
  // (refund/снятие позиции/void): delta>0 → (−delta) вычитает — возвращённый товар
  // проданным не считается. Фолбэк на текущий cost_price для исторических NULL.
  // Только закрытые чеки — см. cogsInWindow (иначе открытый счёт давал минус).
  const cogsTotal = await cogsInWindow(database, start, end)

  // Операционные расходы без ЗП (по text-дате expenseDate, YYYY-MM-DD).
  const [opexRow] = await database
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, expFrom), lte(expenses.expenseDate, expTo), ne(expenses.category, 'salary')))

  // ФОТ — из выплат ЗП (единый источник).
  const [salaryRow] = await database
    .select({ total: sum(salaryPayments.amount) })
    .from(salaryPayments)
    .where(and(gte(salaryPayments.createdAt, start), lt(salaryPayments.createdAt, end)))

  // Расходы, привязанные к мероприятиям (приз/обед/иные миникапа) — подмножество
  // opex, показываем отдельно для «нетто по мероприятиям». В прибыль уже входят.
  const [eventCostRow] = await database
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, expFrom), lte(expenses.expenseDate, expTo), isNotNull(expenses.eventId)))

  const gross = parseNum(grossRow?.revenue)
  const cnt = grossRow?.cnt ?? 0
  const eventRevenue = parseNum(eventRow?.revenue)
  const eventChecks = eventRow?.cnt ?? 0
  // Клубные (не-мероприятийные) чеки — для «среднего чека».
  const clubGross = gross - eventRevenue
  const clubChecks = cnt - eventChecks
  const refundsTotal = parseNum(refundRow?.total)
  const commission = Math.round(parseNum(sbpRow?.total) * 0.08 * 100) / 100
  const cogs = cogsTotal
  const opex = parseNum(opexRow?.total)
  const salary = parseNum(salaryRow?.total)
  // Чистыми считаем: выручка − возвраты − эквайринг − себестоимость − опекс − ЗП.
  const net = gross - refundsTotal - commission - cogs - opex - salary
  return {
    gross,
    // Выручка за вычетом возвратов (по дате возврата в окне). Это «чистая касса
    // оборота» периода — фронт показывает её как основную «Выручку», а gross
    // остаётся для справки/переключателя «без учёта возвратов».
    revenueNet: Math.round((gross - refundsTotal) * 100) / 100,
    checks: cnt,
    // Средний чек — только по клубным чекам (без мероприятий), чтобы база
    // мероприятия не раздувала показатель.
    avgCheck: clubChecks > 0 ? clubGross / clubChecks : 0,
    eventRevenue,
    eventChecks,
    eventCosts: parseNum(eventCostRow?.total),
    clubChecks,
    refunds: refundsTotal,
    commission,
    cogs,
    opex,
    salary,
    expenses: opex + salary,
    net: Math.round(net * 100) / 100,
  }
}

// Net-разбивка для не-владельца: из неё вырезаем коммерческую тайну (COGS/ФОТ/
// опекс/эквайринг/прибыль), оставляя выручку (gross/net-of-refunds/возвраты), число
// чеков, средний чек и блок мероприятий (P1, ПДн тут нет). Владельцу — как есть.
type NetBreakdownResult = Awaited<ReturnType<typeof netBreakdown>>
function sanitizeBreakdown(b: NetBreakdownResult, owner: boolean) {
  return owner ? b : {
    gross: b.gross, revenueNet: b.revenueNet, refunds: b.refunds,
    checks: b.checks, avgCheck: b.avgCheck,
    eventRevenue: b.eventRevenue, eventChecks: b.eventChecks, clubChecks: b.clubChecks,
  }
}

// ─── Текущий бизнес-день ───────────────────────────────────────────────────────
// Единый источник «сегодня» для клиентов: дата бизнес-дня по часам сервера и
// настройке business_day_start_hour. Клиент строит от неё все пресеты периода —
// иначе часы/часовой пояс телефона или незагруженная настройка дают календарную дату.
analyticsRouter.get('/business-day', async (c) => {
  const h = await getBusinessDayStartHour(c.var.db)
  const today = bizDayStr(0, h)
  const { start, end } = bizDayBounds(today, h)
  return c.json({ businessDay: today, startHour: h, start: start.toISOString(), end: end.toISOString() })
})

// ─── Dashboard ───────────────────────────────────────────────────────────────
analyticsRouter.get('/dashboard', async (c) => {
  const db = c.var.db
  // «Сегодня/вчера» считаем по БИЗНЕС-ДНЮ (09:00→06:00), а не по календарным суткам:
  // заведение работает с 9 утра до 6 утра, и «итоги дня» должны покрывать этот
  // промежуток. Бизнес-день D = [D 09:00 МСК, D+1 09:00 МСК).
  const h = await getBusinessDayStartHour(db)
  const todayBizStr = bizDayStr(0, h)
  const yesterdayBizStr = bizDayStr(1, h)
  const { start: todayStart } = bizDayBounds(todayBizStr, h)
  const { start: yesterdayStart } = bizDayBounds(yesterdayBizStr, h)
  // «Месяц» = 30 бизнес-дней ВКЛЮЧАЯ сегодняшний ([29 дней назад, конец сегодня)),
  // предыдущий — те же 30 дней до него ([59, 29)). Раньше было 31 против 30 дней.
  const thirtyDaysAgo = bizDayBounds(bizDayStr(29, h), h).start  // начало 30-го бизнес-дня назад (вкл. сегодня)
  const sixtyDaysAgo = bizDayBounds(bizDayStr(59, h), h).start   // начало предыдущего 30-дневного окна

  // Конец текущего бизнес-дня (для окон возвратов «сегодня»).
  const { end: todayEndBound } = bizDayBounds(todayBizStr, h)

  // Today revenue (бизнес-день: с 09:00 текущего бизнес-дня).
  // ВЫРУЧКА = NET-OF-REFUNDS: из gross вычитаем возвраты за то же окно по дате
  // возврата (см. refundedInWindow/комментарий выше). gross остаётся под капотом
  // (netToday.gross), но видимая «Выручка дня» теперь сходится с кассой.
  const [todayStats] = await db
    .select({ revenue: sum(checks.totalAmount), count: nonCompCount })
    .from(checks)
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, todayStart)))

  // Yesterday revenue for delta — полуоткрытый интервал [вчера-бизнес, сегодня-бизнес)
  const [yesterdayStats] = await db
    .select({ revenue: sum(checks.totalAmount), count: nonCompCount })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, yesterdayStart),
      lt(checks.createdAt, todayStart),
    ))

  // Month revenue
  const [monthStats] = await db
    .select({ revenue: sum(checks.totalAmount), count: nonCompCount })
    .from(checks)
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDaysAgo)))

  // Previous month for delta — полуоткрытый интервал [60д, 30д)
  const [prevMonthStats] = await db
    .select({ revenue: sum(checks.totalAmount), count: nonCompCount })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, sixtyDaysAgo),
      lt(checks.createdAt, thirtyDaysAgo),
    ))

  // Возвраты по окнам (по дате возврата) — для приведения выручки к net.
  const refundsToday = await refundsTotalInWindow(db, todayStart, todayEndBound)
  const refundsYesterday = await refundsTotalInWindow(db, yesterdayStart, todayStart)
  const refundsMonth = await refundsTotalInWindow(db, thirtyDaysAgo, todayEndBound)
  const refundsPrevMonth = await refundsTotalInWindow(db, sixtyDaysAgo, thirtyDaysAgo)

  // COGS this month — себестоимость ПРОДАННОГО (продажа МИНУС возврат), а не
  // стоимость поставок. Зафиксированная себестоимость на момент списания
  // (stock_movements.unit_cost) с фолбэком на текущий WAC для исторических NULL.
  // Продажа delta<0 добавляет, возврат delta>0 вычитает → (0 − delta). Только
  // закрытые чеки, окно по дате чека — см. cogsInWindow.
  const monthCogs = await cogsInWindow(db, thirtyDaysAgo, todayEndBound)

  // Expenses this month.
  // ПРАВИЛО ЗАРПЛАТЫ В ПРИБЫЛИ: единственный источник истины по ФОТ — таблица
  // salaryPayments. Поэтому из «операционных расходов» исключаем категорию
  // 'salary' (её владелец мог завести и через расходы, и через выплаты ЗП —
  // суммировать оба источника = двойной счёт). Так прибыль не зависит от того,
  // через какой экран провели зарплату. Здесь категорию 'salary' исключаем, а
  // фактический ФОТ берём ниже из salaryPayments.
  // Фильтруем по expenseDate (text-дата YYYY-MM-DD), как /revenue, /checks и
  // netBreakdown — иначе прибыль дашборда расходилась с детальными витринами.
  const [expensesRow] = await db
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, bizDayStr(29, h)), lte(expenses.expenseDate, bizDayStr(0, h)), ne(expenses.category, 'salary')))

  // Payroll this month — единый источник (таблица выплат ЗП).
  const [salaryRow] = await db
    .select({ total: sum(salaryPayments.amount) })
    .from(salaryPayments)
    .where(gte(salaryPayments.createdAt, thirtyDaysAgo))

  // Payment breakdown (30d)
  const paymentBreakdown = await db
    .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
    .from(checkPayments)
    .leftJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDaysAgo)))
    .groupBy(checkPayments.method)

  // Top items (30d)
  const topItems = await db
    .select({
      itemId: checkItems.itemId,
      name: inventory.name,
      category: menuCategories.name,
      categoryId: inventory.category,
      totalQty: sum(checkItems.quantity),
      totalRev: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
    })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .leftJoin(menuCategories, eq(menuCategories.id, inventory.category))
    .leftJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDaysAgo), isNull(checks.staffCompId)))
    .groupBy(checkItems.itemId, inventory.name, menuCategories.name, inventory.category)
    .orderBy(desc(sql`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`))
    .limit(20)

  // New clients (30d)
  const [newClients] = await db
    .select({ count: count() })
    .from(profiles)
    .where(and(eq(profiles.role, 'client'), isNull(profiles.deletedAt), gte(profiles.createdAt, thirtyDaysAgo)))

  // Net-разбивка (с учётом расходов/комиссий/возвратов) для дня и месяца.
  // Используем уже вычисленную границу бизнес-дня (todayEndBound).
  const netToday = await netBreakdown(db, todayStart, todayEndBound, todayBizStr, todayBizStr)
  const netMonth = await netBreakdown(db, thirtyDaysAgo, todayEndBound, bizDayStr(29, h), bizDayStr(0, h))

  // ВЫРУЧКА = NET-OF-REFUNDS (P0): из gross вычитаем возвраты соответствующего окна
  // (по дате возврата). Это приводит «Выручку дня/месяца» к фактической кассе.
  // gross остаётся доступен фронту через netToday.gross/netMonth.gross.
  const todayRev = parseNum(todayStats?.revenue) - refundsToday
  const yesterdayRev = parseNum(yesterdayStats?.revenue) - refundsYesterday
  const monthRev = parseNum(monthStats?.revenue) - refundsMonth
  const prevMonthRev = parseNum(prevMonthStats?.revenue) - refundsPrevMonth
  const cogs = monthCogs
  // Операционные расходы БЕЗ зарплаты (см. правило выше).
  const opExpenses = parseNum(expensesRow?.total)
  // ФОТ — единственный источник истины.
  const salary = parseNum(salaryRow?.total)
  // Совокупные расходы для прибыли = операционные (без ЗП) + ФОТ из salaryPayments.
  const totalExpenses = opExpenses + salary
  // Прибыль считаем от выручки УЖЕ за вычетом возвратов (monthRev), чтобы прибыль
  // не была завышена на сумму возвращённых денег.
  const profit = monthRev - cogs - totalExpenses
  const monthRevDelta = prevMonthRev > 0 ? Math.round(((monthRev - prevMonthRev) / prevMonthRev) * 100) : 0

  // Финблок (прибыль/COGS/ФОТ) показываем ТОЛЬКО владельцу. Для staff выручка смены/
  // дня нужна, но коммерческая тайна — нет, поэтому финансовые поля вырезаем (P1).
  const owner = isOwner(c)

  return c.json({
    today: {
      revenue: Math.round(todayRev * 100) / 100,
      refundsTotal: refundsToday,
      checks: todayStats?.count ?? 0,
      // Средний — клубный (без мероприятий), берём из net-разбивки.
      avgCheck: netToday.avgCheck,
      eventChecks: netToday.eventChecks,
      eventRevenue: netToday.eventRevenue,
    },
    yesterday: {
      revenue: Math.round(yesterdayRev * 100) / 100,
      refundsTotal: refundsYesterday,
      checks: yesterdayStats?.count ?? 0,
    },
    month: {
      revenue: Math.round(monthRev * 100) / 100,
      refundsTotal: refundsMonth,
      checks: monthStats?.count ?? 0,
      // Средний — клубный (без мероприятий), берём из net-разбивки.
      avgCheck: netMonth.avgCheck,
      eventChecks: netMonth.eventChecks,
      eventRevenue: netMonth.eventRevenue,
      // Финблок — только owner.
      ...(owner ? { cogs, expenses: totalExpenses, profit } : {}),
      delta: monthRevDelta,
    },
    newClients: newClients.count,
    topItems,
    paymentBreakdown,
    // Бизнес-день, к которому относятся «итоги дня» (09:00→06:00).
    businessDay: todayBizStr,
    // Чистые показатели с учётом расходов/комиссий/возвратов (день и месяц) —
    // содержат COGS/ФОТ/прибыль, поэтому отдаём ТОЛЬКО владельцу.
    ...(owner ? { netToday, netMonth } : {}),
  })
})

// ─── Обзор за период (финансовое здоровье) ─────────────────────────────────────
// Период — по БИЗНЕС-ДНЯМ: окно = [from 09:00 МСК, to+1 09:00 МСК). «Сегодня» =
// текущий бизнес-день (09:00→06:00), не календарные сутки. Возвращает чистую
// разбивку за период, сравнение с предыдущим равным периодом и разбивку способов
// оплаты ИМЕННО за период (проценты на фронте считаются от выручки периода — §9.1),
// плюс отдельный блок текущего бизнес-дня.
analyticsRouter.get('/overview', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(0, h)
  const to = q.to ?? bizDayStr(0, h)
  const { start } = bizDayBounds(from, h)
  const { end } = bizDayBounds(to, h)

  // Кол-во дней в периоде (включительно) → предыдущее равное окно для сравнения.
  const days = Math.max(1, Math.round((mskBoundary(to).getTime() - mskBoundary(from).getTime()) / 86400000) + 1)
  const shiftDateStr = (dateStr: string, deltaDays: number) =>
    new Date(mskBoundary(dateStr).getTime() + deltaDays * 86400000 + MSK_OFFSET_MS).toISOString().split('T')[0]
  const prevFrom = shiftDateStr(from, -days)
  const prevTo = shiftDateStr(to, -days)
  const { start: prevStart } = bizDayBounds(prevFrom, h)
  // Период ещё идёт (заканчивается текущим бизнес-днём) — сравниваем с тем же
  // прошедшим отрезком предыдущего окна, а не с полным: иначе «сегодня до 15:00»
  // против «весь вчерашний день» всегда в минусе.
  const nowMs = Date.now()
  const prevEnd = nowMs < end.getTime()
    ? new Date(prevStart.getTime() + Math.max(0, nowMs - start.getTime()))
    : bizDayBounds(prevTo, h).end

  const [current, previous] = await Promise.all([
    netBreakdown(db, start, end, from, to),
    netBreakdown(db, prevStart, prevEnd, prevFrom, prevTo),
  ])

  // Способы оплаты строго за период (фронт считает % от current.gross).
  const paymentBreakdown = await db
    .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
    .from(checkPayments)
    .leftJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end)))
    .groupBy(checkPayments.method)

  // Текущий бизнес-день — отдельный блок «Обзора».
  const todayBizStr = bizDayStr(0, h)
  const tb = bizDayBounds(todayBizStr, h)
  const today = await netBreakdown(db, tb.start, tb.end, todayBizStr, todayBizStr)

  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0))
  // Маржу считаем от выручки за вычетом возвратов (revenueNet), а не от gross —
  // иначе при возвратах знаменатель завышен и маржа занижена непоследовательно.
  const margin = current.revenueNet > 0 ? Math.round((current.net / current.revenueNet) * 100) : null
  const owner = isOwner(c)

  // Финблок (COGS/ФОТ/прибыль/маржа) — ТОЛЬКО владельцу (см. sanitizeBreakdown).
  return c.json({
    period: { from, to, days },
    // margin — финансовый показатель, добавляем только владельцу.
    current: owner ? { ...current, margin } : sanitizeBreakdown(current, owner),
    previous: sanitizeBreakdown(previous, owner),
    deltas: {
      // Дельта выручки — по net-of-refunds (как и показываемая «Выручка»).
      revenue: pct(current.revenueNet, previous.revenueNet),
      checks: pct(current.checks, previous.checks),
      // Финансовые дельты (прибыль/COGS/расходы) — только владельцу.
      ...(owner ? {
        profit: pct(current.net, previous.net),
        cogs: pct(current.cogs, previous.cogs),
        expenses: pct(current.expenses, previous.expenses),
      } : {}),
    },
    paymentBreakdown,
    today: sanitizeBreakdown(today, owner),
    businessDay: todayBizStr,
  })
})

// ─── Insights: структура, ритм клуба, гости, тренд ─────────────────────────────
// Одним запросом — то, чего не было в «Обзоре»:
//  • structure — из чего сложилась выручка закрытых чеков: бар (позиции и
//    модификаторы), игры (позиции-тарифы), аренда зон (остаток итога сверх позиций
//    и базы), мероприятия (база события на чеке) и скидки отдельной строкой;
//  • hours — оборот и чеки по часу открытия чека (МСК), heat — день недели × час;
//  • weekdays — по дню недели БИЗНЕС-дня (ночной чек в 01:00 — вечер прошлого дня),
//    среднее на один такой день периода;
//  • guests — уникальные гости, из них впервые за всё время, анонимные чеки;
//  • months — 12 месяцев до конца периода (оборот, чеки) для тренда.
// Списания на персонал (staff_comp) не входят — у них итог 0.
analyticsRouter.get('/insights', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(29, h)
  const to = q.to ?? bizDayStr(0, h)
  const start = bizDayBounds(from, h).start.toISOString()
  const end = bizDayBounds(to, h).end.toISOString()
  const rowsOf = (res: any) => (res?.rows ?? res ?? []) as any[]

  const [structureRes, hoursRes, weekdaysRes, guestsRes, monthsRes] = await Promise.all([
    db.execute(sql`
      WITH c AS (
        SELECT id, total_amount::numeric AS total, coalesce(event_base_amount, 0)::numeric AS base,
               coalesce(discount_total, 0)::numeric AS disc
        FROM checks
        WHERE status = 'closed' AND staff_comp_id IS NULL
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
      ),
      it AS (
        SELECT ci.check_id,
          coalesce(sum(ci.quantity * ci.price_at_time) FILTER (WHERE t.id IS NOT NULL), 0) AS tariff,
          coalesce(sum(ci.quantity * ci.price_at_time) FILTER (WHERE t.id IS NULL), 0) AS bar
        FROM check_items ci
        JOIN c ON c.id = ci.check_id
        LEFT JOIN tariffs t ON t.item_id = ci.item_id
        GROUP BY ci.check_id
      ),
      md AS (
        SELECT ci.check_id, sum(m.price_at_time * ci.quantity) AS mods
        FROM check_item_modifiers m
        JOIN check_items ci ON ci.id = m.check_item_id
        JOIN c ON c.id = ci.check_id
        GROUP BY ci.check_id
      )
      SELECT
        coalesce(sum(coalesce(it.bar, 0) + coalesce(md.mods, 0)), 0) AS bar,
        coalesce(sum(coalesce(it.tariff, 0)), 0) AS games,
        coalesce(sum(c.base), 0) AS events,
        coalesce(sum(c.disc), 0) AS discounts,
        coalesce(sum(greatest(0, c.total - c.base - (coalesce(it.tariff, 0) + coalesce(it.bar, 0) + coalesce(md.mods, 0) - c.disc))), 0) AS rental,
        coalesce(sum(c.total), 0) AS total
      FROM c LEFT JOIN it ON it.check_id = c.id LEFT JOIN md ON md.check_id = c.id
    `),
    db.execute(sql`
      SELECT extract(isodow FROM (created_at AT TIME ZONE 'Europe/Moscow') - make_interval(hours => ${h}))::int AS dow,
             extract(hour FROM created_at AT TIME ZONE 'Europe/Moscow')::int AS hour,
             count(*)::int AS checks, coalesce(sum(total_amount), 0)::float AS revenue
      FROM checks
      WHERE status = 'closed' AND staff_comp_id IS NULL
        AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
      GROUP BY 1, 2
    `),
    db.execute(sql`
      SELECT extract(isodow FROM d)::int AS dow, count(*)::int AS days
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
      GROUP BY 1
    `),
    db.execute(sql`
      WITH p AS (
        SELECT DISTINCT player_id FROM checks
        WHERE status = 'closed' AND player_id IS NOT NULL AND staff_comp_id IS NULL
          AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
      ),
      firsts AS (
        SELECT c.player_id, min(c.created_at) AS first_at
        FROM checks c JOIN p ON p.player_id = c.player_id
        WHERE c.status = 'closed'
        GROUP BY c.player_id
      )
      SELECT
        (SELECT count(*) FROM p)::int AS unique_guests,
        (SELECT count(*) FROM firsts WHERE first_at >= ${start}::timestamptz)::int AS new_guests,
        (SELECT count(*) FROM checks WHERE status = 'closed' AND player_id IS NULL AND staff_comp_id IS NULL
           AND created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz)::int AS anonymous_checks
    `),
    db.execute(sql`
      SELECT to_char(date_trunc('month', (created_at AT TIME ZONE 'Europe/Moscow') - make_interval(hours => ${h})), 'YYYY-MM') AS month,
             count(*)::int AS checks, coalesce(sum(total_amount), 0)::float AS revenue
      FROM checks
      WHERE status = 'closed' AND staff_comp_id IS NULL
        AND created_at >= (date_trunc('month', ${to}::date) - interval '11 months')::timestamp AT TIME ZONE 'Europe/Moscow'
        AND created_at < ${end}::timestamptz
      GROUP BY 1 ORDER BY 1
    `),
  ])

  const st = rowsOf(structureRes)[0] ?? {}
  const structure = {
    bar: parseNum(st.bar), games: parseNum(st.games), rental: parseNum(st.rental), events: parseNum(st.events),
    discounts: parseNum(st.discounts), total: parseNum(st.total),
  }

  const cells = rowsOf(hoursRes).map((r) => ({ dow: Number(r.dow), hour: Number(r.hour), checks: Number(r.checks), revenue: parseNum(r.revenue) }))
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const at = cells.filter((x) => x.hour === hour)
    return { hour, checks: at.reduce((a, x) => a + x.checks, 0), revenue: Math.round(at.reduce((a, x) => a + x.revenue, 0)) }
  })
  const dayCount = new Map(rowsOf(weekdaysRes).map((r) => [Number(r.dow), Number(r.days)]))
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const at = cells.filter((x) => x.dow === dow)
    const revenue = at.reduce((a, x) => a + x.revenue, 0)
    const checksCount = at.reduce((a, x) => a + x.checks, 0)
    const days = dayCount.get(dow) ?? 0
    return { dow, days, checks: checksCount, revenue: Math.round(revenue), avgRevenue: days > 0 ? Math.round(revenue / days) : 0 }
  })
  const heat = cells.filter((x) => x.checks > 0).map((x) => ({ dow: x.dow, hour: x.hour, checks: x.checks, revenue: Math.round(x.revenue) }))

  const g = rowsOf(guestsRes)[0] ?? {}
  const uniqueGuests = Number(g.unique_guests ?? 0)
  const newGuests = Number(g.new_guests ?? 0)
  const guests = { unique: uniqueGuests, new: newGuests, returning: Math.max(0, uniqueGuests - newGuests), anonymousChecks: Number(g.anonymous_checks ?? 0) }

  const monthRows = new Map(rowsOf(monthsRes).map((r) => [String(r.month), { checks: Number(r.checks), revenue: Math.round(parseNum(r.revenue)) }]))
  const [ty, tm] = to.split('-').map(Number)
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(ty, tm - 1 - (11 - i), 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return { month: key, ...(monthRows.get(key) ?? { checks: 0, revenue: 0 }) }
  })

  return c.json({ period: { from, to }, structure, hours, weekdays, heat, guests, months })
})

// ─── Revenue by day ───────────────────────────────────────────────────────────
analyticsRouter.get('/revenue', zValidator('query', dateRangeQuerySchema), async (c) => {
  // Период по МСК. from/to — YYYY-MM-DD (включительно). Окно по timestamptz —
  // полуоткрытое [fromStart, toEndExclusive) на границах полуночи МСК; так чек,
  // созданный в 23:30 МСК последнего дня, попадает в нужные сутки, а не в UTC-день.
  // from/to валидированы (см. dateRangeQuerySchema): мусорные/Invalid даты уже
  // отброшены в undefined, поэтому здесь надёжно падаем на дефолты.
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  // Окно и группировка — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как в остальной
  // аналитике: чек в 02:00 относится к бизнес-дню предыдущей календарной даты,
  // иначе ночная активность «разрывалась» по полуночи. interval — час из настройки
  // (h ∈ [0..23], число, безопасно для интерполяции через sql.raw).
  const fromStart = bizDayBounds(from, h).start
  const toEndExclusive = bizDayBounds(to, h).end
  // Сдвиг для агрегации по бизнес-дню в SQL: при h=9 даёт прежний `interval '9 hours'`.
  const bizShift = sql`(${checks.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours'`

  const rows = await db
    .select({
      // День агрегируем по БИЗНЕС-ДНЮ (сдвиг −h ч в МСК → 00:00..(h−1):59 к прошлой дате).
      date: sql<string>`(${bizShift})::date::text`,
      revenue: sum(checks.totalAmount),
      count: count(),
    })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
    ))
    .groupBy(sql`(${bizShift})::date`)
    .orderBy(asc(sql`(${bizShift})::date`))

  // Возвраты по бизнес-дню ВОЗВРАТА (refunds.created_at), та же группировка/окно,
  // что и выручка. Нужны, чтобы привести дневную «Выручку» графика к net-of-refunds
  // (P0): возврат уменьшает столбец того дня, когда он оформлен (консистентно с
  // /overview, /dashboard). Отдаём и отдельной серией `refunds`, чтобы фронт мог
  // показать «возвраты» под графиком.
  const refShift = sql`(${refunds.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours'`
  const refRows = await db
    .select({
      date: sql<string>`(${refShift})::date::text`,
      total: sum(refunds.totalAmount),
    })
    .from(refunds)
    .where(and(
      gte(refunds.createdAt, fromStart),
      lt(refunds.createdAt, toEndExclusive),
    ))
    .groupBy(sql`(${refShift})::date`)
  const refundByDay = new Map<string, number>(refRows.map((r: any) => [r.date, parseNum(r.total)]))
  // Приводим дневную выручку к net: revenue − возвраты этого бизнес-дня (не ниже 0
  // не зажимаем — возврат может относиться к чеку прошлого периода и формально
  // «утянуть» день в минус; это корректное отражение факта на дате возврата).
  const revRows = rows.map((r: any) => ({
    date: r.date,
    revenue: Math.round((parseNum(r.revenue) - (refundByDay.get(r.date) ?? 0)) * 100) / 100,
    count: r.count,
  }))

  // Expenses by day. expenseDate — text-дата в местном времени; сравниваем как
  // строки YYYY-MM-DD (от and до включительно), без каста ::date vs timestamptz,
  // который давал сдвиг на сутки относительно UTC-границы.
  const expRows = await db
    .select({
      date: sql<string>`${expenses.expenseDate}`,
      total: sum(expenses.amount),
    })
    .from(expenses)
    .where(and(
      gte(expenses.expenseDate, from),
      lte(expenses.expenseDate, to),
    ))
    .groupBy(expenses.expenseDate)

  // COGS by day — себестоимость ПРОДАННОГО (продажа МИНУС возврат), а не стоимость
  // поставок. Зафиксированный unit_cost с фолбэком на текущий WAC для исторических
  // NULL. Продажа delta<0 добавляет, возврат delta>0 вычитает → (0 − delta).
  // Как в cogsInWindow: движения по чекам — только закрытых чеков и в бизнес-день
  // ЧЕКА (тот же столбец, что и его выручка; открытый счёт не уводит день в минус);
  // прочие (возвраты по refunds, исторические) — в бизнес-день движения.
  const smShift = sql`(${stockMovements.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours'`
  const [cogsCheckRows, cogsOtherRows] = await Promise.all([
    db
      .select({ date: sql<string>`(${bizShift})::date::text`, total: cogsSumExpr })
      .from(stockMovements)
      .innerJoin(checks, eq(checks.id, stockMovements.sourceId))
      .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
      .where(and(
        eq(stockMovements.sourceType, 'check'), inArray(stockMovements.type, ['sale', 'return']),
        eq(checks.status, 'closed'), gte(checks.createdAt, fromStart), lt(checks.createdAt, toEndExclusive),
      ))
      .groupBy(sql`(${bizShift})::date`),
    db
      .select({ date: sql<string>`(${smShift})::date::text`, total: cogsSumExpr })
      .from(stockMovements)
      .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
      .where(and(
        notCheckSource, inArray(stockMovements.type, ['sale', 'return']),
        gte(stockMovements.createdAt, fromStart), lt(stockMovements.createdAt, toEndExclusive),
      ))
      .groupBy(sql`(${smShift})::date`),
  ])
  const cogsByDay = new Map<string, number>()
  for (const r of [...cogsCheckRows, ...cogsOtherRows] as any[]) {
    cogsByDay.set(r.date, (cogsByDay.get(r.date) ?? 0) + parseNum(r.total))
  }
  const cogsRows = [...cogsByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))

  // revenue — уже net-of-refunds по дню; refunds — отдельная серия для фронта.
  const refundsSeries = refRows.map((r: any) => ({ date: r.date, total: parseNum(r.total) }))
  // Расходы и себестоимость по дням — коммерческая тайна: не-владельцу пустые серии.
  const owner = isOwner(c)
  return c.json({ revenue: revRows, refunds: refundsSeries, expenses: owner ? expRows : [], cogs: owner ? cogsRows : [] })
})

// ─── Payments by method (period) ───────────────────────────────────────────────
// Разбивка платежей по способу оплаты за период. Окно — то же полуоткрытое
// [fromStart, toEndExclusive) по МСК, что и в /revenue; только закрытые чеки.
// Потребляется вкладкой «Отчёты → Платежи» на фронте.
analyticsRouter.get('/payments', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  // Окно — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как в /overview и /staff. Иначе
  // активность, пробитая после полуночи (00:00–06:00), уезжала в следующие
  // календарные сутки и выпадала из бизнес-дня (тариф «Гость» в 01:07 не попадал).
  const fromStart = bizDayBounds(from, h).start
  const toEndExclusive = bizDayBounds(to, h).end

  const rows = await db
    .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
    .from(checkPayments)
    .leftJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
    ))
    .groupBy(checkPayments.method)

  return c.json({ breakdown: rows })
})

// ─── Products ABC ─────────────────────────────────────────────────────────────
analyticsRouter.get('/products', zValidator('query', dateRangeQuerySchema), async (c) => {
  // Период по МСК, полуоткрытое окно [fromStart, toEndExclusive) — как в /revenue.
  // from/to валидированы (dateRangeQuerySchema), мусор отброшен → дефолты.
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  // Окно — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как в /overview и /staff. Иначе
  // активность, пробитая после полуночи (00:00–06:00), уезжала в следующие
  // календарные сутки и выпадала из бизнес-дня (тариф «Гость» в 01:07 не попадал).
  const fromStart = bizDayBounds(from, h).start
  const toEndExclusive = bizDayBounds(to, h).end

  const rows = await db
    .select({
      itemId: checkItems.itemId,
      name: inventory.name,
      // Человекочитаемое название категории (резолв UUID → name). categoryId
      // отдаём отдельно для группировки/навигации на фронте.
      category: menuCategories.name,
      categoryId: inventory.category,
      totalQty: sum(checkItems.quantity),
      totalRev: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
    })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .leftJoin(menuCategories, eq(menuCategories.id, inventory.category))
    .leftJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
      // Списания на персонал (бесплатные) не учитываем в выручке бара — они в «Персонал».
      isNull(checks.staffCompId),
    ))
    .groupBy(checkItems.itemId, inventory.name, menuCategories.name, inventory.category)
    .orderBy(desc(sql`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`))
    .limit(50)

  // ABC по накопленной доле выручки. Класс присваиваем по доле, накопленной ДО
  // данной позиции: A — пока накопление < 80% («топ до 80%»), B — 80–95%, C — 95–100%.
  // Так позиция, перешагивающая порог, остаётся в нижнем (более ценном) классе.
  // Итог — по ВСЕМ позициям периода (отдельный агрегат без LIMIT), а не по топ-50:
  // иначе доли и итог выручки завышались.
  const [totalRow] = await db
    .select({ total: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})` })
    .from(checkItems)
    .leftJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
      isNull(checks.staffCompId),
    ))
  const totalRev = parseNum(totalRow?.total)
  let cumulative = 0
  const withAbc = rows.map((r: any) => {
    const rev = parseNum(r.totalRev)
    const share = totalRev > 0 ? (rev / totalRev) * 100 : 0
    const startCum = cumulative
    cumulative += share
    const abc = startCum < 80 ? 'A' : startCum < 95 ? 'B' : 'C'
    return { ...r, share: Math.round(share * 10) / 10, cumulative: Math.round(cumulative * 10) / 10, abc }
  })

  return c.json({ products: withAbc, totalRev })
})

// ─── Тарифы: продажи по тарифам и разбивка по типам вечеров ────────────────────
// Сколько каждого тарифа продано за период и как продажи делятся по типам вечеров.
// Тариф маппится на проданное через backing-позицию: tariffs.item_id = check_items.item_id.
// Окно — то же полуоткрытое [fromStart, toEndExclusive) по МСК, что и в /revenue;
// только закрытые чеки. Тип вечера берём со смены чека (shifts.evening_type).
// ─── Аналитика мероприятий ──────────────────────────────────────────────────
// Окно — по КАЛЕНДАРНОЙ дате события (events.date = 'YYYY-MM-DD'), а не по бизнес-дню:
// мероприятия планируются по обычной дате. Длительность и группировки считаем в JS.
analyticsRouter.get('/events', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)

  const rows = await db
    .select({
      id: events.id, date: events.date, startTime: events.startTime, endTime: events.endTime,
      plannedHours: events.plannedHours, type: events.type, format: events.format, status: events.status,
      attendeesCount: events.attendeesCount, title: events.title,
      fixedAmount: events.fixedAmount, manualAmount: events.manualAmount,
      participationFee: events.participationFee, prizeFund: events.prizeFund,
      lunchCost: events.lunchCost, otherCost: events.otherCost,
      spaceId: events.spaceId, customerName: events.customerName, customerPhone: events.customerPhone,
      checkId: events.checkId, spaceName: spaces.name,
      // ФАКТ — сумма ЗАКРЫТЫХ чеков, привязанных к событию (linked_event_id): основной
      // чек, чеки участников миникапа (у него нет events.check_id) и доп. чеки.
      // Открытый чек — ещё не выручка. NULL — закрытых чеков нет.
      checkTotal: sql<string | null>`(SELECT sum(ch.total_amount) FROM checks ch WHERE ch.linked_event_id = ${events.id} AND ch.status = 'closed')`,
    })
    .from(events)
    .leftJoin(spaces, eq(spaces.id, events.spaceId))
    .where(and(gte(events.date, from), lte(events.date, to)))
    .orderBy(desc(events.date))

  const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0
  const durHours = (start: string | null, end: string | null, planned: number | null) => {
    if (start && end) {
      const [sh, sm] = start.split(':').map(Number)
      const [eh, em] = end.split(':').map(Number)
      let d = (eh * 60 + em) - (sh * 60 + sm)
      if (d < 0) d += 24 * 60 // через полночь
      return d / 60
    }
    return planned ?? 0
  }
  // ВЫРУЧКА МЕРОПРИЯТИЯ — РАЗДЕЛЯЕМ ФАКТ И ПЛАН (P1):
  // - есть закрытые чеки события → ФАКТ: checkTotal (сумма total_amount всех закрытых
  //   чеков с linked_event_id, уже включает eventBase+аренду). ВАЖНО: эта сумма УЖЕ
  //   входит в общий gross клуба (/dashboard, /overview считают те же чеки). Значит
  //   «Выручка мероприятий» — это ПОДМНОЖЕСТВО общей выручки, а НЕ добавка:
  //   складывать её с «Выручкой клуба» нельзя (будет двойной счёт). См. revenueNote.
  // - закрытых чеков нет → ПЛАН: manualAmount/fixedAmount. Это НЕ факт оплаты и в
  //   общий gross НЕ входит — помечаем отдельно (plannedRevenue), не смешивая с фактом.
  const eventActual = (r: any) => r.checkTotal != null ? n(r.checkTotal) : 0
  const eventPlanned = (r: any) => r.checkTotal != null ? 0 : (n(r.manualAmount) || n(r.fixedAmount) || 0)
  // Совокупная «выручка» строки для разбивок (факт, если есть; иначе план) —
  // прежнее поведение для сортировок/топов, но факт и план считаем ещё и раздельно.
  const eventRevenue = (r: any) => eventActual(r) || eventPlanned(r)
  const categoryOf = (r: any) => r.format === 'minicap' ? 'Миникап' : r.type === 'exit' ? 'Выезд' : 'Титан'
  // Пн..Вс (в России неделя с понедельника). Date.getUTCDay(): 0=вс..6=сб.
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const wdIndex = (dateStr: string) => { const d = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); return (d + 6) % 7 }

  const active = (rows as any[]).filter(r => r.status !== 'cancelled')
  const byStatus: Record<string, number> = {}
  for (const r of rows as any[]) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  let hours = 0, revenue = 0, attendees = 0
  // Раздельно: ФАКТ (выручка по чекам — подмножество общей выручки клуба) и ПЛАН
  // (события без чека — manualAmount/fixedAmount, в общий gross НЕ входят).
  let actualRevenue = 0, plannedRevenue = 0
  const days = new Set<string>()
  const catMap = new Map<string, { count: number; revenue: number; hours: number }>()
  const wdCount = [0, 0, 0, 0, 0, 0, 0]
  const custMap = new Map<string, { name: string; phone: string | null; count: number; hours: number; revenue: number }>()
  const zoneMap = new Map<string, { name: string; count: number; revenue: number }>()

  for (const r of active) {
    const dur = durHours(r.startTime, r.endTime, r.plannedHours)
    const rev = eventRevenue(r)
    hours += dur; revenue += rev; attendees += (r.attendeesCount ?? 0)
    actualRevenue += eventActual(r); plannedRevenue += eventPlanned(r)
    if (r.date) { days.add(r.date); wdCount[wdIndex(r.date)]++ }
    const cat = categoryOf(r)
    const cm = catMap.get(cat) ?? { count: 0, revenue: 0, hours: 0 }
    cm.count++; cm.revenue += rev; cm.hours += dur; catMap.set(cat, cm)
    if (r.customerName || r.customerPhone) {
      const key = (r.customerName ?? '') + '|' + (r.customerPhone ?? '')
      const c2 = custMap.get(key) ?? { name: r.customerName ?? 'Без имени', phone: r.customerPhone ?? null, count: 0, hours: 0, revenue: 0 }
      c2.count++; c2.hours += dur; c2.revenue += rev; custMap.set(key, c2)
    }
    if (r.spaceName) {
      const z = zoneMap.get(r.spaceName) ?? { name: r.spaceName, count: 0, revenue: 0 }
      z.count++; z.revenue += rev; zoneMap.set(r.spaceName, z)
    }
  }

  const cnt = active.length
  return c.json({
    from, to,
    totals: {
      count: cnt,
      hours: Math.round(hours * 10) / 10,
      days: days.size,
      // revenue = факт+план (как раньше, для совместимости со средними). Раздельно
      // отдаём actualRevenue (по чекам — ВХОДИТ в общий gross клуба) и
      // plannedRevenue (события без чека — план, в gross НЕ входит).
      revenue,
      actualRevenue: Math.round(actualRevenue * 100) / 100,
      plannedRevenue: Math.round(plannedRevenue * 100) / 100,
      // Подсказка фронту: «Выручку мероприятий» (actualRevenue) НЕЛЬЗЯ складывать с
      // «Выручкой клуба» — это её подмножество (двойной счёт). plannedRevenue —
      // план по событиям без чека, не факт.
      revenueNote: 'actualRevenue входит в общую выручку клуба (подмножество, не добавка); plannedRevenue — план событий без чека',
      attendees,
      cancelled: byStatus['cancelled'] ?? 0,
      avgDuration: cnt ? Math.round((hours / cnt) * 10) / 10 : 0,
      avgCheck: cnt ? Math.round(revenue / cnt) : 0,
      revenuePerHour: hours ? Math.round(revenue / hours) : 0,
      avgAttendees: cnt ? Math.round((attendees / cnt) * 10) / 10 : 0,
    },
    byStatus,
    byCategory: [...catMap.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.revenue - a.revenue),
    byWeekday: WD.map((label, i) => ({ label, count: wdCount[i] })),
    // Телефон заказчика (ПДн) — только владельцу.
    topCustomers: [...custMap.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count).slice(0, 8)
      .map((cu) => (isOwner(c) ? cu : { ...cu, phone: null })),
    topZones: [...zoneMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
  })
})

analyticsRouter.get('/tariffs', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  // Окно — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как в /overview и /staff. Иначе
  // активность, пробитая после полуночи (00:00–06:00), уезжала в следующие
  // календарные сутки и выпадала из бизнес-дня (тариф «Гость» в 01:07 не попадал).
  const fromStart = bizDayBounds(from, h).start
  const toEndExclusive = bizDayBounds(to, h).end

  const lineRev = sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`
  const lineQty = sql<number>`sum(${checkItems.quantity})::int`

  // Разбивка по тарифам.
  const byTariffRows = await db
    .select({
      tariffId: tariffs.id,
      name: tariffs.name,
      count: lineQty,
      revenue: lineRev,
    })
    .from(checkItems)
    .innerJoin(tariffs, eq(tariffs.itemId, checkItems.itemId))
    .innerJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
    ))
    .groupBy(tariffs.id, tariffs.name)
    .orderBy(desc(lineRev))

  // Разбивка по типам вечеров (тип берём со смены чека).
  const byEveningRows = await db
    .select({
      eveningKey: shifts.eveningType,
      count: lineQty,
      revenue: lineRev,
    })
    .from(checkItems)
    .innerJoin(tariffs, eq(tariffs.itemId, checkItems.itemId))
    .innerJoin(checks, eq(checks.id, checkItems.checkId))
    .innerJoin(shifts, eq(shifts.id, checks.shiftId))
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fromStart),
      lt(checks.createdAt, toEndExclusive),
    ))
    .groupBy(shifts.eveningType)
    .orderBy(desc(lineRev))

  // Метки типов вечеров из справочника (fallback на сам key).
  const eveningRows = await db.select({ key: eveningTypes.key, label: eveningTypes.label }).from(eveningTypes)
  const labelByKey = new Map(eveningRows.map((r: any) => [r.key, r.label]))

  const byTariff = byTariffRows.map((r: any) => ({
    tariffId: r.tariffId,
    name: r.name,
    count: Number(r.count ?? 0),
    revenue: parseNum(r.revenue),
  }))

  const byEvening = byEveningRows.map((r: any) => ({
    eveningKey: r.eveningKey,
    label: labelByKey.get(r.eveningKey) ?? r.eveningKey,
    count: Number(r.count ?? 0),
    revenue: parseNum(r.revenue),
  }))

  const total = byTariff.reduce(
    (acc, r) => ({ count: acc.count + r.count, revenue: acc.revenue + r.revenue }),
    { count: 0, revenue: 0 },
  )
  total.revenue = Math.round(total.revenue * 100) / 100

  // Игровые вечера за период по типам. Вечер засчитывается, ТОЛЬКО если в смене
  // ≥3 закрытых чеков с тарифом-местом игрока (Резидент/Студент/Новичок/Гость — все
  // 4 базовых статуса миграции 052) — считаем по факту игры, а не по типу вечера,
  // выставленному при открытии смены. Тариф узнаём по стабильному tariffs.key, а не
  // по редактируемому имени.
  const geRes: any = await db.execute(sql`
    SELECT sc.evening_type AS evening_key, count(*)::int AS evenings
    FROM (
      SELECT s.id, s.evening_type,
        count(DISTINCT c.id) FILTER (WHERE EXISTS (
          SELECT 1 FROM check_items ci JOIN tariffs t ON t.item_id = ci.item_id
          WHERE ci.check_id = c.id AND t.key IN ('resident', 'student', 'newbie', 'guest')
        )) AS qcount
      FROM shifts s
      LEFT JOIN checks c ON c.shift_id = s.id AND c.status = 'closed'
      WHERE s.opened_at >= ${fromStart.toISOString()}::timestamptz AND s.opened_at < ${toEndExclusive.toISOString()}::timestamptz
      GROUP BY s.id, s.evening_type
    ) sc
    WHERE sc.qcount >= 3
    GROUP BY sc.evening_type
  `)
  const geRows = (geRes.rows ?? geRes ?? []) as { evening_key: string; evenings: number }[]
  const geByKey = new Map(geRows.map(r => [r.evening_key, Number(r.evenings)]))
  // Всегда показываем названные типы (даже с 0); прочие (например board_games) — если были.
  const NAMED_EVENINGS = ['city_mafia', 'sport_mafia', 'kids_mafia', 'none']
  const geKeys = [...NAMED_EVENINGS, ...[...geByKey.keys()].filter(k => !NAMED_EVENINGS.includes(k))]
  const gameEvenings = geKeys.map(k => ({
    eveningKey: k,
    label: labelByKey.get(k) ?? (k === 'none' ? 'Без вечера' : k),
    count: geByKey.get(k) ?? 0,
  }))
  // Миникапы — отдельной строкой (у участников взнос, а не тариф игрока, поэтому в
  // обычный счётчик вечеров они не попадают). Считаем по событиям format='minicap'.
  const [{ cnt: minicapCnt }] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.format, 'minicap'), gte(events.date, from), lte(events.date, to), ne(events.status, 'cancelled')))
  gameEvenings.push({ eveningKey: 'minicap', label: 'Миникап', count: Number(minicapCnt ?? 0) })
  const gameEveningsTotal = gameEvenings.reduce((a, e) => a + e.count, 0)

  return c.json({ byTariff, byEvening, gameEvenings, gameEveningsTotal, total })
})

// ─── Clients / Players ────────────────────────────────────────────────────────
analyticsRouter.get('/clients', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  // Окно — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как в остальной аналитике
  // (см. /tariffs): активность после полуночи не выпадает из своего бизнес-дня.
  const pStart = bizDayBounds(from, h).start
  const pEnd = bizDayBounds(to, h).end

  const now = new Date()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

  // Total clients
  const [total] = await db.select({ count: count() }).from(profiles)
    .where(and(eq(profiles.role, 'client'), isNull(profiles.deletedAt)))

  // Новые за выбранный период (регистрации в окне [from, to]).
  const [newThisPeriod] = await db.select({ count: count() }).from(profiles)
    .where(and(eq(profiles.role, 'client'), isNull(profiles.deletedAt), gte(profiles.createdAt, pStart), lt(profiles.createdAt, pEnd)))

  // Tier distribution
  const tierDist = await db.select({ tier: profiles.clientTier, count: count() })
    .from(profiles)
    .where(and(eq(profiles.role, 'client'), isNull(profiles.deletedAt)))
    .groupBy(profiles.clientTier)

  // Retention (14 дней) по §8: доля игроков, вернувшихся хотя бы раз в окне.
  // Визит = отдельный день с закрытым чеком (несколько чеков за один вечер — один
  // визит). retention = (игроки с ≥2 визит-днями) / (игроки с ≥1 визитом) × 100%.
  // Обезличенные продажи (playerId IS NULL) не считаем — иначе знаменатель/числитель
  // искажаются (раньше метрика давала 0% при сотне игроков).
  const retentionRows = await db
    .select({
      playerId: checks.playerId,
      // Визит-день по бизнес-дню (сдвиг −h ч в МСК; при h=9 = прежний interval '9 hours').
      days: sql<number>`count(distinct ((${checks.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours')::date)`,
    })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, fourteenDaysAgo),
      isNotNull(checks.playerId),
    ))
    .groupBy(checks.playerId)

  const retentionDenom = retentionRows.length
  const retentionNumer = retentionRows.filter((r: any) => Number(r.days) >= 2).length
  const retentionRate = retentionDenom > 0 ? Math.round((retentionNumer / retentionDenom) * 100) : 0

  // Сегменты игроков: new / active / sleeping
  // New = регистрация < 30 дней назад (берётся отдельным запросом ниже)
  // Active = есть закрытый чек за последние 14 дней
  // Sleeping = есть чеки, но последний — более 14 дней назад
  //
  // ОКНО 90 ДНЕЙ (а не all-time): этот агрегат раньше сканировал ВСЕ закрытые чеки
  // за всю историю (один ряд на каждого игрока, когда-либо что-то купившего), и
  // объём рос безгранично. Для сегментации это избыточно: «active» — это последние
  // 14 дней, а «sleeping» имеет смысл только как «недавно был активен, но затих».
  // Игроки без единого закрытого чека за 90 дней считаются ушедшими и в эти два
  // сегмента не попадают (для них есть отдельные витрины retention/тиров). Окно
  // опирается на индекс по checks.created_at и режет скан до свежих данных.
  // Форма ответа не меняется — наполняем те же segments.active / segments.sleeping.
  const segmentsWindowStart = new Date(now.getTime() - 90 * 86400000)

  const visitCounts = await db
    .select({
      playerId: checks.playerId,
      total: count(),
      lastVisit: sql<string>`max(${checks.createdAt})::text`,
    })
    .from(checks)
    .where(and(
      eq(checks.status, 'closed'),
      gte(checks.createdAt, segmentsWindowStart),
      // Анонимные чеки (без игрока) — не игрок: иначе группа NULL давала +1 в сегменте.
      isNotNull(checks.playerId),
    ))
    .groupBy(checks.playerId)

  const segments = { new: 0, active: 0, sleeping: 0 }
  const cutoffMs = fourteenDaysAgo.getTime()

  for (const row of visitCounts) {
    const lastMs = row.lastVisit ? new Date(row.lastVisit).getTime() : 0
    if (lastMs > cutoffMs) {
      segments.active++
    } else {
      segments.sleeping++
    }
  }
  // New clients with no visits yet — сегмент «new» делаем ВЗАИМОИСКЛЮЧАЮЩИМ с
  // active/sleeping: клиент, зарегистрированный <30 дней назад, попадает в «new»
  // только если у него НЕТ закрытого чека в окне визитов (т.е. его нет в
  // visitCounts). Иначе он уже посчитан в active/sleeping и задваивался бы.
  const visitedIds = new Set(visitCounts.map((r: any) => r.playerId).filter(Boolean))
  const newClientRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(
      eq(profiles.role, 'client'),
      isNull(profiles.deletedAt),
      gte(profiles.createdAt, thirtyDaysAgo),
    ))
  segments.new = newClientRows.filter((r: any) => !visitedIds.has(r.id)).length

  // Top spenders ЗА ПЕРИОД — ТОЛЬКО реальные игроки (playerId задан). Обезличенные
  // продажи («Гость», playerId IS NULL) НЕ участвуют в рейтинге, иначе они
  // перебивали бы реальных игроков (§9.4). Их сумму отдаём отдельной строкой.
  // Траты топ-спендеров — NET-OF-REFUNDS (P0): из суммы чеков игрока вычитаем его
  // возвраты, попавшие в окно по дате возврата (refundedInWindow). Иначе полностью
  // возвращённый чек продолжал раздувать «топ по тратам». refundsTotal по игроку
  // отдаём отдельным полем — фронт может показать «возвраты» в карточке строки.
  const spendNet = sql<number>`sum(${checks.totalAmount}::numeric - ${refundedInWindow(checks.id, pStart, pEnd)}::numeric)`
  const topSpenders = await db
    .select({
      playerId: checks.playerId,
      nickname: profiles.nickname,
      clientTier: profiles.clientTier,
      photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
      total: spendNet,
      grossTotal: sum(checks.totalAmount),
      visits: count(),
    })
    .from(checks)
    .leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, pStart), lt(checks.createdAt, pEnd), isNotNull(checks.playerId)))
    .groupBy(checks.playerId, profiles.nickname, profiles.clientTier, profiles.photoUrl, profiles.tgPhotoUrl, profiles.gomafiaPhotoUrl)
    .orderBy(desc(spendNet))
    .limit(10)
  // Нормализуем числа и добавляем refundsTotal = gross − net по строке.
  const topSpendersOut = topSpenders.map((r: any) => {
    const net = parseNum(r.total)
    const gross = parseNum(r.grossTotal)
    return { playerId: r.playerId, nickname: r.nickname, clientTier: r.clientTier, photoUrl: r.photoUrl, total: net, refundsTotal: Math.round((gross - net) * 100) / 100, visits: r.visits }
  })

  // Обезличенные продажи (без игрока) за период — отдельной строкой «Без игрока».
  // Тоже net-of-refunds: возвраты обезличенных чеков вычитаем по дате возврата.
  const [guestRow] = await db
    .select({ total: sql<number>`sum(${checks.totalAmount}::numeric - ${refundedInWindow(checks.id, pStart, pEnd)}::numeric)`, visits: count() })
    .from(checks)
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, pStart), lt(checks.createdAt, pEnd), isNull(checks.playerId)))
  const guestSales = { total: parseNum(guestRow?.total), visits: guestRow?.visits ?? 0 }

  return c.json({
    total: total.count,
    newThisPeriod: newThisPeriod.count,
    period: { from, to },
    tierDist,
    retentionRate,
    segments,
    topSpenders: topSpendersOut,
    guestSales,
  })
})

// ─── Список игроков сегмента (клик по сегменту в «Игроках») ────────────────────
analyticsRouter.get('/segment-members', zValidator('query', z.object({ segment: z.enum(['new', 'active', 'sleeping']) })), async (c) => {
  const db = c.var.db
  const { segment } = c.req.valid('query')
  const now = Date.now()
  const d14 = new Date(now - 14 * 86400000)
  const d30 = new Date(now - 30 * 86400000)
  const d90 = new Date(now - 90 * 86400000)

  if (segment === 'new') {
    // Зарегистрированы <30 дней назад и без закрытого чека за 90 дней (как в counts).
    const visited = await db.selectDistinct({ playerId: checks.playerId }).from(checks)
      .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, d90), isNotNull(checks.playerId)))
    const visitedSet = new Set(visited.map((r: any) => r.playerId).filter(Boolean))
    const rows = await db.select({ id: profiles.id, nickname: profiles.nickname, clientTier: profiles.clientTier, photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})` })
      .from(profiles).where(and(eq(profiles.role, 'client'), isNull(profiles.deletedAt), gte(profiles.createdAt, d30)))
      .orderBy(desc(profiles.createdAt))
    const players = rows.filter((r: any) => !visitedSet.has(r.id)).map((r: any) => ({ playerId: r.id, nickname: r.nickname, clientTier: r.clientTier, photoUrl: r.photoUrl, total: 0, visits: 0 }))
    return c.json({ players })
  }

  // active / sleeping: агрегируем визиты за 90 дней, делим по порогу 14 дней.
  const visits = await db.select({
    playerId: checks.playerId,
    nickname: profiles.nickname,
    clientTier: profiles.clientTier,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
    lastVisit: sql<string>`max(${checks.createdAt})::text`,
    total: sum(checks.totalAmount),
    visits: count(),
  }).from(checks).leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, d90), isNotNull(checks.playerId)))
    .groupBy(checks.playerId, profiles.nickname, profiles.clientTier, profiles.photoUrl, profiles.tgPhotoUrl, profiles.gomafiaPhotoUrl)
  const cutoff = d14.getTime()
  const players = visits
    .filter((v: any) => (segment === 'active' ? new Date(v.lastVisit).getTime() > cutoff : new Date(v.lastVisit).getTime() <= cutoff))
    .map((v: any) => ({ playerId: v.playerId, nickname: v.nickname, clientTier: v.clientTier, photoUrl: v.photoUrl, total: parseNum(v.total), visits: v.visits, lastVisit: v.lastVisit }))
    .sort((a: any, b: any) => b.total - a.total)
  return c.json({ players })
})

// ─── Персонал: списания на сотрудников/владельца за период ─────────────────────
// Чеки со staffCompId (бесплатные, итог 0₽). По каждому сотруднику — товарная
// сумма (сколько бы стоило в рознице) и себестоимость («как бы оплатил»).
analyticsRouter.get('/staff', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  // ДОСТУП: /staff — чисто финансовая витрина (себестоимость comp-списаний на
  // сотрудников = коммерческая тайна, фактически «сколько съели в деньгах»). Для
  // staff отдаём 403 (P1): рядовой кассир не должен видеть себестоимость/маржу.
  if (!isOwner(c)) return c.json({ error: 'forbidden' }, 403)
  const q = c.req.valid('query')
  // Окно — по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как и весь остальной дашборд.
  // Раньше тут были календарные сутки (mskBoundary = 00:00 МСК), из-за чего
  // comp-чек, пробитый после полуночи (00:00–06:00), выпадал из «сегодня» —
  // относился к прошлому бизнес-дню, но календарная граница его отрезала.
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  const { start: pStart } = bizDayBounds(from, h)
  const { end: pEnd } = bizDayBounds(to, h)

  // СЕБЕСТОИМОСТЬ ПО ЗАФИКСИРОВАННОЙ ЦЕНЕ (P1): раньше cost считался по ТЕКУЩЕМУ
  // inventory.cost_price (WAC карточки), из-за чего себестоимость прошлых comp-
  // списаний «плыла» после каждой новой закупки и расходилась с общим COGS
  // (netBreakdown/dashboard уже используют stock_movements.unit_cost). Теперь берём
  // ту же зафиксированную на момент продажи себестоимость из движений склада
  // (stock_movements.unit_cost, фолбэк на текущий WAC для исторических NULL).
  //
  // ВАЖНО про фан-аут: cost считаем ОТДЕЛЬНЫМ запросом по stock_movements (тип
  // 'sale' минус 'return' — снятые с чека позиции, source_type='check',
  // source_id=checks.id), а НЕ в одном join с
  // checkItems — иначе сумма помножилась бы на число позиций/строк. retail (по
  // позициям) и cost (по движениям) собираем двумя запросами и сшиваем в JS.
  const costExpr = sql<number>`sum((0 - ${stockMovements.delta})::numeric * coalesce(${stockMovements.unitCost}, ${inventory.costPrice}, 0)::numeric)`

  // (1) Розничная сумма и число чеков на сотрудника — по позициям (checkItems).
  const retailRows = await db.select({
    staffId: checks.staffCompId,
    nickname: profiles.nickname,
    clientTier: profiles.clientTier,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
    checksCount: sql<number>`count(distinct ${checks.id})`,
    retail: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
  })
    .from(checks)
    .innerJoin(checkItems, eq(checkItems.checkId, checks.id))
    .leftJoin(profiles, eq(profiles.id, checks.staffCompId))
    .where(and(eq(checks.status, 'closed'), isNotNull(checks.staffCompId), gte(checks.createdAt, pStart), lt(checks.createdAt, pEnd)))
    .groupBy(checks.staffCompId, profiles.nickname, profiles.clientTier, profiles.photoUrl, profiles.tgPhotoUrl, profiles.gomafiaPhotoUrl)

  // (2) Зафиксированная себестоимость на сотрудника — по движениям склада comp-чеков.
  const costRows = await db.select({
    staffId: checks.staffCompId,
    cost: costExpr,
  })
    .from(stockMovements)
    .innerJoin(checks, eq(stockMovements.sourceId, checks.id))
    .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
    .where(and(
      eq(stockMovements.sourceType, 'check'), inArray(stockMovements.type, ['sale', 'return']),
      eq(checks.status, 'closed'), isNotNull(checks.staffCompId),
      gte(checks.createdAt, pStart), lt(checks.createdAt, pEnd),
    ))
    .groupBy(checks.staffCompId)
  const costByStaff = new Map<string, number>(costRows.map((r: any) => [r.staffId, parseNum(r.cost)]))

  const staffMapped = retailRows.map((r: any) => ({ staffId: r.staffId, nickname: r.nickname ?? '—', clientTier: r.clientTier, photoUrl: r.photoUrl ?? null, checksCount: r.checksCount ?? 0, retail: parseNum(r.retail), cost: costByStaff.get(r.staffId) ?? 0 }))
  // Сортировка по себестоимости (как раньше) — теперь в JS, т.к. cost из второго запроса.
  const staff = staffMapped.sort((a, b) => b.cost - a.cost)
  const totals = staff.reduce((a, s) => ({ retail: a.retail + s.retail, cost: a.cost + s.cost, checks: a.checks + (s.checksCount || 0) }), { retail: 0, cost: 0, checks: 0 })

  // Отдельные транзакции (каждый comp-чек) — кликабельны в UI → состав чека.
  // retail — по позициям. cost берём из движений склада per-check (тот же фикс-расчёт).
  const compRows = await db.select({
    id: checks.id,
    createdAt: checks.createdAt,
    staffId: checks.staffCompId,
    nickname: profiles.nickname,
    retail: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
  })
    .from(checks)
    .innerJoin(checkItems, eq(checkItems.checkId, checks.id))
    .leftJoin(profiles, eq(profiles.id, checks.staffCompId))
    .where(and(eq(checks.status, 'closed'), isNotNull(checks.staffCompId), gte(checks.createdAt, pStart), lt(checks.createdAt, pEnd)))
    .groupBy(checks.id, checks.createdAt, checks.staffCompId, profiles.nickname)
    .orderBy(desc(checks.createdAt))
    .limit(100)
  // Зафиксированная себестоимость на каждый показанный comp-чек (по движениям склада).
  const compIds = compRows.map((r: any) => r.id)
  const compCostRows = compIds.length
    ? await db.select({ checkId: stockMovements.sourceId, cost: costExpr })
        .from(stockMovements)
        .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
        .where(and(eq(stockMovements.sourceType, 'check'), inArray(stockMovements.type, ['sale', 'return']), inArray(stockMovements.sourceId, compIds)))
        .groupBy(stockMovements.sourceId)
    : []
  const compCostByCheck = new Map<string, number>(compCostRows.map((r: any) => [r.checkId, parseNum(r.cost)]))
  const transactions = compRows.map((r: any) => ({ id: r.id, createdAt: r.createdAt, staffId: r.staffId, nickname: r.nickname ?? '—', retail: parseNum(r.retail), cost: compCostByCheck.get(r.id) ?? 0 }))

  return c.json({ staff, totals, transactions, period: { from, to } })
})

// ─── Карточка игрока: статистика визитов/трат + последние чеки ─────────────────
analyticsRouter.get('/players/:id', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return c.json({ error: 'Bad id' }, 400)
  const now = Date.now()
  const d30 = new Date(now - 30 * 86400000)

  const [prof] = await db.select({
    id: profiles.id, nickname: profiles.nickname, fullName: profiles.fullName,
    clientTier: profiles.clientTier, phone: profiles.phone,
    balance: profiles.balance, bonusPoints: profiles.bonusPoints, createdAt: profiles.createdAt,
  }).from(profiles).where(eq(profiles.id, id)).limit(1)
  if (!prof) return c.json({ error: 'Not found' }, 404)

  // ПДн (телефон/ФИО) — ТОЛЬКО владельцу (P1, 152-ФЗ): рядовой кассир видит карточку
  // без телефона и полного имени (никнейм/тир/баланс/бонусы остаются — они нужны на
  // кассе и не являются прямыми идентификаторами личности).
  const owner = isOwner(c)
  const profile = owner ? prof : { ...prof, fullName: null, phone: null }

  // Час начала бизнес-дня (по умолч. 9 → прежний interval '9 hours' в visitDays).
  const h = await getBusinessDayStartHour(db)
  // Агрегаты за всё время: сумма, число чеков, визит-дни (distinct бизнес-день МСК), первый/последний визит.
  const [agg] = await db.select({
    spend: sum(checks.totalAmount),
    checksCount: count(),
    visitDays: sql<number>`count(distinct ((${checks.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours')::date)`,
    firstVisit: sql<string>`min(${checks.createdAt})::text`,
    lastVisit: sql<string>`max(${checks.createdAt})::text`,
  }).from(checks).where(and(eq(checks.status, 'closed'), eq(checks.playerId, id)))

  const [agg30] = await db.select({ spend: sum(checks.totalAmount), checksCount: count() })
    .from(checks).where(and(eq(checks.status, 'closed'), eq(checks.playerId, id), gte(checks.createdAt, d30)))

  // Возвраты игрока (P0): all-time и за 30д (по дате возврата). Считаем по чекам
  // ЭТОГО игрока — траты приводим к net-of-refunds, иначе полностью возвращённый
  // чек продолжал раздувать «потрачено». join refunds→checks по playerId.
  const [refAll] = await db.select({ total: sum(refunds.totalAmount) })
    .from(refunds)
    .innerJoin(checks, eq(checks.id, refunds.checkId))
    .where(eq(checks.playerId, id))
  const [ref30] = await db.select({ total: sum(refunds.totalAmount) })
    .from(refunds)
    .innerJoin(checks, eq(checks.id, refunds.checkId))
    .where(and(eq(checks.playerId, id), gte(refunds.createdAt, d30)))

  const recentChecks = await db.select({ id: checks.id, createdAt: checks.createdAt, totalAmount: checks.totalAmount })
    .from(checks).where(and(eq(checks.status, 'closed'), eq(checks.playerId, id)))
    .orderBy(desc(checks.createdAt)).limit(10)

  const refundsAll = parseNum(refAll?.total)
  const refunds30 = parseNum(ref30?.total)
  // Траты = выручка чеков − возвраты (net). avgCheck тоже от net-трат.
  const spend = Math.round((parseNum(agg?.spend) - refundsAll) * 100) / 100
  const spend30 = Math.round((parseNum(agg30?.spend) - refunds30) * 100) / 100
  const checksCount = agg?.checksCount ?? 0
  const visitDays = Number(agg?.visitDays ?? 0)
  const firstVisit = agg?.firstVisit ?? null
  const lastVisit = agg?.lastVisit ?? null
  const daysSinceLast = lastVisit ? Math.floor((now - new Date(lastVisit).getTime()) / 86400000) : null
  const tenureDays = firstVisit ? Math.max(1, (now - new Date(firstVisit).getTime()) / 86400000) : 1
  const visitsPerMonth = Math.round((visitDays / tenureDays) * 30 * 10) / 10

  return c.json({
    profile,
    allTime: {
      spend, refundsTotal: refundsAll, checksCount, visitDays,
      avgCheck: checksCount > 0 ? Math.round((spend / checksCount) * 100) / 100 : 0,
      firstVisit, lastVisit, daysSinceLast, visitsPerMonth,
    },
    last30: { spend: spend30, refundsTotal: refunds30, checksCount: agg30?.checksCount ?? 0 },
    recentChecks,
  })
})

// ─── Shifts analytics ─────────────────────────────────────────────────────────
analyticsRouter.get('/shifts', async (c) => {
  const db = c.var.db
  const rows = await db
    .select({ shift: shifts, staffNickname: profiles.nickname })
    .from(shifts)
    .leftJoin(profiles, eq(profiles.id, shifts.openedBy))
    .orderBy(desc(shifts.openedAt))
    .limit(30)

  // Раньше тут был N+1: для каждой из 30 смен выполнялись 2 отдельных запроса
  // (выручка/кол-во чеков + разбивка платежей) → 1 + 2×30 = 61 запрос. Теперь —
  // ровно 3 запроса на весь список: список смен (выше) + 2 агрегата, сгруппированных
  // по shift_id и ограниченных набором id текущей страницы через inArray, а сшивку
  // выполняем в JS по shiftId. Форма ответа не изменилась.
  const shiftIds = rows.map((r: any) => r.shift.id)

  // Агрегат по чекам: выручка и число закрытых чеков на смену (одним запросом).
  // Пустой набор id обрабатываем явно, чтобы не строить inArray по пустому массиву.
  const statsRows = shiftIds.length
    ? await db
        .select({
          shiftId: checks.shiftId,
          revenue: sum(checks.totalAmount),
          cnt: count(),
        })
        .from(checks)
        .where(and(inArray(checks.shiftId, shiftIds), eq(checks.status, 'closed')))
        .groupBy(checks.shiftId)
    : []

  // Разбивка платежей по способу оплаты на смену (одним запросом, группировка по
  // shift_id + method). join к checks нужен, т.к. shift_id живёт в checks, а не в
  // check_payments. Поведение прежней per-shift версии сохранено: фильтра по
  // status здесь не было — оставляем как есть, чтобы суммы платежей совпадали.
  const paymentRows = shiftIds.length
    ? await db
        .select({
          shiftId: checks.shiftId,
          method: checkPayments.method,
          total: sum(checkPayments.amount),
        })
        .from(checkPayments)
        .leftJoin(checks, eq(checks.id, checkPayments.checkId))
        .where(inArray(checks.shiftId, shiftIds))
        .groupBy(checks.shiftId, checkPayments.method)
    : []

  // Возвраты на смену (P0): возврат привязываем к смене ЧЕКА возврата (refunds →
  // checks → shift_id), а не к дате возврата — «выручка смены» должна показывать
  // фактическую кассу именно этой смены за вычетом всех возвратов по её чекам.
  const refundRows = shiftIds.length
    ? await db
        .select({ shiftId: checks.shiftId, total: sum(refunds.totalAmount) })
        .from(refunds)
        .innerJoin(checks, eq(checks.id, refunds.checkId))
        .where(inArray(checks.shiftId, shiftIds))
        .groupBy(checks.shiftId)
    : []
  const refundByShift = new Map<string, number>(refundRows.map((r: any) => [r.shiftId, parseNum(r.total)]))

  // Индексируем агрегаты по shiftId для O(1)-сшивки.
  const statsByShift = new Map<string, { revenue: unknown; cnt: number }>()
  for (const s of statsRows) {
    statsByShift.set(s.shiftId as string, { revenue: s.revenue, cnt: s.cnt })
  }
  // Платежи: на каждую смену — массив { method, total } той же формы, что отдавала
  // прежняя per-shift выборка (поля method/total сохранены дословно).
  const paymentsByShift = new Map<string, { method: string; total: unknown }[]>()
  for (const p of paymentRows) {
    const key = p.shiftId as string
    const list = paymentsByShift.get(key) ?? []
    list.push({ method: p.method, total: p.total })
    paymentsByShift.set(key, list)
  }

  const enriched = rows.map((r: any) => {
    const stats = statsByShift.get(r.shift.id)
    const gross = parseNum(stats?.revenue)
    const refundsTotal = refundByShift.get(r.shift.id) ?? 0
    return {
      ...r,
      // Выручка смены — net-of-refunds (касса смены за вычетом возвратов по её чекам).
      revenue: Math.round((gross - refundsTotal) * 100) / 100,
      refundsTotal,
      checksCount: stats?.cnt ?? 0,
      payments: paymentsByShift.get(r.shift.id) ?? [],
    }
  })

  return c.json({ shifts: enriched })
})

// ─── Single shift detail ──────────────────────────────────────────────────────
analyticsRouter.get('/shifts/:id', async (c) => {
  const db = c.var.db
  const shiftId = c.req.param('id')

  const shiftChecks = await db
    .select()
    .from(checks)
    .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'closed')))

  const payments = await db
    .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
    .from(checkPayments)
    .leftJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(eq(checks.shiftId, shiftId))
    .groupBy(checkPayments.method)

  const topItems = await db
    .select({
      itemId: checkItems.itemId,
      name: inventory.name,
      category: inventory.category,
      totalQty: sum(checkItems.quantity),
      totalRev: sql<number>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
    })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .leftJoin(checks, eq(checks.id, checkItems.checkId))
    // Только закрытые продажи: позиции отменённых чеков и списаний на персонал не в топе.
    .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'closed'), isNull(checks.staffCompId)))
    .groupBy(checkItems.itemId, inventory.name, inventory.category)
    .orderBy(desc(sql`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`))
    .limit(15)

  const totalRev = topItems.reduce((s: number, r: any) => s + parseNum(r.totalRev), 0)
  let cumulative = 0
  const topItemsWithAbc = topItems.map((r: any) => {
    const rev = parseNum(r.totalRev)
    const share = totalRev > 0 ? (rev / totalRev) * 100 : 0
    cumulative += share
    return { ...r, share: Math.round(share * 10) / 10, abc: cumulative <= 80 ? 'A' : cumulative <= 95 ? 'B' : 'C' }
  })

  // Возвраты этой смены (P0): сумма возвратов по чекам смены (привязка через
  // refunds.check_id → checks.shift_id), независимо от даты возврата — «выручка
  // смены» = касса именно этой смены за вычетом возвратов её чеков.
  const [shiftRefundRow] = await db
    .select({ total: sum(refunds.totalAmount) })
    .from(refunds)
    .innerJoin(checks, eq(checks.id, refunds.checkId))
    .where(eq(checks.shiftId, shiftId))
  const refundsTotal = parseNum(shiftRefundRow?.total)

  const uniquePlayers = new Set(shiftChecks.map((ch: any) => ch.playerId).filter(Boolean)).size
  const grossRevenue = shiftChecks.reduce((s: number, ch: any) => s + parseNum(ch.totalAmount), 0)
  // Выручка смены — net-of-refunds. Средний чек считаем от gross/числа чеков
  // (средний чек — характеристика типичной продажи, возвраты его искусственно
  // не занижают; net вынесен отдельно как totalRevenue).
  const totalRevenue = Math.round((grossRevenue - refundsTotal) * 100) / 100
  // Знаменатель — без списаний на персонал (итог 0 ₽), как в netBreakdown.
  const saleChecks = shiftChecks.filter((ch: any) => !ch.staffCompId).length
  const avgCheck = saleChecks > 0 ? grossRevenue / saleChecks : 0

  // Траты игроков смены — net-of-refunds по игроку (вычитаем возвраты его чеков
  // этой смены). Под-select по refunds, привязанным к чекам этого игрока и смены.
  const playerStatsRaw = await db
    .select({
      playerId: checks.playerId,
      nickname: profiles.nickname,
      clientTier: profiles.clientTier,
      total: sql<number>`sum(${checks.totalAmount}::numeric - coalesce((select sum(r.total_amount) from refunds r where r.check_id = ${checks.id}), 0)::numeric)`,
      cnt: count(),
    })
    .from(checks)
    .leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'closed')))
    .groupBy(checks.playerId, profiles.nickname, profiles.clientTier)
    .orderBy(desc(sql`sum(${checks.totalAmount}::numeric - coalesce((select sum(r.total_amount) from refunds r where r.check_id = ${checks.id}), 0)::numeric)`))
    .limit(20)
  const playerStats = playerStatsRaw.map((r: any) => ({ ...r, total: parseNum(r.total) }))

  return c.json({
    overview: {
      totalRevenue,
      refundsTotal,
      checksCount: shiftChecks.length,
      avgCheck,
      uniquePlayers,
    },
    checks: shiftChecks,
    payments,
    topItems: topItemsWithAbc,
    playerStats,
  })
})

// ─── Список чеков за бизнес-день/диапазон (для просмотра чеков) ─────────────────
// from/to — бизнес-дни YYYY-MM-DD (включительно). По умолчанию — текущий бизнес-день.
// Окно по timestamptz — [from 09:00 МСК, to+1 09:00 МСК). Отдаёт сводку (net/gross)
// и список чеков с именем гостя/игрока, кассиром, способами оплаты и числом позиций.
analyticsRouter.get('/checks', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(0, h)
  const to = q.to ?? from
  const { start } = bizDayBounds(from, h)
  const { end } = bizDayBounds(to, h)

  const rows = await db
    .select({
      id: checks.id,
      createdAt: checks.createdAt,
      closedAt: checks.closedAt,
      status: checks.status,
      totalAmount: checks.totalAmount,
      discountTotal: checks.discountTotal,
      bonusUsed: checks.bonusUsed,
      certificateUsed: checks.certificateUsed,
      playerId: checks.playerId,
      playerNickname: profiles.nickname,
      playerPhoto: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
      playerTier: profiles.clientTier,
      guestNames: checks.guestNames,
      staffId: checks.staffId,
      shiftId: checks.shiftId,
      linkedEventId: checks.linkedEventId,
      spaceId: checks.spaceId,
      paymentMethod: checks.paymentMethod,
    })
    .from(checks)
    .leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end)))
    .orderBy(desc(checks.createdAt))
    .limit(1000)

  const checkIds = rows.map((r: any) => r.id)

  // Кассиры — отдельной выборкой по staffId (избегаем второго join к profiles).
  const staffIds = [...new Set(rows.map((r: any) => r.staffId).filter(Boolean))]
  const staffRows = staffIds.length
    ? await db.select({ id: profiles.id, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.id, staffIds as string[]))
    : []
  const staffMap = new Map(staffRows.map((s: any) => [s.id, s.nickname]))

  // Число позиций на чек (сумма количеств).
  const itemRows = checkIds.length
    ? await db
        .select({ checkId: checkItems.checkId, qty: sum(checkItems.quantity) })
        .from(checkItems)
        .where(inArray(checkItems.checkId, checkIds))
        .groupBy(checkItems.checkId)
    : []
  const itemMap = new Map(itemRows.map((r: any) => [r.checkId, Number(r.qty ?? 0)]))

  // Способы оплаты на чек.
  const payRows = checkIds.length
    ? await db
        .select({ checkId: checkPayments.checkId, method: checkPayments.method, amount: checkPayments.amount })
        .from(checkPayments)
        .where(inArray(checkPayments.checkId, checkIds))
    : []
  const payMap = new Map<string, { method: string; amount: number }[]>()
  for (const p of payRows as any[]) {
    const list = payMap.get(p.checkId) ?? []
    list.push({ method: p.method, amount: parseNum(p.amount) })
    payMap.set(p.checkId, list)
  }

  const list = rows.map((r: any) => {
    const guest = r.playerNickname || (Array.isArray(r.guestNames) && r.guestNames[0]) || null
    return {
      id: r.id,
      createdAt: r.createdAt,
      closedAt: r.closedAt,
      totalAmount: parseNum(r.totalAmount),
      discountTotal: parseNum(r.discountTotal),
      bonusUsed: parseNum(r.bonusUsed),
      certificateUsed: parseNum(r.certificateUsed),
      playerId: r.playerId,
      guestName: guest,
      playerPhoto: r.playerId ? (r.playerPhoto ?? null) : null,
      clientTier: r.playerId ? (r.playerTier ?? null) : null,
      staffId: r.staffId,
      staffNickname: staffMap.get(r.staffId) ?? null,
      shiftId: r.shiftId,
      linkedEventId: r.linkedEventId,
      hasRental: !!r.spaceId,
      paymentMethod: r.paymentMethod,
      itemCount: itemMap.get(r.id) ?? 0,
      payments: payMap.get(r.id) ?? [],
    }
  })

  // Сводка без финблока (COGS/ФОТ/прибыль) для не-владельца.
  const summary = sanitizeBreakdown(await netBreakdown(db, start, end, from, to), isOwner(c))
  return c.json({ from, to, summary, checks: list })
})

// ─── Детализация одного чека (что в чеке, чей, как оплачен) ─────────────────────
analyticsRouter.get('/checks/:id', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [check] = await db.select().from(checks).where(eq(checks.id, id)).limit(1)
  if (!check) return c.json({ error: 'not_found' }, 404)

  const items = await db
    .select({
      id: checkItems.id,
      itemId: checkItems.itemId,
      name: inventory.name,
      category: inventory.category,
      quantity: checkItems.quantity,
      priceAtTime: checkItems.priceAtTime,
      costPrice: inventory.costPrice,
    })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .where(eq(checkItems.checkId, id))

  // ЗАФИКСИРОВАННАЯ СЕБЕСТОИМОСТЬ ЧЕКА (P1): раньше lineCost/costTotal считались по
  // ТЕКУЩЕМУ inventory.cost_price (WAC), который «плывёт» после каждой закупки и
  // расходится с общим COGS (он на stock_movements.unit_cost). Тянем фактическую
  // себестоимость на момент продажи из движений склада этого чека (sale,
  // source_type='check'), за вычетом позиций, снятых с чека до закрытия (return) —
  // кроме отменённого чека, где return гасит всё и показывать было бы нечего.
  // На товар: sum((−delta)×unit_cost) с фолбэком на текущий
  // WAC для исторических NULL. Если по товару движений нет (не учётный/историч.) —
  // fallback на costPrice×qty ниже. Ингредиенты техкарты (миграция 070) относим к
  // позиции меню, ради которой их списали (sold_item_id).
  const soldItemExpr = sql<string>`coalesce(${stockMovements.soldItemId}, ${stockMovements.itemId})`
  const saleMoves = await db
    .select({
      itemId: soldItemExpr,
      cost: sql<number>`sum((0 - ${stockMovements.delta})::numeric * coalesce(${stockMovements.unitCost}, ${inventory.costPrice}, 0)::numeric)`,
    })
    .from(stockMovements)
    .leftJoin(inventory, eq(inventory.id, stockMovements.itemId))
    .where(and(eq(stockMovements.sourceType, 'check'), eq(stockMovements.sourceId, id), inArray(stockMovements.type, check.status === 'cancelled' ? ['sale'] : ['sale', 'return'])))
    .groupBy(soldItemExpr)
  const fixedCostByItem = new Map<string, number>(saleMoves.map((m: any) => [m.itemId, parseNum(m.cost)]))
  // Суммарное проданное кол-во товара по чеку — чтобы разнести фикс-себестоимость
  // товара по нескольким строкам пропорционально количеству строки.
  const qtyByItem = new Map<string, number>()
  for (const i of items as any[]) qtyByItem.set(i.itemId, (qtyByItem.get(i.itemId) ?? 0) + Number(i.quantity))
  // Зафиксированная себестоимость строки: доля item-фикс-себестоимости по qty
  // строки; фолбэк на текущий costPrice×qty, если движений по товару нет.
  const lineFixedCost = (i: any): number => {
    const itemCost = fixedCostByItem.get(i.itemId)
    if (itemCost == null) return parseNum(i.costPrice) * Number(i.quantity)
    const totalQty = qtyByItem.get(i.itemId) ?? 0
    return totalQty > 0 ? itemCost * (Number(i.quantity) / totalQty) : itemCost
  }

  const payments = await db
    .select({ method: checkPayments.method, amount: checkPayments.amount })
    .from(checkPayments)
    .where(eq(checkPayments.checkId, id))

  // Применённые скидки (детально: название, тип, значение, сумма, на чек/позицию).
  const discountRows = await db
    .select({ id: checkDiscounts.id, name: checkDiscounts.name, type: checkDiscounts.type, value: checkDiscounts.value, amount: checkDiscounts.amount, target: checkDiscounts.target, itemId: checkDiscounts.itemId })
    .from(checkDiscounts)
    .where(eq(checkDiscounts.checkId, id))

  const [player] = check.playerId
    ? await db.select({ id: profiles.id, nickname: profiles.nickname, fullName: profiles.fullName, phone: profiles.phone, clientTier: profiles.clientTier })
        .from(profiles).where(eq(profiles.id, check.playerId)).limit(1)
    : [null as any]

  const [staff] = await db.select({ id: profiles.id, nickname: profiles.nickname })
    .from(profiles).where(eq(profiles.id, check.staffId)).limit(1)

  const checkRefunds = await db
    .select({ id: refunds.id, totalAmount: refunds.totalAmount, reason: refunds.reason, tenders: refunds.tenders, createdAt: refunds.createdAt })
    .from(refunds).where(eq(refunds.checkId, id))

  const guestName = player?.nickname || (Array.isArray(check.guestNames) && check.guestNames[0]) || null

  // ПДн (телефон/ФИО игрока) — ТОЛЬКО владельцу (P1, 152-ФЗ). Для staff вырезаем
  // phone/fullName, оставляя ник/тир (нужны для идентификации чека на кассе).
  const owner = isOwner(c)
  const playerOut = player && !owner ? { ...player, fullName: null, phone: null } : player

  return c.json({
    check: {
      ...check,
      totalAmount: parseNum(check.totalAmount),
      discountTotal: parseNum(check.discountTotal),
      bonusUsed: parseNum(check.bonusUsed),
      certificateUsed: parseNum(check.certificateUsed),
      eventBaseAmount: check.eventBaseAmount != null ? parseNum(check.eventBaseAmount) : null,
      tipAmount: parseNum(check.tipAmount),
    },
    guestName,
    staffComp: !!check.staffCompId,
    retailTotal: items.reduce((s: number, i: any) => s + parseNum(i.priceAtTime) * Number(i.quantity), 0),
    // costTotal/lineCost — по зафиксированной на момент продажи себестоимости (см.
    // lineFixedCost), а не текущему cost_price; сходится с общим COGS периода.
    // Себестоимость — коммерческая тайна: только владельцу.
    ...(owner ? { costTotal: Math.round(items.reduce((s: number, i: any) => s + lineFixedCost(i), 0) * 100) / 100 } : {}),
    items: items.map(({ costPrice, ...i }: any) => ({
      ...i,
      priceAtTime: parseNum(i.priceAtTime),
      lineTotal: parseNum(i.priceAtTime) * Number(i.quantity),
      ...(owner ? { costPrice, lineCost: Math.round(lineFixedCost({ ...i, costPrice }) * 100) / 100 } : {}),
    })),
    payments: payments.map((p: any) => ({ method: p.method, amount: parseNum(p.amount) })),
    discounts: discountRows.map((d: any) => ({ id: d.id, name: d.name, type: d.type, value: parseNum(d.value), amount: parseNum(d.amount), target: d.target, itemId: d.itemId })),
    player: playerOut,
    staff,
    refunds: checkRefunds.map((r: any) => ({ ...r, totalAmount: parseNum(r.totalAmount) })),
  })
})

// ─── Отзывы гостей (Titan Home) ─────────────────────────────────────────────────
// Оценки вечера, которые гости ставят на планшете кабинки после оплаты. Окно — по
// времени оценки в бизнес-днях [from, to]. Сводка: число, средняя, распределение
// 1–5, частые теги; лента — последние 200 с зоной, суммой и гостем чека.
analyticsRouter.get('/feedback', zValidator('query', dateRangeQuerySchema), async (c) => {
  const db = c.var.db
  const q = c.req.valid('query')
  const h = await getBusinessDayStartHour(db)
  const from = q.from ?? bizDayStr(30, h)
  const to = q.to ?? bizDayStr(0, h)
  const { start } = bizDayBounds(from, h)
  const { end } = bizDayBounds(to, h)

  const rows = await db
    .select({
      id: guestFeedback.id,
      checkId: guestFeedback.checkId,
      rating: guestFeedback.rating,
      tags: guestFeedback.tags,
      comment: guestFeedback.comment,
      createdAt: guestFeedback.createdAt,
      spaceName: spaces.name,
      checkTotal: checks.totalAmount,
      guestNames: checks.guestNames,
      playerNickname: profiles.nickname,
    })
    .from(guestFeedback)
    .leftJoin(checks, eq(checks.id, guestFeedback.checkId))
    .leftJoin(spaces, eq(spaces.id, guestFeedback.spaceId))
    .leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(and(gte(guestFeedback.createdAt, start), lt(guestFeedback.createdAt, end)))
    .orderBy(desc(guestFeedback.createdAt))

  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
  const tagCounts = new Map<string, number>()
  let sumRating = 0
  for (const r of rows) {
    distribution[String(r.rating)] = (distribution[String(r.rating)] ?? 0) + 1
    sumRating += r.rating
    for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  }
  const count = rows.length
  return c.json({
    from, to,
    summary: {
      count,
      avg: count ? Math.round((sumRating / count) * 100) / 100 : null,
      distribution,
      withComment: rows.filter((r) => !!r.comment).length,
      tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, count: n })),
    },
    items: rows.slice(0, 200).map((r) => ({
      id: r.id,
      checkId: r.checkId,
      rating: r.rating,
      tags: r.tags ?? [],
      comment: r.comment,
      createdAt: r.createdAt,
      spaceName: r.spaceName,
      checkTotal: parseNum(r.checkTotal),
      guestName: r.playerNickname ?? r.guestNames?.[0] ?? null,
    })),
  })
})
