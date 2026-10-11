import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { salaryPayments, shifts, checks, checkPayments, cashOperations, profiles, eq, and, desc, gte, lte, lt, sql } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'

// Смена закрылась между чтением и записью наличной выплаты — транзакцию откатываем.
const SHIFT_CLOSED = 'SHIFT_CLOSED'

// Период (YYYY-MM) кладётся в note первым токеном (см. фронт salary/page.tsx).
// Достаём его в отдельное поле period, остаток оставляем как комментарий.
function splitNote(note: string | null): { period: string | null; note: string | null } {
  if (!note) return { period: null, note: null }
  // period может быть месяцем (YYYY-MM) или днём (YYYY-MM-DD).
  const m = note.match(/^(\d{4}-\d{2}(?:-\d{2})?)(?::\s*(.*))?$/)
  if (m) return { period: m[1], note: m[2]?.trim() || null }
  return { period: null, note }
}

function calculateSalary(revenue: number): number {
  if (revenue <= 7000) return 700
  return 700 + Math.ceil((revenue - 7000) / 1000) * 100
}

const PaySalarySchema = z.object({
  profileId: z.string().uuid(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'card', 'transfer']).default('cash'),
  note: z.string().optional(),
  idempotencyKey: z.string().max(80).optional(),
})

export const salaryRouter = new Hono<AppEnv>()
salaryRouter.use('*', requireAuth)

salaryRouter.get('/', requireRole('owner'), async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      id: salaryPayments.id,
      staffId: salaryPayments.profileId,
      staffName: profiles.nickname,
      staffRole: profiles.role,
      amount: salaryPayments.amount,
      paymentMethod: salaryPayments.paymentMethod,
      note: salaryPayments.note,
      createdAt: salaryPayments.createdAt,
    })
    .from(salaryPayments)
    .leftJoin(profiles, eq(profiles.id, salaryPayments.profileId))
    .orderBy(desc(salaryPayments.createdAt))
    .limit(100)
  // period вынимаем из note (фронт хранит его там); отдаём оба поля раздельно.
  const payments = rows.map(r => {
    const { period, note } = splitNote(r.note)
    return { ...r, period, note }
  })
  return c.json({ payments })
})

salaryRouter.get('/estimate', requireRole('owner', 'staff'), async (c) => {
  // Дневной расчёт по БИЗНЕС-ДНЮ (по умолч. 09:00→06:00): зарплата зависит от
  // выручки за бизнес-день по формуле calculateSalary, БЕЗ учёта мероприятий — из
  // суммы чеков вычитаем базовую сумму мероприятия (event_base_amount). Списания
  // на персонал имеют итог 0₽ и в выручку не идут. Зарплата выдаётся ежедневно.
  const db = c.var.db
  // Час начала бизнес-дня (настройка business_day_start_hour, по умолч. 9). При h=9
  // строка границы = прежняя 'YYYY-MM-DDT09:00:00+03:00' — поведение байт-в-байт.
  const h = await getBusinessDayStartHour(db)
  const hh = `${String(h).padStart(2, '0')}:00:00+03:00`

  // Приватность: staff видит ТОЛЬКО свою оценку — чужой ?staffId= игнорируется.
  // Только owner может запросить расчёт по конкретному сотруднику. Раньше любой
  // staff мог подставить чужой uuid и узнать выручку/ЗП коллеги.
  const user = c.get('user')
  const staffId = user.role === 'owner' ? (c.req.query('staffId') ?? user.sub) : user.sub

  // ЕДИНАЯ БАЗА ВЫРУЧКИ (P0). Раньше дневная ветка (?day=) считала выручку КЛУБА
  // (без фильтра по staffId) и БЕЗ вычета мероприятий несогласованно с ветиной
  // ?from/to. Фактическая выплата (фронт salary/page.tsx) берёт сумму из дневной
  // ветки → при 2+ сотрудниках на смене КАЖДЫЙ получал % от ПОЛНОЙ выручки клуба.
  // Теперь ОБЕ ветки считают выручку ПЕРСОНАЛЬНО (eq(checks.staffId)) и в ОБЕИХ
  // вычитаем event_base_amount — оцениваемая и выплачиваемая база совпадают.
  // Возвраты по чеку вычитаем: полностью возвращённый чек не должен повышать зарплату.
  const personalRevenue = sql<string>`coalesce(sum(${checks.totalAmount}::numeric - coalesce(${checks.eventBaseAmount}, 0)::numeric - coalesce((select sum(r.total_amount) from refunds r where r.check_id = ${checks.id}), 0)::numeric), 0)`

  const day = c.req.query('day')
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const start = new Date(`${day}T${hh}`)
    const end = new Date(start.getTime() + 86400000)
    const [r] = await db
      .select({ revenue: personalRevenue })
      .from(checks)
      .where(and(eq(checks.staffId, staffId), eq(checks.status, 'closed'), gte(checks.createdAt, start), lt(checks.createdAt, end)))
    const revenue = Math.max(0, parseFloat(String(r?.revenue ?? '0')) || 0)
    return c.json({ day, revenue, salary: calculateSalary(revenue), staffId })
  }

  const from = c.req.query('from')
  const to = c.req.query('to')

  // Границы периода строим по календарю МСК (как аналитика): from — 00:00 МСК
  // указанной даты, to — эксклюзивная верхняя граница (следующие сутки 00:00 МСК),
  // иначе new Date('YYYY-MM-DD') трактовалось как UTC и окно съезжало на 3ч,
  // а чек последнего дня после 21:00 МСК выпадал из расчёта.
  const conditions = [eq(checks.staffId, staffId), eq(checks.status, 'closed')]
  // По БИЗНЕС-ДНЮ (по умолч. 09:00→06:00), как и дневная ветка выше: окно
  // [from h:00, to+1 h:00). hh берётся из настройки (см. выше).
  if (from) conditions.push(gte(checks.createdAt, new Date(`${from}T${hh}`)))
  if (to) conditions.push(lt(checks.createdAt, new Date(new Date(`${to}T${hh}`).getTime() + 86400000)))

  const [result] = await db
    .select({ revenue: personalRevenue })
    .from(checks)
    .where(and(...(conditions as [any, ...any[]])))

  const revenue = Math.max(0, parseFloat(String(result?.revenue ?? '0')) || 0)
  const salary = calculateSalary(revenue)

  return c.json({ revenue, salary, staffId })
})

salaryRouter.post('/pay', requireRole('owner'), zValidator('json', PaySalarySchema), async (c) => {
  const user = c.get('user')
  const db = c.var.db
  const body = c.req.valid('json')

  // СЕРВЕРНАЯ ИДЕМПОТЕНТНОСТЬ ВЫПЛАТЫ ПО ПЕРИОДУ (P0). Раньше дедуп держался ТОЛЬКО
  // на клиентском idempotencyKey: при undefined-ключе onConflictDoNothing бьёт по
  // nullable-колонке (NULL'ы в Postgres не конфликтуют) → вставка ВСЕГДА проходит,
  // и перезагрузка / другое устройство / прямой вызов API без ключа давали вторую
  // выплату + второе изъятие кассы. Делаем идемпотентность серверной: период (день
  // YYYY-MM-DD или месяц YYYY-MM) фронт кладёт первым токеном note, достаём его тем
  // же splitNote. Если периода нет — ключ детерминированно не построить, тогда
  // оставляем поведение по клиентскому ключу (см. ниже).
  const { period } = splitNote(body.note ?? null)
  // Детерминированный серверный ключ от (profileId, period) — НЕ зависит от клиента.
  // Используется и для строки выплаты, и (с суффиксом) для парной cashOperation,
  // так что полный unique-индекс salary_payments_idem_key_uniq реально ловит ретрай
  // даже когда клиент ключ не прислал.
  const effectiveKey = period
    ? `salary:${body.profileId}:${period}`
    : (body.idempotencyKey ?? null)

  // Наличная зарплата — это деньги, покинувшие кассу: помимо записи о выплате
  // создаём cashOperation type='salary' за текущую смену, иначе сверка кассы
  // (getShiftCashBalance вычитает salary-операции) её не увидит и касса
  // «переполнится». Делаем в одной транзакции с записью о выплате.
  const result = await db.transaction(async (tx) => {
    // СЕРИАЛИЗАЦИЯ ПО (profileId, period): берём advisory-lock ПЕРВЫМ в транзакции.
    // Два параллельных запроса на одну выплату (двойной клик/две вкладки) на READ
    // COMMITTED оба не увидели бы существующую строку и оба вставили бы её до того,
    // как сработает unique-индекс. Лок выстраивает их в очередь — второй увидит
    // выплату, созданную первым, и вернёт её как дубль (а не задвоит кассу).
    if (period) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`salary:${body.profileId}:${period}`}, 0))`)
      // Уже выплачено за этот (profileId, period)? — отдаём существующую как дубль.
      const [existing] = await tx.select().from(salaryPayments)
        .where(and(eq(salaryPayments.profileId, body.profileId), eq(salaryPayments.idempotencyKey, effectiveKey!)))
      if (existing) return { pay: existing, duplicate: true as const }
    }

    const [pay] = await tx.insert(salaryPayments).values({
      profileId: body.profileId,
      amount: String(body.amount),
      paymentMethod: body.paymentMethod,
      note: body.note,
      idempotencyKey: effectiveKey,
      createdBy: user.sub,
    }).onConflictDoNothing({ target: salaryPayments.idempotencyKey }).returning()

    // Дубликат по ключу (ретрай/двойной клик) — прерываем, cashOp не создаём.
    if (!pay) return { pay: null, duplicate: true as const }

    if (body.paymentMethod === 'cash') {
      // Открытую смену читаем ВНУТРИ транзакции, прямо перед записью cashOp:
      // если смена закрылась между приёмом запроса и коммитом, cashOperation
      // не должна лечь на устаревший shiftId. Если открытой смены нет — выплату
      // фиксируем, но кассовую операцию не создаём (как и раньше при shift=null).
      // Читаем через tx и блокируем строку смены FOR SHARE: закрытие смены держит
      // FOR UPDATE, поэтому выплата либо ляжет в смену ДО закрытия (и войдёт в сверку),
      // либо увидит, что смена уже закрыта, — тогда откатываем всё (409, повторить).
      const [current] = await tx.select({ id: shifts.id }).from(shifts)
        .where(eq(shifts.status, 'open')).orderBy(desc(shifts.openedAt)).limit(1)
      const [shift] = current
        ? await tx.select().from(shifts).where(eq(shifts.id, current.id)).for('share')
        : []
      if (shift && shift.status !== 'open') throw new Error(SHIFT_CLOSED)
      if (shift) {
        await tx.insert(cashOperations).values({
          type: 'salary',
          amount: String(body.amount),
          description: `Зарплата${body.note ? ' · ' + body.note : ''}`,
          shiftId: shift.id,
          createdBy: user.sub,
          // Производный ключ от серверного ключа выплаты — ретрай не задвоит и cashOp.
          idempotencyKey: effectiveKey ? `${effectiveKey}:salary-cashop` : undefined,
        }).onConflictDoNothing({ target: cashOperations.idempotencyKey })
      }
    }
    // Безналичная зарплата (перевод) кассу не трогает и отдельной строки-расхода
    // не создаёт: в разделе «Расходы» и в P&L зарплата (нал+перевод) берётся из
    // salaryPayments (см. /expenses/summary и netBreakdown). Это исключает задвоение.

    return { pay, duplicate: false as const }
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === SHIFT_CLOSED) return null
    throw e
  })
  if (!result) return c.json({ error: 'Смена закрылась во время выплаты — повторите' }, 409)

  // Дубль (ретрай/повторная выплата за период): отдаём существующую выплату, если
  // нашли, иначе 409 — но в кассу повторно НЕ списали (cashOp под тем же ключом).
  if (result.duplicate) {
    if (result.pay) return c.json({ payment: result.pay, duplicate: true })
    const [existing] = effectiveKey
      ? await db.select().from(salaryPayments).where(eq(salaryPayments.idempotencyKey, effectiveKey))
      : []
    if (existing) return c.json({ payment: existing, duplicate: true })
    return c.json({ error: 'Выплата за этот период уже проведена' }, 409)
  }
  return c.json({ payment: result.pay }, 201)
})
