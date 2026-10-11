import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { alias } from 'drizzle-orm/pg-core'
import {
  inventory, recipeItems, stockMovements, supplies, supplyItems, checks, checkItems, profiles,
  eq, and, desc, gte, inArray, isNull, sql,
} from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { loadCatalog } from './catalog.js'
import { loadDocuments } from './documents.js'
import { GoodsError, ItemCreateSchema, ItemPatchSchema, deleteGoodsItem, saveGoodsItem } from './items.js'
import { writeOffsRouter } from './write-offs.router.js'

// Раздел «Товары» (миграция 070): меню, остатки и операции склада одним разделом.
// Остаток меняют только документы: приход (/supplies), списание (/goods/write-offs),
// ревизия (/inventory/revisions) и продажи кассы. Себестоимость считает склад.

export const goodsRouter = new Hono<AppEnv>()

// Себестоимость и маржа чувствительны — раздел только для персонала.
goodsRouter.use('*', requireAuth, requireRole('owner', 'staff'))

goodsRouter.route('/write-offs', writeOffsRouter)

goodsRouter.get('/', async (c) => c.json(await loadCatalog(c.var.db)))

goodsRouter.post('/items', zValidator('json', ItemCreateSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  try {
    const id = await db.transaction((tx) => saveGoodsItem(tx, null, body))
    return c.json({ id }, 201)
  } catch (err) {
    if (err instanceof GoodsError) return c.json({ error: err.message }, err.status)
    throw err
  }
})

goodsRouter.patch('/items/:id', zValidator('json', ItemPatchSchema), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const body = c.req.valid('json')
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(inventory).where(and(eq(inventory.id, id), isNull(inventory.deletedAt))).for('update')
      if (!existing) throw new GoodsError('Позиция не найдена', 404)
      await saveGoodsItem(tx, existing, body)
    })
    return c.json({ id })
  } catch (err) {
    if (err instanceof GoodsError) return c.json({ error: err.message }, err.status)
    throw err
  }
})

goodsRouter.delete('/items/:id', requireRole('owner'), async (c) => {
  const db = c.var.db
  try {
    await db.transaction((tx) => deleteGoodsItem(tx, c.req.param('id')))
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof GoodsError) return c.json({ error: err.message }, err.status)
    throw err
  }
})

const MSK_MS = 3 * 3600 * 1000
const DAY_MS = 86400000
const SERIES_DAYS = 30
const MOVEMENTS_LIMIT = 60

const mskDay = (d: Date) => new Date(d.getTime() + MSK_MS).toISOString().slice(0, 10)

/** Ряд из 30 дней по МСК (старые слева), пустые дни — нули. */
function daySeries(byDay: Map<string, number>) {
  const series: { date: string; qty: number }[] = []
  for (let i = SERIES_DAYS - 1; i >= 0; i--) {
    const key = mskDay(new Date(Date.now() - i * DAY_MS))
    series.push({ date: key, qty: byDay.get(key) ?? 0 })
  }
  return series
}

// Карточка позиции: журнал движений, продажи (или расход сырья) за 30 дней, последний
// приход, а у сырья — в составе каких позиций оно стоит.
goodsRouter.get('/items/:id/card', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [item] = await db.select({ id: inventory.id }).from(inventory).where(eq(inventory.id, id))
  if (!item) return c.json({ error: 'Позиция не найдена' }, 404)
  const since = new Date(Date.now() - SERIES_DAYS * DAY_MS)
  const soldItem = alias(inventory, 'sold_item')

  const [movements, lastSupply, usedIn, sales, usage] = await Promise.all([
    db.select({
      id: stockMovements.id,
      type: stockMovements.type,
      delta: stockMovements.delta,
      qtyAfter: stockMovements.qtyAfter,
      unitCost: stockMovements.unitCost,
      sourceType: stockMovements.sourceType,
      sourceId: stockMovements.sourceId,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
      author: profiles.nickname,
      soldItemName: soldItem.name,
    })
      .from(stockMovements)
      .leftJoin(profiles, eq(profiles.id, stockMovements.createdBy))
      .leftJoin(soldItem, eq(soldItem.id, stockMovements.soldItemId))
      .where(eq(stockMovements.itemId, id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(MOVEMENTS_LIMIT),
    db.select({ date: supplies.createdAt, supplier: supplies.supplier, supplyId: supplies.id, quantity: supplyItems.quantity, costPerUnit: supplyItems.costPerUnit })
      .from(supplyItems)
      .innerJoin(supplies, eq(supplies.id, supplyItems.supplyId))
      .where(and(eq(supplyItems.itemId, id), eq(supplies.status, 'posted')))
      .orderBy(desc(supplies.createdAt))
      .limit(1),
    db.select({ id: inventory.id, name: inventory.name, quantity: recipeItems.quantity })
      .from(recipeItems)
      .innerJoin(inventory, eq(inventory.id, recipeItems.productId))
      .where(and(eq(recipeItems.componentId, id), isNull(inventory.deletedAt))),
    // Продано порций позиции меню: закрытые чеки за 30 дней.
    db.select({ createdAt: checks.createdAt, quantity: checkItems.quantity, price: checkItems.priceAtTime })
      .from(checkItems)
      .innerJoin(checks, eq(checks.id, checkItems.checkId))
      .where(and(eq(checkItems.itemId, id), eq(checks.status, 'closed'), gte(checks.createdAt, since))),
    // Расход со склада: продажи минус возвраты (для сырья — по всем техкартам).
    db.select({ createdAt: stockMovements.createdAt, delta: stockMovements.delta })
      .from(stockMovements)
      .where(and(eq(stockMovements.itemId, id), inArray(stockMovements.type, ['sale', 'return']), gte(stockMovements.createdAt, since))),
  ])

  const soldByDay = new Map<string, number>()
  let soldQty = 0
  let revenue = 0
  for (const s of sales) {
    const q = Number(s.quantity) || 0
    soldQty += q
    revenue += q * (parseFloat(String(s.price)) || 0)
    const key = mskDay(new Date(s.createdAt as unknown as string))
    soldByDay.set(key, (soldByDay.get(key) ?? 0) + q)
  }
  const usedByDay = new Map<string, number>()
  let usedQty = 0
  for (const u of usage) {
    usedQty -= u.delta
    const key = mskDay(new Date(u.createdAt as unknown as string))
    usedByDay.set(key, (usedByDay.get(key) ?? 0) - u.delta)
  }

  const supply = lastSupply[0]
  return c.json({
    movements,
    sales: { qty: soldQty, revenue: Math.round(revenue * 100) / 100, series: daySeries(soldByDay) },
    usage: { qty: Math.max(0, usedQty), series: daySeries(usedByDay) },
    lastSupply: supply
      ? { date: supply.date, supplier: supply.supplier, supplyId: supply.supplyId, quantity: Number(supply.quantity), costPerUnit: Number(supply.costPerUnit) }
      : null,
    usedIn,
  })
})

// Лента операций склада: приходы, списания и ревизии одним списком, черновики тоже.
goodsRouter.get('/documents', async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 80))
  return c.json({ documents: await loadDocuments(c.var.db, limit) })
})

// Поставщики из прошлых приходов — подсказки в поле «Поставщик», частые сверху.
goodsRouter.get('/suppliers', async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      name: supplies.supplier,
      count: sql<number>`count(*)::int`,
      lastAt: sql<string>`to_char(max(${supplies.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
    })
    .from(supplies)
    .where(sql`coalesce(trim(${supplies.supplier}), '') <> ''`)
    .groupBy(supplies.supplier)
    .orderBy(desc(sql`max(${supplies.createdAt})`))
    .limit(30)
  return c.json({ suppliers: rows.map((r) => ({ name: r.name!, count: r.count, lastAt: r.lastAt })) })
})
