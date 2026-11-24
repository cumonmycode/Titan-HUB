/**
 * Tai сам по себе в групповых чатах:
 *  • посты-приколы (fun) — факт, шутка, совет по мафии или вопрос чату, N раз в день в
 *    заданные часы по МСК; тик раз в 10 минут, случайный момент в окне, без повторов;
 *  • реплика в разговор без обращения (tai.chime) — изредка, только когда чат живой;
 *  • реакции-эмодзи на сообщения (tai.reactions) — изредка.
 * Всё настраивается на каждый чат: HUB → Telegram → чат → «Tai в чате» и «Приколы и факты».
 */
import type { Database } from '@titan/database'
import { getSharedRedis } from '../../lib/redis.js'
import type { FunPostKind } from '../../lib/tai.js'
import { botActive, readAllChatConfigs, type ChatConfig } from '../../lib/tgChatConfig.js'
import { chatContext, recentActivity, taiSays } from './chatTai.js'
import { clubForDb, type TgClub } from './club.js'
import type { TgMessage } from './types.js'
import { FUN_TICK_MS, funDue } from './rules.js'

export { FUN_TICK_MS }
const MSK_MS = 3 * 3600_000
const RECENT_KEEP = 15
const RECENT_TTL_SEC = 30 * 24 * 3600
const DAY_TTL_SEC = 2 * 24 * 3600

/** Реплика без обращения: вероятность на сообщение и пауза между репликами в чате. */
const CHIME: Record<'rare' | 'often', { chance: number; gapMs: number }> = {
  rare: { chance: 0.04, gapMs: 25 * 60_000 },
  often: { chance: 0.1, gapMs: 8 * 60_000 },
}
const CHIME_MIN_ACTIVITY = 3
const ACTIVITY_WINDOW_MS = 10 * 60_000
const REACTION_CHANCE = 0.06
const REACTION_GAP_MS = 4 * 60_000
const REACTIONS = ['🔥', '😁', '🤣', '👍', '🤔', '👀', '💯', '🗿', '😈', '🤯', '👏']

const lastChime = new Map<string, number>()
const lastReaction = new Map<string, number>()

const mskDate = (now = Date.now()) => new Date(now + MSK_MS).toISOString().slice(0, 10)
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!

async function postFun(club: TgClub, chatId: string, config: ChatConfig): Promise<void> {
  const redis = getSharedRedis()
  const base = `tg:fun:${club.key}:${chatId}`
  const recent = await redis.lrange(`${base}:recent`, 0, RECENT_KEEP - 1).catch(() => [] as string[])
  const kind: FunPostKind = pick(config.fun.kinds)
  const text = await taiSays(club, chatId, config, { kind: 'post', post: kind, avoid: recent })
  if (!text) return
  const sent = await club.bot.send(chatId, text, { threadId: config.fun.threadId })
  if (!sent.ok) return
  const day = `${base}:n:${mskDate()}`
  await Promise.all([
    redis.set(`${base}:last`, String(Date.now()), 'EX', RECENT_TTL_SEC),
    redis.incr(day).then(() => redis.expire(day, DAY_TTL_SEC)),
    redis.lpush(`${base}:recent`, text.slice(0, 120)).then(() => redis.ltrim(`${base}:recent`, 0, RECENT_KEEP - 1)).then(() => redis.expire(`${base}:recent`, RECENT_TTL_SEC)),
  ]).catch(() => undefined)
}

/** Тик раз в 10 минут: посты-приколы во всех чатах, где они включены. */
export async function runFunPosts(db: Database, clubId: string | null): Promise<void> {
  const configs = [...(await readAllChatConfigs(db)).entries()].filter(([, c]) => c.fun.on && botActive(c) && c.mode !== 'notify')
  if (!configs.length) return
  const club = await clubForDb(db, clubId)
  if (!club) return
  const redis = getSharedRedis()
  for (const [chatId, config] of configs) {
    const base = `tg:fun:${club.key}:${chatId}`
    const [n, last] = await Promise.all([redis.get(`${base}:n:${mskDate()}`), redis.get(`${base}:last`)]).catch(() => [null, null])
    if (funDue(config.fun, Number(n) || 0, Number(last) || 0)) await postFun(club, chatId, config)
  }
}

/**
 * Живой разговор, к Tai не обращались: иногда реакция, ещё реже — реплика.
 * Только игровой чат с включённым Tai.
 */
export async function maybeJoinConversation(club: TgClub, msg: TgMessage, config: ChatConfig): Promise<void> {
  if (config.mode !== 'game' || !config.tai.on || !msg.text) return
  const chatId = String(msg.chat.id)
  const now = Date.now()
  if (config.tai.reactions && now - (lastReaction.get(chatId) ?? 0) > REACTION_GAP_MS && Math.random() < REACTION_CHANCE) {
    lastReaction.set(chatId, now)
    await club.bot.call('setMessageReaction', { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: pick(REACTIONS) }] })
  }
  if (config.tai.chime === 'off') return
  const rule = CHIME[config.tai.chime]
  if (now - (lastChime.get(chatId) ?? 0) < rule.gapMs || recentActivity(chatId, ACTIVITY_WINDOW_MS) < CHIME_MIN_ACTIVITY || Math.random() >= rule.chance) return
  lastChime.set(chatId, now)
  const text = await taiSays(club, chatId, config, { kind: 'chime' }, chatContext(chatId))
  if (text) await club.bot.send(msg.chat.id, text, { threadId: msg.message_thread_id ?? null })
}
