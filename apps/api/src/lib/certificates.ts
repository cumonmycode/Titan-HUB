/**
 * Сертификаты клуба: статус, срок и то, какую часть чека можно ими оплатить.
 *
 * scope = all        — весь чек;
 *         categories — позиции из категорий сертификата;
 *         items      — только позиции сертификата (например, тарифы игры);
 *         events     — мероприятие: база события и аренда зоны.
 * Доля позиций считается после скидок (пропорционально), чтобы сертификат не «оплатил»
 * больше, чем стоят эти позиции в чеке.
 */
import { checks, checkItems, checkItemModifiers, checkDiscounts, inventory, spaces, eq, inArray, type Certificate, type Database } from '@titan/database'
import { computeRental, computeTotals, round2 } from './money.js'

export type CertificateStatus = 'active' | 'used' | 'expired' | 'void'

const MSK_MS = 3 * 3600_000
export const mskToday = () => new Date(Date.now() + MSK_MS).toISOString().slice(0, 10)

export function certificateStatus(c: Pick<Certificate, 'balance' | 'isUsed' | 'voidedAt' | 'validUntil'>): CertificateStatus {
  if (c.voidedAt) return 'void'
  if (c.isUsed || Number(c.balance) <= 0.005) return 'used'
  if (c.validUntil && c.validUntil < mskToday()) return 'expired'
  return 'active'
}

export const STATUS_ERROR: Record<Exclude<CertificateStatus, 'active'>, string> = {
  used: 'Сертификат уже использован',
  expired: 'Срок действия сертификата истёк',
  void: 'Сертификат погашен',
}

/** Номер: латиница/кириллица/цифры и дефис, 3–40 знаков; храним в верхнем регистре. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/\s+/g, '')
  return /^[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]{2,39}$/.test(code) ? code : null
}

type Exec = Pick<Database, 'select'>

/** Сколько из чека можно оплатить этим сертификатом (без учёта остатка на нём). */
export async function eligibleAmount(exec: Exec, cert: Pick<Certificate, 'scope' | 'categoryIds' | 'itemIds'>, checkId: string): Promise<number> {
  const [check] = await exec.select().from(checks).where(eq(checks.id, checkId))
  if (!check || check.staffCompId) return 0
  const items = await exec.select({
    id: checkItems.id, itemId: checkItems.itemId, priceAtTime: checkItems.priceAtTime, quantity: checkItems.quantity, categoryId: inventory.category,
  }).from(checkItems).leftJoin(inventory, eq(inventory.id, checkItems.itemId)).where(eq(checkItems.checkId, checkId))
  const ids = items.map((i) => i.id)
  const mods = ids.length ? await exec.select().from(checkItemModifiers).where(inArray(checkItemModifiers.checkItemId, ids)) : []
  const discountRows = await exec.select().from(checkDiscounts).where(eq(checkDiscounts.checkId, checkId))
  const { gross, total: itemsTotal } = computeTotals(items, mods, discountRows)
  let rental = 0
  if (check.spaceId && check.spaceStartAt) {
    const [space] = await exec.select({ hourlyRate: spaces.hourlyRate }).from(spaces).where(eq(spaces.id, check.spaceId))
    rental = computeRental(check.spaceStartAt, check.spaceEndAt, space?.hourlyRate, Date.now())
  }
  const eventBase = parseFloat(check.eventBaseAmount ?? '0') || 0
  const prepaid = parseFloat(check.prepaidAmount ?? '0') || 0
  const due = Math.max(0, itemsTotal + rental + eventBase - prepaid)

  if (cert.scope === 'all') return round2(due)
  if (cert.scope === 'events') return round2(Math.min(due, eventBase + rental))
  const pick = cert.scope === 'categories'
    ? items.filter((i) => i.categoryId && cert.categoryIds.includes(i.categoryId))
    : items.filter((i) => i.itemId && cert.itemIds.includes(i.itemId))
  const lineGross = pick.reduce((s, i) => s + parseFloat(i.priceAtTime) * i.quantity, 0)
  const share = gross > 0 ? itemsTotal / gross : 0
  return round2(Math.min(due, lineGross * share))
}
