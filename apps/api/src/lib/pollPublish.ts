/**
 * Выкладка опроса и всё, что после неё: закреп, уборка прошлого опроса серии,
 * напоминание неотметившимся до закрытия и итог «кто идёт» после закрытия.
 *
 * Последняя выкладка каждого опроса хранится в app_settings.poll_runs
 * (configId → выкладка): отдельно от poll_configs, чтобы сохранение настроек из
 * интерфейса не затирало состояние выкладки.
 */
import { appSettings, eq, type Database } from '@titan/database'
import { buildPollQuestion, postPollConfig, type PollConfig } from './polls.js'
import { recordPollPosted, voteMapOfPoll } from './pollState.js'
import { listRosterForChat } from './roster.js'
import { escapeHtml, type TgBot } from './tgBot.js'
import { nicknamesByTgId } from '../modules/tg/commands.js'

export const POLL_RUNS_KEY = 'poll_runs'
const MENTION_CHUNK = 50
const NAMES_IN_SUMMARY = 40
const MINUTE_MS = 60_000

export interface PollRun {
  chatId: string
  threadId: number | null
  messageId: number
  pollId: string
  postedAt: string
  closesAt: string | null
  options: string[]
  reminded?: boolean
  summarized?: boolean
}

export async function readPollRuns(db: Database): Promise<Record<string, PollRun>> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, POLL_RUNS_KEY))
    const parsed = row?.value ? JSON.parse(row.value) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writePollRuns(db: Database, runs: Record<string, PollRun>): Promise<void> {
  const value = JSON.stringify(runs)
  await db.insert(appSettings).values({ key: POLL_RUNS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

/** Записать выкладку одного опроса поверх свежих данных (другие опросы не трогаем). */
async function saveRun(db: Database, configId: string, run: PollRun): Promise<void> {
  await writePollRuns(db, { ...(await readPollRuns(db)), [configId]: run })
}

export type PublishResult = { ok: true; messageId: number; closesAt: number | null } | { ok: false; error: string }

/** Прошлый опрос серии в том же месте: открепить или удалить, как просит настройка. */
async function tidyPrevious(bot: TgBot, cfg: PollConfig, prev: PollRun | undefined): Promise<void> {
  if (!prev || prev.chatId !== cfg.chatId || !prev.messageId) return
  if (cfg.deletePrevious) await bot.call('deleteMessage', { chat_id: prev.chatId, message_id: prev.messageId })
  else if (cfg.unpinPrevious) await bot.call('unpinChatMessage', { chat_id: prev.chatId, message_id: prev.messageId })
}

/**
 * Выложить опрос: отправить, запомнить для команд и итогов, закрепить и убрать
 * прошлый опрос серии. test — проверочная отправка: без закрепа, уборки и итогов.
 * Никогда не бросает.
 */
export async function publishPoll(db: Database, bot: TgBot, cfg: PollConfig, opts: { forceTodayDay?: boolean; test?: boolean } = {}): Promise<PublishResult> {
  const prev = (await readPollRuns(db))[cfg.id]
  const r = await postPollConfig(bot.token, cfg, { forceTodayDay: opts.forceTodayDay })
  if (!r.ok || !r.messageId) return { ok: false, error: r.error ?? 'Telegram не принял опрос' }
  if (opts.test) return { ok: true, messageId: r.messageId, closesAt: r.closesAt }
  if (r.pollId) await recordPollPosted(db, cfg.chatId, r.pollId, r.messageId, cfg.threadId, cfg.options).catch((e) => console.error('[polls] recordPollPosted', e))
  if (cfg.pin) await bot.call('pinChatMessage', { chat_id: cfg.chatId, message_id: r.messageId, disable_notification: true })
  await tidyPrevious(bot, cfg, prev)
  await saveRun(db, cfg.id, {
    chatId: cfg.chatId,
    threadId: cfg.threadId,
    messageId: r.messageId,
    pollId: r.pollId ?? '',
    postedAt: new Date().toISOString(),
    closesAt: r.closesAt !== null ? new Date(r.closesAt).toISOString() : null,
    options: cfg.options,
  }).catch((e) => console.error('[polls] poll_runs', e))
  return { ok: true, messageId: r.messageId, closesAt: r.closesAt }
}

// ─── После выкладки: напоминание и итоги ────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase()
type Person = { tgId: string; firstName: string | null; username: string | null }

async function nameMap(db: Database, people: Person[]): Promise<Map<string, string>> {
  const nicks = await nicknamesByTgId(db, people.map((p) => p.tgId))
  return new Map(people.map((p) => [p.tgId, nicks.get(p.tgId) || p.firstName || (p.username ? `@${p.username}` : 'участник')]))
}

/** Кто из чата не отметился в этом опросе (или выбрал «Думаю»). */
async function unvoted(db: Database, run: PollRun): Promise<Person[]> {
  const votes = await voteMapOfPoll(db, run.pollId)
  const thinking = run.options.findIndex((o) => norm(o) === 'думаю')
  return (await listRosterForChat(db, run.chatId)).filter((u) => !votes[u.tgId] || (thinking >= 0 && votes[u.tgId]!.includes(thinking)))
}

async function sendReminder(db: Database, bot: TgBot, cfg: PollConfig, run: PollRun): Promise<void> {
  const people = await unvoted(db, run)
  if (!people.length) return
  const names = await nameMap(db, people)
  const minutes = Math.max(1, Math.round((Date.parse(run.closesAt!) - Date.now()) / MINUTE_MS))
  const header = `⏰ «${escapeHtml(cfg.title)}» закроется через ${minutes} мин. Не отметились:`
  for (let i = 0; i < people.length; i += MENTION_CHUNK) {
    const mentions = people
      .slice(i, i + MENTION_CHUNK)
      .map((u) => `<a href="tg://user?id=${u.tgId}">${escapeHtml(names.get(u.tgId)!)}</a>`)
      .join(' ')
    await bot.send(run.chatId, i === 0 ? `${header}\n${mentions}` : mentions, { html: true, threadId: run.threadId, replyTo: i === 0 ? run.messageId : null })
  }
}

/** Текст итога: каждый вариант — сколько и кто; в конце — сколько не отметилось. */
export async function summaryText(db: Database, cfg: PollConfig, run: PollRun): Promise<string> {
  const votes = await voteMapOfPoll(db, run.pollId)
  const roster = await listRosterForChat(db, run.chatId)
  const voters: Person[] = Object.keys(votes).map((tgId) => roster.find((u) => u.tgId === tgId) ?? { tgId, firstName: null, username: null })
  const names = await nameMap(db, voters)
  const lines = run.options.map((option, idx) => {
    const who = Object.keys(votes).filter((tgId) => votes[tgId]!.includes(idx))
    const list = who.slice(0, NAMES_IN_SUMMARY).map((tgId) => names.get(tgId)!).join(', ')
    const more = who.length > NAMES_IN_SUMMARY ? ` и ещё ${who.length - NAMES_IN_SUMMARY}` : ''
    return `<b>${escapeHtml(option)}</b> — ${who.length}${who.length ? `: ${escapeHtml(list)}${more}` : ''}`
  })
  const silent = roster.filter((u) => !votes[u.tgId]).length
  const title = escapeHtml(buildPollQuestion(cfg, Date.parse(run.postedAt)).split('\n').join(' · '))
  return [`📊 Итоги: ${title}`, ...lines, silent ? `Не отметились: ${silent}` : null].filter(Boolean).join('\n')
}

/**
 * Каждую минуту: напоминания до закрытия и итоги после. Анонимные опросы
 * пропускаем — Telegram не сообщает, кто как голосовал.
 */
export async function runPollFollowUps(db: Database, bot: TgBot, configs: PollConfig[], nowMs = Date.now()): Promise<void> {
  const runs = await readPollRuns(db)
  const done: Record<string, Partial<PollRun>> = {}
  for (const [configId, run] of Object.entries(runs)) {
    const cfg = configs.find((c) => c.id === configId)
    if (!cfg || cfg.anonymous || !run.closesAt || !run.pollId) continue
    const closes = Date.parse(run.closesAt)
    const remindMs = (Number(cfg.remindBeforeMin) || 0) * MINUTE_MS
    if (remindMs > 0 && !run.reminded && nowMs >= closes - remindMs && nowMs < closes) {
      await sendReminder(db, bot, cfg, run).catch((e) => console.error('[polls] напоминание', e))
      done[configId] = { ...done[configId], reminded: true }
    }
    if (cfg.summary && !run.summarized && nowMs >= closes) {
      await bot.send(run.chatId, await summaryText(db, cfg, run), { html: true, threadId: run.threadId, replyTo: run.messageId })
      done[configId] = { ...done[configId], summarized: true }
    }
  }
  if (!Object.keys(done).length) return
  const fresh = await readPollRuns(db)
  for (const [configId, patch] of Object.entries(done)) if (fresh[configId]) fresh[configId] = { ...fresh[configId]!, ...patch }
  await writePollRuns(db, fresh)
}
