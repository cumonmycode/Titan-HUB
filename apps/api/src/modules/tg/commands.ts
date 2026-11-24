/**
 * Команды группового чата. У каждого чата свой список (lib/tgChatConfig):
 * встроенные отметки (@all, @tvari, …), /stream, /games, /rules и /help, и свои —
 * ответ текстом, отметка людей, задание для Tai, случайный человек, ближайшие игры,
 * стрим или сегодняшний опрос. Вызов — /name, /name@бот или словом из aliases.
 * Кто может вызывать — админы чата или все; не-админам — не чаще раза в N минут.
 * Админские /mute и т. п. — moderation.ts (в меню «/» видны только админам).
 */
import { profiles, inArray, isNull, and, type Database } from '@titan/database'
import { listRosterForChat, listRoster } from '../../lib/roster.js'
import { lastPollForChat, voteMapOfPoll } from '../../lib/pollState.js'
import { readAliases } from '../../lib/tgAliases.js'
import { isTelegramChatAdmin } from '../../lib/telegram.js'
import { escapeHtml, type TgBot } from '../../lib/tgBot.js'
import { type ChatCommand, type ChatConfig, type MentionAudience } from '../../lib/tgChatConfig.js'
import type { TgClub } from './club.js'
import type { TgMessage } from './types.js'
import { taiSays } from './chatTai.js'
import { gameConfigs, nightLabel, upcomingNights } from './games.js'
import { MODERATION_COMMANDS } from './moderation.js'
import { publishedStream, streamCommandReply } from './streams.js'

type MentionTarget = { tgId: string; username: string | null; firstName: string | null }

const CMD_WARN_THROTTLE_MS = 60 * 1000
const MENTION_CHUNK = 50
const lastCmdRun = new Map<string, number>()
const lastCmdWarn = new Map<string, number>()

/** Первое слово сообщения → команда чата (или null). */
export function matchCommand(text: string | undefined, list: ChatCommand[], botUsername: string | null): ChatCommand | null {
  const first = (text ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  if (!first) return null
  let word = first
  if (word.startsWith('/')) {
    const [name, target] = word.slice(1).split('@')
    // /cmd@другой_бот — не нам.
    if (target && botUsername && target !== botUsername.toLowerCase()) return null
    word = `/${name}`
  }
  return list.find((c) => c.enabled && (word === `/${c.name}` || c.aliases.includes(word))) ?? null
}

const normOpt = (s: string): string => s.trim().toLowerCase()
const dedup = <T extends { tgId: string }>(arr: T[]): T[] => {
  const seen = new Set<string>()
  return arr.filter((u) => (seen.has(u.tgId) ? false : (seen.add(u.tgId), true)))
}

// tgId → ник клиента клуба (основной tg_id, затем доп. аккаунты).
export async function nicknamesByTgId(db: Database, tgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(tgIds.filter(Boolean))]
  if (ids.length === 0) return out
  const direct = await db.select({ tgId: profiles.tgId, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.tgId, ids))
  for (const p of direct) if (p.tgId) out.set(p.tgId, p.nickname)
  const aliasMap = await readAliases(db)
  const pending = ids.filter((t) => !out.has(t) && aliasMap[t])
  if (pending.length) {
    const profileIds = [...new Set(pending.map((t) => aliasMap[t]!.profileId))]
    const rows = await db.select({ id: profiles.id, nickname: profiles.nickname }).from(profiles).where(inArray(profiles.id, profileIds))
    const byId = new Map(rows.map((p) => [p.id, p.nickname]))
    for (const t of pending) {
      const nick = byId.get(aliasMap[t]!.profileId)
      if (nick) out.set(t, nick)
    }
  }
  return out
}

/** Сотрудники клуба из ростера чата: по основному tg_id и доп. аккаунтам. */
async function staffInChat(db: Database, roster: MentionTarget[]): Promise<MentionTarget[]> {
  if (!roster.length) return []
  const staff = await db.select({ id: profiles.id, tgId: profiles.tgId }).from(profiles).where(and(inArray(profiles.role, ['owner', 'staff']), isNull(profiles.deletedAt)))
  const staffIds = new Set(staff.map((s) => s.id))
  const staffTg = new Set(staff.map((s) => s.tgId).filter(Boolean) as string[])
  const aliases = await readAliases(db)
  return roster.filter((u) => staffTg.has(u.tgId) || (aliases[u.tgId] && staffIds.has(aliases[u.tgId]!.profileId)))
}

type Resolved = { targets: MentionTarget[] } | { error: string }

async function resolveAudience(db: Database, chatId: string, audience: MentionAudience): Promise<Resolved> {
  const chatRoster = await listRosterForChat(db, chatId)
  if (audience === 'all') return { targets: chatRoster }
  if (audience === 'staff') return { targets: await staffInChat(db, chatRoster) }
  const last = await lastPollForChat(db, chatId)
  if (!last) return { error: 'Нет последнего опроса для этого чата.' }
  const voteMap = await voteMapOfPoll(db, last.pollId)
  const options = last.options ?? []
  const byId = new Map((await listRoster(db)).map((u) => [u.tgId, u]))
  const lookup = (tgId: string): MentionTarget => byId.get(tgId) ?? { tgId, username: null, firstName: null }
  const votedFor = (label: string): MentionTarget[] | null => {
    const idx = options.findIndex((o) => normOpt(o) === label)
    return idx < 0 ? null : Object.keys(voteMap).filter((tg) => voteMap[tg]!.includes(idx)).map(lookup)
  }
  if (audience === 'unvoted') {
    const voters = new Set(Object.keys(voteMap))
    return { targets: dedup([...chatRoster.filter((u) => !voters.has(u.tgId)), ...(votedFor('думаю') ?? [])]) }
  }
  const label = audience === 'yes' ? 'да' : 'нет'
  const list = votedFor(label)
  return list ? { targets: list } : { error: `В последнем опросе нет варианта «${label === 'да' ? 'Да' : 'Нет'}».` }
}

const EMPTY_TEXT: Record<MentionAudience, string> = {
  all: 'Список участников пуст — бот ещё никого здесь не видел.',
  staff: 'Сотрудников клуба в этом чате бот ещё не видел.',
  unvoted: '✅ Все определились!',
  yes: 'Никто не выбрал «Да».',
  no: 'Никто не выбрал «Нет».',
}

type Send = (text: string, html?: boolean) => Promise<unknown>

async function sendMentions(db: Database, send: Send, cmd: ChatCommand, targets: MentionTarget[]): Promise<void> {
  if (targets.length === 0) {
    await send(EMPTY_TEXT[cmd.audience ?? 'all'])
    return
  }
  // Видимый текст — ник клиента клуба; ссылка tg://user?id=… всё равно пингует.
  const nickByTg = await nicknamesByTgId(db, targets.map((u) => u.tgId))
  const header = cmd.text?.trim() ? escapeHtml(cmd.text.trim()) : ''
  for (let i = 0; i < targets.length; i += MENTION_CHUNK) {
    const mentions = targets
      .slice(i, i + MENTION_CHUNK)
      .map((u) => `<a href="tg://user?id=${u.tgId}">${escapeHtml(nickByTg.get(u.tgId) || u.firstName || (u.username ? '@' + u.username : 'участник'))}</a>`)
      .join(' ')
    await send(i === 0 && header ? `${header}\n${mentions}` : mentions, true)
  }
}

/** Видна ли команда сейчас: /rules — только когда правила заданы. */
const commandVisible = (c: ChatCommand, config: ChatConfig): boolean => c.enabled && (c.kind !== 'rules' || !!config.welcome.rules.trim())

export function helpText(config: ChatConfig): string {
  const lines = config.commands.list
    .filter((c) => commandVisible(c, config) && c.kind !== 'help')
    .map((c) => `/${c.name}${c.aliases.length ? ` (${c.aliases.join(', ')})` : ''} — ${c.description}`)
  const tai = config.tai.on ? '\n\nКо мне можно обратиться «Тай, …» или ответом на моё сообщение.' : ''
  const mod = config.moderation.on ? '\nАдминам: /mute, /unmute, /mutechat, /unmutechat, /kick, /ban, /unban, /del, /pin.' : ''
  return (lines.length ? `Команды чата:\n${lines.join('\n')}${tai}` : `В этом чате команд нет.${tai}`) + mod
}

async function cooldownPassed(send: Send, key: string, minutes: number): Promise<boolean> {
  const now = Date.now()
  const windowMs = minutes * 60_000
  const since = now - (lastCmdRun.get(key) ?? 0)
  if (since >= windowMs) {
    lastCmdRun.set(key, now)
    return true
  }
  if (now - (lastCmdWarn.get(key) ?? 0) > CMD_WARN_THROTTLE_MS) {
    lastCmdWarn.set(key, now)
    await send(`⏳ Эту команду можно раз в ${minutes} мин. Подождите ещё ~${Math.ceil((windowMs - since) / 60000)} мин.`)
  }
  return false
}

/** Выполнить команду, если сообщение — команда этого чата. true — сообщение обработано. */
export async function handleChatCommand(club: TgClub, msg: TgMessage, config: ChatConfig): Promise<boolean> {
  if (!msg.text || !msg.from) return false
  const chatId = String(msg.chat.id)
  const cmd = matchCommand(msg.text, config.commands.list, await club.bot.username())
  if (!cmd) return false

  const threadId = msg.message_thread_id ?? null
  const send: Send = (body, html = false) => club.bot.send(msg.chat.id, body, { threadId, html })

  // Справка и правила — всем и без антиспама: они никого не пингуют.
  if (cmd.kind === 'help') {
    await send(helpText(config))
    return true
  }
  if (cmd.kind === 'rules') {
    await send(config.welcome.rules.trim() || 'Правила чата пока не заданы.')
    return true
  }

  // Стрим, игры и опрос никого не пингуют — всем и без паузы, если владелец не ограничил.
  if (QUIET_KINDS.has(cmd.kind) && !cmd.access) {
    await runAction(club, msg, config, cmd, send)
    return true
  }

  const access = cmd.access ?? config.commands.access
  const isAdmin = await isTelegramChatAdmin(club.bot.token, msg.chat.id, msg.from.id).catch(() => false)
  if (access === 'admins' && !isAdmin) {
    await send('Команда доступна только администраторам чата.')
    return true
  }
  const cooldown = config.commands.cooldownMin
  if (!isAdmin && cooldown > 0 && !(await cooldownPassed(send, `${chatId}:${msg.from.id}:${cmd.id}`, cooldown))) return true

  await runAction(club, msg, config, cmd, send)
  return true
}

const QUIET_KINDS = new Set<ChatCommand['kind']>(['stream', 'games', 'poll'])
const RANDOM_DEFAULT = '🎲 Выбор пал на'
const GAMES_AHEAD = 6

/** Что делает команда — после проверок прав и паузы. */
async function runAction(club: TgClub, msg: TgMessage, config: ChatConfig, cmd: ChatCommand, send: Send): Promise<void> {
  const chatId = String(msg.chat.id)
  const threadId = msg.message_thread_id ?? null
  switch (cmd.kind) {
    case 'text':
      await send(cmd.text?.trim() || cmd.description)
      return
    case 'stream': {
      const reply = streamCommandReply(await publishedStream(club.db))
      await club.bot.send(msg.chat.id, reply.text, { html: true, threadId, ...(reply.markup ? { markup: reply.markup } : {}) })
      return
    }
    case 'games': {
      const nights = upcomingNights(await gameConfigs(club.db), 8).slice(0, GAMES_AHEAD)
      await send(nights.length ? `🗓 Ближайшие игры:\n${nights.map((n) => `• ${nightLabel(n)}`).join('\n')}` : 'Расписание игр пока не заведено.')
      return
    }
    case 'poll': {
      const last = await lastPollForChat(club.db, chatId)
      if (!last) return void (await send('Сегодняшнего опроса в этом чате нет.'))
      await club.bot.send(msg.chat.id, cmd.description || '👆 Вот опрос — отмечайтесь!', { threadId: last.threadId ?? threadId, replyTo: last.messageId })
      return
    }
    case 'tai': {
      const words = String(msg.text ?? '').trim().split(/\s+/).slice(1).join(' ')
      const said = await taiSays(club, chatId, config, { kind: 'command', instruction: cmd.text?.trim() || cmd.description, userMessage: words })
      await club.bot.send(msg.chat.id, said ?? 'Что-то я задумался… попробуй ещё раз 🙃', { threadId, replyTo: msg.message_id })
      return
    }
    case 'random': {
      const resolved = await resolveAudience(club.db, chatId, cmd.audience ?? 'all')
      if ('error' in resolved) return void (await send(resolved.error))
      const pool = resolved.targets.filter((u) => u.tgId !== String(msg.from?.id ?? ''))
      const pick = pool[Math.floor(Math.random() * pool.length)]
      if (!pick) return void (await send(EMPTY_TEXT[cmd.audience ?? 'all']))
      const nick = (await nicknamesByTgId(club.db, [pick.tgId])).get(pick.tgId) || pick.firstName || (pick.username ? `@${pick.username}` : 'участник')
      await send(`${escapeHtml(cmd.text?.trim() || RANDOM_DEFAULT)} <a href="tg://user?id=${pick.tgId}">${escapeHtml(nick)}</a>`, true)
      return
    }
    default: {
      const resolved = await resolveAudience(club.db, chatId, cmd.audience ?? 'all')
      if ('error' in resolved) await send(resolved.error)
      else await sendMentions(club.db, send, cmd, resolved.targets)
    }
  }
}

/**
 * Меню «/» в Telegram для конкретного чата: включённые команды этого чата.
 * Пустой список — убираем меню чата (Telegram покажет общее меню бота).
 */
export async function syncCommandMenu(bot: TgBot, chatId: string, config: ChatConfig): Promise<boolean> {
  const scope = { type: 'chat', chat_id: chatId }
  const adminScope = { type: 'chat_administrators', chat_id: chatId }
  const commands = config.commands.list
    .filter((c) => commandVisible(c, config))
    .slice(0, 80)
    .map((c) => ({ command: c.name, description: c.description.slice(0, 256) || c.name }))
  const taken = new Set(commands.map((c) => c.command))
  const moderation = config.moderation.on ? MODERATION_COMMANDS.filter((m) => !taken.has(m.name)).map((m) => ({ command: m.name, description: m.description })) : []
  const admins = [...commands, ...moderation]
  const setOrDelete = async (sc: Record<string, unknown>, list: { command: string; description: string }[]) =>
    list.length ? (await bot.call<boolean>('setMyCommands', { scope: sc, commands: list })) === true : (await bot.call<boolean>('deleteMyCommands', { scope: sc })) === true
  const [forAll, forAdmins] = await Promise.all([setOrDelete(scope, commands), setOrDelete(adminScope, admins)])
  return forAll && forAdmins
}
