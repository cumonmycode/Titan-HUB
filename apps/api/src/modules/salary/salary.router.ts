import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { salaryPayments, salarySchemes, shifts, shiftStaff, checks, cashOperations, profiles, eq, and, desc, gte, lt, gt, sql } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'
import { computeSalary, describeRules, loadSchemes, normalizeRules, schemeOf, shiftSalaries, REVENUE_LABEL } from '../../lib/salary.js'

// Смена закрылась между чтением и записью наличной выплаты — транзакцию откатываем.
const SHIFT_CLOSED = 'SHIFT_CLOSED'
const UNPAID_DAYS = 60

// Старые выплаты (до 084) хранили период (YYYY-MM или YYYY-MM-DD) первым токеном note.
// Достаём его в отдельное поле period, остаток оставляем как комментарий.
function splitNote(note: string | null): { period: string | null; note: string | null } {
  if (!note) return { period: null, note: null }
  const m = note.match(/^(\d{4}-\d{2}(?:-\d{2})?)(?::\s*(.*))?$/)
  if (m) return { period: m[1], note: m[2]?.trim() || null }
  return { period: null, note }
}

const RulesSchema = z.object({
  base: z.number().min(0).max(10_000_000),
  percent: z.number().min(0).max(100),
  stepFrom: z.number().min(0).max(10_000_000),
  stepEvery: z.number().min(0).max(10_000_000),
  stepAdd: z.number().min(0).max(10_000_000),
  hourly: z.number().min(0).max(1_000_000),
  min: z.number().min(0).max(10_000_000),
  max: z.number().min(0).max(10_000_000),
  revenue: z.enum(['shift', 'split', 'own']),
  events: z.boolean(),
})

const PaySalarySchema = z.object({
  profileId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  paymentMethod: z.enum(['cash', 'card', 'transfer']).default('cash'),
  note: z.string().max(500).optional(),
  /** Выплата за смену: одна на сотрудника и смену; без неё — разовая (аванс, премия). */
  shiftId: z.string().uuid().optional(),
  idempotencyKey: z.string().max(80).optional(),
})

export const salaryRouter = new Hono<AppEnv>()
salaryRouter.use('*', requireAuth)

// ─── История выплат ─────────────────────────────────────────────────────────
salaryRouter.get('/', requireRole('owner'), async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      id: salaryPayments.id,
      staffId: salaryPayments.profileId,
      staffName: profiles.nickname,
      staffRole: profiles.role,
      amount: salaryPayments.amount,
      calculated: salaryPayments.calculated,
      paymentMethod: salaryPayments.paymentMethod,
      note: salaryPayments.note,
      shiftId: salaryPayments.shiftId,
      shiftOpenedAt: shifts.openedAt,
      createdAt: salaryPayments.createdAt,
    })
    .from(salaryPayments)
    .leftJoin(profiles, eq(profiles.id, salaryPayments.profileId))
    .leftJoin(shifts, eq(shifts.id, salaryPayments.shiftId))
    .orderBy(desc(salaryPayments.createdAt))
    .limit(100)
  const payments = rows.map(r => {
    const { period, note } = r.shiftId ? { period: null, note: r.note } : splitNote(r.note)
    return { ...r, period, note }
  })
  return c.json({ payments })
})

// ─── Формулы ────────────────────────────────────────────────────────────────
salaryRouter.get('/schemes', requireRole('owner'), async (c) => {
  const db = c.var.db
  const [schemes, staff] = await Promise.all([
    loadSchemes(db),
    db.select({ id: profiles.id, schemeId: profiles.salarySchemeId }).from(profiles)
      .where(and(eq(profiles.role, 'staff'), sql`${profiles.deletedAt} is null`)),
  ])
  const fallback = schemeOf(schemes, null).id
  return c.json({
    schemes: schemes.map((s) => ({
      ...s,
      text: describeRules(s.rules),
      revenueLabel: REVENUE_LABEL[s.rules.revenue],
      staffCount: staff.filter((p) => (schemes.some((x) => x.id === p.schemeId) ? p.schemeId : fallback) === s.id).length,
    })),
  })
})

salaryRouter.post('/schemes', requireRole('owner'), zValidator('json', z.object({
  name: z.string().trim().min(1).max(60),
  rules: RulesSchema,
  isDefault: z.boolean().optional(),
})), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const created = await db.transaction(async (tx) => {
    if (body.isDefault) await tx.update(salarySchemes).set({ isDefault: false }).where(eq(salarySchemes.isDefault, true))
    const [row] = await tx.insert(salarySchemes).values({ name: body.name, rules: normalizeRules(body.rules) as unknown as Record<string, unknown>, isDefault: !!body.isDefault }).returning()
    return row
  })
  return c.json({ scheme: created }, 201)
})

salaryRouter.patch('/schemes/:id', requireRole('owner'), zValidator('json', z.object({
  name: z.string().trim().min(1).max(60).optional(),
  rules: RulesSchema.optional(),
  isDefault: z.literal(true).optional(),
})), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const updated = await db.transaction(async (tx) => {
    if (body.isDefault) await tx.update(salarySchemes).set({ isDefault: false }).where(eq(salarySchemes.isDefault, true))
    const [row] = await tx.update(salarySchemes).set({
      ...(body.name ? { name: body.name } : {}),
      ...(body.rules ? { rules: normalizeRules(body.rules) as unknown as Record<string, unknown> } : {}),
      ...(body.isDefault ? { isDefault: true } : {}),
      updatedAt: new Date(),
    }).where(eq(salarySchemes.id, id)).returning()
    return row
  })
  if (!updated) return c.json({ error: 'Формула не найдена' }, 404)
  return c.json({ scheme: updated })
})

salaryRouter.delete('/schemes/:id', requireRole('owner'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [row] = await db.select().from(salarySchemes).where(eq(salarySchemes.id, id))
  if (!row) return c.json({ error: 'Формула не найдена' }, 404)
  if (row.isDefault) return c.json({ error: 'Основную формулу удалить нельзя — сначала сделайте основной другую' }, 409)
  // Сотрудники с этой формулой переходят на основную (FK ON DELETE SET NULL).
  await db.delete(salarySchemes).where(eq(salarySchemes.id, id))
  return c.json({ ok: true })
})

// ─── Расчёт по сменам ───────────────────────────────────────────────────────
// Владелец видит всех; сотрудник — только себя (зарплаты коллег — приватно).
salaryRouter.get('/shift/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const result = await shiftSalaries(db, c.req.param('id'))
  if (!result) return c.json({ error: 'Смена не найдена' }, 404)
  if (user.role !== 'owner') result.workers = result.workers.filter((w) => w.profileId === user.sub)
  return c.json(result)
})

// Невыплаченная зарплата за последние 60 дней: смены, где кто-то из работавших не получил.
salaryRouter.get('/unpaid', requireRole('owner'), async (c) => {
  const db = c.var.db
  const since = new Date(Date.now() - UNPAID_DAYS * 86_400_000)
  const candidates = await db.selectDistinct({ id: shifts.id, openedAt: shifts.openedAt })
    .from(shifts)
    .innerJoin(shiftStaff, eq(shiftStaff.shiftId, shifts.id))
    .innerJoin(profiles, and(eq(profiles.id, shiftStaff.profileId), eq(profiles.role, 'staff')))
    .leftJoin(salaryPayments, and(eq(salaryPayments.shiftId, shifts.id), eq(salaryPayments.profileId, shiftStaff.profileId)))
    .where(and(gt(shifts.openedAt, since), sql`${salaryPayments.id} is null`))
    .orderBy(desc(shifts.openedAt))
    .limit(40)
  const out = []
  for (const s of candidates) {
    const r = await shiftSalaries(db, s.id)
    if (!r) continue
    const unpaid = r.workers.filter((w) => !w.paid)
    if (unpaid.length) out.push({ shift: r.shift, workers: unpaid })
  }
  return c.json({ shifts: out })
})

// Совместимость (веб «Зарплата»): оценка по выручке сотрудника за бизнес-день, по его формуле.
salaryRouter.get('/estimate', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const h = await getBusinessDayStartHour(db)
  const hh = `${String(h).padStart(2, '0')}:00:00+03:00`
  const user = c.get('user')
  const staffId = user.role === 'owner' ? (c.req.query('staffId') ?? user.sub) : user.sub
  const personalRevenue = sql<string>`coalesce(sum(${checks.totalAmount}::numeric - coalesce(${checks.eventBaseAmount}, 0)::numeric - coalesce((select sum(r.total_amount) from refunds r where r.check_id = ${checks.id}), 0)::numeric), 0)`

  const day = c.req.query('day')
  const from = c.req.query('from')
  const to = c.req.query('to')
  const conditions = [eq(checks.staffId, staffId), eq(checks.status, 'closed')]
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const start = new Date(`${day}T${hh}`)
    conditions.push(gte(checks.createdAt, start), lt(checks.createdAt, new Date(start.getTime() + 86400000)))
  } else {
    if (from) conditions.push(gte(checks.createdAt, new Date(`${from}T${hh}`)))
    if (to) conditions.push(lt(checks.createdAt, new Date(new Date(`${to}T${hh}`).getTime() + 86400000)))
  }
  const [r] = await db.select({ revenue: personalRevenue }).from(checks).where(and(...conditions))
  const revenue = Math.max(0, parseFloat(String(r?.revenue ?? '0')) || 0)
  const [p] = await db.select({ schemeId: profiles.salarySchemeId }).from(profiles).where(eq(profiles.id, staffId))
  const scheme = schemeOf(await loadSchemes(db), p?.schemeId ?? null)
  const salary = computeSalary(scheme.rules, { revenue, hours: 0 }).amount
  return c.json({ ...(day ? { day } : {}), revenue, salary, staffId })
})

// ─── Выплата ────────────────────────────────────────────────────────────────
// Выдаёт только владелец. Получают только сотрудники (не владельцы). Выплата за смену —
// одна на (сотрудник, смена): повтор возвращает первую как дубль. Сумму можно поправить —
// рядом сохраняется расчёт по формуле (calculated).
salaryRouter.post('/pay', requireRole('owner'), zValidator('json', PaySalarySchema), async (c) => {
  const user = c.get('user')
  const db = c.var.db
  const body = c.req.valid('json')

  const [target] = await db.select({ role: profiles.role, deletedAt: profiles.deletedAt }).from(profiles).where(eq(profiles.id, body.profileId))
  if (!target || target.deletedAt) return c.json({ error: 'Сотрудник не найден' }, 404)
  if (target.role !== 'staff') return c.json({ error: 'Зарплату получают только сотрудники — владелец её не получает' }, 400)

  let calculated: number | null = null
  if (body.shiftId) {
    const result = await shiftSalaries(db, body.shiftId)
    if (!result) return c.json({ error: 'Смена не найдена' }, 404)
    const worker = result.workers.find((w) => w.profileId === body.profileId)
    if (!worker) return c.json({ error: 'Этот сотрудник не работал на смене — добавьте его в смену' }, 400)
    calculated = worker.calculated
  }

  const { period } = body.shiftId ? { period: null } : splitNote(body.note ?? null)
  const effectiveKey = body.shiftId
    ? `salary:${body.profileId}:shift:${body.shiftId}`
    : period ? `salary:${body.profileId}:${period}` : (body.idempotencyKey ?? null)

  // Наличная зарплата — деньги из кассы: вместе с выплатой создаём cashOperation
  // type='salary' в открытой смене (сверка кассы её вычитает). Перевод кассу не трогает.
  const result = await db.transaction(async (tx) => {
    if (effectiveKey) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${effectiveKey}, 0))`)
      const [existing] = await tx.select().from(salaryPayments).where(eq(salaryPayments.idempotencyKey, effectiveKey))
      if (existing) return { pay: existing, duplicate: true as const }
    }

    const [pay] = await tx.insert(salaryPayments).values({
      profileId: body.profileId,
      amount: String(body.amount),
      paymentMethod: body.paymentMethod,
      note: body.note,
      shiftId: body.shiftId ?? null,
      calculated: calculated === null ? null : String(calculated),
      idempotencyKey: effectiveKey,
      createdBy: user.sub,
    }).onConflictDoNothing({ target: salaryPayments.idempotencyKey }).returning()
    if (!pay) return { pay: null, duplicate: true as const }

    if (body.paymentMethod === 'cash') {
      // Открытую смену читаем внутри транзакции под FOR SHARE (закрытие держит FOR UPDATE):
      // выплата ляжет в смену до закрытия либо увидит, что смена закрыта, — тогда откат (409).
      const [current] = await tx.select({ id: shifts.id }).from(shifts)
        .where(eq(shifts.status, 'open')).orderBy(desc(shifts.openedAt)).limit(1)
      const [shift] = current ? await tx.select().from(shifts).where(eq(shifts.id, current.id)).for('share') : []
      if (shift && shift.status !== 'open') throw new Error(SHIFT_CLOSED)
      if (shift) {
        const [who] = await tx.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, body.profileId))
        await tx.insert(cashOperations).values({
          type: 'salary',
          amount: String(body.amount),
          description: `Зарплата · ${who?.nickname ?? 'сотрудник'}${body.note ? ' · ' + body.note : ''}`,
          shiftId: shift.id,
          createdBy: user.sub,
          idempotencyKey: effectiveKey ? `${effectiveKey}:salary-cashop` : undefined,
        }).onConflictDoNothing({ target: cashOperations.idempotencyKey })
      }
    }
    return { pay, duplicate: false as const }
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === SHIFT_CLOSED) return null
    throw e
  })
  if (!result) return c.json({ error: 'Смена закрылась во время выплаты — повторите' }, 409)
  if (result.duplicate) {
    if (result.pay) return c.json({ payment: result.pay, duplicate: true })
    return c.json({ error: 'Выплата уже проведена' }, 409)
  }
  return c.json({ payment: result.pay }, 201)
})

// Отмена ошибочной выплаты (владелец): наличные возвращаются в кассу открытой смены внесением.
salaryRouter.delete('/payments/:id', requireRole('owner'), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const out = await db.transaction(async (tx) => {
    const [pay] = await tx.select().from(salaryPayments).where(eq(salaryPayments.id, id)).for('update')
    if (!pay) return 'not_found' as const
    if (pay.paymentMethod === 'cash') {
      const [shift] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.status, 'open')).orderBy(desc(shifts.openedAt)).limit(1)
      if (shift) {
        await tx.insert(cashOperations).values({
          type: 'deposit', amount: pay.amount, description: 'Отмена выплаты зарплаты', shiftId: shift.id, createdBy: user.sub,
        })
      }
    }
    await tx.delete(salaryPayments).where(eq(salaryPayments.id, id))
    return 'ok' as const
  })
  if (out === 'not_found') return c.json({ error: 'Выплата не найдена' }, 404)
  return c.json({ ok: true })
})

// Кого можно поставить на смену — нужно и сотруднику (открытие смены).
salaryRouter.get('/workers', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const staff = await db.select({
    id: profiles.id,
    nickname: profiles.nickname,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
  }).from(profiles).where(and(eq(profiles.role, 'staff'), sql`${profiles.deletedAt} is null`)).orderBy(profiles.nickname)
  return c.json({ staff })
})
