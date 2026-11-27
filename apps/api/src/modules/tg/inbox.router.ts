/**
 * Чат Tai с клиентами в HUB (как диалоги бота в MIKAN): персонал видит все личные
 * переписки Tai, читает их и в любой момент отвечает сам. Ответ сотрудника уходит
 * клиенту от бота клуба и ставит Tai на паузу в этом чате — пока сотрудник не вернёт
 * Tai, клиентские сообщения ждут человека (needs_attention + push «Клиент ждёт ответа»).
 *
 * Личка Tai: tai_contacts (собеседник) + tai_messages (chat_id = tg_id). Реплики
 * сотрудника — role 'staff' со staff_id. Монтируется как /api/tai-inbox.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, sql, taiContacts, eq, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { publishEvent } from '../../lib/realtime.js'
import { taiBot } from './club.js'
import { appendMessage, markBlocked, markOutbound } from './dialog/memory.js'

const PAGE = 50
const LIST_LIMIT = 200
const TEXT_MAX = 3_500
const TG_ID_RE = /^\d{3,20}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Событие для живого обновления списка и переписки в HUB. */
export const INBOX_EVENT = 'tai-inbox:updated'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface InboxChat {
  tgId: string
  name: string
  username: string | null
  profile: { id: string; nickname: string; photoUrl: string | null; role: string } | null
  aiPaused: boolean
  needsAttention: boolean
  dmOpen: boolean
  unread: number
  lastMessage: { role: string; content: string; createdAt: string } | null
  updatedAt: string
}

interface ChatFilter {
  onlyAttention?: boolean
  profileId?: string | null
  tgId?: string | null
}

/** Диалоги Tai в личке: ждущие человека сверху, дальше — свежие. */
async function listChats(db: Database, f: ChatFilter): Promise<InboxChat[]> {
  const res = await db.execute(sql`
    SELECT c.tg_id, c.first_name, c.username, c.ai_paused, c.needs_attention, c.dm_open, c.updated_at,
           p.id AS profile_id, p.nickname, p.role,
           COALESCE(p.photo_url, p.tg_photo_url, p.gomafia_photo_url) AS photo_url,
           lm.role AS last_role, lm.content AS last_content, lm.created_at AS last_at,
           (SELECT count(*)::int FROM tai_messages u
             WHERE u.chat_id = c.tg_id AND u.role = 'user'
               AND u.created_at > COALESCE(c.staff_read_at, 'epoch'::timestamptz)) AS unread
    FROM tai_contacts c
    LEFT JOIN profiles p ON p.id = c.profile_id
    ${f.tgId ? sql`LEFT` : sql``} JOIN LATERAL (
      SELECT m.role, m.content, m.created_at FROM tai_messages m
      WHERE m.chat_id = c.tg_id ORDER BY m.id DESC LIMIT 1
    ) lm ON true
    WHERE true
      ${f.onlyAttention ? sql`AND c.needs_attention` : sql``}
      ${f.profileId ? sql`AND c.profile_id = ${f.profileId}` : sql``}
      ${f.tgId ? sql`AND c.tg_id = ${f.tgId}` : sql``}
    ORDER BY c.needs_attention DESC, lm.created_at DESC NULLS LAST
    LIMIT ${LIST_LIMIT}
  `)
  return rows<Record<string, unknown>>(res).map((r) => {
    const lastAt = r['last_at'] ? new Date(r['last_at'] as string).toISOString() : null
    return {
      tgId: String(r['tg_id']),
      name: (r['nickname'] as string | null) ?? (r['first_name'] as string | null) ?? (r['username'] ? `@${String(r['username'])}` : 'Гость из Telegram'),
      username: (r['username'] as string | null) ?? null,
      profile: r['profile_id']
        ? { id: String(r['profile_id']), nickname: String(r['nickname']), photoUrl: (r['photo_url'] as string | null) ?? null, role: String(r['role']) }
        : null,
      aiPaused: !!r['ai_paused'],
      needsAttention: !!r['needs_attention'],
      dmOpen: r['dm_open'] !== false,
      unread: Number(r['unread'] ?? 0),
      lastMessage: lastAt ? { role: String(r['last_role']), content: String(r['last_content']), createdAt: lastAt } : null,
      updatedAt: lastAt ?? new Date(r['updated_at'] as string).toISOString(),
    }
  })
}

export const taiInboxRouter = new Hono<AppEnv>()
taiInboxRouter.use('*', requireAuth, requireRole('owner', 'staff'))

taiInboxRouter.get('/', async (c) => {
  const profileId = c.req.query('profileId') ?? null
  if (profileId && !UUID_RE.test(profileId)) return c.json({ error: 'Bad profileId' }, 400)
  const items = await listChats(c.var.db, { onlyAttention: c.req.query('filter') === 'attention', profileId })
  return c.json({ items, attention: items.filter((i) => i.needsAttention).length })
})

taiInboxRouter.get('/:tgId', async (c) => {
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const [chat] = await listChats(c.var.db, { tgId })
  if (!chat) return c.json({ error: 'Диалог не найден' }, 404)
  return c.json({ chat })
})

taiInboxRouter.get('/:tgId/messages', async (c) => {
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const before = Number(c.req.query('beforeId') ?? 0)
  const res = await c.var.db.execute(sql`
    SELECT m.id, m.role, m.content, m.voice, m.memo, m.created_at, m.staff_id, s.nickname AS staff_name
    FROM tai_messages m
    LEFT JOIN profiles s ON s.id = m.staff_id
    WHERE m.chat_id = ${tgId} ${Number.isFinite(before) && before > 0 ? sql`AND m.id < ${before}` : sql``}
    ORDER BY m.id DESC
    LIMIT ${PAGE}
  `)
  const items = rows<Record<string, unknown>>(res).reverse().map((m) => ({
    id: Number(m['id']),
    role: String(m['role']) as 'user' | 'assistant' | 'staff',
    text: String(m['content']),
    voice: !!m['voice'],
    memo: (m['memo'] as string | null) ?? null,
    staff: m['staff_id'] ? { id: String(m['staff_id']), nickname: (m['staff_name'] as string | null) ?? 'Сотрудник' } : null,
    createdAt: new Date(m['created_at'] as string).toISOString(),
  }))
  return c.json({ items, hasMore: items.length === PAGE })
})

const ReplySchema = z.object({
  text: z.string().trim().min(1).max(TEXT_MAX),
  // Ответил сам — Tai замолкает в этом чате (по умолчанию), чтобы не перебивать.
  pauseAi: z.boolean().optional(),
})

taiInboxRouter.post('/:tgId/messages', zValidator('json', ReplySchema), async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const { text, pauseAi = true } = c.req.valid('json')
  const [contact] = await db.select().from(taiContacts).where(eq(taiContacts.tgId, tgId)).limit(1)
  if (!contact) return c.json({ error: 'Диалог не найден' }, 404)
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот клуба не подключён — «Управление → Telegram»' }, 409)

  const sent = await bot.send(tgId, escapeHtml(text), { html: true })
  if (!sent.ok) {
    if (sent.code === 403) {
      await markBlocked(db, tgId)
      return c.json({ error: 'Клиент заблокировал бота — сообщение не доставлено' }, 409)
    }
    console.warn('[tai-inbox] send failed:', sent.code, sent.error)
    return c.json({ error: 'Telegram не принял сообщение — попробуйте ещё раз' }, 502)
  }
  const user = c.get('user')
  await appendMessage(db, { chatId: tgId, role: 'staff', content: text, staffId: user.sub })
  await markOutbound(db, tgId, false)
  const aiPaused = pauseAi || contact.aiPaused
  await db.update(taiContacts)
    .set({ needsAttention: false, staffReadAt: new Date(), aiPaused, updatedAt: new Date() })
    .where(eq(taiContacts.tgId, tgId))
  publishEvent(c.var.club?.id, INBOX_EVENT, { tgId })
  const [staff] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, user.sub)).limit(1)
  return c.json({ ok: true, aiPaused, staff: { id: user.sub, nickname: staff?.nickname ?? 'Сотрудник' } })
})

taiInboxRouter.patch('/:tgId', zValidator('json', z.object({ aiPaused: z.boolean() })), async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const { aiPaused } = c.req.valid('json')
  const [updated] = await db.update(taiContacts)
    .set({ aiPaused, ...(aiPaused ? {} : { needsAttention: false }), updatedAt: new Date() })
    .where(eq(taiContacts.tgId, tgId))
    .returning({ tgId: taiContacts.tgId })
  if (!updated) return c.json({ error: 'Диалог не найден' }, 404)
  publishEvent(c.var.club?.id, INBOX_EVENT, { tgId })
  return c.json({ ok: true, aiPaused })
})

taiInboxRouter.post('/:tgId/read', async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  await db.update(taiContacts).set({ staffReadAt: new Date(), needsAttention: false }).where(eq(taiContacts.tgId, tgId))
  publishEvent(c.var.club?.id, INBOX_EVENT, { tgId })
  return c.json({ ok: true })
})
