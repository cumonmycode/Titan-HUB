import type { Price, ScheduleDay } from './types'

export const rub = (n: number): string => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export const DAY_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const
export const DAY_LONG = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'] as const

/** Цена для новичка: тариф «Новичок», иначе самый дорогой входной тариф. */
export function newbiePrice(prices: Price[]): number | null {
  const n = prices.find((p) => /нович/i.test(p.name))
  if (n) return n.price
  return prices.length ? Math.max(...prices.map((p) => p.price)) : null
}

export function minPrice(prices: { price: number }[]): number | null {
  const vals = prices.map((p) => p.price).filter((v) => v > 0)
  return vals.length ? Math.min(...vals) : null
}

/** Дни недели с этим вечером: «вт · пт». */
export function daysOf(schedule: ScheduleDay[], match: RegExp): string {
  return schedule.filter((d) => match.test(d.title)).map((d) => DAY_SHORT[d.day] ?? '').filter(Boolean).join(' · ')
}

/** Ближайший игровой вечер от «сейчас» по МСК: сегодня, если ещё не началось. */
export function nextEvening(schedule: ScheduleDay[], now = new Date()): { day: ScheduleDay; date: Date; isToday: boolean } | null {
  if (!schedule.length) return null
  const msk = new Date(now.getTime() + 3 * 3600_000)
  const isoDow = ((msk.getUTCDay() + 6) % 7) + 1
  const minutesNow = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  for (let add = 0; add < 8; add++) {
    const dow = ((isoDow - 1 + add) % 7) + 1
    const day = schedule.find((d) => d.day === dow)
    if (!day) continue
    const [h, m] = (day.time ?? '19:00').split(':').map(Number)
    if (add === 0 && (h ?? 19) * 60 + (m ?? 0) <= minutesNow) continue
    const date = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + add))
    return { day, date, isToday: add === 0 }
  }
  return null
}

export function dateLabel(d: Date): string {
  return d.toLocaleDateString('ru-RU', { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'long' })
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** srcset для фото из public/media (две ширины). */
export function media(name: string): { src: string; srcSet: string } {
  return { src: `/media/${name}-1600.webp`, srcSet: `/media/${name}-800.webp 800w, /media/${name}-1600.webp 1600w` }
}

/** Фото публикации: файлы сайта получают srcset двух размеров, загрузки HUB — как есть. */
export function photo(url: string): { src: string; srcSet?: string } {
  const m = /^\/media\/(.+)-1600\.webp$/.exec(url)
  return m ? media(m[1]!) : { src: url }
}
