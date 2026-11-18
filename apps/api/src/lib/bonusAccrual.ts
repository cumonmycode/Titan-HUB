/**
 * Начисление бонусов за оплаченный чек — одно место для кассы (/pay), оплаты по QR
 * (pay/settle.ts) и вебхука Platega. Раньше это были три копии, и две из них не знали
 * про процент по статусу, категории без бонусов и правила.
 *
 * Как считается:
 *  1. Базовый процент — свой у статуса клиента (bonus_tier_rates) или общий (bonus_accrual_rate).
 *  2. Оплаченная сумма раскладывается по позициям пропорционально их стоимости
 *     (так скидки и аренда честно делятся между позициями).
 *  3. Категории без бонусов (bonus_excluded_categories) дают 0 — если правило явно
 *     не назвало их в «на что».
 *  4. Правила (bonus_rules), подошедшие по «кому/когда/от какой суммы»:
 *       percent    — на позиции «на что» действует свой процент (берётся наибольший);
 *       multiplier — процент позиций «на что» умножается (берётся наибольший множитель);
 *       fixed      — +N бонусов за чек (складываются).
 *  5. Итог округляется вниз до целого.
 *
 * Подарки первого чека: приветственный бонус и награда за приглашение (обоим).
 */
import { appSettings, bonusHistory, bonusRules, checkItems, checks, inventory, profiles, and, eq, inArray, isNull, ne, sql } from '@titan/database'
import { accrueBonusLot, getBonusExpiryDays, type DbExecutor } from './bonusLots.js'
import { BONUS_SETTING_KEYS, computeAccrual, parseBonusSettings, type AccrualLine, type BonusSettings } from './bonusRules.js'
import { isRegistrationPending } from './registration.js'
import { round2 } from './money.js'

export { computeAccrual, parseBonusSettings, type BonusSettings } from './bonusRules.js'

export async function loadBonusSettings(exec: DbExecutor): Promise<BonusSettings> {
  const rows = await exec.select().from(appSettings).where(inArray(appSettings.key, [...BONUS_SETTING_KEYS]))
  return parseBonusSettings(Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value])))
}

/** Начислить бонусы клиенту: баланс, история, лот для сгорания. Возвращает новый баланс. */
export async function creditBonus(exec: DbExecutor, profileId: string, amount: number, reason: string): Promise<number | null> {
  if (!(amount > 0)) return null
  const [p] = await exec.select({ bonusPoints: profiles.bonusPoints }).from(profiles).where(eq(profiles.id, profileId)).for('update')
  if (!p) return null
  const balance = round2((parseFloat(p.bonusPoints) || 0) + amount)
  await exec.update(profiles).set({ bonusPoints: String(balance) }).where(eq(profiles.id, profileId))
  await exec.insert(bonusHistory).values({ profileId, amount: String(amount), balanceAfter: String(balance), reason })
  await accrueBonusLot(exec, profileId, amount, await getBonusExpiryDays(exec))
  return balance
}

export interface LoyaltyGift {
  profileId: string
  amount: number
  kind: 'welcome' | 'referral_inviter' | 'referral_invitee'
  title: string
  body: string
}

/** Состав чека для начисления: позиции с категориями. */
async function accrualLines(exec: DbExecutor, checkId: string): Promise<AccrualLine[]> {
  const rows = await exec.select({ itemId: checkItems.itemId, price: checkItems.priceAtTime, qty: checkItems.quantity, categoryId: inventory.category })
    .from(checkItems).leftJoin(inventory, eq(inventory.id, checkItems.itemId)).where(eq(checkItems.checkId, checkId))
  return rows.map((r) => ({ itemId: r.itemId ?? '', categoryId: r.categoryId ?? null, amount: parseFloat(r.price) * r.qty }))
}

/**
 * Всё, что клиент получает за оплаченный чек: бонусы по правилам и подарки первого чека.
 * Вызывать в транзакции оплаты, когда чек уже помечен закрытым. Пишет checks.bonus_awarded.
 */
export async function accrueForCheck(
  exec: DbExecutor,
  args: { checkId: string; playerId: string | null; paid: number; debt?: number },
): Promise<{ bonusAwarded: number; reason: string; gifts: LoyaltyGift[] }> {
  const result = { bonusAwarded: 0, reason: '', gifts: [] as LoyaltyGift[] }
  const [player] = args.playerId ? await exec.select().from(profiles).where(eq(profiles.id, args.playerId)) : []
  const [check] = await exec.select({ createdAt: checks.createdAt }).from(checks).where(eq(checks.id, args.checkId))
  // Регистрация из приложения, ещё не подтверждённая персоналом, — без бонусов и подарков.
  if (!player || !check || isRegistrationPending(player)) {
    await exec.update(checks).set({ bonusAwarded: '0' }).where(eq(checks.id, args.checkId))
    return result
  }
  const settings = await loadBonusSettings(exec)
  const rules = await exec.select().from(bonusRules).where(eq(bonusRules.isActive, true))
  const [prev] = await exec.select({ n: sql<number>`count(*)::int` }).from(checks)
    .where(and(eq(checks.playerId, player.id), eq(checks.status, 'closed'), ne(checks.id, args.checkId)))
  const closedChecks = prev?.n ?? 0

  const accrual = computeAccrual(settings, rules, {
    playerId: player.id,
    player: { role: player.role, clientTier: player.clientTier, birthday: player.birthday, closedChecks },
    openedAt: check.createdAt,
    lines: await accrualLines(exec, args.checkId),
    paid: args.paid,
    debt: args.debt ?? 0,
  })
  if (accrual.amount > 0) {
    await creditBonus(exec, player.id, accrual.amount, accrual.reason)
    result.bonusAwarded = accrual.amount
    result.reason = accrual.reason
  }
  // Фактически начисленное — база отката бонусов при возврате (refunds.router.ts).
  await exec.update(checks).set({ bonusAwarded: String(result.bonusAwarded) }).where(eq(checks.id, args.checkId))

  if (settings.enabled && closedChecks === 0) {
    result.gifts = await firstCheckGifts(exec, player, settings, args.paid)
  }
  return result
}

/** Подарки за первый оплаченный чек: приветственный бонус и награда за приглашение. */
async function firstCheckGifts(
  exec: DbExecutor,
  player: typeof profiles.$inferSelect,
  settings: BonusSettings,
  paid: number,
): Promise<LoyaltyGift[]> {
  const gifts: LoyaltyGift[] = []
  if (settings.welcome.enabled && settings.welcome.amount > 0 && !player.welcomeBonusAt) {
    // Условие welcome_bonus_at IS NULL в WHERE — защита от двойной выдачи.
    const marked = await exec.update(profiles).set({ welcomeBonusAt: new Date() })
      .where(and(eq(profiles.id, player.id), isNull(profiles.welcomeBonusAt))).returning({ id: profiles.id })
    if (marked.length) {
      await creditBonus(exec, player.id, settings.welcome.amount, 'Приветственный бонус')
      gifts.push({ profileId: player.id, amount: settings.welcome.amount, kind: 'welcome', title: `+${settings.welcome.amount} бонусов`, body: 'Приветственный подарок за первый визит' })
    }
  }

  const r = settings.referral
  if (!r.enabled || !player.referredBy || player.referredBy === player.id || player.referralRewardedAt || paid < r.minCheck) return gifts
  const [inviter] = await exec.select({ id: profiles.id, nickname: profiles.nickname, deletedAt: profiles.deletedAt })
    .from(profiles).where(eq(profiles.id, player.referredBy))
  if (!inviter || inviter.deletedAt) return gifts
  const marked = await exec.update(profiles).set({ referralRewardedAt: new Date() })
    .where(and(eq(profiles.id, player.id), isNull(profiles.referralRewardedAt))).returning({ id: profiles.id })
  if (!marked.length) return gifts
  if (r.inviter > 0) {
    await creditBonus(exec, inviter.id, r.inviter, `За приглашение: ${player.nickname}`)
    gifts.push({ profileId: inviter.id, amount: r.inviter, kind: 'referral_inviter', title: `+${r.inviter} бонусов`, body: `${player.nickname} пришёл по вашему приглашению — спасибо!` })
  }
  if (r.invitee > 0) {
    await creditBonus(exec, player.id, r.invitee, `Подарок от ${inviter.nickname}`)
    gifts.push({ profileId: player.id, amount: r.invitee, kind: 'referral_invitee', title: `+${r.invitee} бонусов`, body: `Подарок за то, что пришли по приглашению ${inviter.nickname}` })
  }
  return gifts
}
