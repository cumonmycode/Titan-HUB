import type { AppEnv } from '../../types.js'
import type { Database } from '@titan/database'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { inventory, stockMovements, supplies, supplyItems, checks, checkItems, revisions, revisionItems, profiles, eq, ne, asc, isNull, and, gte, lte, desc, sum, inArray, sql } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { recordMovement } from './ledger.js'

export const inventoryRouter = new Hono<AppEnv>()

// Себестоимость/маржа чувствительны — весь склад только для owner/staff.
inventoryRouter.use('*', requireAuth, requireRole('owner', 'staff'))

// GET /api/inventory — управление остатками. Возвращает активные И неактивные
// позиции (исключая только мягко удалённые deletedAt != null): скрытая из меню
// позиция всё ещё нуждается в учёте остатков/ревизии. Порядок — как в меню
// (sortOrder, затем имя). Эндпоинт за requireAuth (только персонал), поэтому
// costPrice здесь допустим. Сырьё (070) прежние клиенты показали бы штуками —
// оно живёт в разделе «Товары» (/api/goods), здесь только позиции меню.
inventoryRouter.get('/', async (c) => {
  const db = c.var.db
  const rows = await db
    .select()
    .from(inventory)
    .where(and(isNull(inventory.deletedAt), eq(inventory.kind, 'goods')))
    .orderBy(asc(inventory.sortOrder), asc(inventory.name))
  return c.json({ items: rows })
})

// ─── Ревизии (история инвентаризаций) ────────────────────────────────────────
// Регистрируются ДО '/:id/stats', чтобы '/revisions/...' не перехватывался.

// GET /api/inventory/revisions — список ревизий, новые сверху, со сводкой.
inventoryRouter.get('/revisions', async (c) => {
  const db = c.var.db
  const rows = await db.select().from(revisions).orderBy(desc(revisions.createdAt)).limit(100)
  const ids = rows.map(r => r.id)
  const items = ids.length
    ? await db.select().from(revisionItems).where(inArray(revisionItems.revisionId, ids))
    : []
  const authorIds = [...new Set(rows.map(r => r.createdBy).filter((x): x is string => !!x))]
  const authors = authorIds.length
    ? await db.select({ id: profiles.id, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.id, authorIds))
    : []
  const authorOf = new Map(authors.map(a => [a.id, a.nickname]))

  const list = rows.map(r => {
    let positions = 0, surplusValue = 0, shortageValue = 0
    if (r.status === 'draft') {
      // У черновика нет revision_items — состав в draft_data (расхождения не считаем).
      positions = r.draftData?.items?.length ?? 0
    } else {
      for (const it of items) {
        if (it.revisionId !== r.id) continue
        positions++
        const diff = it.actual - it.expected
        const cost = parseFloat(String(it.costPrice)) || 0
        if (diff > 0) surplusValue += diff * cost
        else if (diff < 0) shortageValue += -diff * cost
      }
    }
    return {
      id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, status: r.status,
      author: r.createdBy ? authorOf.get(r.createdBy) ?? null : null,
      positions, surplusValue, shortageValue,
    }
  })
  return c.json({ revisions: list })
})

// POST /api/inventory/revisions/draft — сохранить/обновить ЧЕРНОВИК ревизии.
// Рабочее состояние (позиции + введённые факты) кладём в draft_data; остатки и
// revision_items НЕ трогаем. Регистрируется ДО '/revisions/:id'. Возврат { id }.
inventoryRouter.post(
  '/revisions/draft',
  requireRole('owner', 'staff'),
  zValidator('json', z.object({
    id: z.string().uuid().optional(),
    items: z.array(z.object({
      itemId: z.string().uuid(),
      actual: z.number().int().min(0).nullable(),
    })).max(500),
  })),
  async (c) => {
    const db = c.var.db
    const { id, items } = c.req.valid('json')
    const user = c.get('user')
    const draftData = { items }
    if (id) {
      // Обновляем только если это всё ещё черновик (проведённую не трогаем).
      const [row] = await db.update(revisions)
        .set({ draftData, updatedAt: new Date() })
        .where(and(eq(revisions.id, id), eq(revisions.status, 'draft')))
        .returning({ id: revisions.id })
      if (!row) return c.json({ error: 'Черновик не найден' }, 404)
      return c.json({ id: row.id })
    }
    const [row] = await db.insert(revisions)
      .values({ status: 'draft', draftData, createdBy: user.sub })
      .returning({ id: revisions.id })
    return c.json({ id: row.id }, 201)
  }
)

/**
 * Условие «ревизия новее данной». Сравниваем в SQL: created_at хранится с микросекундами,
 * а Date из драйвера — с миллисекундами, и ревизия выходила «новее самой себя» — последнюю
 * нельзя было поправить ни в приложении, ни в вебе. Считаются только проведённые:
 * незаконченный черновик не мешает поправить последнюю ревизию.
 */
const newerThan = (revisionId: string) =>
  and(
    ne(revisions.id, revisionId),
    eq(revisions.status, 'applied'),
    sql`${revisions.createdAt} > (select r.created_at from revisions r where r.id = ${revisionId})`,
  )

// GET /api/inventory/revisions/:id — детали ревизии с позициями (в порядке добавления).
inventoryRouter.get('/revisions/:id', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [rev] = await db.select().from(revisions).where(eq(revisions.id, id))
  if (!rev) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select({ line: revisionItems, unit: inventory.unit })
    .from(revisionItems)
    .leftJoin(inventory, eq(inventory.id, revisionItems.itemId))
    .where(eq(revisionItems.revisionId, id))
    .orderBy(asc(revisionItems.sortOrder))
  // Единица учёта строки (шт/г/мл) — для сырья (070); прежние клиенты поле не читают.
  const items = rows.map((r) => ({ ...r.line, unit: r.unit ?? 'pcs' }))
  let author: string | null = null
  if (rev.createdBy) {
    const [a] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, rev.createdBy))
    author = a?.nickname ?? null
  }
  // Корректировать можно только ПОСЛЕДНЮЮ ревизию: более новая уже зафиксировала
  // свои expected от текущих остатков — правка старой перемешала бы динамику.
  const [newer] = await db.select({ id: revisions.id }).from(revisions).where(newerThan(rev.id)).limit(1)
  return c.json({ revision: { ...rev, author, isLatest: !newer }, items })
})

const ApplyItemsSchema = z.array(z.object({
  itemId: z.string().uuid(),
  actual: z.number().int().min(0),
})).min(1).max(500)

// Применить позиции к ревизии revId: на каждую — снапшот expected (FOR UPDATE),
// движение count через ledger, запись revision_items. Используется при проведении
// свежей ревизии и при применении черновика.
async function applyRevisionItems(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  revId: string,
  items: { itemId: string; actual: number }[],
  userId: string,
) {
  for (let i = 0; i < items.length; i++) {
    const { itemId, actual } = items[i]
    const [item] = await tx.select().from(inventory).where(and(eq(inventory.id, itemId), isNull(inventory.deletedAt))).for('update')
    if (!item) throw new Error(`item ${itemId} not found`)
    const expected = item.stockQuantity ?? 0
    await recordMovement(tx, {
      itemId, type: 'count', delta: actual - expected,
      sourceType: 'revision', sourceId: revId, reason: 'Ревизия', userId,
    })
    await tx.insert(revisionItems).values({
      revisionId: revId, itemId, name: item.name,
      expected, actual,
      costPrice: String(parseFloat(String(item.costPrice ?? 0)) || 0),
      sortOrder: i,
    })
  }
}

function firstDuplicate(items: { itemId: string }[]): boolean {
  const seen = new Set<string>()
  for (const it of items) { if (seen.has(it.itemId)) return true; seen.add(it.itemId) }
  return false
}

// POST /api/inventory/revisions — провести новую ревизию (create + apply), статус applied.
inventoryRouter.post('/revisions', zValidator('json', z.object({ items: ApplyItemsSchema })), async (c) => {
  const db = c.var.db
  const { items } = c.req.valid('json')
  const user = c.get('user')
  if (firstDuplicate(items)) return c.json({ error: 'Дублирующаяся позиция в ревизии' }, 400)
  const result = await db.transaction(async (tx) => {
    const [rev] = await tx.insert(revisions).values({ status: 'applied', createdBy: user.sub }).returning()
    await applyRevisionItems(tx, rev.id, items, user.sub)
    return rev
  })
  return c.json({ revision: result }, 201)
})

// POST /api/inventory/revisions/:id/apply — применить ЧЕРНОВИК ревизии (draft → applied).
// Snapshot expected берётся СЕЙЧАС (на момент применения), а не на момент сохранения черновика.
inventoryRouter.post('/revisions/:id/apply', requireRole('owner', 'staff'),
  zValidator('json', z.object({ items: ApplyItemsSchema })), async (c) => {
    const db = c.var.db
    const revId = c.req.param('id')
    const { items } = c.req.valid('json')
    const user = c.get('user')
    if (firstDuplicate(items)) return c.json({ error: 'Дублирующаяся позиция в ревизии' }, 400)
    const res = await db.transaction(async (tx) => {
      const [rev] = await tx.select().from(revisions).where(eq(revisions.id, revId)).for('update')
      if (!rev) return 'not_found' as const
      if (rev.status !== 'draft') return 'not_draft' as const
      await applyRevisionItems(tx, revId, items, user.sub)
      // Дата ревизии — момент проведения, а не создания черновика (как у прихода и
      // списания): иначе поздно проведённый черновик не считался бы последней ревизией.
      await tx.update(revisions).set({ status: 'applied', draftData: null, createdAt: new Date(), updatedAt: new Date() }).where(eq(revisions.id, revId))
      return 'ok' as const
    })
    if (res === 'not_found') return c.json({ error: 'Not found' }, 404)
    if (res === 'not_draft') return c.json({ error: 'Ревизия уже проведена' }, 409)
    return c.json({ revision: { id: revId } })
  })

// DELETE /api/inventory/revisions/:id — удалить ЧЕРНОВИК (проведённую удалять нельзя).
inventoryRouter.delete('/revisions/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [row] = await db.delete(revisions)
    .where(and(eq(revisions.id, id), eq(revisions.status, 'draft')))
    .returning({ id: revisions.id })
  if (!row) return c.json({ error: 'Черновик не найден' }, 404)
  return c.json({ ok: true })
})

// PATCH /api/inventory/revisions/:id — корректировка проведённой ревизии.
// НЕ перезаписывает остаток: применяет к ТЕКУЩЕМУ остатку дельту между новым и
// старым фактом (движения после ревизии сохраняются). Снапшот expected не трогаем —
// динамика «ожидалось/факт на момент ревизии» остаётся честной.
inventoryRouter.patch(
  '/revisions/:id',
  requireRole('owner', 'staff'),
  zValidator('json', z.object({
    items: z.array(z.object({
      id: z.string().uuid(),          // id строки ревизии (revision_items.id)
      actual: z.number().int().min(0),
    })).min(1).max(500),
  })),
  async (c) => {
    const db = c.var.db
    const revId = c.req.param('id')
    const { items } = c.req.valid('json')
    const user = c.get('user')

    const applied = await db.transaction(async (tx) => {
      const [rev] = await tx.select().from(revisions).where(eq(revisions.id, revId)).for('update')
      if (!rev) return null
      // Жёсткий гард: правки разрешены только у последней ревизии (проверяем
      // внутри транзакции — параллельно созданная новая ревизия тоже учтётся).
      const [newer] = await tx.select({ id: revisions.id }).from(revisions).where(newerThan(rev.id)).limit(1)
      if (newer) return 'not_latest' as const
      const changes: { name: string; from: number; to: number; stockDelta: number }[] = []
      for (const ch of items) {
        const [ri] = await tx.select().from(revisionItems).where(and(eq(revisionItems.id, ch.id), eq(revisionItems.revisionId, revId))).for('update')
        if (!ri) throw new Error(`revision item ${ch.id} not found`)
        const deltaChange = ch.actual - ri.actual
        if (deltaChange === 0) continue
        // Корректируем ТЕКУЩИЙ остаток на дельту правки (ниже нуля не уходим);
        // фактический сдвиг фиксируется движением count со ссылкой на ревизию.
        const res = await recordMovement(tx, {
          itemId: ri.itemId, type: 'count', delta: deltaChange, clamp: true,
          sourceType: 'revision', sourceId: revId, reason: 'Корректировка ревизии', userId: user.sub,
        })
        if (!res.ok) throw new Error(`inventory ${ri.itemId} not found`)
        await tx.update(revisionItems).set({ actual: ch.actual }).where(eq(revisionItems.id, ri.id))
        changes.push({ name: ri.name, from: ri.actual, to: ch.actual, stockDelta: res.applied })
      }
      if (changes.length) await tx.update(revisions).set({ updatedAt: new Date() }).where(eq(revisions.id, revId))
      return changes
    })

    if (applied === null) return c.json({ error: 'Not found' }, 404)
    if (applied === 'not_latest') return c.json({ error: 'Корректировать можно только последнюю ревизию' }, 409)
    return c.json({ changes: applied })
  }
)

// GET /api/inventory/overview — KPI дашборда склада. Регистрируется ДО '/:id/stats'.
// Стоимость склада по себестоимости, дефицит (≤ точки заказа), нет в наличии,
// «мёртвый» сток (нет продаж и прихода > 180 дней), даты последней поставки/ревизии.
inventoryRouter.get('/overview', async (c) => {
  const db = c.var.db
  const agg: any = await db.execute(sql`
    SELECT
      COALESCE(SUM(stock_quantity * cost_price), 0)::float8 AS stock_value,
      COUNT(*) FILTER (WHERE stock_quantity <= 0) AS out_count,
      COUNT(*) FILTER (
        WHERE stock_quantity > 0
          AND COALESCE(reorder_point, min_threshold, 0) > 0
          AND stock_quantity <= COALESCE(reorder_point, min_threshold, 0)
      ) AS low_count,
      COUNT(*) AS tracked_count
    FROM inventory
    WHERE track_stock = true AND deleted_at IS NULL
  `)
  const dead: any = await db.execute(sql`
    SELECT COUNT(*) AS dead_count FROM inventory i
    WHERE i.track_stock = true AND i.deleted_at IS NULL AND i.stock_quantity > 0
      AND NOT EXISTS (
        SELECT 1 FROM stock_movements m
        WHERE m.item_id = i.id AND m.type IN ('sale','receipt')
          AND m.created_at > now() - interval '180 days'
      )
  `)
  const last: any = await db.execute(sql`
    SELECT (SELECT max(created_at) FROM supplies)  AS last_supply,
           (SELECT max(created_at) FROM revisions) AS last_revision
  `)
  const a = (agg.rows ?? agg)[0] ?? {}
  const d = (dead.rows ?? dead)[0] ?? {}
  const l = (last.rows ?? last)[0] ?? {}
  return c.json({
    stockValue: Math.round((Number(a.stock_value) || 0) * 100) / 100,
    lowStockCount: Number(a.low_count) || 0,
    outOfStockCount: Number(a.out_count) || 0,
    deadStockCount: Number(d.dead_count) || 0,
    trackedCount: Number(a.tracked_count) || 0,
    lastSupplyAt: l.last_supply ?? null,
    lastRevisionAt: l.last_revision ?? null,
  })
})

// GET /api/inventory/:id/stats — карточка позиции: остаток, последняя закупка,
// продажи по дням за 30 дней (закрытые чеки, валовое количество) + агрегаты.
// Бакетим по календарю МСК (UTC+3). Идёт ДО PATCH/:id по методу — конфликта нет.
inventoryRouter.get('/:id/stats', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [item] = await db.select().from(inventory).where(eq(inventory.id, id))
  if (!item) return c.json({ error: 'Not found' }, 404)

  const [lastSup] = await db
    .select({ date: supplies.createdAt, quantity: supplyItems.quantity, costPerUnit: supplyItems.costPerUnit })
    .from(supplyItems)
    .innerJoin(supplies, eq(supplies.id, supplyItems.supplyId))
    .where(eq(supplyItems.itemId, id))
    .orderBy(desc(supplies.createdAt))
    .limit(1)

  const since = new Date(Date.now() - 30 * 86400000)
  const rows = await db
    .select({ createdAt: checks.createdAt, quantity: checkItems.quantity, price: checkItems.priceAtTime })
    .from(checkItems)
    .innerJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(eq(checkItems.itemId, id), eq(checks.status, 'closed'), gte(checks.createdAt, since)))

  const MSK = 3 * 3600 * 1000
  const dayKey = (d: Date) => new Date(d.getTime() + MSK).toISOString().split('T')[0]
  const byDay = new Map<string, number>()
  let totalQty = 0, totalRevenue = 0
  for (const r of rows) {
    const q = Number(r.quantity) || 0
    totalQty += q
    totalRevenue += q * (parseFloat(String(r.price)) || 0)
    const k = dayKey(new Date(r.createdAt as unknown as string))
    byDay.set(k, (byDay.get(k) ?? 0) + q)
  }
  const series: { date: string; qty: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const k = new Date(Date.now() + MSK - i * 86400000).toISOString().split('T')[0]
    series.push({ date: k, qty: byDay.get(k) ?? 0 })
  }

  const [allTime] = await db
    .select({ qty: sum(checkItems.quantity) })
    .from(checkItems)
    .innerJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(eq(checkItems.itemId, id), eq(checks.status, 'closed')))

  const costPrice = parseFloat(String(item.costPrice ?? 0)) || 0
  const price = parseFloat(String(item.price ?? 0)) || 0
  const avgDaily = totalQty / 30
  return c.json({
    item: {
      id: item.id, name: item.name, stockQuantity: item.stockQuantity ?? 0,
      costPrice, price, minThreshold: item.minThreshold ?? 0, trackStock: item.trackStock,
    },
    lastSupply: lastSup ? { date: lastSup.date, quantity: Number(lastSup.quantity), costPerUnit: Number(lastSup.costPerUnit) } : null,
    sales: {
      totalQty, totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgDaily, allTimeQty: Number(allTime?.qty ?? 0), series,
    },
  })
})

// GET /api/inventory/:id/movements — лента движений товара (журнал ledger) для карточки.
inventoryRouter.get('/:id/movements', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      delta: stockMovements.delta,
      qtyAfter: stockMovements.qtyAfter,
      unitCost: stockMovements.unitCost,
      sourceType: stockMovements.sourceType,
      sourceId: stockMovements.sourceId,
      reason: stockMovements.reason,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      author: profiles.nickname,
    })
    .from(stockMovements)
    .leftJoin(profiles, eq(profiles.id, stockMovements.createdBy))
    .where(eq(stockMovements.itemId, id))
    .orderBy(desc(stockMovements.createdAt))
    .limit(100)
  return c.json({ movements: rows })
})

// POST /api/inventory/:id/write-off — списание (бой/порча/угощение). Отдельный тип
// write_off ради аналитики потерь; обязательна причина. Остаток ниже нуля не уходит.
inventoryRouter.post(
  '/:id/write-off',
  requireRole('owner', 'staff'),
  zValidator('json', z.object({
    quantity: z.number().int().positive(),
    reason: z.string().trim().min(1, 'Укажите причину списания'),
    note: z.string().optional(),
  })),
  async (c) => {
    const db = c.var.db
    const id = c.req.param('id')
    const { quantity, reason, note } = c.req.valid('json')
    const user = c.get('user')
    const res = await db.transaction(async (tx) =>
      recordMovement(tx, {
        itemId: id, type: 'write_off', delta: -quantity, clamp: true,
        sourceType: 'manual', reason, note: note ?? null, userId: user.sub,
      }),
    )
    if (!res.ok) return c.json({ error: 'Not found' }, 404)
    return c.json({ qtyAfter: res.qtyAfter, applied: res.applied })
  }
)

// PATCH /api/inventory/:id — изменение остатка/порога/параметров пополнения.
// adjustDelta — атомарная корректировка (для кнопок +/−, без гонок);
// stockQuantity — установка абсолютного значения (дельта считается от текущего).
// Изменение остатка проходит через ledger (type=adjustment); поля пополнения
// (minThreshold/reorderPoint/parLevel/trackStock) обновляются напрямую.
inventoryRouter.patch(
  '/:id',
  requireRole('owner', 'staff'),
  zValidator('json', z.object({
    stockQuantity: z.number().int().min(0).optional(),
    adjustDelta: z.number().int().optional(),
    minThreshold: z.number().int().min(0).optional(),
    reorderPoint: z.number().int().min(0).nullable().optional(),
    parLevel: z.number().int().min(0).nullable().optional(),
    trackStock: z.boolean().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
  })),
  async (c) => {
    const db = c.var.db
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const user = c.get('user')
    const reason = body.reason ?? body.note ?? null

    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventory).where(eq(inventory.id, id)).for('update')
      if (!item) return null

      // 1. Изменение остатка — через ledger (adjustment).
      if (body.adjustDelta !== undefined && body.adjustDelta !== 0) {
        await recordMovement(tx, {
          itemId: id, type: 'adjustment', delta: body.adjustDelta, clamp: true,
          sourceType: 'manual', reason, userId: user.sub,
        })
      } else if (body.stockQuantity !== undefined) {
        await recordMovement(tx, {
          itemId: id, type: 'adjustment', delta: body.stockQuantity - (item.stockQuantity ?? 0), clamp: true,
          sourceType: 'manual', reason, userId: user.sub,
        })
      }

      // 2. Поля пополнения — прямой апдейт (не движения склада).
      const fields: Record<string, unknown> = {}
      if (body.minThreshold !== undefined) fields.minThreshold = body.minThreshold
      if (body.reorderPoint !== undefined) fields.reorderPoint = body.reorderPoint
      if (body.parLevel !== undefined) fields.parLevel = body.parLevel
      if (body.trackStock !== undefined) fields.trackStock = body.trackStock
      if (Object.keys(fields).length > 0) {
        fields.updatedAt = new Date()
        await tx.update(inventory).set(fields).where(eq(inventory.id, id))
      }

      const [row] = await tx.select().from(inventory).where(eq(inventory.id, id))
      return row
    })

    if (!result) return c.json({ error: 'Not found' }, 404)
    return c.json({ item: result })
  }
)
