/**
 * Карточка поставки Tai в HUB: правки строк, оплата из кассы, «Принять», «Отменить».
 * Всё — от имени нажавшего (его токен), через те же маршруты прихода, что у экрана.
 */
import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../../../types.js'
import { createApiCaller, forwardedHeaders, InternalApiError } from './internal.js'
import { acceptSupply, cancelSupply, editSupply, supplyCard, type SupplyCtx, type SupplyOp } from './supply.js'
import { updateStoredBlock } from './history.js'
import type { TaiSupplyCard } from './blocks.js'

export const supplyRouter = new Hono<AppEnv>()

const ID = /^[0-9a-f-]{36}$/i
const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('quantity'), line: z.number().int().min(0), quantity: z.number().min(0) }),
  z.object({ op: z.literal('step'), line: z.number().int().min(0), direction: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ op: z.literal('price'), line: z.number().int().min(0), costPerUnit: z.number().min(0) }),
  z.object({ op: z.literal('remove'), line: z.number().int().min(0) }),
  z.object({ op: z.literal('match'), line: z.number().int().min(0), itemId: z.string().uuid() }),
  z.object({ op: z.literal('payment'), fromRegister: z.boolean() }),
  z.object({ op: z.literal('supplier'), supplier: z.string().max(120) }),
])

const ctxOf = (c: Context<AppEnv>): SupplyCtx => ({ db: c.var.db, api: createApiCaller(forwardedHeaders(c)), clubKey: c.var.club?.id ?? 'main' })
const failed = (c: Context<AppEnv>, error: unknown) =>
  c.json({ error: error instanceof Error ? error.message : 'Не получилось' }, error instanceof InternalApiError && error.status < 500 ? (error.status as 400) : 400)

/** Новое состояние карточки — и в историю чатов Tai, где она была показана. */
async function remember<T extends TaiSupplyCard | null>(c: Context<AppEnv>, id: string, card: T): Promise<T> {
  if (card) await updateStoredBlock(c.var.db, 'supply', id, card)
  return card
}

supplyRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Неверная поставка' }, 400)
  const card = await supplyCard(ctxOf(c), id)
  return card ? c.json({ supply: card }) : c.json({ error: 'Черновик не найден' }, 404)
})

supplyRouter.post('/:id/edit', zValidator('json', z.object({ ops: z.array(OpSchema).min(1).max(20) })), async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Неверная поставка' }, 400)
  try {
    return c.json({ supply: await remember(c, id, await editSupply(ctxOf(c), id, c.req.valid('json').ops as SupplyOp[])) })
  } catch (error) {
    return failed(c, error)
  }
})

supplyRouter.post('/:id/accept', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Неверная поставка' }, 400)
  try {
    return c.json({ supply: await remember(c, id, await acceptSupply(ctxOf(c), id)) })
  } catch (error) {
    return failed(c, error)
  }
})

supplyRouter.post('/:id/cancel', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Неверная поставка' }, 400)
  try {
    return c.json({ supply: await remember(c, id, await cancelSupply(ctxOf(c), id)) })
  } catch (error) {
    return failed(c, error)
  }
})
