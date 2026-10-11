/**
 * Долг участника по ежемесячному сбору («Фонд клуба») — общая арифметика для
 * ростера персонала (modules/collections) и My Titan (modules/resident).
 *
 * Взносы участника копятся в пул и закрывают месяцы по порядку, поэтому здесь
 * считается только «сколько он должен был внести» за месяцы до просматриваемого
 * включительно:
 *  - у каждого месяца своя сумма (смена суммы одного месяца не трогает прошлые);
 *  - месяцы до появления клиента в базе не в счёт (новичок не должен за весь год);
 *  - месяцы исключения не в счёт (1м/3м — столько месяцев от начала исключения,
 *    «навсегда» с последующим возвратом — до месяца возврата).
 */

const MS_PER_DAY = 86_400_000
const MSK_OFFSET_MS = 3 * 3600 * 1000
const DAYS_PER_MONTH = 30

/** 'YYYY-MM' по Москве для момента времени. */
export function mskMonthKey(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + MSK_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export interface MemberExclusion {
  excludedFrom: Date | string | null
  excludedUntil: Date | string | null
  excludedForever: boolean
}

/** Месяцы прошедшего исключения (участник уже вернулся в сбор). */
export function excusedMonthKeys(m: MemberExclusion | null | undefined, now = new Date()): Set<string> {
  const keys = new Set<string>()
  if (!m || m.excludedForever || !m.excludedFrom || !m.excludedUntil) return keys
  const from = new Date(m.excludedFrom)
  const until = new Date(m.excludedUntil)
  if (until > now || until <= from) return keys
  const months = Math.max(1, Math.round((until.getTime() - from.getTime()) / MS_PER_DAY / DAYS_PER_MONTH))
  const start = mskMonthKey(from)
  for (let i = 0; i < months; i++) keys.add(addMonths(start, i))
  return keys
}

export interface DuePeriod {
  periodKey: string
  amount: number
}

/**
 * Сколько участник должен был внести за переданные месяцы (все ≤ просматриваемого).
 * override — персональная сумма участника (заменяет сумму каждого месяца).
 */
export function recurringOwed(
  periods: DuePeriod[],
  opts: { override: number | null; memberSince: Date | string | null; excused: Set<string> },
): number {
  const startKey = opts.memberSince ? mskMonthKey(opts.memberSince) : null
  let owed = 0
  for (const p of periods) {
    if (startKey && p.periodKey < startKey) continue
    if (opts.excused.has(p.periodKey)) continue
    owed += opts.override ?? p.amount
  }
  return Math.round(owed * 100) / 100
}
