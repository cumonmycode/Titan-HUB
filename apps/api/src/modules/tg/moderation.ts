/**
 * Админские команды группы — для администраторов чата в Telegram и владельца клуба:
 *
 *   /mute [10м|2ч|1д] [причина]   — замолчать участника (ответом на его сообщение или @ник)
 *   /unmute                        — вернуть голос
 *   /mutechat [30м]                — закрыть чат для всех, кроме админов; сам откроется по сроку
 *   /unmutechat                    — открыть чат сейчас
 *   /kick, /ban [срок], /unban     — выгнать, забанить (на срок или навсегда), разбанить
 *   /del                           — удалить сообщение, на которое ответили
 *   /pin, /unpin                   — закрепить / открепить сообщение
 *
 * Срок участника Telegram снимает сам (until_date). Закрытый чат открывает тик
 * runChatUnlocks раз в минуту: прежние права чата хранятся в Redis до открытия.
 * Включаются в HUB → Telegram → чат → «Модерация».
 */
import type { Database } from '@titan/database'
import { getSharedRedis } from '../../lib/redis.js'
import { listRoster } from '../../lib/roster.js'
import { isTelegramChatAdmin } from '../../lib/telegram.js'
import { escapeHtml } from '../../lib/tgBot.js'
import type { ChatConfig } from '../../lib/tgChatConfig.js'
import { clubForDb, type TgClub } from './club.js'
import { profileByTg } from './identity.js'
import { durationText, parseDuration } from './rules.js'
import type { TgMessage, TgUser } from './types.js'

export const MODERATION_COMMANDS = [
  { name: 'mute', description: 'Замолчать участника: /mute 10м (ответом)' },
  { name: 'unmute', description: 'Вернуть голос участнику' },
  { name: 'mutechat', description: 'Закрыть чат на время: /mutechat 30м' },
  { name: 'unmutechat', description: 'Открыть чат' },
  { name: 'kick', description: 'Выгнать участника' },
  { name: 'ban', description: 'Забанить: /ban 1д или навсегда' },
  { name: 'unban', description: 'Разбанить участника' },
  { name: 'del', description: 'Удалить сообщение (ответом)' },
  { name: 'pin', description: 'Закрепить сообщение (ответом)' },
  { name: 'unpin', description: 'Открепить сообщение' },
] as const
type ModName = (typeof MODERATION_COMMANDS)[number]['name']
const NAMES = new Set<string>(MODERATION_COMMANDS.map((c) => c.name))

const MIN = 60
const DEFAULT_MUTE_SEC = 10 * MIN
const DEFAULT_CHAT_LOCK_SEC = 30 * MIN
const MAX_USER_SEC = 366 * 24 * 3600
const MAX_CHAT_LOCK_SEC = 7 * 24 * 3600
const TG_MIN_RESTRICT_SEC = 30
const lockKey = (clubKey: string) => `tg:locks:${clubKey}`

type Permissions = Record<string, boolean>
interface ChatLock { until: number; prev: Permissions; threadId: number | null }

const SILENT: Permissions = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false, can_send_videos: false,
  can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false, can_add_web_page_previews: false,
}
/** Права чата по умолчанию, если Telegram их не отдал. */
const OPEN: Permissions = Object.fromEntries(Object.keys(SILENT).map((k) => [k, true]))

const mention = (u: { id: number | string; name: string }) => `<a href="tg://user?id=${u.id}">${escapeHtml(u.name)}</a>`
const nameOf = (u: TgUser) => u.first_name || (u.username ? `@${u.username}` : 'участник')

function parseLock(raw: string | null | undefined): ChatLock | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<ChatLock>
    return { until: Number(v.until) || 0, prev: v.prev ?? OPEN, threadId: typeof v.threadId === 'number' ? v.threadId : null }
  } catch {
    return null
  }
}

/** Первое слово — админская команда этого бота? */
function parseCommand(text: string, botUsername: string | null): { name: ModName; args: string[] } | null {
  const [first, ...args] = text.trim().split(/\s+/)
  if (!first?.startsWith('/')) return null
  const [raw, target] = first.slice(1).toLowerCase().split('@')
  if (target && botUsername && target !== botUsername.toLowerCase()) return null
  return raw && NAMES.has(raw) ? { name: raw as ModName, args } : null
}

/** Кого касается команда: ответ на сообщение, упоминание или @ник из ростера. */
async function targetOf(club: TgClub, msg: TgMessage, args: string[]): Promise<{ id: number; name: string } | null> {
  const replied = msg.reply_to_message?.from
  if (replied && !replied.is_bot) return { id: replied.id, name: nameOf(replied) }
  const textMention = msg.entities?.find((e) => e.type === 'text_mention' && e.user)
  if (textMention?.user) return { id: textMention.user.id, name: nameOf(textMention.user) }
  const at = args.find((a) => a.startsWith('@'))?.slice(1).toLowerCase()
  if (!at) return null
  const known = (await listRoster(club.db)).find((u) => u.username?.toLowerCase() === at)
  return known ? { id: Number(known.tgId), name: known.firstName || `@${known.username}` } : null
}

async function mayModerate(club: TgClub, msg: TgMessage): Promise<boolean> {
  if (await isTelegramChatAdmin(club.bot.token, msg.chat.id, msg.from!.id).catch(() => false)) return true
  return (await profileByTg(club.db, String(msg.from!.id)))?.role === 'owner'
}

const RIGHTS_HINT = 'Дайте мне в настройках группы права администратора: «Блокировка участников», «Удаление» и «Закрепление сообщений».'
const refusal = (error: string, who: string) => (/administrator|creator|owner/i.test(error) ? `${who} нельзя 🙂` : `Не получилось: ${error}. ${RIGHTS_HINT}`)

/** Срок и причина из аргументов (кроме @ника). */
function durationAndReason(args: string[], fallback: number | null): { sec: number | null; reason: string } {
  const rest = args.filter((a) => !a.startsWith('@'))
  const parsed = parseDuration(rest[0])
  return { sec: parsed ?? fallback, reason: (parsed != null ? rest.slice(1) : rest).join(' ').slice(0, 200) }
}

const clampUser = (sec: number) => Math.max(TG_MIN_RESTRICT_SEC, Math.min(MAX_USER_SEC, sec))

async function chatPermissions(club: TgClub, chatId: number | string): Promise<Permissions> {
  const chat = await club.bot.call<{ permissions?: Permissions }>('getChat', { chat_id: chatId })
  return chat?.permissions ? { ...chat.permissions } : OPEN
}

type Reply = (text: string) => Promise<unknown>

async function lockChat(club: TgClub, msg: TgMessage, args: string[], reply: Reply): Promise<void> {
  const sec = Math.min(MAX_CHAT_LOCK_SEC, parseDuration(args[0]) ?? DEFAULT_CHAT_LOCK_SEC)
  const redis = getSharedRedis()
  const chatId = String(msg.chat.id)
  // Повторный /mutechat не должен запомнить «немые» права как прежние.
  const existing = parseLock(await redis.hget(lockKey(club.key), chatId).catch(() => null))
  const prev = existing?.prev ?? (await chatPermissions(club, msg.chat.id))
  const r = await club.bot.request('setChatPermissions', { chat_id: msg.chat.id, permissions: SILENT, use_independent_chat_permissions: true })
  if (!r.ok) return void (await reply(`Не получилось закрыть чат: ${r.error}. ${RIGHTS_HINT}`))
  const lock: ChatLock = { until: Date.now() + sec * 1000, prev, threadId: msg.message_thread_id ?? null }
  await redis.hset(lockKey(club.key), chatId, JSON.stringify(lock))
  await reply(`🔇 Чат закрыт на ${durationText(sec)}. Писать могут только админы. Открыть раньше — /unmutechat`)
}

async function unlockChat(club: TgClub, chatId: string, threadId: number | null): Promise<boolean> {
  const redis = getSharedRedis()
  const lock = parseLock(await redis.hget(lockKey(club.key), chatId).catch(() => null))
  const r = await club.bot.request('setChatPermissions', { chat_id: chatId, permissions: lock?.prev ?? OPEN, use_independent_chat_permissions: true })
  if (!r.ok) return false
  await redis.hdel(lockKey(club.key), chatId).catch(() => undefined)
  await club.bot.send(chatId, '🔊 Чат снова открыт — можно писать.', { threadId: lock?.threadId ?? threadId })
  return true
}

async function restrict(club: TgClub, msg: TgMessage, args: string[], reply: Reply): Promise<void> {
  const target = await targetOf(club, msg, args)
  if (!target) return void (await reply('Кого? Ответьте командой на сообщение человека или укажите @ник.'))
  const { sec, reason } = durationAndReason(args, DEFAULT_MUTE_SEC)
  const forSec = clampUser(sec ?? DEFAULT_MUTE_SEC)
  const r = await club.bot.request('restrictChatMember', {
    chat_id: msg.chat.id, user_id: target.id, permissions: SILENT, use_independent_chat_permissions: true,
    until_date: Math.floor(Date.now() / 1000) + forSec,
  })
  if (!r.ok) return void (await reply(refusal(r.error, 'Админа замолчать')))
  await reply(`🤐 ${mention(target)} молчит ${durationText(forSec)}.${reason ? ` Причина: ${escapeHtml(reason)}` : ''}`)
}

async function unrestrict(club: TgClub, msg: TgMessage, args: string[], reply: Reply): Promise<void> {
  const target = await targetOf(club, msg, args)
  if (!target) return void (await reply('Кому вернуть голос? Ответьте на его сообщение или укажите @ник.'))
  const r = await club.bot.request('restrictChatMember', { chat_id: msg.chat.id, user_id: target.id, permissions: await chatPermissions(club, msg.chat.id), use_independent_chat_permissions: true })
  await reply(r.ok ? `🗣 ${mention(target)} снова может писать.` : `Не получилось: ${r.error}`)
}

async function ban(club: TgClub, msg: TgMessage, args: string[], reply: Reply, kick: boolean): Promise<void> {
  const target = await targetOf(club, msg, args)
  if (!target) return void (await reply('Кого? Ответьте командой на сообщение человека или укажите @ник.'))
  const { sec, reason } = durationAndReason(args, null)
  const r = await club.bot.request('banChatMember', {
    chat_id: msg.chat.id, user_id: target.id,
    ...(sec && !kick ? { until_date: Math.floor(Date.now() / 1000) + clampUser(sec) } : {}),
  })
  if (!r.ok) return void (await reply(refusal(r.error, 'Админа так выгнать')))
  // Выгнать = бан и сразу разбан: вернуться можно по ссылке.
  if (kick) await club.bot.request('unbanChatMember', { chat_id: msg.chat.id, user_id: target.id, only_if_banned: true })
  const what = kick ? '👢 выгнан из чата' : sec ? `⛔️ забанен на ${durationText(clampUser(sec))}` : '⛔️ забанен навсегда'
  await reply(`${mention(target)} ${what}.${reason ? ` Причина: ${escapeHtml(reason)}` : ''}`)
}

async function unban(club: TgClub, msg: TgMessage, args: string[], reply: Reply): Promise<void> {
  const target = await targetOf(club, msg, args)
  if (!target) return void (await reply('Кого разбанить? Укажите @ник или ответьте на его сообщение.'))
  const r = await club.bot.request('unbanChatMember', { chat_id: msg.chat.id, user_id: target.id, only_if_banned: true })
  await reply(r.ok ? `✅ ${mention(target)} разбанен — может вернуться по ссылке.` : `Не получилось: ${r.error}`)
}

async function messageAction(club: TgClub, msg: TgMessage, name: 'del' | 'pin' | 'unpin', reply: Reply): Promise<void> {
  const replied = msg.reply_to_message
  if (name === 'unpin') {
    const r = await club.bot.request('unpinChatMessage', { chat_id: msg.chat.id, ...(replied ? { message_id: replied.message_id } : {}) })
    if (!r.ok) await reply(`Не получилось: ${r.error}`)
    return
  }
  if (!replied) return void (await reply(`Ответьте командой /${name} на нужное сообщение.`))
  const r = name === 'del'
    ? await club.bot.request('deleteMessage', { chat_id: msg.chat.id, message_id: replied.message_id })
    : await club.bot.request('pinChatMessage', { chat_id: msg.chat.id, message_id: replied.message_id, disable_notification: true })
  if (!r.ok) return void (await reply(`Не получилось: ${r.error}. ${RIGHTS_HINT}`))
  if (name === 'del') await club.bot.call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id })
}

/** Админская команда в группе. true — сообщение обработано (даже если отказали). */
export async function handleModeration(club: TgClub, msg: TgMessage, config: ChatConfig): Promise<boolean> {
  if (!msg.text || !msg.from || !config.moderation.on) return false
  const cmd = parseCommand(msg.text, await club.bot.username())
  if (!cmd) return false
  const threadId = msg.message_thread_id ?? null
  const reply: Reply = (text) => club.bot.send(msg.chat.id, text, { html: true, threadId, replyTo: msg.message_id })
  if (!(await mayModerate(club, msg))) {
    await reply('Эта команда — только для администраторов чата.')
    return true
  }
  const { name, args } = cmd
  if (name === 'mute') await restrict(club, msg, args, reply)
  else if (name === 'unmute') await unrestrict(club, msg, args, reply)
  else if (name === 'mutechat') await lockChat(club, msg, args, reply)
  else if (name === 'unmutechat') {
    if (!(await unlockChat(club, String(msg.chat.id), threadId))) await reply(`Не получилось открыть чат. ${RIGHTS_HINT}`)
  } else if (name === 'kick' || name === 'ban') await ban(club, msg, args, reply, name === 'kick')
  else if (name === 'unban') await unban(club, msg, args, reply)
  else await messageAction(club, msg, name, reply)
  return true
}

/** Тик раз в минуту: открыть чаты, у которых истёк срок /mutechat. */
export async function runChatUnlocks(db: Database, clubId: string | null): Promise<void> {
  const locks = await getSharedRedis().hgetall(lockKey(clubId ?? 'main')).catch(() => ({}) as Record<string, string>)
  const due = Object.entries(locks).filter(([, raw]) => (parseLock(raw)?.until ?? 0) <= Date.now())
  if (!due.length) return
  const club = await clubForDb(db, clubId)
  if (!club) return
  for (const [chatId] of due) await unlockChat(club, chatId, null)
}
