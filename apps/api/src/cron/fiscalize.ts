/**
 * Фоновая фискализация 54-ФЗ (тик раз в минуту по всем клубам).
 *
 * Сканирует НЕДАВНО закрытые чеки клуба и пробивает по ним фискальный чек активной
 * самостоятельной кассой (АТОЛ и т.п.). НЕ трогает денежные пути закрытия чека —
 * нулевой риск для продаж. Идемпотентно: один ряд fiscal_receipts на чек (sent —
 * не повторяем; failed с attempts<5 — ретраим). Клубы без фискального провайдера
 * (включая основной инстанс) полностью пропускаются.
 *
 * Окно 60 минут: при включении кассы фискализируются последние сделки, новые —
 * в течение ~минуты. failed ретраятся независимо от окна, пока attempts<5.
 */
import { sql } from '@titan/database'
import type { Database } from '@titan/database'
import { getActiveFiscalProvider, getFiscalProvider, resolveFiscalCreds } from '../modules/pay/fiscal/registry.js'
import { buildFiscalReceipt, getFiscalMethods, type FiscalCheckRow } from '../modules/pay/fiscal/buildReceipt.js'
import { getPaymentTestMode } from '../modules/pay/registry.js'
import { round2 } from '../lib/money.js'

const MAX_ATTEMPTS = 5
const BATCH = 30

// БД клубов, по которым проход ещё идёт: тик раз в минуту, а пробитие у кассы
// может быть дольше — без защиты следующий тик брал те же чеки и пробивал дважды.
const running = new WeakSet<Database>()

export async function fiscalizePendingForDb(db: Database): Promise<void> {
  if (running.has(db)) return
  running.add(db)
  try {
    await fiscalizePending(db)
  } finally {
    running.delete(db)
  }
}

async function fiscalizePending(db: Database): Promise<void> {
  const providerId = await getActiveFiscalProvider(db)
  const provider = getFiscalProvider(providerId) // null для '' и 'yookassa' (встроенная)
  if (!provider) return

  const creds = await resolveFiscalCreds(db, provider)
  if (provider.requiredKeys.some((k) => !creds[k])) return // ключи неполные
  const test = await getPaymentTestMode(db)
  const allowedMethods = await getFiscalMethods(db) // какие способы оплаты фискализируем

  // Закрытые чеки за последний час без фискального чека + ретраи failed(<5) — ретраи
  // НЕЗАВИСИМО от окна (иначе чек, упавший под конец часа, так и не пробивался).
  // Тянем чаевые и эквайринговую надбавку: фискальный чек обязан сойтись с
  // ФАКТИЧЕСКИ принятой по эквайрингу суммой (total + tip + surcharge), а не с
  // голой товарной суммой — иначе расхождение чека с поступлением (риск 54-ФЗ).
  const res: unknown = await db.execute(sql`
    SELECT c.id, c.total_amount, c.tip_amount, c.acquiring_surcharge, c.payment_method, c.player_id
    FROM checks c
    LEFT JOIN fiscal_receipts fr ON fr.check_id = c.id
    WHERE c.status = 'closed'
      AND c.total_amount::numeric > 0
      AND (
        (fr.id IS NULL AND c.closed_at > now() - interval '60 minutes')
        OR (fr.status = 'failed' AND fr.attempts < ${MAX_ATTEMPTS})
      )
    ORDER BY c.closed_at ASC
    LIMIT ${BATCH}
  `)
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as Array<Record<string, unknown>>

  for (const r of rows) {
    const checkId = String(r['id'])
    try {
      const method = (r['payment_method'] as string | null) ?? null
      // Способ оплаты исключён из фискализации (напр. наличные/депозит/долг скрыты).
      if (!method || !allowedMethods.has(method)) {
        await markStatus(db, checkId, providerId, 'skipped', null, `Способ оплаты «${method ?? '—'}» не фискализируется`)
        continue
      }
      const check: FiscalCheckRow = {
        id: checkId,
        totalAmount: String(r['total_amount'] ?? '0'),
        paymentMethod: method,
        playerId: (r['player_id'] as string | null) ?? null,
      }
      const receipt = await buildFiscalReceipt(db, check)
      if (!receipt) {
        await markStatus(db, checkId, providerId, 'failed', null, 'Нет контакта покупателя (телефон)')
        continue
      }
      // Чек строится на товарную базу (total_amount). Клиент по СБП фактически
      // заплатил больше: чаевые и эквайринговую надбавку 8% добавляем ОТДЕЛЬНЫМИ
      // позициями (а не размазываем по товарам) и поднимаем итог чека, чтобы
      // фискальная сумма = фактически принятой по эквайрингу. vatCode берём из
      // уже построенных товарных строк (настройка клуба), payment наследуется.
      const tip = round2(parseFloat(String(r['tip_amount'] ?? '0')) || 0)
      const surcharge = round2(parseFloat(String(r['acquiring_surcharge'] ?? '0')) || 0)
      const vatCode = receipt.items[0]?.vatCode ?? 1
      if (tip > 0) {
        receipt.items.push({ name: 'Чаевые', price: tip, quantity: 1, vatCode })
      }
      if (surcharge > 0) {
        receipt.items.push({ name: 'Комиссия за эквайринг (СБП)', price: surcharge, quantity: 1, vatCode })
      }
      receipt.total = round2(receipt.total + tip + surcharge)
      const { externalId } = await provider.registerReceipt({ creds, receipt, test })
      await markStatus(db, checkId, providerId, 'sent', externalId, null)
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300)
      await markStatus(db, checkId, providerId, 'failed', null, msg)
      console.error(`[cron:fiscalize] чек ${checkId.slice(0, 8)} → ${msg}`)
    }
  }
}

async function markStatus(
  db: Database, checkId: string, provider: string,
  status: 'sent' | 'failed' | 'skipped', externalId: string | null, error: string | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO fiscal_receipts (check_id, provider, status, external_id, attempts, last_error, updated_at)
    VALUES (${checkId}, ${provider}, ${status}, ${externalId}, 1, ${error}, now())
    ON CONFLICT (check_id) DO UPDATE SET
      status = ${status},
      external_id = COALESCE(${externalId}, fiscal_receipts.external_id),
      attempts = fiscal_receipts.attempts + 1,
      last_error = ${error},
      updated_at = now()
    -- Уже пробитый (sent) чек не перетираем ошибкой/повтором.
    WHERE fiscal_receipts.status <> 'sent'
  `)
}
