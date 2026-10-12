/**
 * Действия Tai с клиентами по просьбе персонала (карточки Tai выполняются через
 * эти маршруты от имени сотрудника — права и журнал как у кнопки в HUB).
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, eq, and, isNull } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import type { AppEnv } from '../../types.js'
import { clubForDb } from './club.js'
import { forwardTodayPoll, todaysPolls } from './games.js'
import { getContact, markBlocked } from './dialog/memory.js'
import { composeInvite } from './outreach.js'

export const taiRouter = new Hono<AppEnv>()
taiRouter.use('*', requireAuth, requireRole('owner', 'staff'))

// Отправить клиенту в личку сегодняшний опрос записи (и пару слов от Tai).
taiRouter.post('/send-poll', zValidator('json', z.object({
  playerId: z.string().uuid(),
  kind: z.string().max(20).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
})), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const club = await clubForDb(db, c.var.club?.id ?? null)
  if (!club) return c.json({ error: 'Бот Tai клуба не настроен' }, 400)
  const [client] = await db.select().from(profiles).where(and(eq(profiles.id, body.playerId), isNull(profiles.deletedAt))).limit(1)
  if (!client?.tgId) return c.json({ error: 'У клиента не привязан Telegram' }, 400)
  const contact = await getContact(db, client.tgId)
  if (!contact?.dmOpen) return c.json({ error: 'Клиент не писал Tai или заблокировал бота — написать первым нельзя' }, 409)
  const poll = (await todaysPolls(db)).find((p) => !body.kind || p.kind === body.kind)
  if (!poll) return c.json({ error: 'Сегодня опрос ещё не выложен' }, 404)

  const sent = await composeInvite(club, contact, client, { kind: poll.kind, title: poll.title, note: body.note ?? null, reason: 'staff' })
  if (sent === 'blocked') {
    await markBlocked(db, client.tgId)
    return c.json({ error: 'Клиент заблокировал Tai' }, 409)
  }
  const r = await forwardTodayPoll(db, club.bot, client.tgId, poll.kind)
  if (r.status !== 'sent') return c.json({ error: 'Не удалось переслать опрос' }, 502)
  return c.json({ ok: true, poll: poll.title })
})
