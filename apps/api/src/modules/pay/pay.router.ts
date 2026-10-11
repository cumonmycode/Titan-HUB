/**
 * Приёмник вебхуков эквайеров: POST /api/pay/:provider/webhook.
 *
 * Безопасность (зеркало platega.router): тело вебхука НЕ авторитетно. Сначала
 * verifyWebhook провайдера (подпись/аутентичность), затем серверная сверка статуса
 * через fetchStatus с повторами (устойчивость к eventual-consistency), и только при
 * подтверждённом статусе — общий settleCheckPayment (идемпотентное закрытие чека).
 *
 * Монтируется ДО requireActiveSubscription/requireModule (как /api/tg): это внешний
 * вебхук, защищён подписью провайдера, а не пользовательской авторизацией/подпиской.
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppEnv } from '../../types.js'
import { publishEvent } from '../../lib/realtime.js'
import { residentPayments, eq } from '@titan/database'
import { getProvider, resolveCreds } from './registry.js'
import { settleCheckPayment, notifySecondPayment, notifyEventCompleted } from './settle.js'
import type { CompletedEvent } from '../events/eventLifecycle.js'
import { settleResidentPayment, notifyResidentPaid } from './residentSettle.js'

export const payRouter = new Hono<AppEnv>()

// RBS-эквайеры (Сбер/Альфа) шлют callback GET-ом, Т-Банк/ЮKassa — POST-ом.
// Один обработчик на оба метода.
const handleWebhook = async (c: Context<AppEnv>) => {
  const providerId = c.req.param('provider')
  const provider = providerId ? getProvider(providerId) : null
  if (!provider) return c.json({ error: 'unknown provider' }, 404)

  const db = c.var.db
  const creds = await resolveCreds(db, provider)
  const rawBody = await c.req.text()

  // Заголовки + сырой query (RBS-колбэки кладут параметры в URL) для verifyWebhook.
  const headers: Record<string, string | undefined> = {
    'x-callback-query': new URL(c.req.url).searchParams.toString() || undefined,
  }

  const verified = await provider.verifyWebhook({ headers, rawBody, creds })
  if (!verified.ok) return c.json({ error: 'unauthorized' }, 401)

  const ack = () => (verified.ackBody ? c.text(verified.ackBody) : c.json({ ok: true }))

  // Не подтверждение или нет привязки к чеку — просто квитируем получение.
  if (verified.status !== 'confirmed' || !verified.transactionId || !verified.checkId) {
    return ack()
  }
  const { transactionId, checkId } = verified

  // Серверная сверка статуса у провайдера (с повторами): тело не авторитетно.
  let confirmed = false
  let definitelyFailed = false
  let verifiedAmount: number | undefined = verified.amount
  for (let i = 0; i < 3; i++) {
    const st = await provider.fetchStatus({ creds, transactionId }).catch(() => null)
    if (st) {
      if (st.amount != null && !Number.isNaN(st.amount)) verifiedAmount = st.amount
      if (st.status === 'confirmed') { confirmed = true; break }
      if (st.status === 'failed') { definitelyFailed = true; break }
    }
    if (i < 2) await new Promise((r) => setTimeout(r, 700))
  }
  if (definitelyFailed) {
    console.error(`[pay:${providerId}] webhook confirmed but API status=failed (tx ${transactionId})`)
    return c.json({ error: 'not confirmed' }, 400)
  }
  if (!confirmed) {
    // Подтверждения пока нет — чек НЕ закрываем; 503 → провайдер повторит вебхук.
    console.error(`[pay:${providerId}] verification pending for tx ${transactionId} (check ${checkId})`)
    return c.json({ error: 'verification pending' }, 503)
  }

  // orderRef (checkId) может ссылаться на ЧЕК или на онлайн-платёж клиента
  // (resident_payments). Различаем по наличию строки resident_payments — это
  // НЕ меняет путь чека (доп. индексный SELECT перед settle).
  const [residentRow] = await db.select({ id: residentPayments.id }).from(residentPayments).where(eq(residentPayments.id, checkId)).limit(1)

  let didClose = false
  let secondPayment = false
  let residentApplied = false
  let completedEvent: CompletedEvent | null = null
  try {
    await db.transaction(async (tx) => {
      if (residentRow) {
        const r = await settleResidentPayment(tx, { paymentId: checkId, verifiedAmount, transactionId, descriptionPrefix: provider.label })
        if (r === 'applied') residentApplied = true
      } else {
        const r = await settleCheckPayment(tx, {
          checkId,
          verifiedAmount,
          transactionId,
          descriptionPrefix: provider.label,
          onEventCompleted: (ev) => { completedEvent = ev },
        })
        if (r === 'closed') didClose = true
        if (r === 'second_payment') secondPayment = true
      }
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'AMOUNT_MISMATCH') {
      console.error(`[pay:${providerId}] amount mismatch for ${checkId} (tx ${transactionId})`)
      return c.json({ error: 'amount mismatch' }, 400)
    }
    if (msg === 'CHECK_NOT_FOUND') return c.json({ error: 'check not found' }, 404)
    console.error(`[pay:${providerId}] webhook error:`, err)
    return c.json({ error: 'internal error' }, 500)
  }

  if (didClose) {
    publishEvent(c.var.club?.id, 'check:paid', { checkId })
    publishEvent(c.var.club?.id, 'check:closed', { checkId })
    if (completedEvent) notifyEventCompleted(db, c.var.club?.id, completedEvent, checkId)
  }
  // Деньги пришли за уже закрытый чек — банку 200 (платёж принят), персоналу сигнал.
  if (secondPayment) {
    notifySecondPayment(db, c.var.club?.id, { checkId, amount: verifiedAmount, transactionId, provider: provider.label })
  }
  if (residentApplied) {
    publishEvent(c.var.club?.id, 'resident:paid', { paymentId: checkId })
    void notifyResidentPaid(db, checkId)
  }
  return ack()
}

payRouter.post('/:provider/webhook', handleWebhook)
payRouter.get('/:provider/webhook', handleWebhook)
