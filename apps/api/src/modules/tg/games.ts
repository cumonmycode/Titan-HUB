/**
 * Игровые вечера клуба для Tai: расписание берём из регулярных опросов (опрос
 * выкладывается в день игры, подзаголовок — время), сегодняшний опрос — из
 * poll_state. Отсюда Tai знает, когда звать человека и какой опрос ему переслать.
 */
import type { Database, TaiGames } from '@titan/database'
import { readPollConfigs, type PollConfig } from '../../lib/polls.js'
import { listLastPolls } from '../../lib/pollState.js'
import { readRoster } from '../../lib/roster.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'
import { businessDayStartMs } from '../../lib/prechecks.js'
import type { TgBot, SendResult } from '../../lib/tgBot.js'

export type GameKind = 'sport' | 'city'
const MSK_MS = 3 * 3600_000
const DAY_MS = 86_400_000
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const WEEKDAYS_ACC = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье']

export interface GameNight {
  kind: string
  title: string
  /** YYYY-MM-DD по МСК. */
  date: string
  /** «в четверг» и т.п. */
  weekday: string
  time: string
  today: boolean
}

/** Вид вечера из конфига опроса: sport/city по kind, иначе по названию. */
export function kindOf(cfg: Pick<PollConfig, 'kind' | 'title'>): string {
  if (cfg.kind === 'sport' || cfg.kind === 'city') return cfg.kind
  const t = cfg.title.toLowerCase()
  if (t.includes('спорт')) return 'sport'
  if (t.includes('город')) return 'city'
  return cfg.kind || 'other'
}

/** Дни игры (1=Пн…7=Вс): день выкладки опроса, либо статичный день из подзаголовка. */
function gameWeekdays(cfg: PollConfig): number[] {
  if (cfg.autoDay === false && cfg.subtitleDay) {
    const idx = WEEKDAYS.findIndex((w) => cfg.subtitleDay.toLowerCase().startsWith(w.slice(0, 3)))
    if (idx >= 0) return [idx + 1]
  }
  return Array.isArray(cfg.weekdays) ? cfg.weekdays : []
}

function mskDate(ms: number): { date: string; dow: number } {
  const d = new Date(ms + MSK_MS)
  const js = d.getUTCDay()
  return { date: d.toISOString().slice(0, 10), dow: js === 0 ? 7 : js }
}

export async function gameConfigs(db: Database): Promise<PollConfig[]> {
  return (await readPollConfigs(db)).filter((c) => c.enabled && c.chatId && c.title)
}

/** Ближайшие игровые вечера на days дней вперёд, начиная с сегодня. */
export function upcomingNights(configs: PollConfig[], days = 8, nowMs = Date.now()): GameNight[] {
  const out: GameNight[] = []
  for (let i = 0; i < days; i += 1) {
    const { date, dow } = mskDate(nowMs + i * DAY_MS)
    for (const cfg of configs) {
      if (!gameWeekdays(cfg).includes(dow)) continue
      out.push({ kind: kindOf(cfg), title: cfg.title, date, weekday: i === 0 ? 'сегодня' : i === 1 ? 'завтра' : `в ${WEEKDAYS_ACC[dow - 1]}`, time: cfg.subtitleTime || '', today: i === 0 })
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
}

/** Следующий вечер нужного вида строго после сегодняшнего дня. */
export function nextNight(configs: PollConfig[], kind: string, nowMs = Date.now()): GameNight | null {
  return upcomingNights(configs, 15, nowMs).find((n) => !n.today && (kind === 'any' || n.kind === kind)) ?? null
}

/** Подходит ли вечер человеку: играет в этот вид (или не знаем, во что играет). */
export function nightFits(games: TaiGames | null | undefined, kind: string): boolean {
  if (!games || games === 'both') return true
  return games === kind
}

export interface TodayPoll {
  kind: string
  title: string
  chatId: string
  messageId: number
  pollId: string
  options: string[]
}

/** Опросы, выложенные с начала бизнес-дня, по видам вечеров. */
export async function todaysPolls(db: Database): Promise<TodayPoll[]> {
  const since = businessDayStartMs(await getBusinessDayStartHour(db))
  const configs = await gameConfigs(db)
  return (await listLastPolls(db))
    .filter((p) => Date.parse(p.postedAt) >= since && p.messageId > 0)
    .map((p) => {
      const cfg = configs.find((c) => c.chatId === p.chatId)
      return { kind: cfg ? kindOf(cfg) : 'other', title: cfg?.title ?? 'Игра', chatId: p.chatId, messageId: p.messageId, pollId: p.pollId, options: p.options ?? [] }
    })
}

/**
 * Во что играет человек по чатам клуба, где его видел бот: в чате спортивных
 * опросов — sport, городских — city, в обоих — both. null — не видел.
 */
export async function gamesFromChats(db: Database, tgId: string): Promise<TaiGames | null> {
  const user = (await readRoster(db)).find((u) => u.tgId === tgId)
  if (!user) return null
  const chats = new Set([...(user.chatIds ?? []), user.chatId].filter(Boolean) as string[])
  const kinds = new Set((await gameConfigs(db)).filter((c) => chats.has(c.chatId)).map(kindOf))
  if (kinds.has('sport') && kinds.has('city')) return 'both'
  if (kinds.has('sport')) return 'sport'
  if (kinds.has('city')) return 'city'
  return null
}

export type PollForward = { status: 'sent'; poll: TodayPoll } | { status: 'no_poll' } | { status: 'blocked' } | { status: 'failed'; error: string }

/**
 * Переслать сегодняшний опрос в личку: голос в пересланном опросе засчитывается в
 * исходный, так что человек отмечается, не заходя в группу.
 */
export async function forwardTodayPoll(db: Database, bot: TgBot, chatId: string | number, kind: string | null): Promise<PollForward> {
  const polls = await todaysPolls(db)
  const poll = polls.find((p) => !kind || kind === 'any' || p.kind === kind) ?? (kind ? null : polls[0])
  if (!poll) return { status: 'no_poll' }
  const r: SendResult = await bot.forward(chatId, poll.chatId, poll.messageId)
  if (r.ok) return { status: 'sent', poll }
  if (r.code === 403) return { status: 'blocked' }
  return { status: 'failed', error: r.error }
}

export function nightLabel(n: GameNight): string {
  return `${n.title} ${n.weekday}${n.time ? ` в ${n.time}` : ''}`
}
