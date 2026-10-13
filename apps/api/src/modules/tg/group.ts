/**
 * Tai в группах. Два режима на чат (app_settings.tai_chat_settings[chatId].mode):
 *  • game — игровые чаты клуба: опросы, команды-отметки (@all/@tvari/…) и дерзкие
 *    ответы Tai, когда к нему обращаются;
 *  • work — рабочий чат персонала: Tai отвечает сотрудникам по работе (смена,
 *    касса, цифры, кто записался) с правами того, кто спросил.
 * Режим ставится сам: добавил Tai в группу сотрудник и это не чат опросов — work.
 */
import { appSettings, profiles, inArray, type Database } from '@titan/database'
import { upsertRosterUser, listRosterForChat, listRoster } from '../../lib/roster.js'
import { lastPollForChat, voteMapOfPoll } from '../../lib/pollState.js'
import { getBoolSetting, getStringSetting } from '../../lib/appSettings.js'
import { recordChat, recordTopic } from '../../lib/tgChats.js'
import { readAliases } from '../../lib/tgAliases.js'
import { isTelegramChatAdmin } from '../../lib/telegram.js'
import { taiChatReply, taiStyleLine } from '../../lib/tai.js'
import { escapeHtml } from '../../lib/tgBot.js'
import { readPollConfigs } from '../../lib/polls.js'
import type { TgClub } from './club.js'
import { whoIs } from './identity.js'
import type { TgChatMemberUpdate, TgMessage } from './types.js'
import { converse } from './dialog/converse.js'
import { voiceToText } from './private.js'
import { handleStaffAnswer } from './dialog/request-desk.js'

type MentionTarget = { tgId: string; username: string | null; firstName: string | null }
type MentionCommand = 'all' | 'tvari' | 'supertvari' | 'lubimki'
export type ChatMode = 'work' | 'game'

// Антиспам: команды-отметки — не чаще раза в 10 минут от одного пользователя в чате.
const CMD_COOLDOWN_MS = 10 * 60 * 1000
const CMD_WARN_THROTTLE_MS = 60 * 1000
const lastCmdRun = new Map<string, number>()
const lastCmdWarn = new Map<string, number>()
// Tai-чат: анти-спам (1 ответ в 12с/польз.) + короткая память чата для контекста.
const TAI_COOLDOWN_MS = 12 * 1000
const lastTaiReply = new Map<string, number>()
const TAI_BUF_MAX = 8
const taiBuffer = new Map<string, { name: string; text: string }[]>()
// Не-сотрудник обратился к Tai в рабочем чате — отвечаем не чаще раза в 10 минут.
const NOT_STAFF_THROTTLE_MS = 10 * 60 * 1000
const lastNotStaff = new Map<string, number>()

const SETTINGS_KEY = 'tai_chat_settings'

/** Настройки Tai в группе: режим, стиль, жёсткость и мат — у каждого чата свои. */
export interface ChatPrefs { enabled?: boolean; profanity?: boolean; harshness?: string; preset?: string; mode?: ChatMode }
const WORK_DEFAULTS: ChatPrefs = { mode: 'work', preset: 'friendly', harshness: 'soft', profanity: false }

async function readChatPrefs(db: Database): Promise<Record<string, ChatPrefs>> {
  try {
    const raw = await getStringSetting(SETTINGS_KEY, '', db)
    return raw ? (JSON.parse(raw) as Record<string, ChatPrefs>) : {}
  } catch {
    return {}
  }
}

async function writeChatPrefs(db: Database, map: Record<string, ChatPrefs>): Promise<void> {
  const value = JSON.stringify(map)
  await db.insert(appSettings).values({ key: SETTINGS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

/** Режим чата: явная настройка; иначе чат опросов и прочие — игровой. */
export async function chatMode(db: Database, chatId: string): Promise<ChatMode> {
  const prefs = (await readChatPrefs(db))[chatId]
  return prefs?.mode === 'work' ? 'work' : 'game'
}

function pushTaiBuffer(chatId: string | number | null | undefined, name: string, text: string): void {
  if (!chatId || !text) return
  const k = String(chatId)
  const arr = taiBuffer.get(k) ?? []
  arr.push({ name, text: text.slice(0, 300) })
  while (arr.length > TAI_BUF_MAX) arr.shift()
  taiBuffer.set(k, arr)
}

// Сообщение адресовано Tai: реплай на сообщение бота, упоминание @бота или «tai/тай» словом.
function directedAtTai(msg: TgMessage, botUsername: string | null): boolean {
  if (msg.reply_to_message?.from?.is_bot) return true
  const text = String(msg.text ?? '').trim()
  if (!text || text.startsWith('/')) return false
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true
  return /(^|[^a-zа-яё0-9])(tai|тай)([^a-zа-яё0-9]|$)/i.test(text)
}

// tgId → ник сопоставленного клиента (profiles.tg_id, затем доп. аккаунты).
async function clientNicknamesByTgId(db: Database, tgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(tgIds.filter(Boolean))]
  if (ids.length === 0) return out
  const direct = await db.select({ tgId: profiles.tgId, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.tgId, ids))
  for (const p of direct) if (p.tgId) out.set(p.tgId, p.nickname)
  const aliasMap = await readAliases(db)
  const pending = ids.filter((t) => !out.has(t) && aliasMap[t])
  if (pending.length) {
    const profileIds = [...new Set(pending.map((t) => aliasMap[t]!.profileId))]
    const aprofs = await db.select({ id: profiles.id, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.id, profileIds))
    const byId = new Map(aprofs.map((p) => [p.id, p.nickname]))
    for (const t of pending) { const nick = byId.get(aliasMap[t]!.profileId); if (nick) out.set(t, nick) }
  }
  return out
}

// Дерзкий ответ Tai в игровой чат. Гейт: мастер-тумблер + пер-групповой enabled.
async function handleBanter(club: TgClub, msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id
  const text = String(msg.text ?? '').trim()
  if (!text) return
  const db = club.db
  if (!(await getBoolSetting('tai_chat_enabled', false, db))) return
  const p = (await readChatPrefs(db))[String(chatId)] ?? {}
  if (p.enabled === false) return

  const key = `${chatId}:${msg.from?.id}`
  const now = Date.now()
  if (now - (lastTaiReply.get(key) ?? 0) < TAI_COOLDOWN_MS) return
  lastTaiReply.set(key, now)

  const fromName = msg.from?.first_name || (msg.from?.username ? '@' + msg.from.username : 'кто-то')
  const replyText = msg.reply_to_message?.text ? String(msg.reply_to_message.text).slice(0, 300) : ''
  const ctxArr = (taiBuffer.get(String(chatId)) ?? []).slice(0, -1).slice(-6)
  const context = ctxArr.length ? ctxArr.map((m) => `${m.name}: ${m.text}`).join('\n') : undefined
  const userMessage = replyText ? `${fromName} отвечает на твою реплику «${replyText}»: ${text}` : `${fromName} пишет: ${text}`

  const preset = p.preset || (await getStringSetting('tai_preset', 'roast', db))
  const harshness = p.harshness === 'soft' || p.harshness === 'medium' ? p.harshness : 'savage'
  const reply = await taiChatReply(db, { userMessage, context, preset, harshness, profanity: p.profanity !== false })
  if (reply) {
    pushTaiBuffer(chatId, 'Tai', reply)
    await club.bot.send(chatId, reply, { threadId: msg.message_thread_id ?? null, replyTo: msg.message_id })
  }
}

const normOpt = (s: string): string => s.trim().toLowerCase()
function dedupById<T extends { tgId: string }>(arr: T[]): T[] {
  const seen = new Set<string>()
  return arr.filter((u) => (seen.has(u.tgId) ? false : (seen.add(u.tgId), true)))
}

/**
 * Команды-отметки чата. Только админ чата (или любой — настройка клуба), не-админам
 * не чаще раза в 10 минут. «Участники» = ростер чата (кого бот видел).
 */
async function handleMentionCommand(club: TgClub, msg: TgMessage, cmd: MentionCommand): Promise<void> {
  const db = club.db
  const chatId = msg.chat.id
  const fromId = msg.from?.id
  const threadId = msg.message_thread_id ?? null
  if (!fromId) return
  const send = (text: string, html = false) => club.bot.send(chatId, text, { threadId, html })

  const key = `${chatId}:${fromId}:${cmd}`
  const now = Date.now()
  const adminOnly = await getBoolSetting('poll_commands_admin_only', true, db)
  const isAdmin = await isTelegramChatAdmin(club.bot.token, chatId, fromId).catch(() => false)
  if (adminOnly && !isAdmin) {
    await send('Команда доступна только администраторам чата.')
    return
  }
  if (!isAdmin) {
    const since = now - (lastCmdRun.get(key) ?? 0)
    if (since < CMD_COOLDOWN_MS) {
      if (now - (lastCmdWarn.get(key) ?? 0) > CMD_WARN_THROTTLE_MS) {
        lastCmdWarn.set(key, now)
        await send(`⏳ Команды-отметки можно раз в 10 минут. Подождите ещё ~${Math.ceil((CMD_COOLDOWN_MS - since) / 60000)} мин.`)
      }
      return
    }
  }

  let targets: MentionTarget[] = []
  let header = ''
  let emptyMsg = ''
  if (cmd === 'all') {
    targets = await listRosterForChat(db, String(chatId))
    header = '📣 Участники:'
    emptyMsg = 'Список участников пуст (бот ещё никого не видел).'
  } else {
    const last = await lastPollForChat(db, String(chatId))
    if (!last) {
      await send('Нет последнего опроса для этого чата.')
      return
    }
    const voteMap = await voteMapOfPoll(db, last.pollId)
    const voters = new Set(Object.keys(voteMap))
    const options = last.options ?? []
    const fullRoster = await listRoster(db)
    const byId = new Map(fullRoster.map((u) => [u.tgId, u]))
    const lookup = (tgId: string): MentionTarget => byId.get(tgId) ?? { tgId, username: null, firstName: null }
    const votedFor = (label: string): MentionTarget[] | null => {
      const idx = options.findIndex((o) => normOpt(o) === label)
      return idx < 0 ? null : Object.keys(voteMap).filter((tg) => voteMap[tg]!.includes(idx)).map(lookup)
    }
    if (cmd === 'tvari') {
      const chatRoster = await listRosterForChat(db, String(chatId))
      const thinking = votedFor('думаю')
      targets = dedupById([...chatRoster.filter((u) => !voters.has(u.tgId)), ...(thinking ?? [])])
      header = thinking ? '⚠️ Не отметились или «Думаю»:' : '⚠️ Не отметились в последнем опросе:'
      emptyMsg = '✅ Все определились!'
    } else {
      const label = cmd === 'lubimki' ? 'да' : 'нет'
      const list = votedFor(label)
      if (!list) {
        await send(`В последнем опросе нет варианта «${label === 'да' ? 'Да' : 'Нет'}».`)
        return
      }
      targets = list
      header = cmd === 'lubimki' ? '❤️ Любимки (проголосовали «Да»):' : '🚫 Проголосовали «Нет»:'
      emptyMsg = cmd === 'lubimki' ? 'Никто не выбрал «Да».' : 'Никто не выбрал «Нет».'
    }
  }

  if (!isAdmin) lastCmdRun.set(key, now)
  if (targets.length === 0) {
    await send(emptyMsg)
    return
  }
  // Видимый текст упоминания — ник клиента клуба; ссылка tg://user?id=… всё равно пингует.
  const nickByTg = await clientNicknamesByTgId(db, targets.map((u) => u.tgId))
  const CHUNK = 50
  for (let i = 0; i < targets.length; i += CHUNK) {
    const mentions = targets.slice(i, i + CHUNK)
      .map((u) => `<a href="tg://user?id=${u.tgId}">${escapeHtml(nickByTg.get(u.tgId) || u.firstName || (u.username ? '@' + u.username : 'участник'))}</a>`)
      .join(' ')
    await send(i === 0 ? `${header}\n${mentions}` : mentions, true)
  }
}

function parseMentionCommand(text: string | undefined): MentionCommand | null {
  const first = (text ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  if (first === '@all') return 'all'
  if (first === '@tvari' || first === '@твари') return 'tvari'
  if (first === '@supertvari' || first === '@супертвари') return 'supertvari'
  if (first === '@lubimki' || first === '@любимки') return 'lubimki'
  return null
}

/** Рабочий чат: отвечаем сотруднику по работе от его имени. */
async function handleWorkChat(club: TgClub, msg: TgMessage): Promise<void> {
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
  const p = (await readChatPrefs(club.db))[String(msg.chat.id)] ?? WORK_DEFAULTS
  await converse(club, person, null, {
    chatId: String(msg.chat.id),
    threadId: msg.message_thread_id ?? null,
    replyTo: msg.message_id,
    groupTitle: msg.chat.title ?? 'Рабочий чат',
    style: { line: taiStyleLine(p.preset || 'friendly', p.harshness || 'soft'), profanity: p.profanity === true },
  }, text, voice)
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
  if (edited || !msg.from || msg.from.is_bot) return

  const mode = await chatMode(db, String(msg.chat.id))
  if (msg.text && mode === 'game') pushTaiBuffer(msg.chat.id, msg.from.first_name || msg.from.username || 'гость', msg.text)

  const cmd = parseMentionCommand(msg.text)
  if (cmd) {
    await handleMentionCommand(club, msg, cmd)
    return
  }
  // Ответ сотрудника на вопрос Tai по заявке гостя — Tai передаёт его гостю.
  if (msg.reply_to_message?.from?.is_bot) {
    const file = msg.voice ?? msg.audio ?? msg.video_note
    const answer = file ? ((await voiceToText(club, file)) ?? '') : String(msg.text ?? msg.caption ?? '')
    const replyToGuest = (c: TgClub, guest: Awaited<ReturnType<typeof whoIs>>, contact: Parameters<typeof converse>[2], chatId: string, text: string) =>
      converse(c, guest, contact, { chatId, threadId: null, replyTo: null, groupTitle: null }, text, false)
    if (await handleStaffAnswer(club, msg, answer, replyToGuest)) return
  }
  const botUsername = await club.bot.username()
  const voiceReplyToBot = !!(msg.voice && msg.reply_to_message?.from?.is_bot)
  if (!directedAtTai(msg, botUsername) && !voiceReplyToBot) return
  if (mode === 'work') await handleWorkChat(club, msg)
  else if (msg.text) await handleBanter(club, msg)
}

/**
 * Бота добавили в группу. Добавил сотрудник, и это не чат опросов — считаем чат
 * рабочим и здороваемся с командой.
 */
export async function onBotMembership(club: TgClub, upd: TgChatMemberUpdate): Promise<void> {
  const status = upd.new_chat_member?.status
  if (upd.chat.type === 'private' || (status !== 'member' && status !== 'administrator')) return
  const chatId = String(upd.chat.id)
  const prefs = await readChatPrefs(club.db)
  if (prefs[chatId]?.mode) return
  const pollChats = new Set((await readPollConfigs(club.db)).map((c) => c.chatId))
  if (pollChats.has(chatId)) return
  const adder = await whoIs(club.db, upd.from)
  if (!adder.staff) return
  await writeChatPrefs(club.db, { ...prefs, [chatId]: { ...WORK_DEFAULTS, ...prefs[chatId] } })
  await club.bot.send(
    upd.chat.id,
    'Привет, команда! 👋 Я Tai. Спрашивайте про смену, кассу, выручку, склад, кто записался на игру — обращайтесь «Тай, …» или ответом на моё сообщение. Можно голосом.',
  )
}
