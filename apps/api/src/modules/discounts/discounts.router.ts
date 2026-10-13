import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { discounts, clientDiscountRules, eq, desc, asc, sql } from '@titan/database'
import { requireAuth, requireRole, requirePermission } from '../../middleware/auth.js'

export const discountsRouter = new Hono<AppEnv>()

const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/)
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Условия скидки (миграция 085). Все поля необязательны: PATCH меняет только присланное.
const ConditionsSchema = z.object({
  description: z.string().max(300).nullable().optional(),
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
  combinable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
})
type Conditions = z.infer<typeof ConditionsSchema>

/** Присланные условия → колонки; старые itemId/clientId (веб) превращаем в «на что/кому». */
function conditionColumns(body: Conditions & { itemId?: string | null; clientId?: string | null; minCheckSum?: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(ConditionsSchema.shape) as (keyof Conditions)[]) {
    const v = body[k]
    if (v === undefined) continue
    out[k] = k === 'minCheckSum' ? String(v) : v
  }
  if (body.itemId !== undefined && body.scope === undefined) {
    Object.assign(out, body.itemId ? { scope: 'items', itemIds: [body.itemId] } : { scope: 'check', itemIds: [] })
  }
  if (body.clientId !== undefined && body.audience === undefined) {
    Object.assign(out, body.clientId ? { audience: 'clients', clientIds: [body.clientId] } : { audience: 'all', clientIds: [] })
  }
  return out
}

discountsRouter.use('*', requireAuth)

// GET /api/discounts — только персонал/владелец (видны привязки clientId).
discountsRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const clientId = c.req.query('clientId')
  const where = clientId ? sql`${clientId}::uuid = ANY(${discounts.clientIds})` : undefined
  const rows = await db.select().from(discounts).where(where).orderBy(asc(discounts.sortOrder), desc(discounts.createdAt))
  return c.json({ discounts: rows })
})

// POST /api/discounts
// Изменения скидок/правил — только с правом «Скидки» (GET нужны кассе — без него).
discountsRouter.post(
  '/',
  requireRole('owner', 'staff'),
  requirePermission('discounts'),
  zValidator('json', z.object({
    name: z.string().min(1),
    type: z.enum(['percent', 'fixed']),
    value: z.number().min(0),
    isActive: z.boolean().optional().default(true),
    isAuto: z.boolean().optional().default(false),
    minQuantity: z.number().int().min(1).optional().default(1),
    itemId: z.string().uuid().optional().nullable(),
    clientId: z.string().uuid().optional().nullable(),
  }).merge(ConditionsSchema).refine(
    // Процентная скидка не может превышать 100%.
    (d) => d.type !== 'percent' || d.value <= 100,
    { message: 'Процентная скидка не может превышать 100%', path: ['value'] },
  )),
  async (c) => {
    const db = c.var.db
    const body = c.req.valid('json')
    const [row] = await db.insert(discounts).values({
      name: body.name,
      type: body.type,
      value: String(body.value),
      isActive: body.isActive,
      isAuto: body.isAuto,
      minQuantity: body.minQuantity,
      ...conditionColumns(body),
    }).returning()
    return c.json({ discount: row }, 201)
  }
)

// ───────────────────────── Скидки по тиру клиента ─────────────────────────
// Правила маппинга «тир клиента → скидка». Связанная скидка применяется на
// кассе по факту наличия активного правила для тира клиента — НЕЗАВИСИМО от
// флага isAuto самой скидки. Семантика для кассы: clientDiscountRules.isActive
// → ищем по clientTier клиента → берём discountId → применяем эту скидку.
//
// ВАЖНО: эти роуты объявлены ДО `/:id` PATCH/DELETE ниже, иначе путь
// `tier-rules` был бы перехвачен параметром `:id`.

// Статусы теперь динамические (справочник client_tiers). Для подписи правила по
// умолчанию знаем системные метки; для кастомных — fallback на сам ключ.
const RU_TIER_LABEL: Record<string, string> = {
  guest: 'Гость',
  resident: 'Резидент',
  student: 'Студент',
}

// GET /api/discounts/tier-rules — список правил (активные и нет) с привязанной скидкой.
discountsRouter.get('/tier-rules', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      id: clientDiscountRules.id,
      name: clientDiscountRules.name,
      clientTier: clientDiscountRules.clientTier,
      discountId: clientDiscountRules.discountId,
      isActive: clientDiscountRules.isActive,
      createdAt: clientDiscountRules.createdAt,
      discountName: discounts.name,
      discountType: discounts.type,
      discountValue: discounts.value,
    })
    .from(clientDiscountRules)
    .leftJoin(discounts, eq(clientDiscountRules.discountId, discounts.id))
    .orderBy(desc(clientDiscountRules.createdAt))

  const rules = rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientTier: r.clientTier,
    discountId: r.discountId,
    isActive: r.isActive,
    discount: r.discountId
      ? { name: r.discountName, type: r.discountType, value: r.discountValue }
      : null,
  }))
  return c.json({ rules })
})

// POST /api/discounts/tier-rules — создать правило.
discountsRouter.post(
  '/tier-rules',
  requireRole('owner', 'staff'),
  requirePermission('discounts'),
  zValidator('json', z.object({
    name: z.string().min(1).optional(),
    clientTier: z.string().min(1),
    discountId: z.string().uuid(),
    isActive: z.boolean().optional().default(true),
  })),
  async (c) => {
    const db = c.var.db
    const body = c.req.valid('json')

    // Привязываемая скидка должна существовать (discountId — FK).
    const [linked] = await db.select({ name: discounts.name }).from(discounts).where(eq(discounts.id, body.discountId))
    if (!linked) return c.json({ error: 'Скидка не найдена' }, 400)

    // Имя необязательно: по умолчанию — название скидки, иначе метка тира.
    const name = body.name?.trim() || linked.name || RU_TIER_LABEL[body.clientTier] || body.clientTier

    const [row] = await db.insert(clientDiscountRules).values({
      name,
      clientTier: body.clientTier,
      discountId: body.discountId,
      isActive: body.isActive,
    }).returning()
    return c.json({ rule: row }, 201)
  }
)

// PATCH /api/discounts/tier-rules/:id — частичное обновление.
discountsRouter.patch(
  '/tier-rules/:id',
  requireRole('owner', 'staff'),
  requirePermission('discounts'),
  zValidator('json', z.object({
    name: z.string().min(1).optional(),
    clientTier: z.string().min(1).optional(),
    discountId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
  })),
  async (c) => {
    const db = c.var.db
    const id = c.req.param('id')
    const body = c.req.valid('json')

    if (body.discountId !== undefined) {
      const [linked] = await db.select({ id: discounts.id }).from(discounts).where(eq(discounts.id, body.discountId))
      if (!linked) return c.json({ error: 'Скидка не найдена' }, 400)
    }

    const update: Record<string, unknown> = {}
    if (body.name !== undefined) update.name = body.name
    if (body.clientTier !== undefined) update.clientTier = body.clientTier
    if (body.discountId !== undefined) update.discountId = body.discountId
    if (body.isActive !== undefined) update.isActive = body.isActive

    const [row] = await db.update(clientDiscountRules).set(update).where(eq(clientDiscountRules.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ rule: row })
  }
)

// DELETE /api/discounts/tier-rules/:id — удалить правило.
discountsRouter.delete('/tier-rules/:id', requireRole('owner', 'staff'), requirePermission('discounts'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  await db.delete(clientDiscountRules).where(eq(clientDiscountRules.id, id))
  return c.json({ ok: true })
})

// ──────────────────────────────────────────────────────────────────────────

// PATCH /api/discounts/:id
discountsRouter.patch(
  '/:id',
  requireRole('owner', 'staff'),
  requirePermission('discounts'),
  zValidator('json', z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['percent', 'fixed']).optional(),
    value: z.number().min(0).optional(),
    isActive: z.boolean().optional(),
    isAuto: z.boolean().optional(),
    minQuantity: z.number().int().min(1).optional(),
    itemId: z.string().uuid().optional().nullable(),
    clientId: z.string().uuid().optional().nullable(),
  }).merge(ConditionsSchema).refine(
    // Если в одном запросе указаны и type='percent', и value — value ≤ 100.
    (d) => d.type !== 'percent' || d.value === undefined || d.value <= 100,
    { message: 'Процентная скидка не может превышать 100%', path: ['value'] },
  )),
  async (c) => {
    const db = c.var.db
    const id = c.req.param('id')
    const body = c.req.valid('json')

    // Частичное обновление: если меняется только value (без type), сверяемся
    // с уже сохранённым типом скидки, чтобы процент не превысил 100%.
    if (body.value !== undefined) {
      let effectiveType = body.type
      if (effectiveType === undefined) {
        const [cur] = await db.select({ type: discounts.type }).from(discounts).where(eq(discounts.id, id))
        effectiveType = cur?.type as 'percent' | 'fixed' | undefined
      }
      if (effectiveType === 'percent' && body.value > 100) {
        return c.json({ error: 'Процентная скидка не может превышать 100%' }, 400)
      }
    } else if (body.type === 'percent') {
      // Меняется только тип: фиксированная 500 ₽ не должна стать скидкой 500%.
      const [cur] = await db.select({ value: discounts.value }).from(discounts).where(eq(discounts.id, id))
      if (cur && parseFloat(cur.value) > 100) {
        return c.json({ error: 'Процентная скидка не может превышать 100% — укажите новое значение' }, 400)
      }
    }

    const update: Record<string, unknown> = {}
    if (body.name !== undefined) update.name = body.name
    if (body.type !== undefined) update.type = body.type
    if (body.value !== undefined) update.value = String(body.value)
    if (body.isActive !== undefined) update.isActive = body.isActive
    if (body.isAuto !== undefined) update.isAuto = body.isAuto
    if (body.minQuantity !== undefined) update.minQuantity = body.minQuantity
    Object.assign(update, conditionColumns(body))

    const [row] = await db.update(discounts).set(update).where(eq(discounts.id, id)).returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ discount: row })
  }
)

// DELETE /api/discounts/:id
discountsRouter.delete('/:id', requireRole('owner', 'staff'), requirePermission('discounts'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  await db.delete(discounts).where(eq(discounts.id, id))
  return c.json({ ok: true })
})
