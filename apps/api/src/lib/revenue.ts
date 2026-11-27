/**
 * Выручка чека — без свободных позиций «Другое».
 *
 * «Другое» — деньги, которые клуб заплатил за гостя (еда из другого заведения), а
 * гость вернул по чеку. Они входят в итог к оплате (checks.total_amount) и в кассу,
 * но это не выручка: аналитика, прогноз Tai и зарплата их не видят.
 *
 * Выручка = total_amount − custom_amount (не меньше нуля: при списании на персонал
 * итог 0 ₽, а custom_amount остаётся).
 */
import { checks, sql } from '@titan/database'

/** Выручка строки `checks` для Drizzle-запросов (sum/avg/orderBy). */
export const checkRevenue = sql<string>`GREATEST(${checks.totalAmount}::numeric - ${checks.customAmount}::numeric, 0)`

/** То же для сырого SQL: `revenueSql('c')` → выражение по алиасу таблицы checks. */
export const revenueSql = (alias: string) => sql.raw(`GREATEST(${alias}.total_amount::numeric - ${alias}.custom_amount::numeric, 0)`)

/**
 * Доля оплат чека, которая приходится на выручку (без «Другого»): 1 − custom/total.
 * Для разбивки по способам оплаты: сумма платежа × доля.
 */
export const revenueShare = sql<string>`(1 - LEAST(COALESCE(${checks.customAmount}::numeric / NULLIF(${checks.totalAmount}::numeric, 0), 0), 1))`

export { revenueOf } from './money.js'
