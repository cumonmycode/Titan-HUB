import { appSettings, eq, type Database } from '@titan/database'

// ─────────────────────────────────────────────────────────────────────────────
// Состояние опросов для команды @tvari: последний опрос каждого чата + кто в нём
// проголосовал. Хранится в app_settings клуба (ключ poll_state), без миграции.
// Голоса приходят на вебхук бота (poll_answer, неанонимные опросы). @tvari =
// ростер чата минус проголосовавшие в последнем опросе.
//
// ВАЖНО: при бурном голосовании возможны редкие гонки read-modify-write JSON —
// @tvari приблизителен (может изредка включить/пропустить недавно проголосовавшего).
// Для бытового сценария приемлемо.
// ─────────────────────────────────────────────────────────────────────────────

export const POLL_STATE_KEY = 'poll_state'

interface LastPoll {
  pollId: string
  messageId: number
  postedAt: string
  threadId: number | null
  options?: string[] // варианты опроса (чтобы по тексту найти «Думаю»/«Нет»)
}
interface Vote {
  o: number[] // индексы выбранных вариантов
  at: string
}
interface PollState {
  lastByChat: Record<string, LastPoll> // chatId → последний опрос
  votersByPoll: Record<string, Record<string, Vote>> // pollId → { tgId: голос }
  /** pollId → когда выложен: голоса недавних опросов храним и после следующего опроса в чате (итоги, напоминания). */
  postedAt?: Record<string, string>
}
const KEEP_VOTES_MS = 3 * 86_400_000

async function read(db: Database): Promise<PollState> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, POLL_STATE_KEY))
    if (!row?.value) return { lastByChat: {}, votersByPoll: {} }
    const p = JSON.parse(row.value)
    return { lastByChat: p?.lastByChat ?? {}, votersByPoll: p?.votersByPoll ?? {}, postedAt: p?.postedAt ?? {} }
  } catch {
    return { lastByChat: {}, votersByPoll: {} }
  }
}

async function write(db: Database, s: PollState): Promise<void> {
  const value = JSON.stringify(s)
  const [ex] = await db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, POLL_STATE_KEY))
  if (ex) await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.key, POLL_STATE_KEY))
  else await db.insert(appSettings).values({ key: POLL_STATE_KEY, value })
}

// Зафиксировать факт публикации опроса (он становится «последним» для чата).
// Чистим голоса опросов, которые больше не являются «последними» (ограничение размера).
export async function recordPollPosted(
  db: Database,
  chatId: string | number,
  pollId: string,
  messageId: number,
  threadId: number | null,
  options?: string[],
): Promise<void> {
  const s = await read(db)
  s.lastByChat[String(chatId)] = {
    pollId,
    messageId,
    postedAt: new Date().toISOString(),
    threadId: threadId ?? null,
    options: options ?? [],
  }
  if (!s.votersByPoll[pollId]) s.votersByPoll[pollId] = {}
  const now = Date.now()
  const posted = { ...(s.postedAt ?? {}), [pollId]: new Date(now).toISOString() }
  const recent = (pid: string) => posted[pid] !== undefined && now - Date.parse(posted[pid]!) < KEEP_VOTES_MS
  const keep = new Set([...Object.values(s.lastByChat).map((l) => l.pollId), ...Object.keys(posted).filter(recent)])
  for (const pid of Object.keys(s.votersByPoll)) if (!keep.has(pid)) delete s.votersByPoll[pid]
  s.postedAt = Object.fromEntries(Object.entries(posted).filter(([pid]) => keep.has(pid)))
  await write(db, s)
}

// Зафиксировать/снять голос (option_ids пустой = отозвал голос). Храним индексы
// выбранных вариантов — чтобы @tvari/@supertvari различали «Думаю»/«Нет».
export async function recordVote(db: Database, pollId: string, tgId: string, optionIds: unknown): Promise<void> {
  const s = await read(db)
  if (!s.votersByPoll[pollId]) s.votersByPoll[pollId] = {}
  const ids = Array.isArray(optionIds) ? optionIds.filter((n): n is number => typeof n === 'number') : []
  if (ids.length === 0) {
    delete s.votersByPoll[pollId]![tgId] // отозвал голос
  } else {
    s.votersByPoll[pollId]![tgId] = { o: ids, at: new Date().toISOString() }
  }
  await write(db, s)
}

// Для ПРЕДЧЕКОВ: кто проголосовал за нужные варианты (напр. «Да»/«Опоздаю») в
// опросах, опубликованных не раньше sinceMs (сегодняшний вечер) — по ЛЮБОМУ чату.
// Возвращает tgId → выбранная метка (приоритет у первой из labels, т.е. «да»).
export async function votersForToday(
  db: Database, sinceMs: number, labels: string[],
): Promise<Map<string, string>> {
  const s = await read(db)
  const want = labels.map((l) => l.trim().toLowerCase())
  const priority = (lbl: string) => want.indexOf(lbl) // меньше = важнее
  const out = new Map<string, string>()
  for (const lp of Object.values(s.lastByChat)) {
    if (!lp?.postedAt || Date.parse(lp.postedAt) < sinceMs) continue
    const opts = (lp.options ?? []).map((o) => String(o).trim().toLowerCase())
    const idxToLabel = new Map<number, string>()
    opts.forEach((o, i) => { if (want.includes(o)) idxToLabel.set(i, o) })
    if (idxToLabel.size === 0) continue
    const votes = s.votersByPoll[lp.pollId] ?? {}
    for (const [tgId, v] of Object.entries(votes)) {
      const ids = v && typeof v === 'object' && Array.isArray((v as Vote).o) ? (v as Vote).o : []
      for (const id of ids) {
        const lbl = idxToLabel.get(id)
        if (!lbl) continue
        const prev = out.get(tgId)
        if (!prev || priority(lbl) < priority(prev)) out.set(tgId, lbl)
      }
    }
  }
  return out
}

// Последние опросы всех чатов (для рассылок «по опросу»): chatId → опрос.
export async function listLastPolls(db: Database): Promise<Array<LastPoll & { chatId: string }>> {
  const s = await read(db)
  return Object.entries(s.lastByChat)
    .filter(([, lp]) => lp?.pollId)
    .map(([chatId, lp]) => ({ ...lp, chatId }))
}

export async function lastPollForChat(db: Database, chatId: string | number): Promise<LastPoll | null> {
  const s = await read(db)
  return s.lastByChat[String(chatId)] ?? null
}

// tgId → индексы выбранных вариантов (для фильтра по «Думаю»/«Нет»). Совместимо
// со старым форматом (значение-строка → пустой список вариантов).
export async function voteMapOfPoll(db: Database, pollId: string): Promise<Record<string, number[]>> {
  const s = await read(db)
  const raw = s.votersByPoll[pollId] ?? {}
  const out: Record<string, number[]> = {}
  for (const [tgId, v] of Object.entries(raw)) {
    out[tgId] = v && typeof v === 'object' && Array.isArray((v as Vote).o) ? (v as Vote).o : []
  }
  return out
}
