/**
 * Расписание клуба — одно на всё: сайт (календарь игр и запись), Tai (ближайшие игры,
 * запись, напоминания, /games), касса (тип вечера при открытии смены → статистика) и
 * опросы записи в Telegram (выкладываются по расписанию). Правится в HUB:
 * «Управление → Расписание».
 *
 * Хранение — app_settings.club_schedule: { slots: ScheduleSlot[] }. Пока владелец не
 * сохранил своё, расписание собирается из прежних мест: расписания сайта (site_schedule)
 * и регулярных опросов (poll_configs) — так ничего не теряется при переходе.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { appSettings, eq, type Database } from '@titan/database'
import { readPollConfigs, writePollConfigs, type PollConfig } from './polls.js'

export const SCHEDULE_KEY = 'club_schedule'
const SITE_SCHEDULE_KEY = 'site_schedule'
const MSK_MS = 3 * 3600_000
const DAY_MS = 86_400_000
const DEFAULT_TIME = '19:00'
const DEFAULT_POST_TIME = '10:00'
const POLL_DEFAULT_OPTIONS = ['Да', 'Нет', 'Думаю', 'Опоздаю']
/** Опросы, которые завело расписание, — с этим префиксом id. */
const OWN_POLL_PREFIX = 'sched-'

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const PollLinkSchema = z.object({
  on: z.boolean().default(false),
  /** Чей конфиг опроса обновлять: свой (sched-…) или перенесённый из «Опросов». */
  configId: z.string().max(80).nullable().optional(),
  chatId: z.string().max(40).nullable().optional(),
  threadId: z.number().int().nullable().optional(),
  postTime: z.string().regex(TIME_RE).optional(),
})

export const SlotSchema = z.object({
  id: z.string().min(1).max(80),
  repeat: z.enum(['weekly', 'once']),
  /** 1 = понедельник … 7 = воскресенье (для weekly). */
  day: z.number().int().min(1).max(7).nullable().optional(),
  /** YYYY-MM-DD (для once). */
  date: z.string().regex(DATE_RE).nullable().optional(),
  /** Ключ типа вечера (evening_types): city_mafia, sport_mafia, board_games, свой… */
  evening: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(60),
  time: z.string().regex(TIME_RE),
  end: z.string().regex(TIME_RE).nullable().optional(),
  /** Показывать на сайте (календарь и запись). */
  onSite: z.boolean().default(true),
  note: z.string().trim().max(300).nullable().optional(),
  poll: PollLinkSchema.default({ on: false }),
}).superRefine((s, ctx) => {
  if (s.repeat === 'weekly' && !s.day) ctx.addIssue({ code: 'custom', message: 'Укажите день недели' })
  if (s.repeat === 'once' && !s.date) ctx.addIssue({ code: 'custom', message: 'Укажите дату' })
  if (s.poll.on && !s.poll.chatId) ctx.addIssue({ code: 'custom', message: `«${s.title}»: выберите чат для опроса` })
})
export type ScheduleSlot = z.infer<typeof SlotSchema>

export interface ClubSchedule {
  slots: ScheduleSlot[]
  /** true — владелец ещё не сохранял: собрано из расписания сайта и опросов. */
  derived: boolean
}

/** Вид вечера для Tai и опросов: sport / city / ключ типа вечера. */
export function kindOfEvening(evening: string): string {
  if (evening === 'sport_mafia') return 'sport'
  if (evening === 'city_mafia') return 'city'
  return evening
}

/** Тип вечера по названию (для переноса старых расписаний). */
function eveningOfTitle(title: string, kind?: string): string {
  if (kind === 'sport') return 'sport_mafia'
  if (kind === 'city') return 'city_mafia'
  const t = title.toLowerCase()
  if (t.includes('спорт')) return 'sport_mafia'
  if (t.includes('город')) return 'city_mafia'
  if (t.includes('настол')) return 'board_games'
  if (t.includes('дет')) return 'kids_mafia'
  return 'city_mafia'
}

async function readKey(db: Database, key: string): Promise<string | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1)
  return row?.value ?? null
}

async function writeKey(db: Database, key: string, value: string): Promise<void> {
  await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

function parseSlots(raw: string | null): ScheduleSlot[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { slots?: unknown[] }
    if (!Array.isArray(parsed.slots)) return null
    return parsed.slots.map((s) => SlotSchema.safeParse(s)).filter((r) => r.success).map((r) => r.data)
  } catch {
    return null
  }
}

interface SiteDay { day: number; title: string; time?: string }

async function readSiteDays(db: Database): Promise<SiteDay[]> {
  try {
    const raw = await readKey(db, SITE_SCHEDULE_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(arr)) return []
    return arr.filter((d): d is SiteDay => !!d && Number.isInteger((d as SiteDay).day) && typeof (d as SiteDay).title === 'string')
  } catch {
    return []
  }
}

/** Первичное расписание из прежних мест: вечера сайта + привязка регулярных опросов. */
async function deriveSchedule(db: Database): Promise<ScheduleSlot[]> {
  const siteDays = await readSiteDays(db)
  const polls = (await readPollConfigs(db)).filter((c) => c.enabled && c.chatId && c.title && c.scheduleKind !== 'dates')
  const slots: ScheduleSlot[] = siteDays.map((d) => ({
    id: randomUUID(), repeat: 'weekly', day: d.day, date: null, evening: eveningOfTitle(d.title), title: d.title.slice(0, 60),
    time: TIME_RE.test(d.time ?? '') ? d.time! : DEFAULT_TIME, end: null, onSite: true, note: null, poll: { on: false },
  }))
  for (const cfg of polls) {
    const evening = eveningOfTitle(cfg.title, cfg.kind)
    for (const day of cfg.weekdays ?? []) {
      const link = { on: true, configId: cfg.id, chatId: cfg.chatId, threadId: cfg.threadId, postTime: TIME_RE.test(cfg.postTime) ? cfg.postTime : DEFAULT_POST_TIME }
      const same = slots.find((s) => s.repeat === 'weekly' && s.day === day && s.evening === evening && !s.poll.on)
      if (same) {
        same.poll = link
        continue
      }
      slots.push({
        id: randomUUID(), repeat: 'weekly', day, date: null, evening, title: cfg.title.slice(0, 60),
        time: TIME_RE.test(cfg.subtitleTime) ? cfg.subtitleTime : DEFAULT_TIME, end: null, onSite: !siteDays.length, note: null, poll: link,
      })
    }
  }
  return sortSlots(slots)
}

function sortSlots(slots: ScheduleSlot[]): ScheduleSlot[] {
  return [...slots].sort((a, b) => {
    if (a.repeat !== b.repeat) return a.repeat === 'weekly' ? -1 : 1
    const ka = a.repeat === 'weekly' ? String(a.day) : a.date ?? ''
    const kb = b.repeat === 'weekly' ? String(b.day) : b.date ?? ''
    return ka.localeCompare(kb) || a.time.localeCompare(b.time)
  })
}

export async function readSchedule(db: Database): Promise<ClubSchedule> {
  const own = parseSlots(await readKey(db, SCHEDULE_KEY))
  if (own) return { slots: sortSlots(own), derived: false }
  return { slots: await deriveSchedule(db), derived: true }
}

const pollIdOf = (s: ScheduleSlot): string => (s.repeat === 'once' ? `${OWN_POLL_PREFIX}${s.id}` : s.poll.configId || `${OWN_POLL_PREFIX}${s.id}`)

/**
 * Опросы из расписания: у вечера включён «опрос в чат» — конфиг опроса создаётся или
 * обновляется (название, время, дни выкладки, чат), тонкие настройки («закрепить»,
 * «закрыть», варианты) остаются как в «Опросах». Вечер убрали или выключили опрос —
 * свой опрос удаляется, перенесённый из «Опросов» выключается.
 */
export function syncPollConfigs(configs: PollConfig[], prev: ScheduleSlot[], next: ScheduleSlot[]): PollConfig[] {
  const groups = new Map<string, ScheduleSlot[]>()
  for (const s of next) {
    if (!s.poll.on || !s.poll.chatId) continue
    // Разовый вечер — всегда свой опрос: даты и дни недели в одном конфиге не смешиваются.
    const id = pollIdOf(s)
    groups.set(id, [...(groups.get(id) ?? []), s])
  }
  const byId = new Map(configs.map((c) => [c.id, c]))
  const out: PollConfig[] = configs.filter((c) => !groups.has(c.id))
  for (const [id, slots] of groups) {
    const first = slots[0]!
    const base = byId.get(id)
    const weekly = first.repeat === 'weekly'
    out.push({
      ...(base ?? { lastPostedAt: null }),
      id,
      kind: kindOfEvening(first.evening),
      enabled: true,
      chatId: first.poll.chatId!,
      threadId: first.poll.threadId ?? null,
      title: first.title,
      subtitleDay: base?.subtitleDay ?? '',
      autoDay: true,
      subtitleTime: first.time,
      options: base?.options?.length ? base.options : [...POLL_DEFAULT_OPTIONS],
      postTime: first.poll.postTime ?? base?.postTime ?? DEFAULT_POST_TIME,
      times: undefined,
      scheduleKind: weekly ? 'weekly' : 'dates',
      weekdays: weekly ? [...new Set(slots.map((s) => s.day!))].sort((a, b) => a - b) : [],
      dates: weekly ? [] : slots.map((s) => s.date!),
      lastPostedAt: base?.lastPostedAt ?? null,
    })
  }
  // Связи, которых больше нет: свои опросы удаляем, перенесённые — выключаем.
  const linked = new Set(groups.keys())
  const dropped = new Set(prev.filter((s) => s.poll.on).map(pollIdOf).filter((id) => !linked.has(id)))
  return out
    .filter((c) => !(dropped.has(c.id) && c.id.startsWith(OWN_POLL_PREFIX)))
    .map((c) => (dropped.has(c.id) ? { ...c, enabled: false } : c))
}

export async function saveSchedule(db: Database, slots: ScheduleSlot[]): Promise<ClubSchedule> {
  const prev = await readSchedule(db)
  const next = sortSlots(slots)
  await writeKey(db, SCHEDULE_KEY, JSON.stringify({ slots: next }))
  await writePollConfigs(db, syncPollConfigs(await readPollConfigs(db), prev.slots, next))
  return { slots: next, derived: false }
}

function mskDate(ms: number): { date: string; dow: number } {
  const d = new Date(ms + MSK_MS)
  const js = d.getUTCDay()
  return { date: d.toISOString().slice(0, 10), dow: js === 0 ? 7 : js }
}

export interface ScheduledNight {
  slotId: string
  date: string
  dow: number
  evening: string
  kind: string
  title: string
  time: string
  end: string | null
  onSite: boolean
  once: boolean
  /** Дней от сегодня (0 — сегодня по МСК). */
  offset: number
}

/** Вечера на days дней вперёд с сегодняшнего (разовые и обычные), по времени. */
export function nightsAhead(slots: ScheduleSlot[], days: number, nowMs = Date.now()): ScheduledNight[] {
  const out: ScheduledNight[] = []
  for (let i = 0; i < days; i += 1) {
    const { date, dow } = mskDate(nowMs + i * DAY_MS)
    const once = slots.filter((s) => s.repeat === 'once' && s.date === date)
    const weekly = slots.filter((s) => s.repeat === 'weekly' && s.day === dow)
    for (const s of [...once, ...weekly]) {
      out.push({
        slotId: s.id, date, dow, evening: s.evening, kind: kindOfEvening(s.evening), title: s.title, time: s.time,
        end: s.end ?? null, onSite: s.onSite, once: s.repeat === 'once', offset: i,
      })
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
}

/** Сегодняшний вечер по расписанию (для кассы): разовый важнее обычного. */
export async function eveningToday(db: Database, nowMs = Date.now()): Promise<ScheduledNight | null> {
  const nights = nightsAhead((await readSchedule(db)).slots, 1, nowMs)
  return nights.find((n) => n.once) ?? nights[0] ?? null
}
