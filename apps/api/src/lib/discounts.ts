/**
 * Движок скидок клуба: какие скидки подходят чеку и какие строки check_discounts они дают.
 *
 * Скидка сама описывает условия (миграция 085): на что (весь чек / категории / позиции),
 * кому (все / статусы / клиенты / команда / первый визит, день рождения ± дней), когда
 * (дни недели, время, период — по моменту открытия чека), минимальная сумма и количество.
 * Автоматические скидки применяются сами; ручные («скидки клуба») — когда кассир выбрал.
 *
 * Сочетание: «несуммируемая» скидка исключительна — берётся одна лучшая из них, либо все
 * суммируемые вместе, если они в сумме выгоднее. Выбранные кассиром — всегда сверху.
 * Математика строк — та же, что у computeTotals (money.ts): процент от базы, сумма ≤ базы.
 */
import type { Discount } from '@titan/database'

export interface CheckLine {
  /** id строки check_items. */
  id: string
  itemId: string
  categoryId: string | null
  price: number
  qty: number
}

export interface DiscountContext {
  playerId: string | null
  player: { role: string; clientTier: string; birthday: string | null; closedChecks: number } | null
  /** Момент открытия чека — по нему сверяются день недели, время и период. */
  openedAt: Date
  lines: CheckLine[]
  /** Позиции + платные модификаторы (база скидки на весь чек). */
  gross: number
}

export interface DiscountRow {
  discountId: string
  name: string
  type: 'percent' | 'fixed'
  value: string
  amount: string
  target: 'check' | 'item'
  itemId: string | null
}

const MSK_MS = 3 * 3600_000
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function mskParts(at: Date): { date: string; weekday: number; minutes: number } {
  const d = new Date(at.getTime() + MSK_MS)
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  return { date: d.toISOString().slice(0, 10), weekday, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

const toMinutes = (hhmm: string | null): number | null => {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Дней от даты до ближайшего дня рождения (в любую сторону). */
function birthdayDistance(birthday: string | null, today: string): number | null {
  const m = birthday?.match(/^\d{4}-(\d{2})-(\d{2})/)
  if (!m) return null
  const year = Number(today.slice(0, 4))
  const now = Date.UTC(year, Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const dists = [year - 1, year, year + 1].map((y) => Math.abs(Date.UTC(y, Number(m[1]) - 1, Number(m[2])) - now) / 86_400_000)
  return Math.min(...dists)
}

/** Подходит ли скидка чеку по «кому» и «когда» (без суммы и состава). */
export function matchesConditions(d: Discount, ctx: DiscountContext): boolean {
  const when = mskParts(ctx.openedAt)
  if (d.weekdays.length && !d.weekdays.includes(when.weekday)) return false
  const from = toMinutes(d.timeFrom)
  const to = toMinutes(d.timeTo)
  if (from !== null && to !== null && from !== to) {
    const inside = from < to ? when.minutes >= from && when.minutes < to : when.minutes >= from || when.minutes < to
    if (!inside) return false
  }
  if (d.startsOn && when.date < d.startsOn) return false
  if (d.endsOn && when.date > d.endsOn) return false

  const p = ctx.player
  switch (d.audience) {
    case 'tiers': if (!p || !d.tiers.includes(p.clientTier)) return false; break
    case 'clients': if (!ctx.playerId || !d.clientIds.includes(ctx.playerId)) return false; break
    case 'staff': if (!p || (p.role !== 'staff' && p.role !== 'owner')) return false; break
    case 'first': if (!p || p.closedChecks > 0) return false; break
  }
  if (d.birthdayDays !== null && d.birthdayDays !== undefined) {
    const dist = birthdayDistance(p?.birthday ?? null, when.date)
    if (dist === null || dist > d.birthdayDays) return false
  }
  return true
}

function scopeLines(d: Discount, ctx: DiscountContext): CheckLine[] {
  if (d.scope === 'categories') return ctx.lines.filter((l) => l.categoryId && d.categoryIds.includes(l.categoryId))
  if (d.scope === 'items') return ctx.lines.filter((l) => d.itemIds.includes(l.itemId))
  return ctx.lines
}

/** Строки скидки для чека и её эффект в рублях; null — по сумме/составу не подходит. */
export function discountRows(d: Discount, ctx: DiscountContext): { rows: DiscountRow[]; effect: number } | null {
  const value = parseFloat(d.value)
  if (!(value > 0) || ctx.gross < parseFloat(d.minCheckSum ?? '0')) return null
  const lines = scopeLines(d, ctx)
  const qty = lines.reduce((s, l) => s + l.qty, 0)
  if (!lines.length || qty < (d.minQuantity ?? 1)) return null
  const base = { discountId: d.id, name: d.name, type: d.type as 'percent' | 'fixed' }

  if (d.scope === 'check') {
    const effect = d.type === 'percent' ? (ctx.gross * value) / 100 : Math.min(value, ctx.gross)
    if (effect <= 0) return null
    return { rows: [{ ...base, value: String(value), amount: String(round2(effect)), target: 'check', itemId: null }], effect }
  }
  if (d.type === 'percent') {
    const rows = lines.map((l) => ({ ...base, value: String(value), amount: String(round2((l.price * l.qty * value) / 100)), target: 'item' as const, itemId: l.id }))
    const effect = lines.reduce((s, l) => s + (l.price * l.qty * value) / 100, 0)
    return effect > 0 ? { rows, effect } : null
  }
  // Сумма на категории/позиции — одной строкой на чек, не больше стоимости этих позиций.
  const capped = round2(Math.min(value, lines.reduce((s, l) => s + l.price * l.qty, 0)))
  if (capped <= 0) return null
  return { rows: [{ ...base, value: String(capped), amount: String(capped), target: 'check', itemId: null }], effect: capped }
}

/**
 * Итоговый набор строк: авто-скидки по условиям + выбранные кассиром, без снятых вручную.
 * forced — скидки, которые действуют независимо от флага «автоматическая» (устаревшие
 * правила по статусам из веба): проверяются по условиям, как несуммируемые.
 */
export function pickDiscounts(all: Discount[], ctx: DiscountContext, opts: { manualIds: string[]; excludedIds: string[]; forced?: Discount[] }): DiscountRow[] {
  const excluded = new Set(opts.excludedIds)
  const manual = new Set(opts.manualIds)
  const forced = new Set((opts.forced ?? []).map((d) => d.id))
  const exclusive: { rows: DiscountRow[]; effect: number }[] = []
  const stackable: { rows: DiscountRow[]; effect: number }[] = []
  const chosen: DiscountRow[] = []
  const seen = new Set<string>()

  for (const d of [...all, ...(opts.forced ?? [])]) {
    if (seen.has(d.id) || excluded.has(d.id) || !d.isActive) continue
    seen.add(d.id)
    const isManual = manual.has(d.id)
    if (!isManual && !d.isAuto && !forced.has(d.id)) continue
    // Выбранную кассиром скидку клуба не перепроверяем по «кому/когда» — он так решил.
    if (!isManual && !matchesConditions(d, ctx)) continue
    const result = discountRows(d, ctx)
    if (!result) continue
    if (isManual) chosen.push(...result.rows)
    else (d.combinable && !forced.has(d.id) ? stackable : exclusive).push(result)
  }

  const bestExclusive = exclusive.sort((a, b) => b.effect - a.effect)[0]
  const stackEffect = stackable.reduce((s, r) => s + r.effect, 0)
  const auto = bestExclusive && bestExclusive.effect >= stackEffect ? bestExclusive.rows : stackable.flatMap((r) => r.rows)
  return [...auto, ...chosen]
}
