// Единый источник правды для денежной математики чеков.
// Раньше round2 и расчёт аренды дублировались в pos.router.ts и platega.router.ts
// (с комментарием «держать синхронно»). Чтобы математика не разъезжалась —
// одна реализация на оба сервера. Поведение байт-в-байт как было.

/** Округление до 2 знаков с защитой от плавающей погрешности. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Сумма по позициям чека: позиции + платные модификаторы − скидки (на чек/позицию).
 * Единая реализация для /pay (pos.router) и вебхука Platega — раньше дублировалась
 * байт-в-байт в обоих местах (риск расхождения суммы кассы и суммы вебхука).
 * НЕ включает аренду зоны и базу события — это отдельные слагаемые итога.
 */
export function computeTotals(
  items: { id: string; priceAtTime: string; quantity: number; customName?: string | null }[],
  mods: { checkItemId: string; priceAtTime: string }[],
  discountRows: { type: string; value: string; target: string; itemId: string | null }[],
) {
  const qtyByItem = new Map(items.map(i => [i.id, i.quantity]))
  const itemsTotal = items.reduce((s, i) => s + parseFloat(i.priceAtTime) * i.quantity, 0)
  const modsTotal = mods.reduce((s, m) => s + parseFloat(m.priceAtTime) * (qtyByItem.get(m.checkItemId) ?? 1), 0)
  const gross = itemsTotal + modsTotal
  // Свободные строки «Другое» — возврат денег, оплаченных клубом за гостя: скидки на
  // них не действуют (иначе скидка резидента «съедала» бы часть возврата).
  const custom = items.reduce((s, i) => s + (i.customName ? parseFloat(i.priceAtTime) * i.quantity : 0), 0)
  const discountable = gross - custom
  let discountTotal = 0
  for (const d of discountRows) {
    let base = discountable
    if (d.target === 'item' && d.itemId) {
      const it = items.find(i => i.id === d.itemId)
      base = it && !it.customName ? parseFloat(it.priceAtTime) * it.quantity : 0
    }
    discountTotal += d.type === 'percent' ? base * (parseFloat(d.value) / 100) : Math.min(parseFloat(d.value), base)
  }
  discountTotal = Math.min(discountTotal, discountable)
  return { gross: round2(gross), discountTotal: round2(discountTotal), total: round2(Math.max(0, gross - discountTotal)) }
}

/**
 * Аренда зоны: ceil(минуты/60) × ставка.
 * Конец аренды — заданный вручную spaceEndAt либо «живой счётчик» (nowMs).
 * Возвращает 0, если зона/время начала/ставка отсутствуют (NULL-handling
 * идентичен прежним инлайновым копиям в /pay и вебхуке Platega).
 *
 * Чистая функция (без БД): вызывающий код сам тянет hourlyRate из spaces.
 */
export function computeRental(
  spaceStartAt: Date | string | null | undefined,
  spaceEndAt: Date | string | null | undefined,
  hourlyRate: string | null | undefined,
  nowMs: number,
): number {
  if (!spaceStartAt || !hourlyRate) return 0
  const endMs = spaceEndAt ? new Date(spaceEndAt).getTime() : nowMs
  // Целые минуты: секунды/миллисекунды (выбор времени оставляет «хвост» от исходного
  // значения) не должны превращать ровно 3 часа в 4. Начатая минута сверх часа — час.
  const mins = Math.floor(Math.max(0, endMs - new Date(spaceStartAt).getTime()) / 60000)
  return Math.ceil(mins / 60) * parseFloat(hourlyRate)
}

/**
 * Выручка одного чека без свободных позиций «Другое» (см. lib/revenue.ts) из строки с
 * totalAmount/customAmount (числа или строки numeric).
 */
export function revenueOf(check: { totalAmount: string | number | null; customAmount?: string | number | null }): number {
  const total = parseFloat(String(check.totalAmount ?? 0)) || 0
  const custom = parseFloat(String(check.customAmount ?? 0)) || 0
  return Math.max(0, Math.round((total - custom) * 100) / 100)
}
