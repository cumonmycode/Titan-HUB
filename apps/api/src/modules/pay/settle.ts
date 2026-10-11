/**
 * Общий расчёт и закрытие чека по подтверждённой СБП-оплате эквайера.
 *
 * Это провайдеро-независимая выжимка логики Platega-вебхука (platega.router.ts):
 * сверка авторитетной суммы (товары+модификаторы−скидки+аренда+база события),
 * учёт чаевых и эквайринговой надбавки 8%, идемпотентное закрытие, начисление
 * бонусов с лотом сгорания. Platega НАМЕРЕННО не трогаем (живой денежный путь);
 * новые эквайеры используют этот общий код, поэтому ошибка здесь не затрагивает
 * рабочий Platega.
 *
 * Вызывается ВНУТРИ db.transaction(...) вызывающего вебхука: бросает
 * AMOUNT_MISMATCH / CHECK_NOT_FOUND, которые роутер мапит в 400/404.
 */
import {
  checks, checkItems, checkItemModifiers, checkDiscounts, spaces,
  checkPayments, transactions, profiles, bonusHistory, appSettings,
  eq, and, inArray,
} from '@titan/database'
import type { Database } from '@titan/database'
import { accrueBonusLot, getBonusExpiryDays } from '../../lib/bonusLots.js'
import { round2, computeRental, computeTotals } from '../../lib/money.js'
import { notify } from '../notifications/push.js'
import { completeLinkedEvent, type CompletedEvent } from '../events/eventLifecycle.js'

/** Уведомление «Мероприятие завершено» после коммита закрытия чека (вебхуки СБП). */
export function notifyEventCompleted(
  db: Database,
  clubId: string | null | undefined,
  event: CompletedEvent,
  checkId: string,
): void {
  void notify({
    type: 'event_completed',
    title: 'Мероприятие завершено',
    body: event.title ?? 'Мероприятие завершено',
    meta: { eventId: event.id, checkId },
  }, db, clubId ?? null).catch(() => {})
}

// 'second_payment' — чек уже не открыт, а пришла ДРУГАЯ транзакция: деньги получены
// сверх оплаты (гость оплатил старый QR после закрытия чека другим способом).
export type SettleResult = 'closed' | 'noop' | 'second_payment'

export interface SettleArgs {
  checkId: string
  /** Авторитетная сумма из API провайдера (рубли). undefined → доверяем чеку. */
  verifiedAmount?: number
  transactionId?: string
  /** Префикс описания транзакции, например 'Т-Банк СБП'. */
  descriptionPrefix: string
  /**
   * Закрытие чека завершило мероприятие (основной чек события или последний чек
   * участника миникапа). Вызывается внутри транзакции — уведомлять после коммита.
   */
  onEventCompleted?: (event: CompletedEvent) => void
}

// Минимальный тип транзакции drizzle, чтобы не тянуть весь Database generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any

/**
 * Оплата пришла по чеку, который уже не открыт: это повтор вебхука или ВТОРОЙ платёж?
 * Повтор — та же транзакция, что закрыла чек (platega_tx_id), либо транзакция
 * последнего QR, если чек закрыли из кассы тендером «перевод» (фолбэк, когда банк
 * подтвердил раньше вебхука). Всё остальное — деньги за закрытый/отменённый чек.
 */
export async function isSecondPayment(
  tx: Tx,
  check: { id: string; plategaTxId: string | null; sbpQrTxId: string | null; prepaidAmount?: string | null },
  transactionId: string | undefined,
): Promise<boolean> {
  if (!transactionId || transactionId === check.plategaTxId) return false
  if (!check.plategaTxId && transactionId === check.sbpQrTxId) {
    // Предоплата миникапа пишется в /pay платежом «перевод» — это не тендер кассы:
    // фолбэком считаем только переводы СВЕРХ неё.
    const prepaid = parseFloat(check.prepaidAmount ?? '0') || 0
    const transferRows: { amount: string }[] = await tx.select({ amount: checkPayments.amount }).from(checkPayments)
      .where(and(eq(checkPayments.checkId, check.id), eq(checkPayments.method, 'transfer')))
    const transferSum = transferRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
    if (transferSum > prepaid + 0.005) return false
  }
  return true
}

/** Сообщить персоналу о втором платеже по СБП: банку отвечаем 200, деньги вернуть вручную. */
export function notifySecondPayment(
  db: Database,
  clubId: string | null | undefined,
  args: { checkId: string; amount?: number; transactionId: string; provider: string },
): void {
  const sum = args.amount != null && !Number.isNaN(args.amount)
    ? `${args.amount.toLocaleString('ru')} ₽`
    : 'Сумма неизвестна'
  console.warn(`[${args.provider}] оплата по уже закрытому чеку ${args.checkId}: ${sum} (tx ${args.transactionId})`)
  void notify({
    type: 'sbp_second_payment',
    title: 'Оплата по закрытому чеку',
    body: `${sum} по СБП (${args.provider}) за чек ${args.checkId.slice(0, 8)}, который уже закрыт или отменён. Транзакция ${args.transactionId} — оформите возврат гостю.`,
    meta: { checkId: args.checkId, transactionId: args.transactionId, amount: args.amount ?? null },
  }, db, clubId).catch(() => {})
}

/**
 * Закрывает открытый чек как оплаченный СБП. Возвращает 'closed' при закрытии,
 * 'noop' если чек уже закрыт/отменён (идемпотентность повторного вебхука),
 * 'second_payment' — чек не открыт, а транзакция другая (см. isSecondPayment).
 */
export async function settleCheckPayment(tx: Tx, args: SettleArgs): Promise<SettleResult> {
  const { checkId, verifiedAmount, transactionId, descriptionPrefix } = args

  const [check] = await tx.select().from(checks).where(eq(checks.id, checkId)).for('update')
  if (!check) throw new Error('CHECK_NOT_FOUND')
  // Идемпотентность: чек уже не открыт — вебхук уже обработан (или чек отменён).
  // Другая транзакция по такому чеку — второй платёж (вызывающий уведомит персонал).
  if (check.status !== 'open') {
    return (await isSecondPayment(tx, check, transactionId)) ? 'second_payment' : 'noop'
  }

  // Авторитетная сумма — то же правило, что и pos.router.ts /pay:
  // позиции + модификаторы − скидки + аренда зоны + база события.
  const itemRows = await tx.select().from(checkItems).where(eq(checkItems.checkId, checkId))
  const ciIds = itemRows.map((i: { id: string }) => i.id)
  const modRows = ciIds.length
    ? await tx.select().from(checkItemModifiers).where(inArray(checkItemModifiers.checkItemId, ciIds))
    : []
  const discRows = await tx.select().from(checkDiscounts).where(eq(checkDiscounts.checkId, checkId))
  const { total: itemsTotal } = computeTotals(itemRows, modRows, discRows)

  let rental = 0
  if (check.spaceId && check.spaceStartAt) {
    const [space] = await tx.select({ hourlyRate: spaces.hourlyRate }).from(spaces).where(eq(spaces.id, check.spaceId))
    rental = computeRental(check.spaceStartAt, check.spaceEndAt, space?.hourlyRate, Date.now())
  }
  const eventBase = parseFloat(check.eventBaseAmount ?? '0') || 0
  // Оплата по последнему QR: его сумма зафиксирована при выставлении (sbp_qr_*).
  // Живая аренда к вебхуку могла «тикнуть» на новый час → пересчёт дал бы ложный
  // AMOUNT_MISMATCH. Для ЭТОЙ транзакции итог = сумма QR, аренда — до момента QR.
  const qrBase = transactionId && check.sbpQrTxId === transactionId && check.sbpQrAmount != null
    ? parseFloat(check.sbpQrAmount)
    : NaN
  const fromQr = Number.isFinite(qrBase)
  const total = fromQr ? round2(qrBase) : round2(itemsTotal + rental + eventBase)

  // Чаевые, запрошенные при генерации QR. Гость платит total + tip (опц. ×1.08).
  const requestedTip = parseFloat(check.tipAmount ?? '0') || 0
  const expectedWithTip = round2(total + requestedTip)

  // Сверка суммы: допускаем переплату до +8% (эквайринговая надбавка клиента),
  // недоплату (< товары) отклоняем.
  if (verifiedAmount != null && !Number.isNaN(verifiedAmount)) {
    const tooLow = verifiedAmount < total - 0.01
    const tooHigh = verifiedAmount > round2(expectedWithTip * 1.08) + 1
    if (tooLow || tooHigh) throw new Error('AMOUNT_MISMATCH')
  }

  // Фактически уплаченные чаевые (если сумма неизвестна — доверяем запрошенным).
  const tipPaid = requestedTip > 0 && (verifiedAmount == null || Number.isNaN(verifiedAmount) || verifiedAmount >= expectedWithTip - 1)
    ? requestedTip
    : 0

  // Надбавку 8% доплачивает клиент сверх товаров+чаевых.
  const surchargePaid = verifiedAmount != null && !Number.isNaN(verifiedAmount)
    ? verifiedAmount >= round2(expectedWithTip * 1.08) - 1
    : parseFloat(check.acquiringSurcharge ?? '0') > 0
  const acquiringSurcharge = surchargePaid ? round2(expectedWithTip * 0.08) : 0

  await tx.insert(checkPayments).values({
    checkId,
    method: 'transfer',
    amount: String(total),
  })
  await tx.insert(transactions).values({
    type: 'payment',
    amount: String(total),
    checkId,
    playerId: check.playerId ?? null,
    description: `${descriptionPrefix} ${transactionId ?? ''}`.trim(),
  })
  await tx.update(checks).set({
    status: 'closed',
    paymentMethod: 'transfer',
    totalAmount: String(total),
    tipAmount: String(tipPaid),
    acquiringSurcharge: String(acquiringSurcharge),
    // id закрывшей транзакции — по нему повтор вебхука отличаем от второго платежа.
    plategaTxId: transactionId ?? null,
    // Чек закрыт на сумму QR → аренда заканчивается в момент выставления QR.
    spaceEndAt: check.spaceEndAt ?? (check.spaceId ? ((fromQr ? check.sbpQrAt : null) ?? new Date()) : undefined),
    closedAt: new Date(),
  }).where(eq(checks.id, checkId))

  // Как pos.router.ts /pay: оплаченный чек мероприятия завершает событие (миникап —
  // последний открытый чек участника). Без этого оплаченное по QR «Идёт» навсегда.
  const completedEvent = await completeLinkedEvent(tx, { id: checkId, linkedEventId: check.linkedEventId })
  if (completedEvent) args.onEventCompleted?.(completedEvent)

  // Начисление бонусов (зеркало pos.router.ts /pay и Platega-вебхука).
  let bonusAwarded = 0
  if (check.playerId) {
    const settingsRows = await tx.select().from(appSettings)
      .where(inArray(appSettings.key, ['bonus_enabled', 'bonus_accrual_rate', 'bonus_min_purchase']))
    const settings = Object.fromEntries(settingsRows.map((r: { key: string; value: string }) => [r.key, r.value]))
    const bonusEnabled = settings['bonus_enabled'] !== 'false'
    const accrualRate = parseFloat(settings['bonus_accrual_rate'] ?? '5') / 100
    const minPurchase = parseFloat(settings['bonus_min_purchase'] ?? '0')
    if (bonusEnabled && total >= minPurchase) {
      const earned = Math.floor(total * accrualRate)
      if (earned > 0) {
        const [p] = await tx.select().from(profiles).where(eq(profiles.id, check.playerId)).for('update')
        if (p) {
          const newBonus = round2(parseFloat(p.bonusPoints) + earned)
          await tx.update(profiles).set({ bonusPoints: String(newBonus) }).where(eq(profiles.id, check.playerId))
          await tx.insert(bonusHistory).values({
            profileId: check.playerId,
            amount: String(earned),
            balanceAfter: String(newBonus),
            reason: `${Math.round(accrualRate * 100)}% начисление за чек (СБП)`,
          })
          const expiryDays = await getBonusExpiryDays(tx)
          await accrueBonusLot(tx, check.playerId, earned, expiryDays)
          bonusAwarded = earned
        }
      }
    }
  }
  // Фактически начисленное (0 — не начисляли) — база отката бонусов при возврате.
  await tx.update(checks).set({ bonusAwarded: String(bonusAwarded) }).where(eq(checks.id, checkId))

  return 'closed'
}
