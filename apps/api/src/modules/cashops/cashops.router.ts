import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { cashOperations, shifts, checkPayments, checks, profiles, eq, and, desc, sum, sql } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { getCurrentShift, getShiftCashBalance } from '../shifts/shifts.service.js'

export const cashopsRouter = new Hono<AppEnv>()
// Остаток/операции кассы — только owner/staff.
cashopsRouter.use('*', requireAuth, requireRole('owner', 'staff'))

// GET /cashops — list operations for current shift + balance summary
cashopsRouter.get('/', async (c) => {
  const db = c.var.db
  const shift = await getCurrentShift(db)
  const operations = await db.select({
    id: cashOperations.id,
    type: cashOperations.type,
    amount: cashOperations.amount,
    description: cashOperations.description,
    createdAt: cashOperations.createdAt,
    createdBy: profiles.nickname,
  })
    .from(cashOperations)
    .leftJoin(profiles, eq(profiles.id, cashOperations.createdBy))
    .where(shift ? eq(cashOperations.shiftId, shift.id) : sql`1=0`)
    .orderBy(desc(cashOperations.createdAt))

  // Единый расчёт остатка кассы (та же логика, что у смены и закрытия смены):
  // начало + наличные платежи + внесения − изъятия − зарплаты − возвраты наличными.
  // Раньше здесь НЕ вычитались наличные возвраты — из-за чего «В кассе сейчас» в
  // инкассации расходилось с суммой при закрытии смены.
  const balance = shift
    ? await getShiftCashBalance(shift.id, db)
    : { cashStart: 0, cashPayments: 0, deposits: 0, withdrawals: 0, salaries: 0, expected: 0 }

  return c.json({ operations, balance })
})

// POST /cashops — create operation
cashopsRouter.post('/', requireRole('owner', 'staff'), zValidator('json', z.object({
  type: z.enum(['deposit', 'withdrawal', 'salary']),
  amount: z.number().positive(),
  description: z.string().optional(),
  idempotencyKey: z.string().max(80).optional(),
})), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { type, amount, description, idempotencyKey } = c.req.valid('json')
  const shift = await getCurrentShift(db)
  // Операции с кассой пишутся только в открытую смену — иначе они не попадут
  // в сверку (shiftId=null) и «потеряются» из ожидаемого остатка.
  if (!shift) return c.json({ error: 'Нет открытой смены' }, 400)

  // Изъятия (withdrawal/salary) не должны опускать кассу ниже нуля. Проверку
  // доступной наличности и саму вставку делаем в ОДНОЙ транзакции под advisory-lock
  // по смене — иначе два параллельных изъятия оба прочитают старый остаток и оба
  // пройдут проверку (READ COMMITTED), уведя кассу в минус и замаскировав недостачу.
  // (Внесение deposit баланс только увеличивает — для него блокировка не нужна,
  //  но идём общим путём ради единообразия.)
  type Outcome =
    | { kind: 'ok'; op: typeof cashOperations.$inferSelect }
    | { kind: 'duplicate'; op: typeof cashOperations.$inferSelect }
    | { kind: 'insufficient'; available: number; requested: number }
    | { kind: 'closed' }
    | { kind: 'failed' }

  const result: Outcome = await db.transaction(async (tx) => {
    // Сериализуем конкурентные операции по этой смене: advisory-lock держится до
    // конца транзакции, поэтому второе изъятие подождёт коммита первого и увидит
    // уже уменьшенный остаток.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'cashops:' + shift.id}, 0))`)

    // Смену перечитываем под FOR SHARE: закрытие держит FOR UPDATE, поэтому операция
    // либо ляжет в смену ДО закрытия (и войдёт в сверку), либо увидит, что смена закрыта.
    const [locked] = await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shift.id)).for('share')
    if (locked?.status !== 'open') return { kind: 'closed' }

    if (type === 'withdrawal' || type === 'salary') {
      const { expected } = await getShiftCashBalance(shift.id, tx)
      if (amount > expected) {
        return { kind: 'insufficient', available: expected, requested: amount }
      }
    }

    const [op] = await tx.insert(cashOperations).values({
      type,
      amount: String(amount),
      description,
      shiftId: shift.id,
      createdBy: user.sub,
      idempotencyKey,
    }).onConflictDoNothing({ target: cashOperations.idempotencyKey }).returning()

    // Повторный POST с тем же ключом (двойной клик/ретрай) — отдаём существующую.
    if (!op) {
      if (idempotencyKey) {
        const [existing] = await tx.select().from(cashOperations).where(eq(cashOperations.idempotencyKey, idempotencyKey))
        if (existing) return { kind: 'duplicate', op: existing }
      }
      return { kind: 'failed' }
    }
    return { kind: 'ok', op }
  })

  if (result.kind === 'insufficient') {
    return c.json({
      error: `Недостаточно наличных в кассе: доступно ${result.available} ₽, запрошено ${result.requested} ₽`,
      available: result.available,
    }, 400)
  }
  if (result.kind === 'closed') return c.json({ error: 'Смена уже закрыта' }, 409)
  if (result.kind === 'duplicate') return c.json({ operation: result.op, duplicate: true })
  if (result.kind === 'failed') return c.json({ error: 'Не удалось сохранить операцию' }, 500)

  return c.json({ operation: result.op }, 201)
})
