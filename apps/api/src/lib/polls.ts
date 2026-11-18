import { appSettings, eq, type Database } from '@titan/database'
import { sendTelegramPoll, type SendPollResult } from './telegram.js'

// ─────────────────────────────────────────────────────────────────────────────
// Регулярные опросы Telegram (пер-клуб). Конфиги хранятся в app_settings клуба
// под ключом poll_configs (JSON-массив) — без отдельной таблицы/миграции.
// Постит планировщик (cron/polls.ts) от токена poll_bot_token (integrations клуба).
//
// Модель (решение владельца): подзаголовок (день+время) — СТАТИЧНЫЙ текст,
// постинг — по ОТДЕЛЬНОМУ расписанию (дни недели + время МСК). Опросы постятся в
// топик «Опросы» супергруппы (message_thread_id).
// ─────────────────────────────────────────────────────────────────────────────

export const POLL_CONFIGS_KEY = 'poll_configs'

export interface PollConfig {
  id: string
  /** Метка для UI/логов: 'sport' | 'city' | произвольная. */
  kind: string
  enabled: boolean
  /** ID чата супергруппы, напр. "-1001281350483". */
  chatId: string
  /** message_thread_id топика (форум). null = в общий чат. */
  threadId: number | null
  /** Заголовок опроса, напр. «Спортивная мафия». */
  title: string
  /** Подзаголовок: день недели события (статичный текст), напр. «Пятница».
   *  Игнорируется, если autoDay=true (тогда подставляется день выкладки). */
  subtitleDay: string
  /** Если true — день недели в подзаголовке = день ВЫКЛАДКИ опроса (сегодня, МСК),
   *  а не статичный subtitleDay. */
  autoDay?: boolean
  /** Подзаголовок: время события (статичный текст), напр. «20:00». */
  subtitleTime: string
  options: string[]
  /** Дни недели ПОСТИНГА: 1=Пн … 7=Вс. */
  weekdays: number[]
  /** Время постинга МСК «HH:MM». */
  postTime: string
  /** ISO момента последнего успешного постинга (для идемпотентности). */
  lastPostedAt: string | null

  // ─── Гибкие настройки (2026-11-19); у старых опросов полей нет — умолчания как раньше ───
  /** Дни выкладки: по дням недели (weekdays, по умолчанию) или по датам (dates). */
  scheduleKind?: 'weekly' | 'dates'
  /** Даты выкладки YYYY-MM-DD для scheduleKind='dates' (разовый опрос — одна дата). */
  dates?: string[]
  /** Несколько времён выкладки в день; есть — вместо postTime. */
  times?: string[]
  /** Пауза: не выкладывать по эту дату включительно (YYYY-MM-DD). */
  pausedUntil?: string | null
  /** Описание под вопросом (Bot API 9.6). */
  description?: string
  anonymous?: boolean
  multipleAnswers?: boolean
  /** Можно передумать и переголосовать. */
  allowsRevoting?: boolean
  shuffleOptions?: boolean
  /** Участники могут добавлять свои варианты. */
  allowAddingOptions?: boolean
  /** Итоги видны только после закрытия (нужно закрытие). */
  hideResultsUntilClose?: boolean
  /** Голосовать могут только участники чата. */
  membersOnly?: boolean
  /** Закрытие: никогда, через closeAfterHours после выкладки, или в closeAtTime (сегодня, иначе завтра). */
  closeMode?: 'none' | 'after' | 'at'
  closeAfterHours?: number
  closeAtTime?: string
  /** Напомнить неотметившимся за N минут до закрытия (0/нет — не напоминать). */
  remindBeforeMin?: number
  /** После закрытия выложить итог «кто идёт». */
  summary?: boolean
  /** Закрепить новый опрос. */
  pin?: boolean
  /** Открепить прошлый опрос этой серии. */
  unpinPrevious?: boolean
  /** Удалить прошлый опрос этой серии. */
  deletePrevious?: boolean
}

const TIME_RE = /^(\d{1,2}):(\d{2})$/
const minutesOf = (t: string): number | null => {
  const m = TIME_RE.exec(t ?? '')
  return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : null
}

/** Времена выкладки опроса за день (минуты от полуночи МСК), по возрастанию. */
export function postMinutes(cfg: PollConfig): number[] {
  const list = cfg.times?.length ? cfg.times : [cfg.postTime]
  return [...new Set(list.map(minutesOf).filter((m): m is number => m !== null))].sort((a, b) => a - b)
}

/** Выкладывается ли опрос в этот день (YYYY-MM-DD по МСК, день недели 1..7). */
export function postsOnDay(cfg: PollConfig, date: string, dow: number): boolean {
  if (cfg.pausedUntil && date <= cfg.pausedUntil) return false
  if (cfg.scheduleKind === 'dates') return (cfg.dates ?? []).includes(date)
  return Array.isArray(cfg.weekdays) && cfg.weekdays.includes(dow)
}

export async function readPollConfigs(db: Database): Promise<PollConfig[]> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, POLL_CONFIGS_KEY))
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as PollConfig[]) : []
  } catch {
    return []
  }
}

export async function writePollConfigs(db: Database, configs: PollConfig[]): Promise<void> {
  const value = JSON.stringify(configs)
  const [ex] = await db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, POLL_CONFIGS_KEY))
  if (ex) await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.key, POLL_CONFIGS_KEY))
  else await db.insert(appSettings).values({ key: POLL_CONFIGS_KEY, value })
}

// Русские названия дней недели (1=Пн..7=Вс).
const RU_WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

// День недели момента nowMs по МСК (UTC+3), напр. «Среда».
export function russianWeekday(nowMs: number): string {
  const d = new Date(nowMs + 3 * 3600 * 1000)
  const js = d.getUTCDay() // 0=Вс..6=Сб
  const idx = js === 0 ? 6 : js - 1 // 0=Пн..6=Вс
  return RU_WEEKDAYS[idx]!
}

// Текст вопроса = «Заголовок\nДень Время». День: автоматический (день выкладки,
// nowMs) — ДЕФОЛТ; статичный subtitleDay только при ЯВНОМ autoDay===false.
//
// ВАЖНО (фикс бага «в четверг постит Пятница»): раньше тут было `cfg.autoDay ?`,
// поэтому конфиг без поля autoDay (undefined — легаси или не сохранён) уходил в
// СТАТИЧНЫЙ subtitleDay. А интерфейс (manage/polls) показывает тумблер «по дню
// выкладки» как `autoDay !== false`, т.е. при undefined — ВКЛЮЧЁННЫМ. Рассинхрон:
// в UI авто-день «включён», а бот постит зашитую «Пятница». Теперь бэк трактует
// undefined так же, как UI — как авто (день выкладки).
//
// forceTodayDay — для кнопки «Выложить на сегодня»: день = день выкладки ВСЕГДА,
// даже если autoDay выключен у конфига.
export function buildPollQuestion(
  cfg: PollConfig,
  nowMs: number = Date.now(),
  forceTodayDay = false,
): string {
  const useAutoDay = forceTodayDay || cfg.autoDay !== false
  const day = useAutoDay ? russianWeekday(nowMs) : (cfg.subtitleDay ?? '').trim()
  const sub = [day, (cfg.subtitleTime ?? '').trim()].filter(Boolean).join(' ')
  return sub ? `${cfg.title}\n${sub}` : cfg.title
}

// ── Расписание (МСК = UTC+3) ─────────────────────────────────────────────────
// Час/день берём в МСК независимо от TZ контейнера (как остальной cron).
export function mskParts(nowMs: number): { date: string; dow: number; minutes: number } {
  const d = new Date(nowMs + 3 * 3600 * 1000)
  const jsDow = d.getUTCDay() // 0=Вс..6=Сб
  const dow = jsDow === 0 ? 7 : jsDow // 1=Пн..7=Вс
  return { date: d.toISOString().slice(0, 10), dow, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

// UTC-мс момента «сегодня в schedMin минут по МСК».
export function scheduledTodayMs(nowMs: number, schedMin: number): number {
  const d = new Date(nowMs + 3 * 3600 * 1000)
  const mskMidnightUtcMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 3 * 3600 * 1000
  return mskMidnightUtcMs + schedMin * 60_000
}

/**
 * Пора ли постить cfg в момент nowMs. РОБАСТНО к дрейфу тика/рестарту: постим
 * ОДИН раз на слот — последнее наступившее сегодня время выкладки, если в этот
 * слот ещё не постили (lastPostedAt < слота). Пропущенные ранние слоты дня не
 * догоняем: выходит один опрос, а не пачка.
 */
export function isPollDue(cfg: PollConfig, nowMs: number): boolean {
  if (!cfg.enabled) return false
  if (!cfg.chatId || !cfg.title || !Array.isArray(cfg.options) || cfg.options.length < 1) return false
  const { date, dow, minutes } = mskParts(nowMs)
  if (!postsOnDay(cfg, date, dow)) return false
  const passed = postMinutes(cfg).filter((m) => m <= minutes)
  if (!passed.length) return false // ещё не наступило время сегодня
  const slotMs = scheduledTodayMs(nowMs, passed[passed.length - 1]!)
  if (cfg.lastPostedAt) {
    const last = new Date(cfg.lastPostedAt).getTime()
    if (!Number.isNaN(last) && last >= slotMs) return false // уже постили этот слот
  }
  return true
}

const HOUR_MS = 3600_000
const MIN_CLOSE_SEC = 5
const MAX_CLOSE_SEC = 2_628_000

/** Когда опрос закроется, если выложить его в nowMs. null — не закрывается. */
export function closeAtMs(cfg: PollConfig, nowMs: number): number | null {
  let at: number | null = null
  if (cfg.closeMode === 'after' && Number(cfg.closeAfterHours) > 0) at = nowMs + Number(cfg.closeAfterHours) * HOUR_MS
  if (cfg.closeMode === 'at') {
    const min = minutesOf(cfg.closeAtTime ?? '')
    if (min !== null) {
      at = scheduledTodayMs(nowMs, min)
      if (at <= nowMs + MIN_CLOSE_SEC * 1000) at += 24 * HOUR_MS
    }
  }
  if (at === null) return null
  return Math.min(at, nowMs + MAX_CLOSE_SEC * 1000)
}

// Отправить опрос по конфигу (через токен бота опросов).
// opts.forceTodayDay — выложить с СЕГОДНЯШНИМ днём недели независимо от autoDay
// (кнопка «Выложить на сегодня»).
export function postPollConfig(
  token: string,
  cfg: PollConfig,
  opts?: { forceTodayDay?: boolean; nowMs?: number },
): Promise<SendPollResult & { closesAt: number | null }> {
  const nowMs = opts?.nowMs ?? Date.now()
  const closesAt = closeAtMs(cfg, nowMs)
  return sendTelegramPoll(token, {
    chatId: cfg.chatId,
    messageThreadId: cfg.threadId,
    question: buildPollQuestion(cfg, nowMs, opts?.forceTodayDay ?? false),
    options: cfg.options,
    isAnonymous: cfg.anonymous === true,
    allowsMultipleAnswers: cfg.multipleAnswers === true,
    allowsRevoting: cfg.allowsRevoting,
    shuffleOptions: cfg.shuffleOptions,
    allowAddingOptions: cfg.allowAddingOptions,
    // Скрыть итоги до закрытия можно, только если опрос закрывается.
    hideResultsUntilCloses: closesAt !== null && cfg.hideResultsUntilClose === true,
    membersOnly: cfg.membersOnly,
    description: cfg.description?.trim() || undefined,
    closeDate: closesAt !== null ? Math.floor(closesAt / 1000) : undefined,
  }).then((r) => ({ ...r, closesAt: r.ok ? closesAt : null }))
}
