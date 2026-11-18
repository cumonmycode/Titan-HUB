/**
 * Бот и участники группы: добавление бота по ссылке-приглашению из HUB, статус
 * бота в чате (админ / участник / удалён) и приветствие новичков.
 *
 * Приглашение: HUB создаёт код с назначением чата (игровой / рабочий / уведомления)
 * и открывает t.me/<бот>?startgroup=<код>. Telegram добавляет бота в выбранную
 * группу и шлёт туда «/start@бот <код>» — по коду чат сразу получает заготовку
 * настроек, а HUB, опрашивая код, узнаёт, какой чат появился.
 */
import { randomBytes } from 'node:crypto'
import { getSharedRedis } from '../../lib/redis.js'
import { escapeHtml } from '../../lib/tgBot.js'
import { recordChat } from '../../lib/tgChats.js'
import { chatConfigured, presetFor, readChatConfig, replaceChatConfig, setBotStatus, type ChatMode } from '../../lib/tgChatConfig.js'
import type { TgClub } from './club.js'
import { syncCommandMenu } from './commands.js'
import type { TgChatMemberUpdate, TgMessage, TgUser } from './types.js'

const INVITE_TTL_SEC = 24 * 3600
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{6,64}$/
const inviteKey = (clubKey: string, code: string) => `tg:invite:${clubKey}:${code}`

export interface Invite { mode: ChatMode; by: string; chatId: string | null; title: string | null }

/** Права администратора, которые Telegram предложит выдать боту при добавлении. */
export const INVITE_ADMIN_RIGHTS = 'delete_messages+pin_messages+invite_users+manage_topics'

export async function createInvite(clubKey: string, mode: ChatMode, by: string): Promise<string> {
  const code = randomBytes(9).toString('base64url')
  const invite: Invite = { mode, by, chatId: null, title: null }
  await getSharedRedis().set(inviteKey(clubKey, code), JSON.stringify(invite), 'EX', INVITE_TTL_SEC)
  return code
}

export async function readInvite(clubKey: string, code: string): Promise<Invite | null> {
  if (!INVITE_CODE_RE.test(code)) return null
  const raw = await getSharedRedis().get(inviteKey(clubKey, code)).catch(() => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Invite
  } catch {
    return null
  }
}

const HELLO: Record<ChatMode, string> = {
  game: 'Привет! 👋 Я Tai, бот клуба. Буду выкладывать опросы и отмечать игроков. Команды — /help, ко мне — «Тай, …».',
  work: 'Привет, команда! 👋 Я Tai. Спрашивайте про смену, кассу, выручку, склад, кто записался — «Тай, …» или ответом на моё сообщение. Можно голосом.',
  notify: 'Привет! 👋 Сюда я буду присылать уведомления клуба. Что именно — настраивается в Titan HUB → Telegram.',
}

async function greetAndSync(club: TgClub, chatId: string, mode: ChatMode, threadId: number | null): Promise<void> {
  await club.bot.send(chatId, HELLO[mode], { threadId })
  await syncCommandMenu(club.bot, chatId, await readChatConfig(club.db, chatId))
}

/** «/start@бот <код>» в группе: применить заготовку приглашения. true — обработано. */
export async function handleStartInGroup(club: TgClub, msg: TgMessage): Promise<boolean> {
  const [first, payload] = String(msg.text ?? '').trim().split(/\s+/)
  if (!first?.toLowerCase().startsWith('/start')) return false
  const [, target] = first.split('@')
  const me = await club.bot.username()
  if (target && me && target.toLowerCase() !== me.toLowerCase()) return false
  if (!payload) return false

  const invite = await readInvite(club.key, payload)
  if (!invite) return true
  const chatId = String(msg.chat.id)
  await replaceChatConfig(club.db, chatId, presetFor(invite.mode))
  await recordChat(club.db, msg.chat)
  const claimed: Invite = { ...invite, chatId, title: msg.chat.title ?? null }
  await getSharedRedis().set(inviteKey(club.key, payload), JSON.stringify(claimed), 'EX', INVITE_TTL_SEC).catch(() => undefined)
  await club.bot.call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id })
  await greetAndSync(club, chatId, invite.mode, msg.message_thread_id ?? null)
  return true
}

/**
 * Статус бота в группе поменялся. Удалили — помечаем чат (уведомления туда не идут).
 * Добавили без приглашения и это сделал сотрудник — чат рабочий, как раньше.
 */
export async function onBotMembership(club: TgClub, upd: TgChatMemberUpdate, addedByStaff: () => Promise<boolean>): Promise<void> {
  if (upd.chat.type === 'private') return
  const chatId = String(upd.chat.id)
  const status = upd.new_chat_member?.status
  if (status === 'left' || status === 'kicked') {
    await setBotStatus(club.db, chatId, status)
    return
  }
  if (status !== 'member' && status !== 'administrator' && status !== 'restricted') return
  const wasConfigured = await chatConfigured(club.db, chatId)
  await setBotStatus(club.db, chatId, status === 'administrator' ? 'administrator' : 'member')
  // Приглашение из HUB применится по «/start <код>», который Telegram шлёт следом.
  if (wasConfigured || !(await addedByStaff())) return
  await replaceChatConfig(club.db, chatId, presetFor('work'))
  await greetAndSync(club, chatId, 'work', null)
}

const mentionOf = (u: TgUser) => `<a href="tg://user?id=${u.id}">${escapeHtml(u.first_name || (u.username ? '@' + u.username : 'гость'))}</a>`

/** Новички в группе: приветствие по шаблону и, если нужно, удаление служебного сообщения. */
export async function welcomeNewMembers(club: TgClub, msg: TgMessage): Promise<void> {
  const people = (msg.new_chat_members ?? []).filter((u) => !u.is_bot)
  if (!people.length) return
  const config = await readChatConfig(club.db, String(msg.chat.id))
  if (config.welcome.deleteService) await club.bot.call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id })
  if (!config.welcome.on || !config.welcome.text.trim()) return
  const text = escapeHtml(config.welcome.text.trim())
    .replaceAll('{name}', people.map(mentionOf).join(', '))
    .replaceAll('{chat}', escapeHtml(msg.chat.title ?? 'чат'))
  await club.bot.send(msg.chat.id, text, { html: true, threadId: msg.message_thread_id ?? null })
}
