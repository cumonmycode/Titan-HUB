/**
 * Доступ клиента к чатам клуба — из HUB (карточка клиента и подтверждение анкеты):
 *   GET /api/telegram/clients/:profileId/chats            — чаты, куда можно, и почему;
 *   PUT /api/telegram/clients/:profileId/chats/:chatId    — {allow} вручную открыть/закрыть.
 * Правила чата (всем / сотрудникам / по виду игры) — в настройках самого чата.
 */
import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, eq, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { listChats } from '../../lib/tgChats.js'
import { botActive, patchChatConfig, readAllChatConfigs, readChatConfig } from '../../lib/tgChatConfig.js'
import { accessReason, memberOf, type Member } from './access.js'

const UUID = /^[0-9a-f-]{36}$/i

async function memberByProfile(db: Database, profileId: string): Promise<Member | null> {
  if (!UUID.test(profileId)) return null
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1)
  if (!profile) return null
  return profile.tgId ? { ...(await memberOf(db, profile.tgId)), profile } : { profile, games: null }
}

export function registerAccessRoutes(router: Hono<AppEnv>): void {
  router.get('/clients/:profileId/chats', async (c) => {
    const db = c.var.db
    const member = await memberByProfile(db, c.req.param('profileId'))
    if (!member) return c.json({ error: 'Клиент не найден' }, 404)
    const chats = await listChats(db)
    const configs = await readAllChatConfigs(db, chats.map((ch) => ch.id))
    const items = chats
      .map((ch) => ({ ch, config: configs.get(ch.id)! }))
      .filter(({ config }) => botActive(config) && config.mode !== 'notify')
      .map(({ ch, config }) => ({
        chatId: ch.id,
        title: ch.title,
        mode: config.mode,
        invite: config.access.invite,
        guard: config.access.guard,
        manual: config.access.allow.includes(member.profile!.id),
        reason: accessReason(config.access, member),
      }))
    return c.json({ games: member.games, pending: member.profile!.registrationStatus === 'pending', hasTelegram: !!member.profile!.tgId, items })
  })

  router.put('/clients/:profileId/chats/:chatId', zValidator('json', z.object({ allow: z.boolean() })), async (c) => {
    const db = c.var.db
    const profileId = c.req.param('profileId')
    const chatId = c.req.param('chatId')
    if (!(await memberByProfile(db, profileId))) return c.json({ error: 'Клиент не найден' }, 404)
    if (!(await listChats(db)).some((ch) => ch.id === chatId)) return c.json({ error: 'Чат не найден' }, 404)
    const current = await readChatConfig(db, chatId)
    const allow = c.req.valid('json').allow
      ? [...new Set([...current.access.allow, profileId])]
      : current.access.allow.filter((id) => id !== profileId)
    await patchChatConfig(db, chatId, { mode: current.mode, access: { allow } })
    return c.json({ ok: true })
  })
}
