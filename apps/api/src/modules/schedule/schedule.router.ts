/**
 * «Управление → Расписание»: вечера недели и разовые события клуба (lib/schedule.ts).
 * Читают все сотрудники (касса подставляет сегодняшний вечер), правит владелец.
 * Монтируется как /api/schedule.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { asc, eveningTypes } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { listChats } from '../../lib/tgChats.js'
import { publishEvent } from '../../lib/realtime.js'
import { eveningToday, nightsAhead, readSchedule, saveSchedule, SlotSchema } from '../../lib/schedule.js'

const MAX_SLOTS = 60
const UPCOMING_DAYS = 14
export const SCHEDULE_EVENT = 'schedule:updated'

export const scheduleRouter = new Hono<AppEnv>()
scheduleRouter.use('*', requireAuth, requireRole('owner', 'staff'))

scheduleRouter.get('/', async (c) => {
  const db = c.var.db
  const [schedule, types, chats] = await Promise.all([
    readSchedule(db),
    db.select({ key: eveningTypes.key, label: eveningTypes.label, color: eveningTypes.color }).from(eveningTypes).orderBy(asc(eveningTypes.sortOrder), asc(eveningTypes.key)),
    listChats(db).catch(() => []),
  ])
  return c.json({
    ...schedule,
    upcoming: nightsAhead(schedule.slots, UPCOMING_DAYS),
    eveningTypes: types.filter((t) => t.key !== 'none'),
    // Чаты бота — куда выкладывать опрос вечера.
    chats: chats.map((ch) => ({ id: ch.id, title: ch.title, topics: ch.topics ?? [] })),
  })
})

// Касса: какой вечер сегодня по расписанию (подставляется при открытии смены).
scheduleRouter.get('/today', async (c) => {
  const night = await eveningToday(c.var.db)
  return c.json({ night })
})

scheduleRouter.put('/', requireRole('owner'), zValidator('json', z.object({ slots: z.array(SlotSchema).max(MAX_SLOTS) }), (result, c) => {
  if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? 'Проверьте расписание' }, 400)
}), async (c) => {
  const db = c.var.db
  const { slots } = c.req.valid('json')
  const ids = new Set(slots.map((s) => s.id))
  if (ids.size !== slots.length) return c.json({ error: 'Повторяющиеся вечера — обновите экран' }, 400)
  const known = new Set((await db.select({ key: eveningTypes.key }).from(eveningTypes)).map((t) => t.key))
  const unknown = slots.find((s) => !known.has(s.evening))
  if (unknown) return c.json({ error: `«${unknown.title}»: такого типа вечера нет — создайте его в «Тарифы и аренда»` }, 400)
  const saved = await saveSchedule(db, slots)
  publishEvent(c.var.club?.id, SCHEDULE_EVENT, {})
  return c.json({ ...saved, upcoming: nightsAhead(saved.slots, UPCOMING_DAYS) })
})
