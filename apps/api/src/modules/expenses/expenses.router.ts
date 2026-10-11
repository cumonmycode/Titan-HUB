import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { expenses, salaryPayments, checks, checkItems, inventory, profiles, eq, and, gte, lte, lt, desc, sql, isNotNull, inArray } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'

// Бизнес-день (по умолч. 09:00→06:00): окно [dateStr startHour:00 МСК, +24ч), как
// в analytics. startHour по умолч. 9 → байт-в-байт прежнее поведение (09:00).
const MSK_OFFSET_MS = 3 * 3600 * 1000
function bizBounds(dateStr: string, startHour = 9): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T${String(startHour).padStart(2, '0')}:00:00+03:00`)
  return { start, end: new Date(start.getTime() + 86400000) }
}
// YYYY-MM-DD бизнес-дня, отстоящего на `daysAgo` суток (00:00..(startHour−1):59 → прошлая дата).
function bizDayStr(daysAgo = 0, startHour = 9): string {
  return new Date(Date.now() + MSK_OFFSET_MS - startHour * 3600000 - daysAgo * 86400000).toISOString().split('T')[0]
}
const num = (v: unknown) => { const n = parseFloat(String(v ?? '0')); return Number.isFinite(n) ? n : 0 }

const CATEGORIES = ['rent', 'utilities', 'supplies', 'salary', 'marketing', 'equipment', 'other', 'consumables', 'tobacco'] as const

// Одиночный расход (для PATCH/правки позиции).
const ExpenseSchema = z.object({
  category: z.enum(CATEGORIES).default('other'),
  amount: z.number().positive(),
  description: z.string().optional(),
  unitPrice: z.number().nonnegative().optional(),
  quantity: z.number().positive().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
  idempotencyKey: z.string().max(80).optional(),
})

// Позиция расхода: название, категория, цена за ед., кол-во, сумма (как в поставке).
const ExpenseItemSchema = z.object({
  category: z.enum(CATEGORIES).default('other'),
  description: z.string().optional(),
  unitPrice: z.number().nonnegative().optional(),
  quantity: z.number().positive().optional(),
  amount: z.number().positive(),
})
const CreateExpensesSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД'),
  items: z.array(ExpenseItemSchema).min(1),
  idempotencyKey: z.string().max(80).optional(),
})

export const expensesRouter = new Hono<AppEnv>()
expensesRouter.use('*', requireAuth)

expensesRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const from = c.req.query('from')
  const to = c.req.query('to')

  const conditions = []
  if (from) conditions.push(gte(expenses.expenseDate, from))
  if (to) conditions.push(lte(expenses.expenseDate, to))

  const rows = await db
    .select()
    .from(expenses)
    .where(conditions.length ? and(...(conditions as [any, ...any[]])) : undefined)
    .orderBy(desc(expenses.createdAt))

  return c.json({ expenses: rows })
})

// ─── Сводка расходов за период (по БИЗНЕС-ДНЮ) с разбивкой по сотрудникам ───────
// Зарплата берётся из salaryPayments (нал + перевод) — источник истины; строки
// expenses с category='salary' исключаем, чтобы не задвоить. Отдельно — себестоимость
// бесплатных списаний на персонал (staffCompId). Два итога: pnlTotal (опекс + ЗП,
// как в дашборде) и staffTotal (ЗП + себестоимость списаний — полные затраты на людей).
// ВАЖНО: маршрут объявлен ДО '/:id', иначе '/summary' попал бы в param-роут.
expensesRouter.get('/summary', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const h = await getBusinessDayStartHour(db)
  const from = c.req.query('from') || bizDayStr(30, h)
  const to = c.req.query('to') || bizDayStr(0, h)
  const { start } = bizBounds(from, h)
  const { end } = bizBounds(to, h)

  // 1. Операционные расходы (без зарплаты) по категориям + сырые строки за период.
  const catRows = await db
    .select({ category: expenses.category, amount: sql<string>`coalesce(sum(${expenses.amount}), 0)` })
    .from(expenses)
    .where(and(gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), sql`${expenses.category} <> 'salary'`))
    .groupBy(expenses.category)
    .orderBy(desc(sql`sum(${expenses.amount})`))
  const categories = catRows.map(r => ({ category: r.category, amount: num(r.amount) }))
  const opexTotal = categories.reduce((a, c2) => a + c2.amount, 0)

  const rawExpenses = await db
    .select()
    .from(expenses)
    .where(and(gte(expenses.expenseDate, from), lte(expenses.expenseDate, to), sql`${expenses.category} <> 'salary'`))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))

  // Приватность (как в salary.router): зарплаты и затраты по каждому сотруднику видит
  // только владелец. Staff получает ту же форму ответа, но без зарплат/списаний/P&L
  // (нули и пустые списки) — клиенты не падают на отсутствующих полях.
  if (c.get('user').role !== 'owner') {
    return c.json({
      period: { from, to },
      categories,
      opexTotal,
      salary: { total: 0, cash: 0, transfer: 0, byStaff: [] },
      staffComp: { cost: 0, retail: 0, checksCount: 0, byStaff: [] },
      byStaff: [],
      pnlTotal: opexTotal,
      staffTotal: 0,
      expenses: rawExpenses,
    })
  }

  // 2. Зарплата по сотрудникам (нал/перевод) из salaryPayments за бизнес-окно.
  const salRows = await db
    .select({
      staffId: salaryPayments.profileId,
      nickname: profiles.nickname,
      role: profiles.role,
      total: sql<string>`coalesce(sum(${salaryPayments.amount}), 0)`,
      cash: sql<string>`coalesce(sum(${salaryPayments.amount}) filter (where ${salaryPayments.paymentMethod} = 'cash'), 0)`,
      transfer: sql<string>`coalesce(sum(${salaryPayments.amount}) filter (where ${salaryPayments.paymentMethod} <> 'cash'), 0)`,
      count: sql<number>`count(*)`,
    })
    .from(salaryPayments)
    .leftJoin(profiles, eq(profiles.id, salaryPayments.profileId))
    .where(and(gte(salaryPayments.createdAt, start), lt(salaryPayments.createdAt, end)))
    .groupBy(salaryPayments.profileId, profiles.nickname, profiles.role)
  const salaryByStaff = salRows.map(r => ({ staffId: r.staffId, nickname: r.nickname ?? '—', role: r.role, total: num(r.total), cash: num(r.cash), transfer: num(r.transfer), count: Number(r.count ?? 0) }))
  const salaryTotals = salaryByStaff.reduce((a, s) => ({ total: a.total + s.total, cash: a.cash + s.cash, transfer: a.transfer + s.transfer }), { total: 0, cash: 0, transfer: 0 })

  // 3. Себестоимость бесплатных списаний на персонал (staffCompId) за бизнес-окно.
  const compRows = await db
    .select({
      staffId: checks.staffCompId,
      nickname: profiles.nickname,
      checksCount: sql<number>`count(distinct ${checks.id})`,
      retail: sql<string>`coalesce(sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime}), 0)`,
      cost: sql<string>`coalesce(sum(${checkItems.quantity}::numeric * coalesce(${inventory.costPrice}, 0)::numeric), 0)`,
    })
    .from(checks)
    .innerJoin(checkItems, eq(checkItems.checkId, checks.id))
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .leftJoin(profiles, eq(profiles.id, checks.staffCompId))
    .where(and(eq(checks.status, 'closed'), isNotNull(checks.staffCompId), gte(checks.createdAt, start), lt(checks.createdAt, end)))
    .groupBy(checks.staffCompId, profiles.nickname)
  const compByStaff = compRows.map(r => ({ staffId: r.staffId, nickname: r.nickname ?? '—', checksCount: Number(r.checksCount ?? 0), retail: num(r.retail), cost: num(r.cost) }))
  const compTotals = compByStaff.reduce((a, s) => ({ cost: a.cost + s.cost, retail: a.retail + s.retail, checksCount: a.checksCount + s.checksCount }), { cost: 0, retail: 0, checksCount: 0 })

  // 4. Слияние по сотруднику (union зарплат и списаний).
  const merged = new Map<string, any>()
  for (const s of salaryByStaff) {
    if (!s.staffId) continue
    merged.set(s.staffId, { staffId: s.staffId, nickname: s.nickname, role: s.role, salary: s.total, salaryCash: s.cash, salaryTransfer: s.transfer, salaryCount: s.count, compCost: 0, compRetail: 0, compChecks: 0 })
  }
  for (const cmp of compByStaff) {
    if (!cmp.staffId) continue
    const ex = merged.get(cmp.staffId)
    if (ex) { ex.compCost = cmp.cost; ex.compRetail = cmp.retail; ex.compChecks = cmp.checksCount; if (!ex.nickname || ex.nickname === '—') ex.nickname = cmp.nickname }
    else merged.set(cmp.staffId, { staffId: cmp.staffId, nickname: cmp.nickname, role: null, salary: 0, salaryCash: 0, salaryTransfer: 0, salaryCount: 0, compCost: cmp.cost, compRetail: cmp.retail, compChecks: cmp.checksCount })
  }
  const byStaff = Array.from(merged.values())
    .map(s => ({ ...s, total: s.salary + s.compCost }))
    .sort((a, b) => b.total - a.total)

  // Эффективное фото сотрудников (ручное → Telegram → GoMafia) одним запросом.
  const staffIds = byStaff.map(s => s.staffId).filter(Boolean) as string[]
  if (staffIds.length) {
    const photoRows = await db
      .select({ id: profiles.id, photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})` })
      .from(profiles).where(inArray(profiles.id, staffIds))
    const photoById = new Map(photoRows.map(p => [p.id, p.photoUrl]))
    for (const s of byStaff) s.photoUrl = photoById.get(s.staffId) ?? null
  }

  return c.json({
    period: { from, to },
    categories,
    opexTotal,
    salary: { total: salaryTotals.total, cash: salaryTotals.cash, transfer: salaryTotals.transfer, byStaff: salaryByStaff },
    staffComp: { cost: compTotals.cost, retail: compTotals.retail, checksCount: compTotals.checksCount, byStaff: compByStaff },
    byStaff,
    pnlTotal: opexTotal + salaryTotals.total,
    staffTotal: salaryTotals.total + compTotals.cost,
    expenses: rawExpenses,
  })
})

// Создание расхода — список позиций (каждая: название/категория/цена/кол-во/сумма).
// Сохраняем по строке на позицию (amount = сумма позиции), как делает аналитика.
expensesRouter.post('/', requireRole('owner', 'staff'), zValidator('json', CreateExpensesSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  const rows = body.items.map((it, i) => ({
    category: it.category,
    amount: String(it.amount),
    description: it.description?.trim() || null,
    unitPrice: it.unitPrice != null ? String(it.unitPrice) : null,
    quantity: it.quantity != null ? String(it.quantity) : null,
    expenseDate: body.expenseDate,
    createdBy: user.sub,
    // Производный ключ на позицию — повтор/двойной клик не задвоит.
    idempotencyKey: body.idempotencyKey ? `${body.idempotencyKey}:${i}` : null,
  }))
  const inserted = await db.insert(expenses).values(rows).onConflictDoNothing({ target: expenses.idempotencyKey }).returning()
  return c.json({ expenses: inserted }, 201)
})

// Подбор позиций по названию + последняя цена (для аналитики и быстрого повтора).
expensesRouter.get('/catalog', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const res: any = await db.execute(sql`
    SELECT DISTINCT ON (lower(description)) description AS name, unit_price, category
    FROM expenses
    WHERE description IS NOT NULL AND description <> ''
    ${q ? sql`AND lower(description) LIKE ${'%' + q + '%'}` : sql``}
    ORDER BY lower(description), created_at DESC
    LIMIT 20
  `)
  const rows = (res.rows ?? res ?? []) as any[]
  return c.json({ items: rows.map(r => ({ name: r.name, unitPrice: r.unit_price != null ? parseFloat(String(r.unit_price)) : null, category: r.category })) })
})

expensesRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, c.req.param('id')))
  if (!expense) return c.json({ error: 'Not found' }, 404)
  return c.json({ expense })
})

expensesRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', ExpenseSchema.partial()), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const update: Record<string, any> = { ...body }
  if (body.amount !== undefined) update.amount = String(body.amount)
  if (body.unitPrice !== undefined) update.unitPrice = body.unitPrice != null ? String(body.unitPrice) : null
  if (body.quantity !== undefined) update.quantity = body.quantity != null ? String(body.quantity) : null
  const [expense] = await db.update(expenses).set(update).where(eq(expenses.id, c.req.param('id'))).returning()
  if (!expense) return c.json({ error: 'Not found' }, 404)
  return c.json({ expense })
})

expensesRouter.delete('/:id', requireRole('owner'), async (c) => {
  const db = c.var.db
  await db.delete(expenses).where(eq(expenses.id, c.req.param('id')))
  return c.json({ ok: true })
})
