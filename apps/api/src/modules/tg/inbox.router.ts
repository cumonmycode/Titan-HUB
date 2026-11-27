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
import { bodyLimit } from 'hono/body-limit'
import { MAX_UPLOAD_BODY_BYTES, storeImage } from '../../lib/imageStore.js'
import { taiBot } from './club.js'
import { appendMessage, markBlocked, markOutbound } from './dialog/memory.js'
import { todaysPolls } from './games.js'

const PAGE = 50
const LIST_LIMIT = 200
const TEXT_MAX = 3_500
const CAPTION_MAX = 1_000
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

/**
 * Категория собеседника: potential — ещё не клиент (нет в базе или ни разу не был с
 * закрытым чеком), client — ходит в клуб, staff — команда клуба.
 */
export type InboxSegment = 'potential' | 'client' | 'staff'

export interface InboxChat {
  tgId: string
  segment: InboxSegment
  /** Сколько вечеров с закрытым чеком — для подписи «был N раз». */
  visits: number
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
           (SELECT count(DISTINCT ch.shift_id)::int FROM checks ch WHERE ch.player_id = p.id AND ch.status = 'closed') AS visits,
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
    const role = r['role'] as string | null
    const visits = Number(r['visits'] ?? 0)
    const segment: InboxSegment = role === 'owner' || role === 'staff' ? 'staff' : r['profile_id'] && visits > 0 ? 'client' : 'potential'
    return {
      tgId: String(r['tg_id']),
      segment,
      visits,
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
  const all = await listChats(c.var.db, { onlyAttention: c.req.query('filter') === 'attention', profileId })
  const segment = c.req.query('segment')
  const items = segment === 'potential' || segment === 'client' || segment === 'staff' ? all.filter((i) => i.segment === segment) : all
  const counts = {
    potential: all.filter((i) => i.segment === 'potential').length,
    client: all.filter((i) => i.segment === 'client').length,
    staff: all.filter((i) => i.segment === 'staff').length,
  }
  return c.json({ items, attention: all.filter((i) => i.needsAttention).length, counts })
})

// Сегодняшние опросы записи из игровых чатов — их можно переслать клиенту в личку.
// Объявлен до /:tgId, иначе «polls» попал бы в параметр.
taiInboxRouter.get('/polls', async (c) => {
  const polls = await todaysPolls(c.var.db)
  return c.json({ polls: polls.map((p) => ({ chatId: p.chatId, messageId: p.messageId, title: p.title, kind: p.kind, options: p.options })) })
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
    SELECT m.id, m.role, m.content, m.voice, m.memo, m.created_at, m.staff_id, m.photo_url, s.nickname AS staff_name
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
    photoUrl: (m['photo_url'] as string | null) ?? null,
    staff: m['staff_id'] ? { id: String(m['staff_id']), nickname: (m['staff_name'] as string | null) ?? 'Сотрудник' } : null,
    createdAt: new Date(m['created_at'] as string).toISOString(),
  }))
  return c.json({ items, hasMore: items.length === PAGE })
})

/** После ответа сотрудника: в историю, Tai на паузу (если просили), диалог прочитан. */
async function afterStaffSend(db: Database, clubId: string | null | undefined, tgId: string, staffId: string, content: string, pauseAi: boolean, photoUrl: string | null): Promise<boolean> {
  const [contact] = await db.select({ aiPaused: taiContacts.aiPaused }).from(taiContacts).where(eq(taiContacts.tgId, tgId)).limit(1)
  await appendMessage(db, { chatId: tgId, role: 'staff', content, staffId, photoUrl })
  await markOutbound(db, tgId, false)
  const aiPaused = pauseAi || !!contact?.aiPaused
  await db.update(taiContacts)
    .set({ needsAttention: false, staffReadAt: new Date(), aiPaused, updatedAt: new Date() })
    .where(eq(taiContacts.tgId, tgId))
  publishEvent(clubId, INBOX_EVENT, { tgId })
  return aiPaused
}

/** Ошибка Telegram → ответ HUB (блокировку бота помечаем у собеседника). */
async function sendFailure(db: Database, tgId: string, sent: { code: number; error: string }): Promise<{ error: string; status: 409 | 502 }> {
  if (sent.code === 403) {
    await markBlocked(db, tgId)
    return { error: 'Клиент заблокировал бота — сообщение не доставлено', status: 409 }
  }
  console.warn('[tai-inbox] send failed:', sent.code, sent.error)
  return { error: 'Telegram не принял сообщение — попробуйте ещё раз', status: 502 }
}

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
    const fail = await sendFailure(db, tgId, sent)
    return c.json({ error: fail.error }, fail.status)
  }
  const user = c.get('user')
  const aiPaused = await afterStaffSend(db, c.var.club?.id, tgId, user.sub, text, pauseAi, null)
  const [staff] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, user.sub)).limit(1)
  return c.json({ ok: true, aiPaused, staff: { id: user.sub, nickname: staff?.nickname ?? 'Сотрудник' } })
})

// Фото клиенту от бота клуба (multipart: file, caption). Копия — в хранилище клуба,
// чтобы фото было видно в переписке HUB.
taiInboxRouter.post('/:tgId/photo', bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES }), async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const form = await c.req.formData()
  const file = form.get('file')
  const caption = String(form.get('caption') ?? '').trim().slice(0, CAPTION_MAX)
  if (!(file instanceof File)) return c.json({ error: 'Нет фото' }, 400)
  const [contact] = await db.select({ tgId: taiContacts.tgId }).from(taiContacts).where(eq(taiContacts.tgId, tgId)).limit(1)
  if (!contact) return c.json({ error: 'Диалог не найден' }, 404)
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот клуба не подключён — «Управление → Telegram»' }, 409)
  const stored = await storeImage(file)
  if (!stored.ok) return c.json({ error: stored.error }, stored.status)

  const tg = new FormData()
  tg.set('chat_id', tgId)
  if (caption) tg.set('caption', caption)
  tg.set('photo', new Blob([new Uint8Array(await file.arrayBuffer())], { type: file.type || 'image/jpeg' }), file.name || 'photo.jpg')
  const sent = await bot.upload<{ message_id: number }>('sendPhoto', tg)
  if (!sent.ok) {
    const fail = await sendFailure(db, tgId, sent)
    return c.json({ error: fail.error }, fail.status)
  }
  const aiPaused = await afterStaffSend(db, c.var.club?.id, tgId, c.get('user').sub, caption ? `[Фото] ${caption}` : '[Фото]', form.get('pauseAi') !== 'false', stored.url)
  return c.json({ ok: true, aiPaused, photoUrl: stored.url })
})

// Переслать клиенту сегодняшний опрос записи (из игрового чата) — отметится прямо в личке.
taiInboxRouter.post('/:tgId/poll', zValidator('json', z.object({ chatId: z.string().min(1).max(32), messageId: z.number().int().positive() })), async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const { chatId, messageId } = c.req.valid('json')
  // Пересылаем только опрос, который бот сам выложил сегодня, — не произвольное сообщение чата.
  const poll = (await todaysPolls(db)).find((p) => p.chatId === chatId && p.messageId === messageId)
  if (!poll) return c.json({ error: 'Опрос уже закрыт или не найден — обновите список' }, 404)
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот клуба не подключён — «Управление → Telegram»' }, 409)
  const sent = await bot.forward(tgId, chatId, messageId)
  if (!sent.ok) {
    const fail = await sendFailure(db, tgId, sent)
    return c.json({ error: fail.error }, fail.status)
  }
  const aiPaused = await afterStaffSend(db, c.var.club?.id, tgId, c.get('user').sub, `[Опрос] ${poll.title}`, false, null)
  return c.json({ ok: true, aiPaused })
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
