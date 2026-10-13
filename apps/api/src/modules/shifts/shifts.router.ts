import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import {
  getCurrentShift,
  openShift,
  closeShift,
  getShiftAnalytics,
  getShiftHistory,
  getBirthdaysToday,
  getShiftCashBalance,
  getLastShiftCashEnd,
  setShiftStaff,
} from './shifts.service.js'
import { shiftSalaries, shiftWorkers } from '../../lib/salary.js'
import { shifts, profiles, eq, and, isNull } from '@titan/database'
import { notify } from '../notifications/push.js'

const OpenShiftSchema = z.object({
  cashStart: z.number().min(0).default(0),
  eveningType: z.enum(['sport_mafia', 'city_mafia', 'kids_mafia', 'board_games', 'none']).default('none'),
  note: z.string().optional(),
  adjustmentReason: z.string().optional(),
  // Кто работает сегодня (сотрудники); не передали — открывший, если он сотрудник.
  staffIds: z.array(z.string().uuid()).max(30).optional(),
  // Внесения и изъятия сразу после пересчёта наличных.
  operations: z.array(z.object({
    type: z.enum(['deposit', 'withdrawal']),
    amount: z.number().positive().max(10_000_000),
    description: z.string().max(200).optional(),
  })).max(10).optional(),
})

const CloseShiftSchema = z.object({
  cashEnd: z.number().min(0),
  adjustmentReason: z.string().optional(),
})

export const shiftsRouter = new Hono<AppEnv>()
shiftsRouter.use('*', requireAuth)

shiftsRouter.get('/current', async (c) => {
  const db = c.var.db
  const shift = await getCurrentShift(db)
  return c.json({ shift, staff: shift ? await shiftWorkers(db, shift.id) : [] })
})

// Состав смены: открытую правит персонал, закрытую — владелец (зарплата задним числом).
shiftsRouter.put('/:id/staff', requireRole('owner', 'staff'), zValidator('json', z.object({ staffIds: z.array(z.string().uuid()).max(30) })), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const id = c.req.param('id')
  const [shift] = await db.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, id))
  if (!shift) return c.json({ error: 'Смена не найдена' }, 404)
  if (shift.status !== 'open' && user.role !== 'owner') return c.json({ error: 'Состав закрытой смены меняет только владелец' }, 403)
  await setShiftStaff(id, c.req.valid('json').staffIds, db)
  return c.json({ staff: await shiftWorkers(db, id) })
})

shiftsRouter.post('/open', requireRole('owner', 'staff'), zValidator('json', OpenShiftSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  try {
    const shift = await openShift({ openedBy: user.sub, ...body }, db, c.var.club?.id ?? null)
    return c.json({ shift }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

shiftsRouter.post('/close', requireRole('owner', 'staff'), zValidator('json', CloseShiftSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { cashEnd, adjustmentReason } = c.req.valid('json')
  const current = await getCurrentShift(db)
  if (!current) return c.json({ error: 'No open shift' }, 400)
  try {
    const shift = await closeShift(current.id, user.sub, cashEnd, adjustmentReason, db, c.var.club?.id ?? null)
    const analytics = await getShiftAnalytics(current.id, db)
    // Смену закрыл сотрудник, а зарплату выдаёт только владелец: напоминаем владельцам,
    // кому и сколько выдать (суммы коллег сотруднику не показываем).
    if (user.role !== 'owner') void remindSalaryDue(db, current.id, c.var.club?.id ?? null).catch(() => {})
    return c.json({ shift, analytics })
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

shiftsRouter.get('/birthdays-today', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const people = await getBirthdaysToday(db)
  return c.json({ birthdays: people })
})

shiftsRouter.get('/cash-balance', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const shift = await getCurrentShift(db)
  if (!shift) return c.json({ expected: 0, cashStart: 0 })
  const balance = await getShiftCashBalance(shift.id, db)
  return c.json(balance)
})

shiftsRouter.get('/last-cash-end', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const cashEnd = await getLastShiftCashEnd(db)
  return c.json({ cashEnd })
})

shiftsRouter.get('/history', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const page = Number(c.req.query('page') ?? 1)
  const rows = await getShiftHistory(page, 20, db)
  return c.json({ shifts: rows })
})

shiftsRouter.get('/:id/analytics', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const analytics = await getShiftAnalytics(c.req.param('id'), db)
  return c.json({ analytics })
})

async function remindSalaryDue(db: Parameters<typeof shiftSalaries>[0], shiftId: string, clubId: string | null): Promise<void> {
  const result = await shiftSalaries(db, shiftId)
  const due = result?.workers.filter((w) => !w.paid) ?? []
  if (!due.length) return
  const body = due.map((w) => `${w.nickname} — ${Math.round(w.calculated).toLocaleString('ru-RU')} ₽`).join(' · ')
  const owners = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))
  for (const o of owners) {
    await notify({ type: 'salary_due', title: 'Зарплата к выдаче', body, meta: { shiftId }, userId: o.id }, db, clubId)
  }
}
