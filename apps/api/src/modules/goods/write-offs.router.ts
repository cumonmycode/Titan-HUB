import type { AppEnv } from '../../types.js'
import type { Database } from '@titan/database'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { inventory, recipeItems, writeOffs, writeOffItems, profiles, eq, and, asc, isNull } from '@titan/database'
import { round2 } from '../../lib/money.js'
import { recordMovement, reverseMovements, round4 } from '../inventory/ledger.js'
import { GoodsError } from './items.js'

// Списание (бой, порча, угощение, истёк срок) — документом на несколько позиций.
// Позиция с техкартой списывает свой состав. Остаток ниже нуля не уходит: списать
// можно только то, что есть. Черновик хранит состав в draft_data, остатки не трогает.

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

const Line = z.object({ itemId: z.string().uuid(), quantity: z.number().int().positive().max(10_000_000) })
const Reason = z.string().trim().min(1, 'Укажите причину списания').max(80)
const Note = z.string().trim().max(500).optional()

const PostSchema = z.object({
  idempotencyKey: z.string().min(1).max(80),
  reason: Reason,
  note: Note,
  items: z.array(Line).min(1).max(200),
})
const ApplySchema = PostSchema.omit({ idempotencyKey: true })
const DraftSchema = z.object({
  id: z.string().uuid().optional(),
  reason: z.string().trim().max(80).optional(),
  note: Note,
  items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().int().min(0).max(10_000_000) })).max(200),
})

function assertUnique(items: { itemId: string }[]) {
  if (new Set(items.map((i) => i.itemId)).size !== items.length) throw new GoodsError('Позиция повторяется в списании')
}

/**
 * Провести строки списания документа docId: движения write_off и строки документа.
 * Возвращает сумму по себестоимости. Строки, по которым списать нечего (на складе 0),
 * пропускаются; если пусто всё — GoodsError.
 */
async function postLines(tx: Tx, docId: string, lines: { itemId: string; quantity: number }[], reason: string, userId: string): Promise<number> {
  let total = 0
  let order = 0
  for (const line of lines) {
    const [item] = await tx.select().from(inventory).where(and(eq(inventory.id, line.itemId), isNull(inventory.deletedAt)))
    if (!item) throw new GoodsError('Позиция не найдена — обновите список', 404)
    const components = await tx
      .select({ componentId: recipeItems.componentId, quantity: recipeItems.quantity })
      .from(recipeItems)
      .where(eq(recipeItems.productId, line.itemId))
      .orderBy(asc(recipeItems.componentId))
    const moves = components.length
      ? components.map((c) => ({ itemId: c.componentId, qty: line.quantity * c.quantity, soldItemId: line.itemId }))
      : [{ itemId: line.itemId, qty: line.quantity, soldItemId: null }]

    let cost = 0
    let appliedAny = false
    let appliedQty = line.quantity
    for (const move of moves) {
      const res = await recordMovement(tx, {
        itemId: move.itemId, type: 'write_off', delta: -move.qty, clamp: true,
        soldItemId: move.soldItemId, sourceType: 'write_off', sourceId: docId, reason, userId,
      })
      if (res.applied !== 0) appliedAny = true
      cost += -res.applied * res.avgCost
      // Штучный товар: в документ пишем, сколько реально списалось (не больше остатка).
      if (!components.length) appliedQty = -res.applied
    }
    if (!appliedAny || appliedQty <= 0) continue
    total += cost
    await tx.insert(writeOffItems).values({
      writeOffId: docId, itemId: line.itemId, name: item.name, quantity: appliedQty,
      unitCost: String(round4(cost / appliedQty)), sortOrder: order++,
    })
  }
  if (order === 0) throw new GoodsError('Списывать нечего — этих позиций нет на складе', 409)
  return round2(total)
}

export const writeOffsRouter = new Hono<AppEnv>()

writeOffsRouter.get('/:id', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const [doc] = await db
    .select({ writeOff: writeOffs, author: profiles.nickname })
    .from(writeOffs)
    .leftJoin(profiles, eq(profiles.id, writeOffs.createdBy))
    .where(eq(writeOffs.id, id))
  if (!doc) return c.json({ error: 'Списание не найдено' }, 404)
  // Единица — из карточки: позиция могла быть удалена, а «120» без «мл» ничего не значит.
  const rows = await db
    .select({ line: writeOffItems, unit: inventory.unit })
    .from(writeOffItems)
    .leftJoin(inventory, eq(inventory.id, writeOffItems.itemId))
    .where(eq(writeOffItems.writeOffId, id))
    .orderBy(asc(writeOffItems.sortOrder))
  return c.json({ writeOff: { ...doc.writeOff, author: doc.author }, items: rows.map((r) => ({ ...r.line, unit: r.unit ?? 'pcs' })) })
})

writeOffsRouter.post('/', zValidator('json', PostSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  try {
    assertUnique(body.items)
    const doc = await db.transaction(async (tx) => {
      const [row] = await tx.insert(writeOffs)
        .values({ idempotencyKey: body.idempotencyKey, status: 'posted', reason: body.reason, note: body.note ?? null, createdBy: user.sub })
        .onConflictDoNothing({ target: writeOffs.idempotencyKey })
        .returning()
      // Повтор того же запроса (двойное нажатие, сетевой ретрай) — документ уже есть.
      if (!row) return null
      const total = await postLines(tx, row.id, body.items, body.reason, user.sub)
      await tx.update(writeOffs).set({ totalCost: String(total) }).where(eq(writeOffs.id, row.id))
      return { ...row, totalCost: String(total) }
    })
    if (!doc) {
      const [existing] = await db.select().from(writeOffs).where(eq(writeOffs.idempotencyKey, body.idempotencyKey))
      return c.json({ writeOff: existing, duplicate: true })
    }
    return c.json({ writeOff: doc }, 201)
  } catch (err) {
    if (err instanceof GoodsError) return c.json({ error: err.message }, err.status)
    throw err
  }
})

writeOffsRouter.post('/draft', zValidator('json', DraftSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { id, reason, note, items } = c.req.valid('json')
  const draftData = { reason, note, items }
  if (id) {
    const [row] = await db.update(writeOffs)
      .set({ draftData, reason: reason ?? '', note: note ?? null, updatedAt: new Date() })
      .where(and(eq(writeOffs.id, id), eq(writeOffs.status, 'draft')))
      .returning({ id: writeOffs.id })
    if (!row) return c.json({ error: 'Черновик не найден' }, 404)
    return c.json({ id: row.id })
  }
  const [row] = await db.insert(writeOffs)
    .values({ status: 'draft', draftData, reason: reason ?? '', note: note ?? null, createdBy: user.sub, updatedAt: new Date() })
    .returning({ id: writeOffs.id })
  return c.json({ id: row!.id }, 201)
})

writeOffsRouter.post('/:id/apply', zValidator('json', ApplySchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const body = c.req.valid('json')
  try {
    assertUnique(body.items)
    const res = await db.transaction(async (tx) => {
      const [doc] = await tx.select().from(writeOffs).where(eq(writeOffs.id, id)).for('update')
      if (!doc) return 'not_found' as const
      if (doc.status !== 'draft') return 'not_draft' as const
      const total = await postLines(tx, id, body.items, body.reason, user.sub)
      await tx.update(writeOffs)
        .set({ status: 'posted', draftData: null, reason: body.reason, note: body.note ?? null, totalCost: String(total), createdAt: new Date(), updatedAt: new Date() })
        .where(eq(writeOffs.id, id))
      return 'ok' as const
    })
    if (res === 'not_found') return c.json({ error: 'Черновик не найден' }, 404)
    if (res === 'not_draft') return c.json({ error: 'Списание уже проведено' }, 409)
    return c.json({ writeOff: { id } })
  } catch (err) {
    if (err instanceof GoodsError) return c.json({ error: err.message }, err.status)
    throw err
  }
})

// Черновик удаляет любой сотрудник; проведённое — только владелец, с возвратом на склад.
writeOffsRouter.delete('/:id', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const res = await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(writeOffs).where(eq(writeOffs.id, id)).for('update')
    if (!doc) return 'not_found' as const
    if (doc.status === 'posted') {
      if ((user as { role?: string }).role !== 'owner') return 'forbidden' as const
      await reverseMovements(tx, { sourceType: 'write_off', sourceId: id, type: 'adjustment', reason: 'Отмена списания', userId: user.sub })
    }
    await tx.delete(writeOffs).where(eq(writeOffs.id, id))
    return 'ok' as const
  })
  if (res === 'not_found') return c.json({ error: 'Списание не найдено' }, 404)
  if (res === 'forbidden') return c.json({ error: 'Отменить проведённое списание может только владелец' }, 403)
  return c.json({ ok: true })
})
