import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supplies, supplyItems, supplyCorrections, inventory, cashOperations, shifts, eq, and, asc, desc } from '@titan/database'
import type { Database } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { round2 } from '../../lib/money.js'
import { recordMovement, refreshRecipeCosts } from '../inventory/ledger.js'
import { notify } from '../notifications/push.js'

// Источник БД — пер-запросный (c.var.db). Тип для хелперов, работающих как с
// корневым соединением, так и внутри транзакции.
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Tx

/** Смена закрыта, а приход просят оплатить из кассы. */
class ShiftClosedError extends Error {}

const SHIFT_CLOSED_TEXT = 'Смена закрыта — из кассы платить нельзя. Откройте смену или выберите другой способ оплаты.'

/**
 * Приход, оплаченный наличными из кассы, — выдача из кассы текущей смены (тот же
 * учёт, что у «Выдачи» в кассе): ожидаемый остаток наличных уменьшается на сумму.
 * Возвращает id операции или null, если платить нечего.
 */
async function payFromRegister(tx: Tx, amount: number, supplier: string | undefined | null, userId: string): Promise<string | null> {
  if (amount <= 0) return null
  const [shift] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.status, 'open')).orderBy(desc(shifts.openedAt)).limit(1)
  if (!shift) throw new ShiftClosedError()
  const [op] = await tx.insert(cashOperations).values({
    type: 'withdrawal',
    amount: String(amount),
    description: `Приход на склад${supplier ? ' · ' + supplier : ''}`,
    shiftId: shift.id,
    createdBy: userId,
  }).returning({ id: cashOperations.id })
  return op!.id
}

/**
 * Выдача по приходу живёт, пока открыта её смена: правка/удаление прихода меняет
 * или убирает её. В закрытой смене деньги уже сверены — операцию не трогаем.
 */
async function syncRegisterPayment(tx: Tx, cashOperationId: string | null, amount: number | null) {
  if (!cashOperationId) return
  const [op] = await tx
    .select({ id: cashOperations.id, status: shifts.status })
    .from(cashOperations)
    .innerJoin(shifts, eq(shifts.id, cashOperations.shiftId))
    .where(eq(cashOperations.id, cashOperationId))
  if (!op || op.status !== 'open') return
  if (amount === null || amount <= 0) await tx.delete(cashOperations).where(eq(cashOperations.id, cashOperationId))
  else await tx.update(cashOperations).set({ amount: String(amount) }).where(eq(cashOperations.id, cashOperationId))
}

/** Карточки товаров из строк прихода — их новая средняя меняет себестоимость техкарт. */
const receivedIds = (items: { itemId?: string | null }[]) => [...new Set(items.map((i) => i.itemId).filter((x): x is string => !!x))]

const SupplySchema = z.object({
  note: z.string().optional(),
  supplier: z.string().optional(),
  paymentMethod: z.enum(['cash', 'card', 'transfer']).default('cash'),
  // Наличными из кассы смены: приход становится выдачей из кассы (миграция 070).
  fromRegister: z.boolean().default(false),
  // Ключ идемпотентности обязателен: без него ретрай POST (двойной клик/сетевой
  // повтор) задвоит приёмку — остаток и COGS уедут. Фронт всегда его шлёт.
  idempotencyKey: z.string().min(1).max(80),
  items: z.array(z.object({
    // Привязка к карточке товара опциональна: сырьё без карточки можно
    // зафиксировать как затрату (без изменения остатка).
    itemId: z.string().uuid().optional(),
    name: z.string().optional(),
    unit: z.string().default('шт'),
    quantity: z.number().positive(),
    costPerUnit: z.number().min(0),
    packs: z.number().positive().max(1_000_000).optional(),
  }).refine(i => !!i.itemId || !!(i.name && i.name.trim()), {
    message: 'Нужно указать товар или название позиции',
  }).refine(i => !i.itemId || Number.isInteger(i.quantity), {
    // Остаток в inventory — целое. Дробное количество для позиции с карточкой
    // рассинхронизирует остаток с себестоимостью (0.4 → 0 шт, но полная стоимость).
    message: 'Для товара с карточкой количество должно быть целым',
    path: ['quantity'],
  })).min(1),
})

export const suppliesRouter = new Hono<AppEnv>()
suppliesRouter.use('*', requireAuth)

suppliesRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const rows = await db.select().from(supplies).orderBy(desc(supplies.createdAt)).limit(50)
  const enriched = await Promise.all(rows.map(async (s) => {
    // У черновика нет supply_items — состав в draft_data.
    if (s.status === 'draft') {
      const di = s.draftData?.items ?? []
      return {
        ...s, date: s.createdAt,
        items: di.map(it => ({ itemId: it.itemId ?? null, name: it.name ?? '—', unit: it.unit ?? 'шт', quantity: Number(it.quantity) || 0, costPerUnit: Number(it.costPerUnit) || 0 })),
      }
    }
    const items = await db.select().from(supplyItems).where(eq(supplyItems.supplyId, s.id))
    return {
      ...s,
      date: s.createdAt,
      items: items.map(it => ({
        itemId: it.itemId,
        name: it.name ?? '—',
        unit: it.unit,
        quantity: Number(it.quantity),
        costPerUnit: Number(it.costPerUnit),
      })),
    }
  }))
  return c.json({ supplies: enriched })
})

suppliesRouter.post('/', requireRole('owner', 'staff'), zValidator('json', SupplySchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  const totalCost = round2(body.items.reduce((s, i) => s + i.quantity * i.costPerUnit, 0))

  let supply: typeof supplies.$inferSelect | null
  try {
  supply = await db.transaction(async (tx) => {
    const [sup] = await tx.insert(supplies).values({
      note: body.note,
      supplier: body.supplier,
      paymentMethod: body.paymentMethod,
      totalCost: String(totalCost),
      createdBy: user.sub,
      idempotencyKey: body.idempotencyKey,
    // Уникальный индекс на idempotency_key — полный (см. 034_supplies_idem_full_index.sql),
    // как у expenses/salary/cash_operations, поэтому ON CONFLICT по колонке его находит.
    }).onConflictDoNothing({ target: supplies.idempotencyKey }).returning()

    // Двойной клик/ретрай с тем же ключом — приёмка уже создана. Прерываем
    // транзакцию без побочных эффектов (без задвоения остатка/COGS).
    if (!sup) return null

    let cashOperationId: string | null = null
    if (body.fromRegister) {
      cashOperationId = await payFromRegister(tx, totalCost, body.supplier, user.sub)
      if (cashOperationId) await tx.update(supplies).set({ cashOperationId, paymentMethod: 'cash' }).where(eq(supplies.id, sup.id))
    }

    await tx.insert(supplyItems).values(body.items.map(i => ({
      supplyId: sup.id,
      itemId: i.itemId ?? null,
      name: i.name ?? null,
      unit: i.unit,
      quantity: String(i.quantity),
      costPerUnit: String(i.costPerUnit),
      packs: i.packs !== undefined ? String(i.packs) : null,
    })))

    // Обновляем остаток только для позиций, привязанных к карточке товара.
    // recordMovement сам пересчитывает WAC по средневзвешенной на приходе.
    for (const i of body.items) {
      if (!i.itemId || i.quantity === 0) continue
      await recordMovement(tx, {
        itemId: i.itemId, type: 'receipt', delta: i.quantity, unitCost: i.costPerUnit,
        sourceType: 'supply', sourceId: sup.id,
        reason: `Приёмка${body.supplier ? ' · ' + body.supplier : ''}`, userId: user.sub,
      })
    }

    return cashOperationId ? { ...sup, cashOperationId, paymentMethod: 'cash' as const } : sup
  })
  } catch (err) {
    if (err instanceof ShiftClosedError) return c.json({ error: SHIFT_CLOSED_TEXT }, 409)
    throw err
  }
  void refreshRecipeCosts(db, { componentIds: receivedIds(body.items) }).catch(() => {})

  // Повторный POST с тем же ключом — отдаём существующую приёмку (как expenses).
  if (!supply) {
    if (body.idempotencyKey) {
      const [existing] = await db.select().from(supplies).where(eq(supplies.idempotencyKey, body.idempotencyKey))
      if (existing) return c.json({ supply: existing, duplicate: true })
    }
    return c.json({ error: 'Не удалось сохранить приёмку' }, 500)
  }

  // Понятный текст: поставщик (если указан) · сколько позиций · сумма.
  const supItemNames = body.items.map(i => i.name).filter(Boolean).slice(0, 3).join(', ')
  const supBody = [
    body.supplier ? `Поставщик: ${body.supplier}` : null,
    `${body.items.length} поз. · ${totalCost.toLocaleString('ru')} ₽`,
    supItemNames || null,
  ].filter(Boolean).join('\n')
  void notify({
    type: 'supply_received',
    title: 'Приход на склад',
    body: supBody,
    meta: { supplyId: supply.id },
  }, db, c.var.club?.id).catch(() => {})

  return c.json({ supply }, 201)
})

// Записать позиции приёмки + движения receipt (WAC). Общая логика проведения
// свежей закупки и применения черновика.
async function postSupplyLines(
  tx: Tx,
  supplyId: string,
  items: { itemId?: string | null; name?: string; unit: string; quantity: number; costPerUnit: number; packs?: number | null }[],
  supplier: string | undefined,
  userId: string,
) {
  await tx.insert(supplyItems).values(items.map(i => ({
    supplyId, itemId: i.itemId ?? null, name: i.name ?? null, unit: i.unit,
    quantity: String(i.quantity), costPerUnit: String(i.costPerUnit),
    packs: i.packs !== undefined && i.packs !== null ? String(i.packs) : null,
  })))
  for (const i of items) {
    if (!i.itemId || i.quantity === 0) continue
    await recordMovement(tx, {
      itemId: i.itemId, type: 'receipt', delta: i.quantity, unitCost: i.costPerUnit,
      sourceType: 'supply', sourceId: supplyId,
      reason: `Приёмка${supplier ? ' · ' + supplier : ''}`, userId,
    })
  }
}

// POST /supplies/draft — сохранить/обновить ЧЕРНОВИК приёмки (без движений/остатков).
// Состав кладётся в draft_data; supply_items не создаются до применения.
suppliesRouter.post('/draft', requireRole('owner', 'staff'), zValidator('json', z.object({
  id: z.string().uuid().optional(),
  note: z.string().optional(),
  supplier: z.string().optional(),
  paymentMethod: z.enum(['cash', 'card', 'transfer']).optional(),
  fromRegister: z.boolean().optional(),
  items: z.array(z.object({
    itemId: z.string().uuid().optional(),
    name: z.string().optional(),
    unit: z.string().default('шт'),
    quantity: z.number().min(0),
    costPerUnit: z.number().min(0),
    packs: z.number().min(0).max(1_000_000).optional(),
  })).max(200),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { id, note, supplier, paymentMethod, fromRegister, items } = c.req.valid('json')
  const draftData = { note, supplier, paymentMethod, fromRegister, items }
  if (id) {
    const [row] = await db.update(supplies)
      .set({ draftData, note: note ?? null, supplier: supplier ?? null, updatedAt: new Date() })
      .where(and(eq(supplies.id, id), eq(supplies.status, 'draft')))
      .returning({ id: supplies.id })
    if (!row) return c.json({ error: 'Черновик не найден' }, 404)
    return c.json({ id: row.id })
  }
  const [row] = await db.insert(supplies)
    .values({ status: 'draft', draftData, note: note ?? null, supplier: supplier ?? null, totalCost: '0', createdBy: user.sub, updatedAt: new Date() })
    .returning({ id: supplies.id })
  return c.json({ id: row.id }, 201)
})

// POST /supplies/:id/apply — провести ЧЕРНОВИК (draft → posted): пишет позиции и
// движения receipt (WAC). FOR UPDATE + проверка статуса сериализуют повторное применение.
const ApplySupplySchema = z.object({
  note: z.string().optional(),
  supplier: z.string().optional(),
  paymentMethod: z.enum(['cash', 'card', 'transfer']).optional(),
  fromRegister: z.boolean().default(false),
  items: z.array(z.object({
    itemId: z.string().uuid().optional(),
    name: z.string().optional(),
    unit: z.string().default('шт'),
    quantity: z.number().positive(),
    costPerUnit: z.number().min(0),
    packs: z.number().positive().max(1_000_000).optional(),
  }).refine(i => !!i.itemId || !!(i.name && i.name.trim()), { message: 'Нужно указать товар или название позиции' })
    .refine(i => !i.itemId || Number.isInteger(i.quantity), { message: 'Для товара с карточкой количество должно быть целым', path: ['quantity'] })
  ).min(1),
})

suppliesRouter.post('/:id/apply', requireRole('owner', 'staff'), zValidator('json', ApplySupplySchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const totalCost = round2(body.items.reduce((s, i) => s + i.quantity * i.costPerUnit, 0))
  let res: 'not_found' | 'not_draft' | 'ok'
  try {
    res = await db.transaction(async (tx) => {
      const [sup] = await tx.select().from(supplies).where(eq(supplies.id, id)).for('update')
      if (!sup) return 'not_found' as const
      if (sup.status !== 'draft') return 'not_draft' as const
      await postSupplyLines(tx, id, body.items, body.supplier, user.sub)
      const cashOperationId = body.fromRegister ? await payFromRegister(tx, totalCost, body.supplier ?? sup.supplier, user.sub) : null
      // Дата прихода — момент проведения, а не создания черновика.
      await tx.update(supplies).set({
        status: 'posted', draftData: null, totalCost: String(totalCost), note: body.note ?? sup.note, supplier: body.supplier ?? sup.supplier,
        paymentMethod: cashOperationId ? 'cash' : body.paymentMethod ?? sup.paymentMethod, cashOperationId, createdAt: new Date(), updatedAt: new Date(),
      }).where(eq(supplies.id, id))
      return 'ok' as const
    })
  } catch (err) {
    if (err instanceof ShiftClosedError) return c.json({ error: SHIFT_CLOSED_TEXT }, 409)
    throw err
  }
  if (res === 'not_found') return c.json({ error: 'Not found' }, 404)
  if (res === 'not_draft') return c.json({ error: 'Приёмка уже проведена' }, 409)
  void refreshRecipeCosts(db, { componentIds: receivedIds(body.items) }).catch(() => {})
  void notify({ type: 'supply_received', title: 'Приход на склад', body: `${body.items.length} поз. · ${totalCost.toLocaleString('ru')} ₽`, meta: { supplyId: id } }, db, c.var.club?.id).catch(() => {})
  return c.json({ supply: { id }, posted: true })
})

// GET /supplies/items/:itemId/last-price — последняя цена закупки позиции.
// Должен идти ДО /:id, иначе перехватится как id.
suppliesRouter.get('/items/:itemId/last-price', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [row] = await db
    .select({ costPerUnit: supplyItems.costPerUnit })
    .from(supplyItems)
    .innerJoin(supplies, eq(supplies.id, supplyItems.supplyId))
    .where(eq(supplyItems.itemId, c.req.param('itemId')))
    .orderBy(desc(supplies.createdAt))
    .limit(1)
  return c.json({ lastPrice: row ? parseFloat(String(row.costPerUnit)) : null })
})

suppliesRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [supply] = await db.select().from(supplies).where(eq(supplies.id, c.req.param('id')))
  if (!supply) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select({ supplyItem: supplyItems, item: inventory })
    .from(supplyItems)
    .leftJoin(inventory, eq(inventory.id, supplyItems.itemId))
    .where(eq(supplyItems.supplyId, supply.id))
  const items = rows.map(r => ({
    itemId: r.supplyItem.itemId,
    name: r.supplyItem.name ?? r.item?.name ?? '—',
    unit: r.supplyItem.unit,
    // Единица учёта карточки (шт/г/мл, миграция 070) — количество строки в ней.
    stockUnit: r.item?.unit ?? null,
    quantity: Number(r.supplyItem.quantity),
    costPerUnit: Number(r.supplyItem.costPerUnit),
    packs: r.supplyItem.packs !== null ? Number(r.supplyItem.packs) : null,
  }))
  const corrections = await db
    .select()
    .from(supplyCorrections)
    .where(eq(supplyCorrections.supplyId, supply.id))
    .orderBy(asc(supplyCorrections.createdAt))
  const correctionsOut = corrections.map(cr => ({
    id: cr.id,
    reason: cr.reason,
    totalBefore: Number(cr.totalBefore),
    totalAfter: Number(cr.totalAfter),
    createdAt: cr.createdAt,
  }))
  return c.json({ supply: { ...supply, date: supply.createdAt }, items, corrections: correctionsOut })
})

// PATCH /supplies/:id — корректировка проведённой закупки (owner/staff). Остаток
// пересчитываем по NET-дельте на карточку: delta = новое_кол-во − старое_кол-во,
// применяем к stockQuantity (не ниже 0) и пишем аудит-движение «Корректировка
// закупки». Операция ИДЕМПОТЕНТНА: повторный PATCH с тем же телом даёт дельту 0
// (склад уже синхронизирован), поэтому ключ идемпотентности не нужен.
// costPrice (средневзвешенную) при правке НЕ трогаем — пересчёт задним числом
// повредил бы её при последующих закупках; то же ограничение, что и у удаления.
const SupplyEditSchema = z.object({
  note: z.string().optional(),
  // Корректировка проведённой закупки требует обязательной причины (аудит).
  reason: z.string().trim().min(3, 'Укажите причину корректировки'),
  items: z.array(z.object({
    itemId: z.string().uuid().optional(),
    name: z.string().optional(),
    unit: z.string().default('шт'),
    quantity: z.number().positive(),
    costPerUnit: z.number().min(0),
    packs: z.number().positive().max(1_000_000).optional(),
  }).refine(i => !!i.itemId || !!(i.name && i.name.trim()), {
    message: 'Нужно указать товар или название позиции',
  }).refine(i => !i.itemId || Number.isInteger(i.quantity), {
    message: 'Для товара с карточкой количество должно быть целым',
    path: ['quantity'],
  })).min(1),
})

suppliesRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', SupplyEditSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const totalCost = round2(body.items.reduce((s, i) => s + i.quantity * i.costPerUnit, 0))

  const result = await db.transaction(async (tx) => {
    const [supply] = await tx.select().from(supplies).where(eq(supplies.id, id)).for('update')
    if (!supply) return null
    // Корректируется только проведённый приход: у черновика остатки не тронуты — запись
    // строк и движений здесь задвоилась бы при его проведении.
    if (supply.status !== 'posted') return 'not_posted' as const

    // Старые количества по карточкам (целые) — для расчёта дельты.
    const oldLines = await tx.select().from(supplyItems).where(eq(supplyItems.supplyId, id))
    const oldByItem = new Map<string, number>()
    for (const l of oldLines) {
      if (!l.itemId) continue
      oldByItem.set(l.itemId, (oldByItem.get(l.itemId) ?? 0) + Math.round(Number(l.quantity)))
    }

    // Перезаписываем состав закупки.
    await tx.delete(supplyItems).where(eq(supplyItems.supplyId, id))
    await tx.insert(supplyItems).values(body.items.map(i => ({
      supplyId: id,
      itemId: i.itemId ?? null,
      name: i.name ?? null,
      unit: i.unit,
      quantity: String(i.quantity),
      costPerUnit: String(i.costPerUnit),
      packs: i.packs !== undefined ? String(i.packs) : null,
    })))

    const newByItem = new Map<string, number>()
    for (const i of body.items) {
      if (!i.itemId) continue
      newByItem.set(i.itemId, (newByItem.get(i.itemId) ?? 0) + i.quantity)
    }

    // Сверяем остаток по каждой затронутой карточке (старые ∪ новые). WAC при
    // правке НЕ трогаем (type=adjustment), как и раньше — пересчёт задним числом
    // повредил бы среднюю при последующих закупках.
    const allIds = new Set<string>([...oldByItem.keys(), ...newByItem.keys()])
    for (const itemId of allIds) {
      const delta = (newByItem.get(itemId) ?? 0) - (oldByItem.get(itemId) ?? 0)
      if (delta === 0) continue
      await recordMovement(tx, {
        itemId, type: 'adjustment', delta, clamp: true,
        sourceType: 'supply', sourceId: id, reason: 'Корректировка закупки', userId: user.sub,
      })
    }

    await tx.update(supplies).set({ totalCost: String(totalCost), note: body.note ?? supply.note, updatedAt: new Date() }).where(eq(supplies.id, id))
    await syncRegisterPayment(tx, supply.cashOperationId, totalCost)

    // Фиксируем корректировку с причиной и суммами до/после (аудит закупки).
    await tx.insert(supplyCorrections).values({
      supplyId: id,
      reason: body.reason,
      totalBefore: String(supply.totalCost ?? '0'),
      totalAfter: String(totalCost),
      createdBy: user.sub,
    })

    return { ...supply, totalCost: String(totalCost) }
  })

  if (!result) return c.json({ error: 'Not found' }, 404)
  if (result === 'not_posted') return c.json({ error: 'Черновик не корректируют — правьте его и проведите' }, 409)
  return c.json({ supply: result })
})

// DELETE /supplies/:id — откат приёмки (только владелец). В транзакции:
// для каждой позиции с карточкой снимаем принятое количество с остатка
// (не уходя ниже 0) и пишем компенсирующее движение, затем удаляем приёмку
// (supply_items уходят каскадом). Известное ограничение: средневзвешенную
// себестоимость НЕ «разворачиваем» — costPrice остаётся как есть.
suppliesRouter.delete('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')

  const res = await db.transaction(async (tx) => {
    // FOR UPDATE на строке приёмки сериализует конкурентные удаления.
    const [supply] = await tx.select().from(supplies).where(eq(supplies.id, id)).for('update')
    if (!supply) return 'not_found' as const

    // Черновик — без движений/остатков, удалять может staff/owner.
    if (supply.status === 'draft') {
      await tx.delete(supplies).where(eq(supplies.id, id))
      return 'ok' as const
    }

    // Проведённая приёмка — только владелец, с откатом стока.
    if ((user as any).role !== 'owner') return 'forbidden' as const
    const lines = await tx.select().from(supplyItems).where(eq(supplyItems.supplyId, id))
    for (const line of lines) {
      if (!line.itemId) continue
      const qty = Math.round(Number(line.quantity))
      if (qty <= 0) continue
      // Компенсирующее движение (WAC не разворачиваем — известное ограничение).
      await recordMovement(tx, {
        itemId: line.itemId, type: 'adjustment', delta: -qty, clamp: true,
        sourceType: 'supply', sourceId: id, reason: `Откат закупки ${id}`, userId: user.sub,
      })
    }
    await syncRegisterPayment(tx, supply.cashOperationId, null)
    await tx.delete(supplies).where(eq(supplies.id, id))
    return 'ok' as const
  })

  if (res === 'not_found') return c.json({ error: 'Not found' }, 404)
  if (res === 'forbidden') return c.json({ error: 'Удалять проведённую закупку может только владелец' }, 403)
  return c.json({ ok: true })
})
