/**
 * Tai в группах. У каждого чата свои настройки (lib/tgChatConfig, раздел HUB «Telegram»):
 *  • game — игровой чат клуба: опросы, команды-отметки и дерзкие ответы Tai;
 *  • work — рабочий чат персонала: Tai отвечает сотрудникам по работе с правами того,
 *    кто спросил;
 *  • notify — только уведомления клуба: Tai молчит, команды по выбору.
 * Команды чата — modules/tg/commands.ts, приглашение и приветствие — membership.ts.
 */
import { upsertRosterUser } from '../../lib/roster.js'
import { recordChat, recordTopic } from '../../lib/tgChats.js'
import { readPollConfigs } from '../../lib/polls.js'
import { taiStyleLine } from '../../lib/tai.js'
import { moveChatConfig, readChatConfig, type ChatConfig } from '../../lib/tgChatConfig.js'
import type { TgClub } from './club.js'
import { whoIs } from './identity.js'
import type { TgChatMemberUpdate, TgMessage } from './types.js'
import { converse } from './dialog/converse.js'
import { voiceToText } from './private.js'
import { handleStaffAnswer } from './dialog/request-desk.js'
import { handleChatCommand, nicknamesByTgId } from './commands.js'
import { chatContext, rememberLine, taiSays } from './chatTai.js'
import { maybeJoinConversation } from './fun.js'
import { handleModeration } from './moderation.js'
import { handleStartInGroup, onBotMembership as onMembership, welcomeNewMembers } from './membership.js'

// Tai-чат: анти-спам — 1 ответ в 12 с на человека.
const TAI_COOLDOWN_MS = 12 * 1000
const lastTaiReply = new Map<string, number>()
// Не-сотрудник обратился к Tai в рабочем чате — отвечаем не чаще раза в 10 минут.
const NOT_STAFF_THROTTLE_MS = 10 * 60 * 1000
const lastNotStaff = new Map<string, number>()

// Сообщение адресовано Tai: реплай на сообщение бота, упоминание @бота или «tai/тай» словом.
function directedAtTai(msg: TgMessage, botUsername: string | null): boolean {
  if (msg.reply_to_message?.from?.is_bot) return true
  const text = String(msg.text ?? '').trim()
  if (!text || text.startsWith('/')) return false
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true
  return /(^|[^a-zа-яё0-9])(tai|тай)([^a-zа-яё0-9]|$)/i.test(text)
}

/** Ответ Tai в игровой чат — стилем, жёсткостью и указаниями этого чата. */
async function handleBanter(club: TgClub, msg: TgMessage, config: ChatConfig): Promise<void> {
  const chatId = msg.chat.id
  const text = String(msg.text ?? '').trim()
  if (!text) return
  const key = `${chatId}:${msg.from?.id}`
  const now = Date.now()
  if (now - (lastTaiReply.get(key) ?? 0) < TAI_COOLDOWN_MS) return
  lastTaiReply.set(key, now)

  const fromName = await speakerName(club, msg)
  const replyText = msg.reply_to_message?.text ? String(msg.reply_to_message.text).slice(0, 300) : ''
  const userMessage = replyText ? `${fromName} отвечает на твою реплику «${replyText}»: ${text}` : `${fromName} пишет: ${text}`
  const reply = await taiSays(club, chatId, config, { kind: 'reply', userMessage }, chatContext(chatId, true))
  if (reply) await club.bot.send(chatId, reply, { threadId: msg.message_thread_id ?? null, replyTo: msg.message_id })
}

/** Как Tai зовёт человека: ник клиента клуба, иначе имя из Telegram. */
async function speakerName(club: TgClub, msg: TgMessage): Promise<string> {
  const from = msg.from
  if (!from) return 'кто-то'
  const nick = (await nicknamesByTgId(club.db, [String(from.id)])).get(String(from.id))
  return nick || from.first_name || (from.username ? '@' + from.username : 'кто-то')
}

/** Рабочий чат: отвечаем сотруднику по работе от его имени. */
async function handleWorkChat(club: TgClub, msg: TgMessage, config: ChatConfig): Promise<void> {
  const from = msg.from!
  const person = await whoIs(club.db, from)
  if (!person.staff) {
    const key = `${msg.chat.id}:${from.id}`
    if (Date.now() - (lastNotStaff.get(key) ?? 0) > NOT_STAFF_THROTTLE_MS) {
      lastNotStaff.set(key, Date.now())
      await club.bot.send(msg.chat.id, 'Я тут помогаю сотрудникам клуба по работе 🙂 Если ты из команды — привяжи Telegram к своему профилю в HUB.', { threadId: msg.message_thread_id ?? null, replyTo: msg.message_id })
    }
    return
  }
  let text = String(msg.text ?? msg.caption ?? '').trim()
  let voice = false
  const file = msg.voice ?? msg.audio ?? msg.video_note
  if (file) {
    const heard = await voiceToText(club, file)
    if (!heard) return
    text = heard
    voice = true
  }
  if (!text) return
  await converse(club, person, null, {
    chatId: String(msg.chat.id),
    threadId: msg.message_thread_id ?? null,
    replyTo: msg.message_id,
    groupTitle: msg.chat.title ?? 'Рабочий чат',
    style: { line: taiStyleLine(config.tai.preset, config.tai.harshness, config.tai.custom), profanity: config.tai.profanity },
  }, text, voice)
}

/** Ответ сотрудника на вопрос Tai по заявке гостя — Tai передаёт его гостю. */
async function relayStaffAnswer(club: TgClub, msg: TgMessage): Promise<boolean> {
  if (!msg.reply_to_message?.from?.is_bot) return false
  const file = msg.voice ?? msg.audio ?? msg.video_note
  const answer = file ? ((await voiceToText(club, file)) ?? '') : String(msg.text ?? msg.caption ?? '')
  const replyToGuest = (c: TgClub, guest: Awaited<ReturnType<typeof whoIs>>, contact: Parameters<typeof converse>[2], chatId: string, text: string) =>
    converse(c, guest, contact, { chatId, threadId: null, replyTo: null, groupTitle: null }, text, false)
  return handleStaffAnswer(club, msg, answer, replyToGuest)
}

/** Служебные сообщения о входе/выходе: приветствие и уборка. true — обработано. */
async function handleServiceMessage(club: TgClub, msg: TgMessage): Promise<boolean> {
  if (msg.new_chat_members?.length) {
    await welcomeNewMembers(club, msg)
    return true
  }
  if (msg.left_chat_member) {
    const config = await readChatConfig(club.db, String(msg.chat.id))
    if (config.welcome.deleteService) await club.bot.call('deleteMessage', { chat_id: msg.chat.id, message_id: msg.message_id })
    return true
  }
  return false
}

/** Сообщение в группе: ростер/чаты всегда; команды и ответы — только на новые сообщения. */
export async function onGroupMessage(club: TgClub, msg: TgMessage, edited: boolean): Promise<void> {
  const db = club.db
  if (msg.from) await upsertRosterUser(db, msg.from, msg.chat.id)
  for (const u of msg.new_chat_members ?? []) await upsertRosterUser(db, u, msg.chat.id)
  await recordChat(db, msg.chat)
  if (msg.message_thread_id != null || msg.is_topic_message) {
    await recordTopic(db, msg.chat.id, msg.message_thread_id, msg.forum_topic_created?.name ?? msg.reply_to_message?.forum_topic_created?.name ?? null)
  }
  if (edited) return
  // Группа стала супергруппой: у неё новый id — настройки переезжают вместе с ней.
  if (msg.migrate_to_chat_id) {
    await moveChatConfig(db, String(msg.chat.id), String(msg.migrate_to_chat_id))
    return
  }
  if (await handleServiceMessage(club, msg)) return
  if (!msg.from || msg.from.is_bot) return
  if (await handleStartInGroup(club, msg)) return

  const config = await readChatConfig(db, String(msg.chat.id))
  if (msg.text && config.mode === 'game' && !msg.text.startsWith('/')) rememberLine(msg.chat.id, await speakerName(club, msg), msg.text)
  if (await handleModeration(club, msg, config)) return
  if (await handleChatCommand(club, msg, config)) return
  if (await relayStaffAnswer(club, msg)) return

  if (!config.tai.on || config.mode === 'notify') return
  const botUsername = await club.bot.username()
  const voiceReplyToBot = !!(msg.voice && msg.reply_to_message?.from?.is_bot)
  if (!directedAtTai(msg, botUsername) && !voiceReplyToBot) {
    await maybeJoinConversation(club, msg, config)
    return
  }
  if (config.mode === 'work') await handleWorkChat(club, msg, config)
  else if (msg.text) await handleBanter(club, msg, config)
}

/** Бота добавили в группу или убрали из неё. */
export async function onBotMembership(club: TgClub, upd: TgChatMemberUpdate): Promise<void> {
  // Без приглашения из HUB: чат сотрудника (и не чат опросов) считаем рабочим.
  const addedByStaff = async () => {
    const pollChats = new Set((await readPollConfigs(club.db)).map((c) => c.chatId))
    if (pollChats.has(String(upd.chat.id))) return false
    return (await whoIs(club.db, upd.from)).staff
  }
  await onMembership(club, upd, addedByStaff)
}
