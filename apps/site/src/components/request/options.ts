import type { ScheduleDay } from '@/lib/types'
import { DAY_SHORT } from '@/lib/format'

export type Evening = 'city_mafia' | 'sport_mafia' | 'board_games' | 'any'
export type EventFormat = 'birthday' | 'corporate' | 'kids' | 'party' | 'other'
export type Topic = 'partnership' | 'question' | 'other'

export const EVENT_FORMATS: { id: EventFormat; label: string }[] = [
  { id: 'birthday', label: 'День рождения' },
  { id: 'corporate', label: 'Корпоратив' },
  { id: 'kids', label: 'Детская мафия' },
  { id: 'party', label: 'Вечеринка' },
  { id: 'other', label: 'Другое' },
]

export const TOPICS: { id: Topic; label: string }[] = [
  { id: 'question', label: 'Вопрос' },
  { id: 'partnership', label: 'Сотрудничество' },
  { id: 'other', label: 'Другое' },
]

export function eveningOf(title: string): Evening {
  if (/город/i.test(title)) return 'city_mafia'
  if (/спорт/i.test(title)) return 'sport_mafia'
  if (/настол/i.test(title)) return 'board_games'
  return 'any'
}

export interface EveningSlot { date: string; time: string; title: string; evening: Evening; label: string }

/** Ближайшие игровые вечера по расписанию (МСК), начиная с сегодняшнего, если он ещё впереди. */
export function upcomingEvenings(schedule: ScheduleDay[], count: number, now = new Date()): EveningSlot[] {
  const out: EveningSlot[] = []
  const msk = new Date(now.getTime() + 3 * 3600_000)
  const minutesNow = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  for (let add = 0; add < 21 && out.length < count; add++) {
    const d = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + add))
    const dow = ((d.getUTCDay() + 6) % 7) + 1
    for (const s of schedule.filter((x) => x.day === dow)) {
      const time = s.time ?? '19:00'
      const [h, m] = time.split(':').map(Number)
      if (add === 0 && (h ?? 19) * 60 + (m ?? 0) <= minutesNow) continue
      const when = add === 0 ? 'Сегодня' : add === 1 ? 'Завтра' : `${DAY_SHORT[dow]}, ${d.getUTCDate()} ${d.toLocaleDateString('ru-RU', { timeZone: 'UTC', month: 'short' }).replace('.', '')}`
      out.push({ date: d.toISOString().slice(0, 10), time, title: s.title, evening: eveningOf(s.title), label: when })
    }
  }
  return out
}

export const TIMES = Array.from({ length: 14 }, (_, i) => `${String(10 + i).padStart(2, '0')}:00`)

export function mskToday(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
}

/** +7 (965) 666-07-00 из любых цифр. */
export function formatPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('8') && d.length === 11) d = '7' + d.slice(1)
  if (d.length === 10) d = '7' + d
  if (d.length !== 11 || !d.startsWith('7')) return raw
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
}
