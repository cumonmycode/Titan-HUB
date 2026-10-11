/**
 * Форматирование для ответов Tai — без Intl: в контейнере API может не быть
 * ICU-данных для ru (см. lib/dateFmt.ts), а суммы должны выглядеть как в приложении.
 */

const NBSP = ' '

export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? 0))
  return Number.isFinite(n) ? n : 0
}

/** 48200 → «48 200 ₽», 1460.5 → «1 460,5 ₽». */
export function rub(value: unknown): string {
  const n = num(value)
  const sign = n < 0 ? '−' : ''
  const abs = Math.abs(n)
  const whole = Math.trunc(Math.round(abs * 100) / 100)
  const kopecks = Math.round((abs - whole) * 100)
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${sign}${grouped}${kopecks ? `,${String(kopecks).padStart(2, '0').replace(/0$/, '')}` : ''}${NBSP}₽`
}

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b > 1 && b < 5) return forms[1]
  if (b === 1) return forms[0]
  return forms[2]
}

export const checksWord = (n: number) => `${n}${NBSP}${plural(n, ['чек', 'чека', 'чеков'])}`

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

/** «2026-10-09» → «9 окт». */
export function dayLabel(key: string, withWeekday = false): string {
  const date = new Date(`${key}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return key
  const base = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  return withWeekday ? `${base}, ${WEEKDAYS_SHORT[date.getUTCDay()]}` : base
}

export function periodLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${dayLabel(from)} — ${dayLabel(to)}`
}

export function addDays(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1

/** Время по МСК «21:40» из ISO. */
export function mskTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(new Date(iso).getTime() + 3 * 3600 * 1000)
  if (Number.isNaN(date.getTime())) return '—'
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDateKey = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value)

/** Подписи способов оплаты — как в кассе. */
export const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные',
  card: 'Перевод',
  transfer: 'СБП',
  bonus: 'Бонусы',
  deposit: 'Депозит',
  debt: 'Долг',
  certificate: 'Сертификат',
  split: 'Раздельная',
}
export const methodLabel = (method: string) => METHOD_LABELS[method] ?? method

/** Цвета способов оплаты — те же, что в кассе приложения (lib/payment.ts METHODS). */
export const METHOD_COLORS: Record<string, string> = {
  cash: '#10B981',
  card: '#3B82F6',
  transfer: '#8B5CF6',
  bonus: '#F59E0B',
  deposit: '#06B6D4',
  debt: '#F43F5E',
  certificate: '#EAB308',
}

export const TIER_LABELS: Record<string, string> = {
  resident: 'Резидент',
  student: 'Студент',
  newbie: 'Новичок',
  guest: 'Гость',
}

/** Строка для поиска: нижний регистр, «ё» → «е», без лишних пробелов. */
export const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
