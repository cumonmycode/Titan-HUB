/**
 * Модель и форматтеры раздела «Мероприятия» (веб-касса). Чистые функции без React:
 * типы ответа API, вид статусов/видов, время/длительность, подписи суммы и места,
 * группировка ленты по дням и по месяцам.
 */
import { formatMoney } from '@/components/manage/DesignSystem'

export type EventStatus = 'planned' | 'needs_clarification' | 'active' | 'completed' | 'cancelled'
export type BillingMode = 'amount' | 'hourly' | 'rental'
/** Вид события в интерфейсе: миникап — это format='minicap' (type у него titan). */
export type EventKind = 'titan' | 'exit' | 'minicap'

export interface EventItem {
  id: string
  type: 'titan' | 'exit'
  format?: string | null
  title: string | null
  location: string | null
  spaceId: string | null
  date: string
  startTime: string
  endTime: string | null
  billingMode: BillingMode
  fixedAmount: string | null
  manualAmount: string | null
  plannedHours: number | null
  maxGuests: number | null
  attendeesCount?: number | null
  /** Игроков в составе миникапа (сервер отдаёт только для миникапов). */
  playersCount?: number
  status: EventStatus
  comment: string | null
  responsibleStaffId: string | null
  customerName: string | null
  customerPhone: string | null
  checkId: string | null
  participationFee: string | null
  prizeFund: string | null
  lunchCost: string | null
  otherCost: string | null
}

export interface SpaceInfo { id: string; name: string; hourlyRate?: string | number | null }
export interface StaffInfo { id: string; nickname: string }
export interface EventRate { hours: number; price: number }

/** Заявка с сайта (GET /bookings?status=new). */
export interface BookingRequest {
  id: string
  space_id: string | null
  zone_name: string | null
  name: string | null
  phone: string | null
  guests: number | null
  title: string | null
  starts_at: string
  tariff_hours: number | null
  location: string | null
  address: string | null
  comment: string | null
}

/** Конфликт брони зоны (409 от POST/PATCH /events и /events/availability). */
export interface EventConflict { id: string; title: string | null; date?: string; startTime: string; endTime: string | null }

export const MUTED = 'var(--on-surface-variant)'

export const STATUS_LOOK: Record<EventStatus, { label: string; color: string }> = {
  planned: { label: 'Запланировано', color: 'var(--info)' },
  needs_clarification: { label: 'Нужно уточнить', color: 'var(--warning)' },
  active: { label: 'Идёт', color: 'var(--success)' },
  completed: { label: 'Завершено', color: '#94A3B8' },
  cancelled: { label: 'Отменено', color: 'var(--danger)' },
}

export const KIND_LOOK: Record<EventKind, { label: string; icon: string }> = {
  titan: { label: 'В клубе', icon: 'home' },
  exit: { label: 'Выезд', icon: 'directions_car' },
  minicap: { label: 'Миникап', icon: 'emoji_events' },
}

export const MINICAP_MAX_PLAYERS = 10
export const MINICAP_LOCATION = 'TITAN'

export const eventKind = (ev: Pick<EventItem, 'type' | 'format'>): EventKind =>
  ev.format === 'minicap' ? 'minicap' : ev.type

export const isPastEvent = (ev: Pick<EventItem, 'status'>): boolean =>
  ev.status === 'completed' || ev.status === 'cancelled'

/** Число из строки/числа API; пусто/мусор → null. */
export function num(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

export const rub = (n: number) => formatMoney(n)

// ─── Время и длительность ──────────────────────────────────────────────────

const DAY_MIN = 24 * 60

export function isValidTime(t: string | null | undefined): t is string {
  return !!t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
}

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function fromMin(total: number): string {
  const m = ((total % DAY_MIN) + DAY_MIN) % DAY_MIN
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Минуты от начала до конца; конец ≤ начала — значит, после полуночи. */
export function durationMin(start: string, end: string): number {
  const diff = toMin(end) - toMin(start)
  return diff <= 0 ? diff + DAY_MIN : diff
}

/** Конец по началу и длительности + признак «следующий день». */
export function endAfter(start: string, minutes: number): { time: string; nextDay: boolean } {
  const total = toMin(start) + minutes
  return { time: fromMin(total), nextDay: total >= DAY_MIN }
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

/** Длительность события: по концу, иначе по плановым часам пакета. */
export function eventDurationMin(ev: Pick<EventItem, 'startTime' | 'endTime' | 'plannedHours'>): number | null {
  if (isValidTime(ev.startTime) && isValidTime(ev.endTime)) return durationMin(ev.startTime, ev.endTime)
  return ev.plannedHours ? ev.plannedHours * 60 : null
}

/** Часы для «Пакета» — как на сервере (hoursBetween): начатый час считается целым. */
export const plannedHoursFor = (minutes: number): number => Math.min(24, Math.max(1, Math.ceil(minutes / 60)))

// ─── Даты ──────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const MONTHS_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

const pad = (n: number) => String(n).padStart(2, '0')
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function parseDate(date: string): Date | null {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

/** Сегодня по часам устройства (а не UTC: ночью UTC-дата ещё вчерашняя). */
export const todayStr = (): string => localDateStr(new Date())

export function addDays(date: string, days: number): string {
  const d = parseDate(date)
  if (!d) return date
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

/** «Пт, 10 октября» (+ год, если не текущий). */
export function fmtDateLong(date: string): string {
  const d = parseDate(date)
  if (!d) return date
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${year}`
}

/** «10 окт» — для ведущей колонки прошедших. */
export function fmtDateShort(date: string): string {
  const d = parseDate(date)
  return d ? `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}` : date
}

/** Заголовок дня в ленте: Сегодня / Завтра / Вчера / «Пт, 10 октября». */
export function dayLabel(date: string): string {
  const today = todayStr()
  if (date === today) return 'Сегодня'
  if (date === addDays(today, 1)) return 'Завтра'
  if (date === addDays(today, -1)) return 'Вчера'
  return fmtDateLong(date)
}

/** 'YYYY-MM' → «Сентябрь 2026». */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FULL[m - 1] ?? ym} ${y}`
}

// ─── Подписи карточки/просмотра ────────────────────────────────────────────

/** Цена пакета на h часов — зеркало сервера (hourlyPackagePrice): точный тариф,
 *  иначе ближайший меньший + остаток по его цене часа, иначе по большему. */
export function packagePrice(rates: EventRate[], h: number): number | null {
  const list = rates.filter(r => r.hours > 0).sort((a, b) => a.hours - b.hours)
  if (!list.length || h <= 0) return null
  const exact = list.find(r => r.hours === h)
  if (exact) return exact.price
  const lower = list.filter(r => r.hours < h).pop()
  if (lower) return Math.round(lower.price + (h - lower.hours) * (lower.price / lower.hours))
  const upper = list.find(r => r.hours > h)
  return upper ? Math.round(h * (upper.price / upper.hours)) : null
}

export function spaceName(spaces: SpaceInfo[], id: string | null | undefined): string | null {
  return id ? spaces.find(s => s.id === id)?.name ?? null : null
}

/** Место события: зона в клубе / адрес выезда / TITAN для миникапа. */
export function placeLabel(ev: EventItem, spaces: SpaceInfo[]): string {
  const kind = eventKind(ev)
  if (kind === 'minicap') return MINICAP_LOCATION
  if (kind === 'exit') return ev.location?.trim() || 'Адрес не указан'
  return spaceName(spaces, ev.spaceId) ?? 'В клубе'
}

/** Короткая сумма для карточки ленты (без слов, если это деньги). */
export function amountLabel(ev: EventItem, rates: EventRate[]): string | null {
  if (eventKind(ev) === 'minicap') {
    const fee = num(ev.participationFee)
    return fee != null ? `взнос ${rub(fee)}` : null
  }
  if (ev.billingMode === 'rental') return 'по ставке зоны'
  if (ev.billingMode === 'hourly') {
    const price = ev.plannedHours ? packagePrice(rates, ev.plannedHours) : null
    return price != null ? rub(price) : 'пакет'
  }
  const amount = num(ev.manualAmount) ?? num(ev.fixedAmount)
  return amount != null ? rub(amount) : null
}

/** Название события в ленте/просмотре. */
export function eventTitle(ev: EventItem): string {
  return ev.title?.trim() || ev.customerName?.trim() || KIND_LOOK[eventKind(ev)].label
}

// ─── Группировки ленты ─────────────────────────────────────────────────────

const sortKey = (e: EventItem) => `${e.date ?? ''}T${e.startTime ?? '00:00'}`

export interface DayGroup { date: string; label: string; items: EventItem[] }
export interface MonthGroup { ym: string; label: string; items: EventItem[] }

/** Предстоящие (включая идущие сейчас) по дням, по возрастанию. */
export function groupUpcoming(events: EventItem[]): DayGroup[] {
  const sorted = events.filter(e => !isPastEvent(e)).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  const groups: DayGroup[] = []
  for (const ev of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.date === ev.date) last.items.push(ev)
    else groups.push({ date: ev.date, label: dayLabel(ev.date), items: [ev] })
  }
  return groups
}

/** Прошедшие: текущий месяц плоско + прошлые месяцы папками (по убыванию). */
export function groupPast(events: EventItem[]): { thisMonth: EventItem[]; older: MonthGroup[] } {
  const past = events.filter(isPastEvent).sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
  const curYM = todayStr().slice(0, 7)
  const thisMonth = past.filter(e => (e.date ?? '').slice(0, 7) === curYM)
  const byMonth = new Map<string, EventItem[]>()
  for (const ev of past) {
    const ym = (ev.date ?? '').slice(0, 7)
    if (!ym || ym === curYM) continue
    byMonth.set(ym, [...(byMonth.get(ym) ?? []), ev])
  }
  const older = [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, items]) => ({ ym, label: monthLabel(ym), items }))
  return { thisMonth, older }
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/** Текст конфликта брони: «Иван, 18:00–21:00». */
export function conflictText(c: EventConflict): string {
  const time = c.endTime ? `${c.startTime}–${c.endTime}` : `с ${c.startTime}`
  return c.title ? `«${c.title}», ${time}` : time
}

/** Сообщение ошибки API + детали конфликта зоны, если сервер их прислал (409). */
export function apiErrorText(err: unknown, fallback: string): string {
  const e = err as { message?: string; data?: { conflict?: EventConflict } } | null
  const base = e?.message || fallback
  const c = e?.data?.conflict
  return c ? `${base}: ${conflictText(c)}` : base
}
