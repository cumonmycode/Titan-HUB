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
} from './shifts.service.js'

const OpenShiftSchema = z.object({
  cashStart: z.number().min(0).default(0),
  eveningType: z.enum(['sport_mafia', 'city_mafia', 'kids_mafia', 'board_games', 'none']).default('none'),
  note: z.string().optional(),
  adjustmentReason: z.string().optional(),
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
  return c.json({ shift })
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
