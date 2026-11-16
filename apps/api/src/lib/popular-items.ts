import { and, checkItems, checks, desc, eq, gte, inventory, menuCategories, sql, type Database } from '@titan/database'

/**
 * Популярные позиции для шторки «Добавить» в чеке — простая статистика продаж, без Tai
 * и без подписки:
 * - в чеке клиент → то, что он сам берёт чаще всего (за год); если истории мало —
 *   дополняем популярным по клубу;
 * - гость без клиента → что продаётся чаще всего в клубе за последние 30 дней.
 * Тарифы (категория со словом «тариф») и неактивные позиции не попадают.
 */

const LIMIT = 8
/** Своих позиций меньше — добавляем популярные по клубу, чтобы ряд не был пустым. */
const MIN_OWN = 3
const PLAYER_DAYS = 365
const GLOBAL_DAYS = 30
const DAY_MS = 86_400_000

export type PopularItems = { source: 'player' | 'global'; itemIds: string[] }

async function topItems(db: Database, playerId: string | null, days: number): Promise<string[]> {
  const since = new Date(Date.now() - days * DAY_MS)
  const rows = await db
    .select({ itemId: checkItems.itemId })
    .from(checkItems)
    .innerJoin(checks, eq(checks.id, checkItems.checkId))
    .innerJoin(inventory, eq(inventory.id, checkItems.itemId))
    .leftJoin(menuCategories, eq(menuCategories.id, inventory.category))
    .where(
      and(
        eq(checks.status, 'closed'),
        gte(checks.closedAt, since),
        playerId ? eq(checks.playerId, playerId) : undefined,
        eq(inventory.isActive, true),
        eq(inventory.kind, 'goods'),
        sql`coalesce(lower(${menuCategories.name}), '') not like '%тариф%'`,
      ),
    )
    .groupBy(checkItems.itemId)
    .orderBy(desc(sql`sum(${checkItems.quantity})`))
    .limit(LIMIT)
  return rows.map((r) => r.itemId)
}

export async function getPopularItems(db: Database, checkId: string): Promise<PopularItems> {
  const [check] = await db.select({ playerId: checks.playerId }).from(checks).where(eq(checks.id, checkId)).limit(1)
  if (!check?.playerId) return { source: 'global', itemIds: await topItems(db, null, GLOBAL_DAYS) }

  const own = await topItems(db, check.playerId, PLAYER_DAYS)
  if (own.length >= MIN_OWN) return { source: 'player', itemIds: own }
  const global = await topItems(db, null, GLOBAL_DAYS)
  const merged = [...new Set([...own, ...global])].slice(0, LIMIT)
  return { source: own.length ? 'player' : 'global', itemIds: merged }
}
