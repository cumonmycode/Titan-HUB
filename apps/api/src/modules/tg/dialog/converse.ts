/**
 * Один ход диалога Tai в Telegram: история → движок Tai → сообщения.
 *
 * Сотрудник получает Tai-коллегу с инструментами кассы (от своего имени, с
 * правами как в HUB), клиент и новый человек — Tai-администратора клуба. Ответ на
 * голосовое — голосовым; карточки действий и выбор — кнопками.
 */
import { randomBytes } from 'node:crypto'
import type { TaiContact } from '@titan/database'
import { getSharedRedis } from '../../../lib/redis.js'
import { runTaiWith, taiErrorMessage, type TaiEnv } from '../../ai/tai/engine.js'
import type { TaiBlock, TaiEvent } from '../../ai/tai/blocks.js'
import { getTaiSettings } from '../../ai/tai/settings.js'
import { resolveApiKey } from '../../ai/tai/llm.js'
import { synthesizeVoiceNote } from '../../ai/tai/speech.js'
import type { ReplyMarkup } from '../../../lib/tgBot.js'
import type { TgClub } from '../club.js'
import { displayName, staffHeaders, type TgPerson } from '../identity.js'
import { clientTools, selfTools, type ClientSession } from './client-tools.js'
import { TELEGRAM_STAFF_TOOLS } from './staff-tools.js'
import { clientPrompt, staffTelegramPrompt } from './prompts.js'
import { actionMarkup, actionText, blockText, choiceMarkup, linksMarkup, mdToHtml, supplyMarkup, supplyText } from './render.js'
import { appendMessage, markBlocked, markOutbound, recentTurns } from './memory.js'
import { activeRequests, requestPrompt, requestTools } from './request-desk.js'

export interface ChatTarget {
  chatId: string
  threadId: number | null
  /** На какое сообщение ответить (в группе — на вопрос). */
  replyTo: number | null
  /** Название рабочего чата; null — личка. */
  groupTitle: string | null
  /** Стиль группового чата (настраивается на каждый чат) и можно ли там материться. */
  style?: { line: string; profanity: boolean }
}

const CHOICE_TTL_SEC = 30 * 60
const TYPING_EVERY_MS = 4_500
const CLIENT_TEMPERATURE = 0.6
const RATE_WINDOW_SEC = 3600
const RATE_LIMIT_CLIENT = 40
const RATE_LIMIT_STAFF = 150
const choiceKey = (clubKey: string, key: string) => `tai:choice:${clubKey}:${key}`

export interface StoredChoice {
  chatId: string
  tgId: string
  replies: string[]
}

export async function loadChoice(clubKey: string, key: string): Promise<StoredChoice | null> {
  const raw = await getSharedRedis().get(choiceKey(clubKey, key)).catch(() => null)
  return raw ? (JSON.parse(raw) as StoredChoice) : null
}

/** Не больше N сообщений в час от человека: Tai стоит денег, а бот открыт всем. */
async function overLimit(club: TgClub, person: TgPerson): Promise<boolean> {
  const key = `tai:rl:${club.key}:${person.tgId}:${Math.floor(Date.now() / (RATE_WINDOW_SEC * 1000))}`
  const redis = getSharedRedis()
  const n = await redis.incr(key).catch(() => 0)
  if (n === 1) await redis.expire(key, RATE_WINDOW_SEC).catch(() => {})
  return n > (person.staff ? RATE_LIMIT_STAFF : RATE_LIMIT_CLIENT)
}

interface Collected {
  text: string
  blocks: TaiBlock[]
  memo: string
  error: string | null
  /** Озвученные по ходу ответа фразы (голосовой режим); upTo — до какого знака текста. */
  audio: { seq: number; format: 'mp3' | 'wav'; data: string; upTo: number }[]
}

/**
 * mp3-фразы → одно голосовое: кадры mp3 независимы, ID3-заголовки убираем.
 * Только если озвучен весь ответ: номера фраз подряд с первой и звук доходит до
 * конца текста — иначе (фраза не синтезировалась) голосовое вышло бы с дырой.
 */
function joinMp3(parts: Collected['audio'], text: string): Buffer | null {
  if (!parts.length || parts.some((p) => p.format !== 'mp3')) return null
  const sorted = [...parts].sort((a, b) => a.seq - b.seq)
  if (sorted.some((p, i) => p.seq !== i + 1) || text.slice(sorted[sorted.length - 1]!.upTo).trim()) return null
  const chunks = sorted.map((p) => {
    const buf = Buffer.from(p.data, 'base64')
    if (buf.subarray(0, 3).toString() !== 'ID3') return buf
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f)
    return buf.subarray(10 + size + ((buf[5]! & 0x10) ? 10 : 0))
  })
  return Buffer.concat(chunks)
}

async function buildEnv(club: TgClub, person: TgPerson, contact: TaiContact | null, target: ChatTarget, voice: boolean): Promise<TaiEnv> {
  const profile = person.profile
  if (person.staff && profile) {
    const session: ClientSession | null = contact ? { club, person, contact, chatId: target.chatId } : null
    return {
      db: club.db,
      user: { sub: profile.id, role: profile.role, nickname: profile.nickname },
      clubKey: club.key,
      clubName: club.name,
      permissions: profile.permissions ?? {},
      headers: await staffHeaders(club, profile),
      extraTools: [...TELEGRAM_STAFF_TOOLS, ...(session && !target.groupTitle ? selfTools(session) : [])],
      extraPrompt: staffTelegramPrompt({ nickname: profile.nickname, group: target.groupTitle, selfTools: !!session && !target.groupTitle, style: target.style?.line ?? null }),
      ...(target.style ? { profanity: target.style.profanity } : {}),
    }
  }
  const session: ClientSession = { club, person, contact: contact!, chatId: target.chatId }
  // Заявка с сайта: Tai знает её и ведёт до подтверждения (tg/dialog/request-desk.ts).
  const requests = target.groupTitle ? [] : await activeRequests(club.db, target.chatId)
  return {
    db: club.db,
    user: { sub: profile?.id ?? `tg:${person.tgId}`, role: 'client', nickname: displayName(person) },
    clubKey: club.key,
    clubName: club.name,
    permissions: undefined,
    headers: { host: club.host },
    tools: [...clientTools(session), ...requestTools(session, requests)],
    prompt: (await clientPrompt(session, voice)) + requestPrompt(requests),
    temperature: CLIENT_TEMPERATURE,
  }
}

async function collect(env: TaiEnv, history: Awaited<ReturnType<typeof recentTurns>>, text: string, voice: boolean): Promise<Collected> {
  const out: Collected = { text: '', blocks: [], memo: '', error: null, audio: [] }
  const emit = async (event: TaiEvent) => {
    if (event.type === 'audio') out.audio.push({ seq: event.seq, format: event.format, data: event.data, upTo: event.upTo })
    else if (event.type === 'delta') out.text += event.text
    else if (event.type === 'block') out.blocks.push(event.block)
    else if (event.type === 'done') out.memo = event.memo
    else if (event.type === 'error') out.error = event.message
  }
  const controller = new AbortController()
  try {
    // Голос: фразы озвучиваются параллельно, пока модель пишет, — ответ готов почти сразу.
    await runTaiWith(env, { messages: [...history, { role: 'user', content: text }], voice, speak: voice }, emit, controller.signal)
  } catch (error) {
    out.error = taiErrorMessage(error)
  }
  return out
}

/** Отправить ответ: голос или текст, затем данные, карточки и выбор. */
async function deliver(club: TgClub, person: TgPerson, target: ChatTarget, result: Collected, voice: boolean): Promise<{ sent: boolean; blocked: boolean }> {
  const bot = club.bot
  const base = { threadId: target.threadId, replyTo: target.replyTo }
  const links = result.blocks.filter((b): b is Extract<TaiBlock, { type: 'links' }> => b.type === 'links').flatMap((b) => b.links)
  const linkMarkup: ReplyMarkup | undefined = links.length ? linksMarkup(links, club.host) : undefined
  const text = result.text.trim()
  let sent = false
  let blocked = false

  if (text && voice) {
    const joined = joinMp3(result.audio, result.text)
    const audio = joined
      ? { data: joined, format: 'mp3' as const }
      : await synthesizeVoiceNote(await resolveApiKey(club.db), text, await getTaiSettings(club.db)).catch(() => null)
    if (audio) {
      const r = await bot.sendVoice(target.chatId, audio.data, audio.format, { ...base, markup: linkMarkup })
      sent = r.ok
      blocked = !r.ok && r.code === 403
    }
  }
  if (text && !sent && !blocked) {
    const r = await bot.send(target.chatId, mdToHtml(text), { html: true, ...base, markup: linkMarkup })
    sent = r.ok
    blocked = !r.ok && r.code === 403
  }
  if (blocked) return { sent, blocked }

  const data = result.blocks.map(blockText).filter((t): t is string => !!t)
  if (data.length) {
    const r = await bot.send(target.chatId, data.join('\n\n'), { html: true, threadId: target.threadId, markup: text ? undefined : linkMarkup })
    sent = sent || r.ok
  } else if (!text && linkMarkup) {
    await bot.send(target.chatId, 'Открыть в HUB:', { threadId: target.threadId, markup: linkMarkup })
  }

  for (const block of result.blocks) {
    if (block.type === 'action') {
      const r = await bot.send(target.chatId, actionText(block.action), { html: true, threadId: target.threadId, markup: actionMarkup(block.action, club.host) })
      sent = sent || r.ok
    } else if (block.type === 'supply') {
      const r = await bot.send(target.chatId, supplyText(block.supply), { html: true, threadId: target.threadId, markup: supplyMarkup(block.supply, club.host) })
      sent = sent || r.ok
    } else if (block.type === 'choice') {
      const key = randomBytes(6).toString('base64url')
      const stored: StoredChoice = { chatId: target.chatId, tgId: person.tgId, replies: block.options.map((o) => o.reply) }
      await getSharedRedis().set(choiceKey(club.key, key), JSON.stringify(stored), 'EX', CHOICE_TTL_SEC).catch(() => {})
      const r = await bot.send(target.chatId, mdToHtml(block.question), { html: true, threadId: target.threadId, markup: choiceMarkup(key, block.options) })
      sent = sent || r.ok
    }
  }
  return { sent, blocked }
}

/**
 * Ход диалога. text — сообщение человека (голосовое уже распознано). voice —
 * ответить голосом. В личке contact обязателен (карточка собеседника).
 */
export async function converse(club: TgClub, person: TgPerson, contact: TaiContact | null, target: ChatTarget, text: string, voice: boolean): Promise<void> {
  if (await overLimit(club, person)) {
    await club.bot.send(target.chatId, 'Давай чуть передохнём — слишком много сообщений подряд. Напиши через полчасика 🙏', { threadId: target.threadId })
    return
  }
  // В группе в истории нужно видеть, кто именно спрашивал.
  const userContent = target.groupTitle ? `${displayName(person)}: ${text}` : text
  const history = await recentTurns(club.db, target.chatId)
  await appendMessage(club.db, { chatId: target.chatId, tgId: person.tgId, role: 'user', content: userContent, voice })

  const typing = setInterval(() => void club.bot.chatAction(target.chatId, voice ? 'record_voice' : 'typing', target.threadId), TYPING_EVERY_MS)
  void club.bot.chatAction(target.chatId, voice ? 'record_voice' : 'typing', target.threadId)
  try {
    const env = await buildEnv(club, person, contact, target, voice)
    const result = await collect(env, history, userContent, voice)
    if (result.error && !result.text && !result.blocks.length) {
      await club.bot.send(target.chatId, person.staff ? `⚠️ ${result.error}` : 'Что-то я задумался и потерял мысль 🙈 Напиши ещё раз, пожалуйста.', { threadId: target.threadId })
      return
    }
    if (!result.text.trim() && !result.blocks.length) result.text = 'Хм, не нашёлся с ответом — переформулируешь?'
    const delivered = await deliver(club, person, target, result, voice)
    if (delivered.blocked) {
      await markBlocked(club.db, person.tgId)
      return
    }
    await appendMessage(club.db, { chatId: target.chatId, role: 'assistant', content: result.text.trim() || '(ответил карточками)', voice, memo: result.memo })
    if (!target.groupTitle) await markOutbound(club.db, person.tgId, false)
  } finally {
    clearInterval(typing)
  }
}
