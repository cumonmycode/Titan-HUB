import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { refunds, checks, inventory, checkItems, checkPayments, transactions, profiles, bonusHistory, certificates, appSettings, eq, and, like, inArray, desc, sql } from '@titan/database'
import { returnCheckPortions } from '../inventory/ledger.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { accrueBonusLot, spendBonusLots, getBonusExpiryDays } from '../../lib/bonusLots.js'
import { round2 } from '../../lib/money.js'
import { notify } from '../notifications/push.js'
import { getNumericSetting, LARGE_REFUND_KEY, DEFAULT_LARGE_REFUND } from '../../lib/appSettings.js'

const TENDER_METHODS = ['cash', 'card', 'transfer', 'deposit', 'bonus', 'certificate', 'debt'] as const

const RefundSchema = z.object({
  checkId: z.string().uuid(),
  // Возврат по способам оплаты: суммы по тендерам.
  tenders: z.array(z.object({
    method: z.enum(TENDER_METHODS),
    amount: z.number().positive(),
  })).min(1),
  refundType: z.enum(['full', 'partial']).default('partial'),
  reason: z.enum(['return', 'exchange', 'discount', 'damage']).default('return'),
  note: z.string().optional(),
  itemsToRestore: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).default([]),
  // Ключ идемпотентности клиента: повтор того же возврата (после потерянного ответа)
  // возвращает уже записанный возврат, а не проводит второй.
  idempotencyKey: z.string().min(1).max(80).optional(),
})

function sumByMethod(rows: { method: string; amount: number | string }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const r of rows) m[r.method] = (m[r.method] ?? 0) + (parseFloat(String(r.amount)) || 0)
  return m
}

// Сколько уже возвращено по каждому методу: новые возвраты — по их tenders,
// старые (tenders=NULL) — пропорционально составу оплаты чека.
function refundedByMethod(
  prev: { totalAmount: string; tenders: { method: string; amount: number }[] | null }[],
  paidByMethod: Record<string, number>,
  paidTotal: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of prev) {
    if (r.tenders && Array.isArray(r.tenders)) {
      for (const t of r.tenders) out[t.method] = (out[t.method] ?? 0) + (Number(t.amount) || 0)
    } else {
      const rt = parseFloat(r.totalAmount) || 0
      for (const [method, paid] of Object.entries(paidByMethod)) {
        out[method] = (out[method] ?? 0) + (paidTotal > 0 ? rt * (paid / paidTotal) : 0)
      }
    }
  }
  return out
}

export const refundsRouter = new Hono<AppEnv>()
refundsRouter.use('*', requireAuth)

refundsRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const rows = await db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(50)
  return c.json({ refunds: rows })
})

refundsRouter.post('/', requireRole('owner', 'staff'), zValidator('json', RefundSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')

  try {
    const { refund, duplicate } = await db.transaction(async (tx) => {
      // СЕРИАЛИЗАЦИЯ ВОЗВРАТОВ ПО ЧЕКУ (P0). Возврат НЕ пишет в строку `checks`,
      // поэтому `checks ... FOR UPDATE` ниже сам по себе НЕ сериализует два
      // параллельных возврата по одному чеку: лимит «уже возвращено» (prevRefunds)
      // читается на READ COMMITTED, и оба запроса видят одинаковую сумму прошлых
      // возвратов → оба проходят проверку лимита и оба исполняются (двойной возврат
      // денег/склада/кассы). Берём advisory-lock по checkId ПЕРВЫМ в транзакции:
      // конкурентные возвраты по одному чеку выстраиваются в очередь и каждый видит
      // результат предыдущего. Лок снимается на коммите/откате (xact-scoped).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${body.checkId}, 0))`)

      // Идемпотентность: ПОД локом чека, поэтому повтор, пришедший пока первый запрос
      // ещё в работе, дождётся его коммита и увидит записанный возврат.
      if (body.idempotencyKey) {
        const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, body.idempotencyKey))
        if (existing) {
          if (existing.checkId !== body.checkId) throw new Error('IDEMPOTENCY_KEY_REUSED')
          return { refund: existing, duplicate: true }
        }
      }

      const [check] = await tx.select().from(checks).where(eq(checks.id, body.checkId)).for('update')
      if (!check) throw new Error('CHECK_NOT_FOUND')
      if (check.status !== 'closed') throw new Error('CHECK_NOT_CLOSED')

      // Что и чем оплачено
      const payments = await tx.select().from(checkPayments).where(eq(checkPayments.checkId, body.checkId))
      const paidByMethod = sumByMethod(payments)
      const paidTotal = Object.values(paidByMethod).reduce((s, v) => s + v, 0)
      if (paidTotal <= 0) throw new Error('NOTHING_TO_REFUND')

      // Уже возвращено по методам (с учётом старых возвратов)
      const prevRefunds = await tx.select().from(refunds).where(eq(refunds.checkId, body.checkId))
      const alreadyByMethod = refundedByMethod(prevRefunds as any, paidByMethod, paidTotal)

      // Запрошенный возврат по методам и проверка лимитов
      const reqByMethod = sumByMethod(body.tenders)
      for (const [method, amt] of Object.entries(reqByMethod)) {
        const available = (paidByMethod[method] ?? 0) - (alreadyByMethod[method] ?? 0)
        if (amt > available + 0.01) throw new Error('REFUND_EXCEEDS_PAID')
      }
      const refundTotal = round2(body.tenders.reduce((s, t) => s + t.amount, 0))
      if (refundTotal <= 0) throw new Error('NOTHING_TO_REFUND')

      const normTenders = body.tenders.map(t => ({ method: t.method, amount: round2(t.amount) }))
      const [r] = await tx.insert(refunds).values({
        checkId: body.checkId,
        totalAmount: String(refundTotal),
        refundType: body.refundType,
        reason: body.reason,
        note: body.note,
        tenders: normTenders,
        idempotencyKey: body.idempotencyKey ?? null,
        createdBy: user.sub,
      }).returning()

      // Финансовая проводка возврата (видна в аналитике/кассе).
      await tx.insert(transactions).values({
        type: 'refund',
        amount: String(refundTotal),
        checkId: body.checkId,
        playerId: check.playerId ?? null,
        createdBy: user.sub,
        description: `Возврат: ${body.reason}`,
      })

      // Возврат на баланс клиента (депозит + долг) и бонусов
      const balanceCredit = round2((reqByMethod['deposit'] ?? 0) + (reqByMethod['debt'] ?? 0))
      const bonusCredit = Math.round(reqByMethod['bonus'] ?? 0)
      if (balanceCredit > 0 || bonusCredit > 0) {
        if (!check.playerId) throw new Error('REFUND_NO_PLAYER')
        const [player] = await tx.select().from(profiles).where(eq(profiles.id, check.playerId)).for('update')
        if (player) {
          let bal = parseFloat(player.balance)
          let bonus = parseFloat(player.bonusPoints)
          if (balanceCredit > 0) {
            bal = round2(bal + balanceCredit)
            await tx.insert(transactions).values({
              type: 'deposit', amount: String(balanceCredit), checkId: body.checkId,
              playerId: check.playerId, createdBy: user.sub, description: 'Возврат на баланс',
            })
          }
          if (bonusCredit > 0) {
            bonus = round2(bonus + bonusCredit)
            await tx.insert(bonusHistory).values({
              profileId: check.playerId, amount: String(bonusCredit), balanceAfter: String(bonus),
              reason: 'Возврат бонусов',
            })
            // Лот для сгорания: re-credited бонусы должны сгорать как любые
            // начисленные (зеркало pos.router.ts /pay). Сумму возврата не трогаем.
            const expiryDays = await getBonusExpiryDays(tx)
            await accrueBonusLot(tx, check.playerId, bonusCredit, expiryDays)
          }
          await tx.update(profiles).set({ balance: String(bal), bonusPoints: String(bonus) }).where(eq(profiles.id, check.playerId))
        }
      }

      // Откат НАЧИСЛЕННЫХ бонусов (claw-back). При оплате чека клиенту начислили
      // floor(totalChecka * rate) бонусов (pos.router.ts /pay). При возврате эти
      // бонусы нужно списать пропорционально возвращённой сумме. Это ОТДЕЛЬНО от
      // возврата ПОТРАЧЕННЫХ бонусов (bonusCredit выше) — две независимые величины.
      const CLAWBACK_REASON = `Откат начисленных бонусов (возврат чека ${body.checkId})`
      if (check.playerId) {
        const checkTotal = parseFloat(check.totalAmount) || 0
        if (checkTotal > 0) {
          const settingsRows = await tx.select().from(appSettings)
            .where(inArray(appSettings.key, ['bonus_accrual_rate']))
          const settings = Object.fromEntries(settingsRows.map(r => [r.key, r.value]))
          const accrualRate = parseFloat(settings['bonus_accrual_rate'] ?? '5') / 100
          // Полная сумма начисления за чек: фактически начисленное при закрытии
          // (checks.bonus_awarded, 0 — не начисляли). Старые чеки (до 075, NULL) —
          // прежняя оценка по текущей ставке (зеркало pos.router.ts /pay).
          const accruedTotal = check.bonusAwarded != null
            ? Math.floor(Number(check.bonusAwarded))
            : Math.floor(checkTotal * accrualRate)
          if (accruedTotal > 0) {
            // Кумулятивно возвращено по чеку (включая текущий возврат).
            const refundedSoFar = prevRefunds.reduce((s, r) => s + (parseFloat(r.totalAmount) || 0), 0) + refundTotal
            const cappedRefunded = Math.min(refundedSoFar, checkTotal)
            // Целевой суммарный откат, пропорциональный возвращённой доле.
            const targetClawback = Math.floor(accruedTotal * (cappedRefunded / checkTotal))
            // Сколько уже откатили по этому чеку (защита от двойного отката
            // при повторном частичном возврате).
            const prevClawRows = await tx.select({ amount: bonusHistory.amount }).from(bonusHistory)
              .where(and(eq(bonusHistory.profileId, check.playerId), like(bonusHistory.reason, CLAWBACK_REASON)))
            const alreadyClawed = prevClawRows.reduce((s, r) => s + Math.abs(parseFloat(r.amount) || 0), 0)
            const clawNow = Math.max(0, targetClawback - alreadyClawed)
            if (clawNow > 0) {
              const [player] = await tx.select().from(profiles).where(eq(profiles.id, check.playerId)).for('update')
              if (player) {
                const cur = parseFloat(player.bonusPoints) || 0
                const burn = Math.min(clawNow, cur) // не уходим ниже 0
                const after = round2(cur - burn)
                await tx.update(profiles).set({ bonusPoints: String(after) }).where(eq(profiles.id, check.playerId))
                // Записываем фактически списанную величину (для корректного учёта
                // alreadyClawed при следующем частичном возврате используем clawNow,
                // но списать ниже 0 нельзя — историю пишем по burn).
                await tx.insert(bonusHistory).values({
                  profileId: check.playerId, amount: String(-burn), balanceAfter: String(after),
                  reason: CLAWBACK_REASON,
                })
                // Уменьшаем лоты сгорания на величину отката (зеркало списания).
                await spendBonusLots(tx, check.playerId, burn)
              }
            }
          }
        }
      }

      // Возврат на сертификат
      const certCredit = round2(reqByMethod['certificate'] ?? 0)
      if (certCredit > 0) {
        if (!check.certificateId) throw new Error('REFUND_NO_CERT')
        const [cert] = await tx.select().from(certificates).where(eq(certificates.id, check.certificateId)).for('update')
        if (cert) {
          const nb = round2(parseFloat(cert.balance) + certCredit)
          await tx.update(certificates).set({ balance: String(nb), isUsed: nb <= 0.005 }).where(eq(certificates.id, cert.id))
        }
      }

      // Restore stock — только по фактически проданным позициям и не больше,
      // чем (продано − уже восстановлено предыдущими возвратами). Иначе повторные
      // частичные возвраты восстановили бы сток сверх проданного.
      const soldRows = await tx.select().from(checkItems).where(eq(checkItems.checkId, body.checkId))
      const soldByItem = new Map<string, number>()
      for (const s of soldRows) soldByItem.set(s.itemId, (soldByItem.get(s.itemId) ?? 0) + s.quantity)
      // Уже восстановлено по каждому товару — сумма restoredItems всех прошлых
      // возвратов этого чека (старые возвраты до миграции 023 имеют пустой массив).
      const restoredByItem = new Map<string, number>()
      for (const pr of prevRefunds) {
        for (const ri of (pr.restoredItems ?? [])) {
          restoredByItem.set(ri.itemId, (restoredByItem.get(ri.itemId) ?? 0) + (ri.quantity || 0))
        }
      }
      const restoredNow: { itemId: string; quantity: number }[] = []
      for (const item of body.itemsToRestore) {
        const sold = soldByItem.get(item.itemId) ?? 0
        const alreadyRestored = restoredByItem.get(item.itemId) ?? 0
        const qty = Math.max(0, Math.min(item.quantity, sold - alreadyRestored))
        if (qty <= 0) continue
        // Возврат чека возвращает на склад то, что реально списано по чеку (журнал
        // исходного чека), а не по текущей техкарте/флагу учёта. Прошлые возвраты
        // в журнал чека не пишутся — их порции передаём как alreadyReturned.
        await returnCheckPortions(tx, {
          checkId: body.checkId, itemId: item.itemId, quantity: qty, alreadyReturned: alreadyRestored,
          sourceType: 'refund', sourceId: r!.id, reason: 'Возврат чека', userId: user.sub,
        })
        // Фиксируем фактически восстановленное количество (в т.ч. для не-учётных
        // товаров — чтобы лимит sold−alreadyRestored не сбрасывался повторными
        // возвратами по одной и той же позиции).
        restoredNow.push({ itemId: item.itemId, quantity: qty })
      }
      // Сохраняем восстановленное этим возвратом — для cap'а будущих возвратов.
      if (restoredNow.length) {
        await tx.update(refunds).set({ restoredItems: restoredNow }).where(eq(refunds.id, r!.id))
      }

      return { refund: r, duplicate: false }
    })

    // Повтор по ключу идемпотентности: возврат уже записан и уведомление ушло.
    if (duplicate) return c.json({ refund, duplicate: true }, 201)

    // Уведомление вне денежной транзакции (fire-and-forget, не блокирует ответ).
    const refundAmt = parseFloat(String(refund?.totalAmount ?? 0)) || 0
    const largeRefund = await getNumericSetting(LARGE_REFUND_KEY, DEFAULT_LARGE_REFUND, db)
    const isLargeRefund = refundAmt >= largeRefund
    const refundReason = ({ return: 'возврат', exchange: 'обмен', discount: 'скидка', damage: 'брак' } as Record<string, string>)[body.reason] ?? body.reason
    void notify({
      type: isLargeRefund ? 'large_refund' : 'refund',
      title: isLargeRefund ? 'Крупный возврат' : 'Возврат',
      body: `${refundAmt.toLocaleString('ru')} ₽ · причина: ${refundReason}`,
      meta: { checkId: body.checkId },
    }, db, c.var.club?.id).catch(() => {})

    return c.json({ refund }, 201)
  } catch (err: any) {
    const map: Record<string, [string, 400 | 404]> = {
      CHECK_NOT_FOUND: ['Check not found', 404],
      CHECK_NOT_CLOSED: ['Возврат возможен только по оплаченному чеку', 400],
      REFUND_EXCEEDS_PAID: ['Сумма возврата по способу оплаты превышает оплаченную', 400],
      NOTHING_TO_REFUND: ['По чеку нет оплат для возврата', 400],
      REFUND_NO_PLAYER: ['Для возврата на баланс/бонусы нужен клиент чека', 400],
      REFUND_NO_CERT: ['У чека нет сертификата для возврата', 400],
      IDEMPOTENCY_KEY_REUSED: ['Ключ повтора уже использован для другого чека', 400],
    }
    const mapped = err?.message ? map[err.message] : undefined
    if (mapped) return c.json({ error: mapped[0] }, mapped[1])
    console.error('POST /refunds error:', err)
    return c.json({ error: 'Internal error' }, 500)
  }
})

// Данные для формы возврата по чеку: позиции, оплата по методам, уже возвращено,
// доступно по каждому методу. Должен идти ДО /:id.
refundsRouter.get('/prepare/:checkId', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const checkId = c.req.param('checkId')
  const [check] = await db.select().from(checks).where(eq(checks.id, checkId))
  if (!check) return c.json({ error: 'Not found' }, 404)

  const items = await db
    .select({ checkItem: checkItems, item: inventory })
    .from(checkItems)
    .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
    .where(eq(checkItems.checkId, checkId))
  const payments = await db.select().from(checkPayments).where(eq(checkPayments.checkId, checkId))
  const paidByMethod = sumByMethod(payments)
  const paidTotal = Object.values(paidByMethod).reduce((s, v) => s + v, 0)
  const prev = await db.select().from(refunds).where(eq(refunds.checkId, checkId))
  const refundedTotal = prev.reduce((s, r) => s + (parseFloat(r.totalAmount) || 0), 0)
  const alreadyByMethod = refundedByMethod(prev as any, paidByMethod, paidTotal)

  const availableByMethod: Record<string, number> = {}
  for (const [method, paid] of Object.entries(paidByMethod)) {
    availableByMethod[method] = round2(Math.max(0, paid - (alreadyByMethod[method] ?? 0)))
  }

  return c.json({
    check: { id: check.id, status: check.status, totalAmount: check.totalAmount, closedAt: check.closedAt, playerId: check.playerId, certificateId: check.certificateId },
    items: items.map(i => ({
      itemId: i.checkItem.itemId,
      name: i.item?.name ?? '—',
      quantity: i.checkItem.quantity,
      priceAtTime: Number(i.checkItem.priceAtTime),
      trackStock: i.item?.trackStock ?? false,
    })),
    paidTotal: round2(paidTotal),
    refundedTotal: round2(refundedTotal),
    maxRefund: round2(Math.max(0, paidTotal - refundedTotal)),
    paidByMethod: Object.fromEntries(Object.entries(paidByMethod).map(([m, v]) => [m, round2(v)])),
    availableByMethod,
  })
})

refundsRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [refund] = await db.select().from(refunds).where(eq(refunds.id, c.req.param('id')))
  if (!refund) return c.json({ error: 'Not found' }, 404)
  return c.json({ refund })
})
