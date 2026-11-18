/**
 * Лояльность (миграция 093): правила начисления бонусов, сводка программы и
 * калькулятор «что получит гость» — для экранов «Лояльность» в HUB.
 */
import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { bonusRules, eq, asc, desc, sql } from '@titan/database'
import { requireAuth, requireRole, requirePermission } from '../../middleware/auth.js'
import { computeAccrual, loadBonusSettings } from '../../lib/bonusAccrual.js'

export const loyaltyRouter = new Hono<AppEnv>()
loyaltyRouter.use('*', requireAuth, requireRole('owner', 'staff'))

const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const RuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
  kind: z.enum(['percent', 'multiplier', 'fixed']),
  value: z.number().min(0).max(1_000_000),
  scope: z.enum(['check', 'categories', 'items']).optional(),
  categoryIds: z.array(z.string().uuid()).max(100).optional(),
  itemIds: z.array(z.string().uuid()).max(300).optional(),
  audience: z.enum(['all', 'tiers', 'clients', 'staff', 'first']).optional(),
  tiers: z.array(z.string().min(1).max(40)).max(30).optional(),
  clientIds: z.array(z.string().uuid()).max(500).optional(),
  birthdayDays: z.number().int().min(0).max(31).nullable().optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  timeFrom: HHMM.nullable().optional(),
  timeTo: HHMM.nullable().optional(),
  startsOn: DATE.nullable().optional(),
  endsOn: DATE.nullable().optional(),
  minCheckSum: z.number().min(0).max(10_000_000).optional(),
  sortOrder: z.number().int().optional(),
})

const valueOk = (r: { kind?: string; value?: number }) =>
  r.value === undefined || (r.kind === 'percent' ? r.value <= 100 : r.kind === 'multiplier' ? r.value >= 1 && r.value <= 10 : true)
const VALUE_ERROR = { message: 'Процент — до 100, множитель — от 1 до 10', path: ['value'] }

function columns(body: Partial<z.infer<typeof RuleSchema>>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue
    out[k] = k === 'value' || k === 'minCheckSum' ? String(v) : v
  }
  return out
}

loyaltyRouter.get('/bonus-rules', async (c) => {
  const rows = await c.var.db.select().from(bonusRules).orderBy(asc(bonusRules.sortOrder), desc(bonusRules.createdAt))
  return c.json({ rules: rows })
})

loyaltyRouter.post('/bonus-rules', requirePermission('bonus'), zValidator('json', RuleSchema.refine(valueOk, VALUE_ERROR)), async (c) => {
  const body = c.req.valid('json')
  const [row] = await c.var.db.insert(bonusRules).values(columns(body) as typeof bonusRules.$inferInsert).returning()
  return c.json({ rule: row }, 201)
})

loyaltyRouter.patch('/bonus-rules/:id', requirePermission('bonus'), zValidator('json', RuleSchema.partial()), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [current] = await db.select().from(bonusRules).where(eq(bonusRules.id, id))
  if (!current) return c.json({ error: 'Правило не найдено' }, 404)
  if (!valueOk({ kind: body.kind ?? current.kind, value: body.value ?? parseFloat(current.value) })) {
    return c.json({ error: VALUE_ERROR.message }, 400)
  }
  const [row] = await db.update(bonusRules).set(columns(body)).where(eq(bonusRules.id, id)).returning()
  return c.json({ rule: row })
})

loyaltyRouter.delete('/bonus-rules/:id', requirePermission('bonus'), async (c) => {
  const [row] = await c.var.db.delete(bonusRules).where(eq(bonusRules.id, c.req.param('id'))).returning({ id: bonusRules.id })
  if (!row) return c.json({ error: 'Правило не найдено' }, 404)
  return c.json({ ok: true })
})

// Калькулятор: сколько бонусов получит гость со статусом tier за чек на amount
// (на категорию categoryId) в момент at. Те же настройки и правила, что у кассы.
loyaltyRouter.post('/preview', zValidator('json', z.object({
  amount: z.number().min(0).max(10_000_000),
  tier: z.string().max(40).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  at: z.string().datetime().optional(),
  firstVisit: z.boolean().optional(),
})), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const settings = await loadBonusSettings(db)
  const rules = await db.select().from(bonusRules).where(eq(bonusRules.isActive, true))
  const result = computeAccrual(settings, rules, {
    playerId: null,
    player: { role: 'client', clientTier: body.tier ?? 'guest', birthday: null, closedChecks: body.firstVisit ? 0 : 1 },
    openedAt: body.at ? new Date(body.at) : new Date(),
    lines: [{ itemId: '', categoryId: body.categoryId ?? null, amount: body.amount }],
    paid: body.amount,
    debt: 0,
  })
  const welcome = body.firstVisit && settings.enabled && settings.welcome.enabled ? settings.welcome.amount : 0
  return c.json({ ...result, welcome })
})

const rows = (res: unknown): Record<string, unknown>[] => ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as Record<string, unknown>[]
const n = (v: unknown) => Number(v ?? 0) || 0

// Сводка программы за период: бонусы выдано/списано/сгорело, на счетах, сгорит скоро,
// скидки по сумме, подарки, приглашения, сертификаты; по дням — для графика.
loyaltyRouter.get('/overview', async (c) => {
  const db = c.var.db
  const days = Math.min(Math.max(Math.floor(Number(c.req.query('days') ?? 30)) || 30, 1), 365)
  const since = sql`now() - make_interval(days => ${days})`

  const [bonus] = rows(await db.execute(sql`
    SELECT
      coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS accrued,
      coalesce(-sum(amount) FILTER (WHERE reason = 'expired'), 0) AS expired,
      count(*) FILTER (WHERE reason IN ('Приветственный бонус', 'Бонус ко дню рождения', 'Сертификат ко дню рождения') OR reason LIKE 'Подарок от %' OR reason LIKE 'За приглашение:%') AS gifts
    FROM bonus_history WHERE created_at > ${since}`))
  const [spent] = rows(await db.execute(sql`
    SELECT coalesce(sum(bonus_used), 0) AS spent, count(*) FILTER (WHERE bonus_used > 0) AS checks
    FROM checks WHERE status = 'closed' AND coalesce(closed_at, created_at) > ${since}`))
  const [wallet] = rows(await db.execute(sql`
    SELECT coalesce(sum(bonus_points), 0) AS balance, count(*) FILTER (WHERE bonus_points > 0) AS holders
    FROM profiles WHERE deleted_at IS NULL`))
  const [expiring] = rows(await db.execute(sql`
    SELECT coalesce(sum(remaining), 0) AS amount FROM bonus_lots
    WHERE remaining > 0 AND expires_at IS NOT NULL AND expires_at < now() + interval '30 days'`))
  const [discountSum] = rows(await db.execute(sql`
    SELECT coalesce(sum(cd.amount), 0) AS amount FROM check_discounts cd JOIN checks ch ON ch.id = cd.check_id
    WHERE ch.status = 'closed' AND coalesce(ch.closed_at, ch.created_at) > ${since}`))
  const discounts = rows(await db.execute(sql`
    SELECT cd.name, coalesce(sum(cd.amount), 0) AS amount, count(DISTINCT cd.check_id) AS checks
    FROM check_discounts cd JOIN checks ch ON ch.id = cd.check_id
    WHERE ch.status = 'closed' AND coalesce(ch.closed_at, ch.created_at) > ${since}
    GROUP BY cd.name ORDER BY amount DESC LIMIT 6`))
  const [referrals] = rows(await db.execute(sql`
    SELECT count(*) FILTER (WHERE referral_rewarded_at > ${since}) AS rewarded,
           count(*) FILTER (WHERE referral_rewarded_at IS NULL) AS pending
    FROM profiles WHERE referred_by IS NOT NULL AND deleted_at IS NULL`))
  const [certs] = rows(await db.execute(sql`
    SELECT count(*) AS active, coalesce(sum(balance), 0) AS balance FROM certificates
    WHERE voided_at IS NULL AND NOT is_used AND balance > 0.005
      AND (valid_until IS NULL OR valid_until >= (now() AT TIME ZONE 'Europe/Moscow')::date)`))
  const daily = rows(await db.execute(sql`
    WITH d AS (SELECT generate_series(((now() AT TIME ZONE 'Europe/Moscow')::date - (${days}::int - 1)), (now() AT TIME ZONE 'Europe/Moscow')::date, interval '1 day')::date AS day)
    SELECT d.day::text AS day,
      coalesce((SELECT sum(amount) FROM bonus_history b WHERE b.amount > 0 AND (b.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day), 0) AS accrued,
      coalesce((SELECT sum(bonus_used) FROM checks ch WHERE ch.status = 'closed' AND (coalesce(ch.closed_at, ch.created_at) AT TIME ZONE 'Europe/Moscow')::date = d.day), 0) AS spent
    FROM d ORDER BY d.day`))

  return c.json({
    days,
    bonus: {
      accrued: n(bonus?.accrued), spent: n(spent?.spent), expired: n(bonus?.expired),
      balance: n(wallet?.balance), holders: n(wallet?.holders), expiringSoon: n(expiring?.amount),
      checksWithBonus: n(spent?.checks),
    },
    discounts: { total: n(discountSum?.amount), top: discounts.map((r) => ({ name: String(r.name), amount: n(r.amount), checks: n(r.checks) })) },
    gifts: n(bonus?.gifts),
    referrals: { rewarded: n(referrals?.rewarded), pending: n(referrals?.pending) },
    certificates: { active: n(certs?.active), balance: n(certs?.balance) },
    daily: daily.map((r) => ({ day: String(r.day), accrued: n(r.accrued), spent: n(r.spent) })),
  })
})
