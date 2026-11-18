/**
 * Раздел HUB «Telegram»: бот клуба, его группы и настройки каждой группы.
 * Только владелец. Бот — интеграция poll_bot_token; настройки чатов —
 * lib/tgChatConfig (app_settings.tai_chat_settings), чат заявок — requests_tg_chat.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { appSettings, eq, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { TG_API } from '../../lib/telegram.js'
import { forgetChat, listChats, recordChat, recordTopic } from '../../lib/tgChats.js'
import { readPollConfigs } from '../../lib/polls.js'
import { TAI_PRESETS } from '../../lib/tai.js'
import { tgWebhookUrl } from '../../lib/tgWebhook.js'
import type { TgBot } from '../../lib/tgBot.js'
import {
  COMMAND_NAME_RE, NOTIFY_CATEGORIES, botActive, forgetChatConfig, patchChatConfig, readAllChatConfigs, readChatConfig, readGlobals,
  type BroadcastCategory, type ChatConfig, type RawConfig,
} from '../../lib/tgChatConfig.js'
import { REQUESTS_CHAT_KEY } from '../site/settings.js'
import { ensureTaiWebhook, taiBot } from './club.js'
import { syncCommandMenu } from './commands.js'
import { createInvite, INVITE_ADMIN_RIGHTS, readInvite } from './membership.js'

export const tgAdminRouter = new Hono<AppEnv>()
tgAdminRouter.use('*', requireAuth, requireRole('owner'))

const clubKey = (c: { var: { club?: { id: string } | null } }) => c.var.club?.id ?? 'main'

export const CATEGORY_INFO: { key: (typeof NOTIFY_CATEGORIES)[number]; title: string; about: string }[] = [
  { key: 'requests', title: 'Заявки с сайта', about: 'Бронь, запись на игру и вопросы гостей — с кнопками «Подтвердить» и «Отклонить». Только в один чат.' },
  { key: 'shifts', title: 'Смены и касса', about: 'Открытие и закрытие смены, расхождения в кассе.' },
  { key: 'clients', title: 'Клиенты', about: 'Новые клиенты и анкеты на подтверждение, дни рождения, отзывы гостей.' },
  { key: 'money', title: 'Деньги клиентов', about: 'Пополнения депозитов, новые долги, повторные оплаты по СБП.' },
  { key: 'stock', title: 'Склад', about: 'Заканчивается товар, принята поставка.' },
  { key: 'events', title: 'Мероприятия', about: 'Новые мероприятия, начало аренды, завершённые события.' },
]

// ─── Бот ─────────────────────────────────────────────────────────────────────

interface BotMe { id: number; username?: string; first_name?: string; can_join_groups?: boolean; can_read_all_group_messages?: boolean }
interface WebhookInfo { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string }

const PHOTO_TTL_MS = 60 * 60 * 1000
const photos = new Map<string, { data: string | null; at: number }>()

/** Аватар бота как data:URL (токен в ссылке на файл наружу не отдаём). */
async function botPhoto(bot: TgBot, userId: number): Promise<string | null> {
  const hit = photos.get(bot.token)
  if (hit && Date.now() - hit.at < PHOTO_TTL_MS) return hit.data
  let data: string | null = null
  try {
    const list = await bot.call<{ photos?: { file_id: string; width: number }[][] }>('getUserProfilePhotos', { user_id: userId, limit: 1 })
    const sizes = list?.photos?.[0] ?? []
    const size = sizes.find((s) => s.width >= 160) ?? sizes[sizes.length - 1]
    const file = size ? await bot.call<{ file_path?: string }>('getFile', { file_id: size.file_id }) : null
    if (file?.file_path) {
      const res = await fetch(`${TG_API}/file/bot${bot.token}/${file.file_path}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) data = `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
    }
  } catch {
    data = null
  }
  photos.set(bot.token, { data, at: Date.now() })
  return data
}

async function botSummary(db: Database, clubId: string | null) {
  const bot = await taiBot(db)
  if (!bot) return { configured: false as const }
  const [me, hook] = await Promise.all([bot.call<BotMe>('getMe', {}), bot.call<WebhookInfo>('getWebhookInfo', {})])
  if (!me) return { configured: true as const, reachable: false as const }
  const expected = clubId ? tgWebhookUrl(clubId) : null
  return {
    configured: true as const,
    reachable: true as const,
    username: me.username ?? null,
    name: me.first_name ?? null,
    photo: await botPhoto(bot, me.id),
    canJoinGroups: me.can_join_groups !== false,
    // Режим приватности включён — бот без прав админа видит только команды и обращения.
    readsAllMessages: me.can_read_all_group_messages === true,
    webhook: {
      ok: !!expected && hook?.url === expected,
      pending: hook?.pending_update_count ?? 0,
      lastError: hook?.last_error_message ?? null,
      lastErrorAt: hook?.last_error_date ? new Date(hook.last_error_date * 1000).toISOString() : null,
    },
  }
}

function chatSummary(id: string, meta: { title: string | null; type: string | null } | undefined, config: ChatConfig, pollCount: number) {
  return {
    id,
    title: meta?.title ?? null,
    type: meta?.type ?? null,
    mode: config.mode,
    taiOn: config.tai.on,
    botStatus: config.bot.status,
    active: botActive(config),
    notify: NOTIFY_CATEGORIES.filter((k) => config.notify[k].on),
    commands: config.commands.list.filter((cmd) => cmd.enabled).length,
    welcome: config.welcome.on,
    polls: pollCount,
  }
}

tgAdminRouter.get('/overview', async (c) => {
  const db = c.var.db
  const chats = await listChats(db)
  const [bot, configs, polls] = await Promise.all([botSummary(db, c.var.club?.id ?? null), readAllChatConfigs(db, chats.map((ch) => ch.id)), readPollConfigs(db)])
  const metaById = new Map(chats.map((ch) => [ch.id, ch]))
  const list = [...configs.entries()]
    // Чаты из старых настроек, которых бот ни разу не видел, не показываем.
    .filter(([id]) => metaById.has(id))
    .map(([id, cfg]) => chatSummary(id, metaById.get(id), cfg, polls.filter((p) => p.chatId === id).length))
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.title ?? '').localeCompare(b.title ?? '', 'ru'))
  return c.json({ bot, chats: list })
})

tgAdminRouter.post('/webhook/repair', async (c) => {
  const clubId = c.var.club?.id ?? null
  if (!clubId) return c.json({ error: 'Вебхук настраивается с домена клуба' }, 400)
  await ensureTaiWebhook(c.var.db, clubId)
  return c.json({ bot: await botSummary(c.var.db, clubId) })
})

// ─── Добавление в чат ────────────────────────────────────────────────────────

const ModeSchema = z.enum(['game', 'work', 'notify'])

tgAdminRouter.post('/invites', zValidator('json', z.object({ mode: ModeSchema })), async (c) => {
  const bot = await taiBot(c.var.db)
  const username = await bot?.username()
  if (!bot || !username) return c.json({ error: 'Сначала подключите бота: Интеграции → Tai — бот клуба' }, 400)
  const code = await createInvite(clubKey(c), c.req.valid('json').mode, c.get('user').sub)
  const query = `startgroup=${code}&admin=${INVITE_ADMIN_RIGHTS}`
  return c.json({ code, url: `https://t.me/${username}?${query}`, appUrl: `tg://resolve?domain=${username}&${query}` })
})

tgAdminRouter.get('/invites/:code', async (c) => {
  const invite = await readInvite(clubKey(c), c.req.param('code'))
  if (!invite) return c.json({ error: 'Ссылка устарела — создайте новую' }, 404)
  return c.json({ mode: invite.mode, chatId: invite.chatId, title: invite.title })
})

// ─── Один чат ────────────────────────────────────────────────────────────────

interface ChatMemberInfo { status?: string; can_delete_messages?: boolean; can_pin_messages?: boolean; can_invite_users?: boolean; can_manage_topics?: boolean }
interface ChatInfo { title?: string; type?: string; is_forum?: boolean }

/** Что бот реально может в чате сейчас (по Telegram). null — Telegram не ответил. */
async function liveChat(bot: TgBot, chatId: string) {
  const me = await bot.call<BotMe>('getMe', {})
  if (!me) return null
  const [info, member, count] = await Promise.all([
    bot.call<ChatInfo>('getChat', { chat_id: chatId }),
    bot.call<ChatMemberInfo>('getChatMember', { chat_id: chatId, user_id: me.id }),
    bot.call<number>('getChatMemberCount', { chat_id: chatId }),
  ])
  if (!member) return { reachable: false as const }
  const admin = member.status === 'administrator'
  return {
    reachable: true as const,
    title: info?.title ?? null,
    isForum: info?.is_forum === true,
    status: member.status ?? 'unknown',
    members: count ?? null,
    rights: {
      admin,
      deleteMessages: admin && member.can_delete_messages === true,
      pinMessages: admin && member.can_pin_messages === true,
      inviteUsers: admin && member.can_invite_users === true,
      manageTopics: admin && member.can_manage_topics === true,
    },
  }
}

async function chatPayload(db: Database, bot: TgBot | null, chatId: string) {
  const meta = (await listChats(db)).find((ch) => ch.id === chatId)
  if (!meta) return null
  const [config, polls, live] = await Promise.all([readChatConfig(db, chatId), readPollConfigs(db), bot ? liveChat(bot, chatId) : Promise.resolve(null)])
  const liveTitle = live && live.reachable ? live.title : null
  return {
    chat: { id: chatId, title: liveTitle ?? meta.title, type: meta.type, topics: meta.topics },
    config,
    live,
    polls: polls.filter((p) => p.chatId === chatId).map((p) => ({ id: p.id, title: p.title, enabled: p.enabled, threadId: p.threadId })),
    presets: TAI_PRESETS,
    categories: CATEGORY_INFO,
  }
}

tgAdminRouter.get('/chats/:id', async (c) => {
  const payload = await chatPayload(c.var.db, await taiBot(c.var.db), c.req.param('id'))
  if (!payload) return c.json({ error: 'Чат не найден' }, 404)
  return c.json(payload)
})

const Thread = z.number().int().positive().nullable()
const CommandSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().toLowerCase().regex(COMMAND_NAME_RE, 'Команда — латиница, цифры и «_», до 32 символов'),
  aliases: z.array(z.string().trim().min(1).max(32)).max(8),
  description: z.string().trim().min(1).max(64),
  kind: z.enum(['mention', 'text', 'rules', 'help']),
  audience: z.enum(['all', 'unvoted', 'yes', 'no', 'staff']).optional(),
  text: z.string().max(2000).optional(),
  enabled: z.boolean(),
  access: z.enum(['admins', 'everyone']).optional(),
})
const PRESET_KEYS = TAI_PRESETS.map((p) => p.key) as [string, ...string[]]
const PatchSchema = z.object({
  mode: ModeSchema.optional(),
  tai: z.object({ on: z.boolean(), preset: z.enum(PRESET_KEYS), harshness: z.enum(['soft', 'medium', 'savage']), profanity: z.boolean() }).partial().optional(),
  commands: z.object({ access: z.enum(['admins', 'everyone']), cooldownMin: z.number().int().min(0).max(120), list: z.array(CommandSchema).max(40) }).partial().optional(),
  notify: z.record(z.enum(NOTIFY_CATEGORIES), z.object({ on: z.boolean(), threadId: Thread })).optional(),
  welcome: z.object({ on: z.boolean(), text: z.string().max(1000), deleteService: z.boolean(), rules: z.string().max(3000) }).partial().optional(),
})
type Patch = z.infer<typeof PatchSchema>

/** Заявки идут в один чат: включение здесь снимает их с прежнего. */
async function setRequestsChat(db: Database, chatId: string, target: { on: boolean; threadId: number | null }): Promise<void> {
  if (target.on) {
    const value = JSON.stringify({ chatId, threadId: target.threadId })
    await db.insert(appSettings).values({ key: REQUESTS_CHAT_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
  } else if ((await readGlobals(db)).requestsChat?.chatId === chatId) {
    await db.delete(appSettings).where(eq(appSettings.key, REQUESTS_CHAT_KEY))
  }
}

/** Тело PATCH → сырые поля tai_chat_settings (имена старого формата сохранены). */
function toRaw(body: Patch): RawConfig {
  const broadcast = Object.fromEntries(Object.entries(body.notify ?? {}).filter(([k]) => k !== 'requests')) as RawConfig['notify']
  return {
    ...(body.mode ? { mode: body.mode } : {}),
    ...(body.tai?.on !== undefined ? { taiOn: body.tai.on } : {}),
    ...(body.tai?.preset ? { preset: body.tai.preset } : {}),
    ...(body.tai?.harshness ? { harshness: body.tai.harshness } : {}),
    ...(body.tai?.profanity !== undefined ? { profanity: body.tai.profanity } : {}),
    ...(body.commands ? { commands: body.commands } : {}),
    ...(broadcast && Object.keys(broadcast).length ? { notify: broadcast as Partial<Record<BroadcastCategory, { on: boolean; threadId: number | null }>> } : {}),
    ...(body.welcome ? { welcome: body.welcome } : {}),
  }
}

tgAdminRouter.patch('/chats/:id', zValidator('json', PatchSchema), async (c) => {
  const db = c.var.db
  const chatId = c.req.param('id')
  const body = c.req.valid('json')
  if (!(await listChats(db)).some((ch) => ch.id === chatId)) return c.json({ error: 'Чат не найден' }, 404)
  const names = body.commands?.list?.map((cmd) => cmd.name) ?? []
  if (new Set(names).size !== names.length) return c.json({ error: 'Две команды с одним названием' }, 400)

  if (body.notify?.requests) await setRequestsChat(db, chatId, body.notify.requests)
  // Назначение фиксируем всегда: иначе первая правка «ничейного» чата не закрепит режим.
  const current = await readChatConfig(db, chatId)
  await patchChatConfig(db, chatId, { mode: current.mode, ...toRaw(body) })
  const config = await readChatConfig(db, chatId)

  // Меню «/» в Telegram — когда поменялись команды или правила (для /rules).
  if (body.commands?.list || body.welcome?.rules !== undefined) {
    const bot = await taiBot(db)
    if (bot) await syncCommandMenu(bot, chatId, config)
  }
  return c.json({ config })
})

tgAdminRouter.post('/chats/:id/test', zValidator('json', z.object({ threadId: Thread.optional() })), async (c) => {
  const bot = await taiBot(c.var.db)
  if (!bot) return c.json({ error: 'Бот не подключён' }, 400)
  const sent = await bot.send(c.req.param('id'), '✅ Tai на связи. Это проверочное сообщение из Titan HUB.', { threadId: c.req.valid('json').threadId ?? null })
  if (!sent.ok) return c.json({ error: `Telegram не принял сообщение: ${sent.error}` }, 502)
  return c.json({ ok: true })
})

tgAdminRouter.post('/chats/:id/rules', async (c) => {
  const db = c.var.db
  const chatId = c.req.param('id')
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот не подключён' }, 400)
  const rules = (await readChatConfig(db, chatId)).welcome.rules.trim()
  if (!rules) return c.json({ error: 'Сначала напишите правила' }, 400)
  const sent = await bot.send(chatId, `📌 Правила чата\n\n${rules}`)
  if (!sent.ok) return c.json({ error: `Telegram не принял сообщение: ${sent.error}` }, 502)
  const pinned = await bot.call<boolean>('pinChatMessage', { chat_id: chatId, message_id: sent.messageId, disable_notification: true })
  return c.json({ ok: true, pinned: pinned === true })
})

/** Убрать бота из чата и забыть чат. Бот мог уже выйти — тогда только забываем. */
tgAdminRouter.delete('/chats/:id', zValidator('query', z.object({ leave: z.enum(['0', '1']).optional() })), async (c) => {
  const db = c.var.db
  const chatId = c.req.param('id')
  if (c.req.valid('query').leave !== '0') {
    const bot = await taiBot(db)
    if (bot) await bot.call<boolean>('leaveChat', { chat_id: chatId })
  }
  await setRequestsChat(db, chatId, { on: false, threadId: null })
  await forgetChatConfig(db, chatId)
  await forgetChat(db, chatId)
  return c.json({ ok: true })
})

// ─── Темы форума для опросов и уведомлений ───────────────────────────────────

const TOPIC_COLORS = [0x6fb9f0, 0xffd67e, 0xcb86db, 0x8eee98, 0xff93b2, 0xfb6f5f]

/** Бот создаёт тему в группе-форуме (нужно право «Управление темами»). */
tgAdminRouter.post('/chats/:id/topics', zValidator('json', z.object({ name: z.string().trim().min(1).max(128) })), async (c) => {
  const db = c.var.db
  const chatId = c.req.param('id')
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот не подключён' }, 400)
  const { name } = c.req.valid('json')
  const topic = await bot.call<{ message_thread_id: number; name: string }>('createForumTopic', {
    chat_id: chatId,
    name,
    icon_color: TOPIC_COLORS[Math.floor(Math.random() * TOPIC_COLORS.length)],
  })
  if (!topic) return c.json({ error: 'Telegram не создал тему: в группе должны быть включены темы, а у бота — право управлять ими' }, 400)
  await recordTopic(db, chatId, topic.message_thread_id, topic.name)
  return c.json({ threadId: topic.message_thread_id, name: topic.name })
})

/**
 * Ссылка на сообщение → группа и тема: t.me/c/<id>/<тема>/<сообщение>,
 * t.me/c/<id>/<сообщение>?thread=<тема>, t.me/<username>/<тема>/<сообщение>.
 */
export function parseMessageLink(raw: string): { chat: string; threadId: number | null } | null {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (!/^(www\.)?(t\.me|telegram\.me)$/i.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const thread = url.searchParams.get('thread') ?? url.searchParams.get('topic')
  const numbers = (list: string[]) => list.every((p) => /^\d+$/.test(p))
  if (parts[0] === 'c' && parts.length >= 2 && /^\d+$/.test(parts[1]!)) {
    const rest = parts.slice(2)
    if (!numbers(rest)) return null
    const threadId = thread && /^\d+$/.test(thread) ? Number(thread) : rest.length >= 2 ? Number(rest[0]) : null
    return { chat: `-100${parts[1]}`, threadId }
  }
  if (parts.length >= 1 && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(parts[0]!)) {
    const rest = parts.slice(1)
    if (!numbers(rest)) return null
    const threadId = thread && /^\d+$/.test(thread) ? Number(thread) : rest.length >= 2 ? Number(rest[0]) : null
    return { chat: `@${parts[0]}`, threadId }
  }
  return null
}

tgAdminRouter.post('/resolve-link', zValidator('json', z.object({ url: z.string().trim().min(5).max(300), name: z.string().trim().max(128).optional() })), async (c) => {
  const db = c.var.db
  const { url, name } = c.req.valid('json')
  const parsed = parseMessageLink(url)
  if (!parsed) return c.json({ error: 'Это не ссылка на сообщение в Telegram. В группе: нажмите на сообщение в теме → «Копировать ссылку».' }, 400)
  const bot = await taiBot(db)
  if (!bot) return c.json({ error: 'Бот не подключён' }, 400)
  const info = await bot.call<{ id: number; title?: string; type?: string }>('getChat', { chat_id: parsed.chat })
  if (!info) return c.json({ error: 'Бота нет в этой группе — сначала добавьте его' }, 400)
  const chatId = String(info.id)
  await recordChat(db, { id: chatId, title: info.title ?? null, type: info.type ?? null })
  if (parsed.threadId) await recordTopic(db, chatId, parsed.threadId, name?.trim() || null)
  return c.json({ chatId, title: info.title ?? null, threadId: parsed.threadId, topicName: name?.trim() || null })
})
