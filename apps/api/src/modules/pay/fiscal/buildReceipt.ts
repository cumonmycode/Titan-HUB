/**
 * Построение фискального чека 54-ФЗ из закрытого чека — общее для самостоятельных
 * касс (АТОЛ/Ferma) и встроенной ЮKassa.
 *
 * Гибкие настройки (app_settings):
 *  - fiscal_itemized: 'true' → позиции (товары+модификаторы, аренда/услуги отдельной
 *    строкой; при скидке цены масштабируются, чтобы сумма строк = итог чека), иначе
 *    единая строка «Оплата по чеку».
 *  - fiscal_methods: JSON-массив способов оплаты, которые фискализируем (остальные
 *    скрываем от налоговой). По умолчанию — реальные деньги: cash/card/transfer/split.
 *  - receipt_footer: подпись/доп.реквизит чека (tag 1192/1085).
 *  - fiscal_vat_code, fiscal_default_phone — как раньше.
 *
 * Контакт покупателя обязателен (касса шлёт электронный чек): телефон гостя из
 * карточки, иначе fiscal_default_phone; без контакта чек пробить нельзя → null.
 */
import { appSettings, profiles, checkItems, checkItemModifiers, inventory, modifiers, eq, inArray, sql } from '@titan/database'
import type { Database } from '@titan/database'
import { round2 } from '../../../lib/money.js'
import type { FiscalReceiptInput, FiscalPaymentKind, FiscalLineItem } from './types.js'

const DEFAULT_FISCAL_METHODS = ['cash', 'card', 'transfer', 'split']

async function getSetting(db: Database, key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1)
  return row?.value ?? null
}

/** Какие способы оплаты фискализировать (множество ключей payment_method). */
export async function getFiscalMethods(db: Database): Promise<Set<string>> {
  const raw = await getSetting(db, 'fiscal_methods')
  if (!raw) return new Set(DEFAULT_FISCAL_METHODS)
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return new Set(arr.map(String))
  } catch { /* ignore */ }
  return new Set(DEFAULT_FISCAL_METHODS)
}

/**
 * Строки чека: либо детально (позиции), либо одна строка на итог. Сумма строк
 * всегда сходится с total (требование АТОЛ/Ferma/ЮKassa). qty свёрнут в название
 * (×N), цена строки = её сумма — чтобы избежать ошибок округления цены за единицу.
 */
export async function buildReceiptLines(db: Database, checkId: string, total: number, vatCode: number): Promise<FiscalLineItem[]> {
  const single: FiscalLineItem[] = [{ name: `Оплата по чеку №${checkId.slice(0, 8)}`, price: round2(total), quantity: 1, vatCode }]
  if ((await getSetting(db, 'fiscal_itemized')) !== 'true') return single

  const itemRows = await db
    .select({ id: checkItems.id, name: sql<string | null>`COALESCE(${checkItems.customName}, ${inventory.name})`, qty: checkItems.quantity, price: checkItems.priceAtTime })
    .from(checkItems)
    .leftJoin(inventory, eq(checkItems.itemId, inventory.id))
    .where(eq(checkItems.checkId, checkId))
  if (!itemRows.length) return single

  const ids = itemRows.map((r) => r.id)
  const modRows = ids.length
    ? await db
        .select({ checkItemId: checkItemModifiers.checkItemId, name: modifiers.name, price: checkItemModifiers.priceAtTime })
        .from(checkItemModifiers)
        .leftJoin(modifiers, eq(checkItemModifiers.modifierId, modifiers.id))
        .where(inArray(checkItemModifiers.checkItemId, ids))
    : []
  const modsByItem = new Map<string, { name: string | null; price: string }[]>()
  for (const m of modRows) {
    const arr = modsByItem.get(m.checkItemId) ?? []
    arr.push({ name: m.name, price: m.price })
    modsByItem.set(m.checkItemId, arr)
  }

  const lines: FiscalLineItem[] = []
  for (const it of itemRows) {
    const mods = modsByItem.get(it.id) ?? []
    const unit = parseFloat(it.price) + mods.reduce((s, m) => s + (parseFloat(m.price) || 0), 0)
    const qty = it.qty || 1
    const amount = round2(unit * qty)
    if (amount <= 0) continue
    const modSuffix = mods.length ? ` (${mods.map((m) => m.name).filter(Boolean).join(', ')})` : ''
    const qtySuffix = qty > 1 ? ` ×${qty}` : ''
    lines.push({ name: `${it.name ?? 'Позиция'}${modSuffix}${qtySuffix}`.slice(0, 128), price: amount, quantity: 1, vatCode })
  }
  if (!lines.length) return single

  const goodsSum = round2(lines.reduce((s, l) => s + l.price, 0))
  const remainder = round2(total - goodsSum)
  if (remainder > 0.01) {
    // Аренда зоны / база события / прочие услуги, не попавшие в позиции.
    lines.push({ name: 'Услуги (аренда/мероприятие)', price: remainder, quantity: 1, vatCode })
  } else if (remainder < -0.01 && goodsSum > 0) {
    // Скидка по чеку: масштабируем цены позиций так, чтобы сумма сошлась с итогом.
    const factor = total / goodsSum
    let acc = 0
    lines.forEach((l, i) => {
      if (i === lines.length - 1) l.price = round2(total - acc)
      else { l.price = round2(l.price * factor); acc = round2(acc + l.price) }
    })
  }
  // Гарантия точности: сумма строк ОБЯЗАНА равняться итогу (АТОЛ/Ferma/ЮKassa
  // отклоняют расхождение). Остаток копеек добавляем к последней строке.
  const drift = round2(total - lines.reduce((s, l) => s + l.price, 0))
  if (drift !== 0 && lines.length) {
    const last = lines[lines.length - 1]!
    last.price = round2(last.price + drift)
  }
  return lines
}

export interface FiscalCheckRow {
  id: string
  totalAmount: string
  paymentMethod: string | null
  playerId: string | null
}

export async function buildFiscalReceipt(db: Database, check: FiscalCheckRow): Promise<FiscalReceiptInput | null> {
  const total = parseFloat(check.totalAmount) || 0
  if (total <= 0) return null

  const vatCode = Number(await getSetting(db, 'fiscal_vat_code')) || 1
  const fallbackPhone = (await getSetting(db, 'fiscal_default_phone')) || undefined
  const footer = (await getSetting(db, 'receipt_footer')) || undefined

  let phone: string | undefined = fallbackPhone
  if (check.playerId) {
    const [p] = await db.select({ phone: profiles.phone }).from(profiles).where(eq(profiles.id, check.playerId)).limit(1)
    if (p?.phone) phone = p.phone
  }
  if (!phone) return null

  const payment: FiscalPaymentKind = check.paymentMethod === 'cash' ? 'cash' : 'electronic'
  return {
    checkId: check.id,
    items: await buildReceiptLines(db, check.id, total, vatCode),
    total,
    payment,
    customerPhone: phone,
    footer,
  }
}
