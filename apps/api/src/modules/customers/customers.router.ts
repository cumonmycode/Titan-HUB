import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { customers, eq, sql } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'

const CustomerSchema = z.object({
  name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
})

export const customersRouter = new Hono<AppEnv>()
customersRouter.use('*', requireAuth)

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[]
}

// Заказчик ↔ мероприятия — по телефону: последние 10 цифр (8 900… и +7 900… — один номер).
const phoneKey = (column: ReturnType<typeof sql.raw>) => sql`right(regexp_replace(coalesce(${column}, ''), '\\D', '', 'g'), 10)`
const MATCH = sql`length(${phoneKey(sql.raw('c.phone'))}) >= 7 and ${phoneKey(sql.raw('e.customer_phone'))} = ${phoneKey(sql.raw('c.phone'))}`

// Список / поиск заказчиков. ?q= — по имени или телефону (для автоподбора). К каждому —
// сколько у него было мероприятий (без отменённых), когда последнее и на какую сумму.
customersRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const q = c.req.query('q')?.trim()
  const like = `%${q ?? ''}%`
  const res = await db.execute(sql`
    SELECT c.id, c.name, c.phone, c.created_at AS "createdAt",
           coalesce(s.events, 0)::int AS events, s.last_date AS "lastDate", coalesce(s.total, 0)::float AS total
    FROM customers c
    LEFT JOIN LATERAL (
      SELECT count(*) AS events, max(e.date) AS last_date, sum(ch.total_amount) AS total
      FROM events e LEFT JOIN checks ch ON ch.id = e.check_id
      WHERE e.status <> 'cancelled' AND ${MATCH}
    ) s ON true
    ${q ? sql`WHERE c.name ILIKE ${like} OR c.phone ILIKE ${like}` : sql``}
    ORDER BY greatest(s.last_date, to_char(c.created_at, 'YYYY-MM-DD')) DESC NULLS LAST, c.created_at DESC
    LIMIT ${q ? 8 : 200}
  `)
  return c.json({ customers: rows(res) })
})

// Карточка заказчика: контакт и его мероприятия (свежие сверху), с суммой чека.
customersRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: 'Not found' }, 404)
  const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
  if (!customer) return c.json({ error: 'Not found' }, 404)
  const res = await db.execute(sql`
    SELECT e.id, e.title, e.date, e.start_time AS "startTime", e.status, e.type, e.format,
           ch.total_amount::float AS total
    FROM customers c
    JOIN events e ON ${MATCH}
    LEFT JOIN checks ch ON ch.id = e.check_id
    WHERE c.id = ${id}
    ORDER BY e.date DESC, e.start_time DESC
    LIMIT 50
  `)
  return c.json({ customer, events: rows(res) })
})

customersRouter.post('/', requireRole('owner', 'staff'), zValidator('json', CustomerSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [row] = await db.insert(customers).values({ name: body.name ?? null, phone: body.phone ?? null }).returning()
  return c.json({ customer: row }, 201)
})

customersRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', CustomerSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const update: Record<string, any> = {}
  if (body.name !== undefined) update.name = body.name
  if (body.phone !== undefined) update.phone = body.phone
  const [row] = await db.update(customers).set(update).where(eq(customers.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ customer: row })
})

customersRouter.delete('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  await db.delete(customers).where(eq(customers.id, c.req.param('id')))
  return c.json({ ok: true })
})
