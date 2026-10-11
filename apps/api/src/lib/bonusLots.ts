/**
 * Лоты начислений бонусов — параллельный учёт для сгорания бонусов по сроку.
 *
 * Принцип:
 * - profiles.bonusPoints остаётся ЕДИНСТВЕННЫМ источником истины для баланса.
 *   Логика /pay (начисление/списание bonusPoints) НЕ меняется.
 * - Лоты (bonus_lots) — параллельный реестр: какое начисление когда сгорает.
 *   accrueBonusLot/spendBonusLots поддерживают ТОЛЬКО лоты, не трогая bonusPoints.
 * - Единственное место, где сгорание влияет на bonusPoints — expireBonuses (крон).
 *
 * Grandfathering: балансы, существовавшие до внедрения лотов, лотов не имеют,
 * поэтому никогда не сгорают. Сгорают только бонусы, начисленные через лоты.
 *
 * Все функции принимают исполнитель (db или tx) первым аргументом, чтобы их
 * можно было вызывать внутри существующей транзакции /pay.
 */
import {
  bonusLots,
  bonusHistory,
  profiles,
  appSettings,
  eq,
  and,
  lt,
  gt,
  sql,
  type Database,
} from '@titan/database'

// Исполнитель: либо корневой db, либо транзакция (tx) из db.transaction(...).
// Тип tx выводим из самого Database — общая поверхность query-builder совпадает.
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbExecutor = Database | Tx

const MS_PER_DAY = 86_400_000

/**
 * Прочитать срок сгорания бонусов (`bonus_expiry_days`) из app_settings.
 * @returns положительное целое число дней, либо null если не задано / 0 /
 *          некорректно (null = сгорание выключено).
 */
export async function getBonusExpiryDays(exec: DbExecutor): Promise<number | null> {
  const [row] = await exec
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, 'bonus_expiry_days'))
    .limit(1)
  if (!row) return null
  const days = Math.floor(Number(row.value))
  return Number.isFinite(days) && days > 0 ? days : null
}

/**
 * Создать лот на начисленные бонусы. remaining = amount.
 * expiresAt = expiryDays>0 ? now + expiryDays дней : null (бессрочно).
 * Срок считаем в JS, чтобы не зависеть от таймзоны БД.
 *
 * Вызывать там же, где /pay прибавляет начисленные бонусы к bonusPoints
 * (в той же транзакции). amount <= 0 — no-op.
 */
export async function accrueBonusLot(
  exec: DbExecutor,
  profileId: string,
  amount: number,
  expiryDays: number | null,
): Promise<void> {
  if (!(amount > 0)) return
  const expiresAt =
    expiryDays && expiryDays > 0 ? new Date(Date.now() + expiryDays * MS_PER_DAY) : null
  await exec.insert(bonusLots).values({
    profileId,
    amount: String(amount),
    remaining: String(amount),
    expiresAt,
  })
}

/**
 * Списать бонусы из лотов, сначала те, что сгорают раньше (expiresAt ASC,
 * NULLS LAST — бессрочные тратим в последнюю очередь), затем по дате создания.
 * Уменьшает remaining по лотам, пока не покроет amount. Если лотов меньше, чем
 * нужно — тратим сколько есть (НЕ ошибка; bonusPoints может опережать лоты для
 * grandfathered-балансов).
 *
 * Вызывать там же, где /pay вычитает потраченные бонусы из bonusPoints
 * (в той же транзакции). amount <= 0 — no-op.
 */
export async function spendBonusLots(
  exec: DbExecutor,
  profileId: string,
  amount: number,
): Promise<void> {
  if (!(amount > 0)) return
  let toSpend = amount

  const lots = await exec
    .select({ id: bonusLots.id, remaining: bonusLots.remaining })
    .from(bonusLots)
    .where(and(eq(bonusLots.profileId, profileId), gt(bonusLots.remaining, '0')))
    // Сначала ближайшие к сгоранию; бессрочные (NULL) — в конце; затем старые.
    .orderBy(sql`${bonusLots.expiresAt} ASC NULLS LAST`, bonusLots.createdAt)

  for (const lot of lots) {
    if (toSpend <= 0) break
    const rem = Number(lot.remaining) || 0
    if (rem <= 0) continue
    const take = Math.min(rem, toSpend)
    const newRem = rem - take
    await exec
      .update(bonusLots)
      .set({ remaining: String(newRem) })
      .where(eq(bonusLots.id, lot.id))
    toSpend -= take
  }
}

/**
 * Сгорание: найти все лоты с expiresAt < now и remaining > 0, сгруппировать по
 * клиенту и для каждого:
 *  - уменьшить profiles.bonusPoints на min(сумма remaining, текущий bonusPoints)
 *    (никогда ниже 0 — clamp защищает от рассинхрона при ручных правках баланса),
 *  - обнулить remaining у этих лотов,
 *  - записать строку bonusHistory { amount: -сгорело, balanceAfter, reason:'expired' }.
 * Каждый клиент обрабатывается в отдельной транзакции (сбой по одному не валит остальных).
 * Транзакция — в БД клуба (database), а не в основной: иначе у клубов со своей
 * базой профили не находились и бонусы не сгорали никогда.
 *
 * @returns число клиентов, у которых что-то сгорело.
 */
export async function expireBonuses(database: Database): Promise<number> {
  const now = new Date()

  // Сгруппировать просроченные лоты по клиенту одним запросом.
  const groups = await database
    .select({
      profileId: bonusLots.profileId,
      sumRemaining: sql<string>`sum(${bonusLots.remaining})`,
    })
    .from(bonusLots)
    .where(and(lt(bonusLots.expiresAt, now), gt(bonusLots.remaining, '0')))
    .groupBy(bonusLots.profileId)

  let affected = 0

  for (const g of groups) {
    const sumRemaining = Number(g.sumRemaining) || 0
    if (sumRemaining <= 0) continue
    try {
      const changed = await database.transaction(async (tx) => {
        // Лочим профиль и пере-считываем просроченные лоты ВНУТРИ транзакции,
        // чтобы не сгореть с устаревшими данными (на случай гонки с /pay).
        const [p] = await tx
          .select({ bonusPoints: profiles.bonusPoints })
          .from(profiles)
          .where(eq(profiles.id, g.profileId))
          .for('update')
        if (!p) return false

        const expiredLots = await tx
          .select({ id: bonusLots.id, remaining: bonusLots.remaining })
          .from(bonusLots)
          .where(
            and(
              eq(bonusLots.profileId, g.profileId),
              lt(bonusLots.expiresAt, now),
              gt(bonusLots.remaining, '0'),
            ),
          )
        if (expiredLots.length === 0) return false

        const sumExpired = expiredLots.reduce((s, l) => s + (Number(l.remaining) || 0), 0)
        if (sumExpired <= 0) return false

        const current = Number(p.bonusPoints) || 0
        // Clamp: списываем не больше текущего баланса (защита от рассинхрона).
        const burn = Math.min(sumExpired, current)
        const newBalance = current - burn

        // Обнуляем просроченные лоты.
        for (const lot of expiredLots) {
          await tx.update(bonusLots).set({ remaining: '0' }).where(eq(bonusLots.id, lot.id))
        }

        // Корректируем баланс и пишем в историю (даже если burn==0 — фиксируем факт).
        if (burn > 0) {
          await tx
            .update(profiles)
            .set({ bonusPoints: String(newBalance) })
            .where(eq(profiles.id, g.profileId))
        }
        await tx.insert(bonusHistory).values({
          profileId: g.profileId,
          amount: String(-burn),
          balanceAfter: String(newBalance),
          reason: 'expired',
        })
        return true
      })
      if (changed) affected++
    } catch (e) {
      console.error('[bonusLots] expire failed for', g.profileId, e)
    }
  }

  return affected
}
