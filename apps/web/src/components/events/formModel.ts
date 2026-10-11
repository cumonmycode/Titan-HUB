/**
 * Единая форма мероприятия (В клубе | Выезд | Миникап): состояние, разбор
 * существующего события, вычисление конца/длительности, проверка и тело запроса.
 * Чистые функции — форма-компонент только связывает их с UI.
 */
import {
  type BillingMode, type EventItem, type EventKind, type EventRate, type SpaceInfo,
  durationMin, endAfter, eventKind, isValidTime, num, packagePrice, plannedHoursFor, todayStr,
  MINICAP_LOCATION,
} from './lib'

/** Чипсы длительности «1 ч … 6 ч»; всё прочее — через «Другое» (время конца). */
export const DURATION_CHIPS = [1, 2, 3, 4, 5, 6] as const

export interface EventFormState {
  kind: EventKind
  /** Только миникап: у клуба/выезда название = заказчик / адрес (как раньше). */
  title: string
  customerName: string
  customerPhone: string
  /** Имя совпало с заказчиком из справочника → телефон уже известен. */
  customerKnown: boolean
  date: string
  startTime: string
  durationH: number | null
  customEnd: boolean
  endTime: string
  spaceId: string
  location: string
  billingMode: BillingMode
  fixedAmount: string
  fee: string
  prize: string
  lunch: string
  other: string
  showPrize: boolean
  showLunch: boolean
  showOther: boolean
  responsibleStaffId: string
  maxGuests: string
  comment: string
}

export function blankForm(): EventFormState {
  return {
    kind: 'titan', title: '', customerName: '', customerPhone: '', customerKnown: false,
    date: todayStr(), startTime: '18:00', durationH: null, customEnd: false, endTime: '',
    spaceId: '', location: '', billingMode: 'amount', fixedAmount: '',
    fee: '', prize: '', lunch: '', other: '', showPrize: false, showLunch: false, showOther: false,
    responsibleStaffId: '', maxGuests: '', comment: '',
  }
}

const str = (v: string | number | null | undefined) => (v == null ? '' : String(v))

/** Длительность события → чипс (целые 1–6 ч) или «Другое» с концом. */
function durationFields(ev: EventItem): Pick<EventFormState, 'durationH' | 'customEnd' | 'endTime'> {
  const start = isValidTime(ev.startTime) ? ev.startTime : null
  if (start && isValidTime(ev.endTime)) {
    const min = durationMin(start, ev.endTime)
    const h = min / 60
    if (Number.isInteger(h) && h >= 1 && h <= DURATION_CHIPS.length) return { durationH: h, customEnd: false, endTime: '' }
    return { durationH: null, customEnd: true, endTime: ev.endTime }
  }
  const ph = ev.plannedHours
  if (ph && ph >= 1 && ph <= DURATION_CHIPS.length) return { durationH: ph, customEnd: false, endTime: '' }
  if (ph && start) return { durationH: null, customEnd: true, endTime: endAfter(start, ph * 60).time }
  return { durationH: null, customEnd: false, endTime: '' }
}

export function formFromEvent(ev: EventItem): EventFormState {
  const base = blankForm()
  return {
    ...base,
    ...durationFields(ev),
    kind: eventKind(ev),
    title: ev.title ?? '',
    customerName: ev.customerName ?? '',
    customerPhone: ev.customerPhone ?? '',
    date: ev.date || base.date,
    startTime: isValidTime(ev.startTime) ? ev.startTime : base.startTime,
    spaceId: ev.spaceId ?? '',
    location: ev.type === 'exit' ? (ev.location ?? '') : '',
    billingMode: ev.billingMode ?? 'amount',
    fixedAmount: str(ev.fixedAmount),
    fee: str(ev.participationFee),
    prize: str(ev.prizeFund), lunch: str(ev.lunchCost), other: str(ev.otherCost),
    showPrize: ev.prizeFund != null, showLunch: ev.lunchCost != null, showOther: ev.otherCost != null,
    responsibleStaffId: ev.responsibleStaffId ?? '',
    maxGuests: str(ev.maxGuests),
    comment: ev.comment ?? '',
  }
}

/** Время конца (HH:MM) по выбранной длительности или ручному концу; нет — null. */
export function resolvedEnd(f: EventFormState): string | null {
  if (!isValidTime(f.startTime)) return null
  if (f.customEnd) return isValidTime(f.endTime) ? f.endTime : null
  return f.durationH ? endAfter(f.startTime, f.durationH * 60).time : null
}

/** Длительность в минутах (null — не выбрана). */
export function resolvedDurationMin(f: EventFormState): number | null {
  if (!isValidTime(f.startTime)) return null
  if (f.customEnd) return isValidTime(f.endTime) ? durationMin(f.startTime, f.endTime) : null
  return f.durationH ? f.durationH * 60 : null
}

/** Режим оплаты с учётом вида: «По ставке зоны» есть только в клубе. */
export function effectiveMode(f: EventFormState): BillingMode {
  return f.billingMode === 'rental' && f.kind !== 'titan' ? 'amount' : f.billingMode
}

export interface FormTotal { amount: number; approx: boolean }

/** Сумма для кнопки «Создать · 15 000 ₽» (миникап — без суммы). */
export function formTotal(f: EventFormState, rates: EventRate[], spaces: SpaceInfo[]): FormTotal | null {
  if (f.kind === 'minicap') return null
  const mode = effectiveMode(f)
  const dur = resolvedDurationMin(f)
  if (mode === 'amount') {
    const n = num(f.fixedAmount)
    return n != null && n > 0 ? { amount: n, approx: false } : null
  }
  if (mode === 'hourly') {
    const price = dur ? packagePrice(rates, plannedHoursFor(dur)) : null
    return price != null ? { amount: price, approx: false } : null
  }
  const rate = num(spaces.find(s => s.id === f.spaceId)?.hourlyRate ?? null)
  return rate && dur ? { amount: Math.round((rate * dur) / 60), approx: true } : null
}

/** Проверка перед сохранением; текст ошибки или null. */
export function validateForm(f: EventFormState): string | null {
  if (!f.date) return 'Укажите дату'
  if (!isValidTime(f.startTime)) return 'Укажите время начала'
  if (f.kind === 'minicap') return f.title.trim() ? null : 'Укажите название миникапа'
  if (f.customEnd && !isValidTime(f.endTime)) return 'Укажите время окончания'
  if (f.kind === 'exit' && !f.responsibleStaffId) return 'Для выезда укажите ответственного'
  if (f.kind === 'titan' && !f.customerName.trim()) return 'Укажите имя заказчика'
  if (f.kind === 'exit' && !f.location.trim()) return 'Укажите адрес выезда'
  const mode = effectiveMode(f)
  if (mode === 'rental' && !f.spaceId) return 'Выберите зону — чек посчитает её аренду по ставке'
  if (mode === 'hourly' && !resolvedDurationMin(f)) return 'Выберите длительность — по ней считается пакет'
  const guests = f.maxGuests.trim()
  if (guests && !(Number.isInteger(Number(guests)) && Number(guests) > 0)) return 'Число гостей — целое больше нуля'
  return null
}

const money = (v: string): number | null => {
  const n = num(v.trim())
  return n != null && n >= 0 ? n : null
}

/** Тело POST/PATCH /events для миникапа. */
function minicapPayload(f: EventFormState, isEdit: boolean): Record<string, unknown> {
  const fields = {
    title: f.title.trim() || null,
    date: f.date,
    startTime: f.startTime,
    participationFee: money(f.fee),
    prizeFund: f.showPrize ? money(f.prize) : null,
    lunchCost: f.showLunch ? money(f.lunch) : null,
    otherCost: f.showOther ? money(f.other) : null,
  }
  if (isEdit) return fields
  return { ...fields, format: 'minicap', type: 'titan', location: MINICAP_LOCATION, paymentType: 'fixed', billingMode: 'amount' }
}

/** Тело POST/PATCH /events. Название клуба = имя заказчика, выезда = адрес. */
export function buildPayload(f: EventFormState, isEdit: boolean): Record<string, unknown> {
  if (f.kind === 'minicap') return minicapPayload(f, isEdit)
  const mode = effectiveMode(f)
  const dur = resolvedDurationMin(f)
  const isClub = f.kind === 'titan'
  const guests = f.maxGuests.trim()
  return {
    type: f.kind,
    title: isClub ? (f.customerName.trim() || null) : (f.location.trim() || null),
    location: isClub ? null : (f.location.trim() || null),
    spaceId: isClub ? (f.spaceId || null) : null,
    date: f.date,
    startTime: f.startTime,
    endTime: resolvedEnd(f),
    paymentType: 'fixed',
    billingMode: mode,
    fixedAmount: mode === 'amount' ? money(f.fixedAmount) : null,
    plannedHours: mode === 'hourly' && dur ? plannedHoursFor(dur) : null,
    responsibleStaffId: f.responsibleStaffId || null,
    customerName: f.customerName.trim() || null,
    customerPhone: f.customerPhone.trim() || null,
    maxGuests: guests ? Number(guests) : null,
    comment: f.comment.trim() || null,
  }
}
