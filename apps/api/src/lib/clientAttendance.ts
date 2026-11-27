/**
 * На какие вечера ходит клиент: Городская, Спортивная, Настолки, Другие ивенты и
 * «Без вечера» — для диаграммы в карточке клиента.
 *
 * Визит — смена, в которой у клиента есть закрытый чек (несколько чеков за вечер —
 * один визит). Вид визита:
 *   • чек привязан к мероприятию (день рождения, миникап, Хэллоуин…) — «Другие ивенты»;
 *   • в чеке есть тариф-место (игровой тариф) — по типу вечера смены: city_mafia →
 *     Городская, sport_mafia → Спортивная, board_games → Настолки, любой другой
 *     (Новый год, детская мафия, свой тип) — «Другие ивенты»;
 *   • тарифа нет — клиент только купил что-то и не играл: «Без вечера».
 */
import { sql, type Database } from '@titan/database'

export type AttendanceKey = 'city' | 'sport' | 'board' | 'other' | 'none'

export interface AttendanceCategory {
  key: AttendanceKey
  label: string
  count: number
  lastAt: string | null
}

export interface ClientAttendance {
  total: number
  firstAt: string | null
  lastAt: string | null
  categories: AttendanceCategory[]
  /** Что именно было в «Других ивентах»: название мероприятия или тип вечера. */
  others: { label: string; count: number }[]
  /** Последние полгода по месяцам — для полосок под кольцом. */
  months: ({ month: string } & Record<AttendanceKey, number>)[]
}

const LABELS: Record<AttendanceKey, string> = {
  city: 'Городская',
  sport: 'Спортивная',
  board: 'Настолки',
  other: 'Другие ивенты',
  none: 'Без вечера',
}
const ORDER: AttendanceKey[] = ['city', 'sport', 'board', 'other', 'none']
const BY_EVENING: Record<string, AttendanceKey> = { city_mafia: 'city', sport_mafia: 'sport', board_games: 'board' }
const MONTHS = 6
const OTHERS_MAX = 8
const MSK = 'Europe/Moscow'

interface VisitRow {
  evening_type: string
  evening_label: string | null
  at: string
  played: boolean
  event_title: string | null
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

function classify(v: VisitRow): { key: AttendanceKey; otherLabel: string | null } {
  if (v.event_title) return { key: 'other', otherLabel: v.event_title }
  if (!v.played) return { key: 'none', otherLabel: null }
  const key = BY_EVENING[v.evening_type]
  if (key) return { key, otherLabel: null }
  return { key: 'other', otherLabel: v.evening_type === 'none' ? 'Игра без типа вечера' : (v.evening_label ?? v.evening_type) }
}

const monthOf = (iso: string): string => new Date(iso).toLocaleDateString('sv-SE', { timeZone: MSK }).slice(0, 7)

function lastMonths(now: Date): string[] {
  const [y, m] = now.toLocaleDateString('sv-SE', { timeZone: MSK }).slice(0, 7).split('-').map(Number) as [number, number]
  return Array.from({ length: MONTHS }, (_, i) => new Date(Date.UTC(y, m - 1 - (MONTHS - 1 - i), 1)).toISOString().slice(0, 7))
}

export async function clientAttendance(db: Database, profileId: string, now = new Date()): Promise<ClientAttendance> {
  const res = await db.execute(sql`
    SELECT s.evening_type, et.label AS evening_label, min(c.closed_at) AS at,
           bool_or(EXISTS (
             SELECT 1 FROM check_items ci JOIN tariffs t ON t.item_id = ci.item_id WHERE ci.check_id = c.id
           )) AS played,
           max(ev.title) AS event_title
    FROM checks c
    JOIN shifts s ON s.id = c.shift_id
    LEFT JOIN evening_types et ON et.key = s.evening_type
    LEFT JOIN events ev ON ev.id = c.linked_event_id AND ev.status <> 'cancelled'
    WHERE c.player_id = ${profileId} AND c.status = 'closed'
    GROUP BY c.shift_id, s.evening_type, et.label
    ORDER BY at
  `)
  const visits = rows<VisitRow>(res).filter((v) => v.at)
  const counts = new Map<AttendanceKey, { count: number; lastAt: string | null }>(ORDER.map((k) => [k, { count: 0, lastAt: null }]))
  const others = new Map<string, number>()
  const monthKeys = lastMonths(now)
  const months = new Map(monthKeys.map((m): [string, Record<AttendanceKey, number>] => [m, { city: 0, sport: 0, board: 0, other: 0, none: 0 }]))

  for (const v of visits) {
    const at = new Date(v.at).toISOString()
    const { key, otherLabel } = classify(v)
    const prev = counts.get(key)!
    counts.set(key, { count: prev.count + 1, lastAt: at })
    if (otherLabel) others.set(otherLabel, (others.get(otherLabel) ?? 0) + 1)
    const bucket = months.get(monthOf(at))
    if (bucket) months.set(monthOf(at), { ...bucket, [key]: bucket[key] + 1 })
  }

  return {
    total: visits.length,
    firstAt: visits[0] ? new Date(visits[0].at).toISOString() : null,
    lastAt: visits.length ? new Date(visits[visits.length - 1]!.at).toISOString() : null,
    categories: ORDER.map((key) => ({ key, label: LABELS[key], ...counts.get(key)! })),
    others: [...others.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, OTHERS_MAX),
    months: monthKeys.map((month) => ({ month, ...months.get(month)! })),
  }
}
