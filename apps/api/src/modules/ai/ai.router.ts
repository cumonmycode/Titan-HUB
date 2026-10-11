import type { AppEnv } from '../../types.js'
import { fmtMsk, bizDayStr, bizDayStart, bizMonthStart } from '../../lib/dateFmt.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getSharedRedis } from '../../lib/redis.js'
import {
  checks,
  checkItems,
  inventory,
  profiles,
  expenses,
  shifts,
  events,
  certificates,
  transactions,
  bonusHistory,
  salaryPayments,
  refunds,
  sum,
  count,
  avg,
  desc,
  eq,
  gt,
  lt,
  gte,
  lte,
  and,
  sql,
  isNull,
  or,
} from '@titan/database'
import type { Database } from '@titan/database'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { quantityText } from '../inventory/ledger.js'
import { answerFromDb, callAI, type DbOrTx } from './sql.js'
import { confirmAction, dismissAction } from './tai/actions.js'
import type { TaiEvent } from './tai/blocks.js'
import { runTai, taiErrorMessage } from './tai/engine.js'
import { createApiCaller, forwardedHeaders } from './tai/internal.js'
import { POLZA_BASE, resolveApiKey } from './tai/llm.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'

// Действия Tai, доступные только владельцу (зарплаты, расходы).
const OWNER_ONLY_ACTIONS = new Set<string>(['salary_report', 'expense_analysis'])

const SYSTEM_PROMPT = [
  'Тебя зовут Tai — AI-ассистент игрового клуба Titan. Если уместно, представляйся как Tai.',
  'Отвечай кратко, конкретно, на русском языке.',
  'Если в сообщении есть блок «РЕЗУЛЬТАТ» (данные SQL-запроса к базе) или',
  '«АКТУАЛЬНЫЕ ДАННЫЕ КЛУБА» — отвечай СТРОГО по этим данным, не выдумывай.',
  'Имя человека из вопроса сопоставляй с именами и никами из данных без учёта регистра',
  '(например «Саид» ↔ «Саид»/«said»). Если ответа в данных нет — честно скажи, что таких данных нет.',
  'Суммы давай в рублях.',
].join(' ')

const ActionSchema = z.object({
  action: z.enum([
    'revenue_summary',
    'daily_summary',
    'shift_report',
    'product_analysis',
    'client_analysis',
    'expense_analysis',
    'low_stock_alert',
    'popular_hours',
    'avg_check_trend',
    'refund_analysis',
    'salary_report',
    'event_summary',
    'certificate_usage',
    'bonus_usage',
    'custom_query',
  ]),
  payload: z.record(z.unknown()).optional(),
  question: z.string().max(1000).optional(),
})

// Снимок актуального состояния клуба для произвольных вопросов (долги, остатки,
// выручка и т.д.). Подаётся в промпт, чтобы ИИ отвечал по реальным данным, а не
// угадывал. Долг клиента = отрицательный profiles.balance; депозит = положительный.
async function buildBusinessSnapshot(db: DbOrTx): Promise<string> {
  const parts: string[] = []
  // Начало текущего БИЗНЕС-ДНЯ (по настройке business_day_start_hour, по умолч.
  // 09:00 МСК), а не календарной полуночи локали сервера.
  const h = await getBusinessDayStartHour(db)
  const todayStart = bizDayStart(bizDayStr(0, h), h)

  // Должники (balance < 0) + общий долг.
  try {
    const debtors = await db
      .select({ nickname: profiles.nickname, fullName: profiles.fullName, balance: profiles.balance })
      .from(profiles)
      .where(and(eq(profiles.role, 'client'), sql`${profiles.balance}::numeric < 0`))
      .orderBy(sql`${profiles.balance}::numeric asc`)
      .limit(80)
    const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.balance) || 0), 0)
    if (debtors.length) {
      const lines = debtors.map(d => {
        const name = d.fullName ? `${d.fullName} (${d.nickname})` : d.nickname
        return `- ${name}: ${Math.abs(Number(d.balance)).toFixed(0)} ₽`
      }).join('\n')
      parts.push(`ДОЛЖНИКИ — всего ${debtors.length}, ОБЩИЙ ДОЛГ ${totalDebt.toFixed(0)} ₽:\n${lines}`)
    } else {
      parts.push('ДОЛЖНИКИ: нет. Общий долг 0 ₽.')
    }
  } catch { parts.push('ДОЛЖНИКИ: данные недоступны.') }

  // Депозиты клиентов (balance > 0).
  try {
    const [dep] = await db
      .select({ total: sql<string>`coalesce(sum(${profiles.balance}::numeric), 0)`, cnt: count() })
      .from(profiles)
      .where(and(eq(profiles.role, 'client'), sql`${profiles.balance}::numeric > 0`))
    parts.push(`ДЕПОЗИТЫ КЛИЕНТОВ: ${Number(dep?.total ?? 0).toFixed(0)} ₽ у ${dep?.cnt ?? 0} клиентов.`)
  } catch { /* skip */ }

  // Нет в наличии (учёт ведётся, остаток 0).
  try {
    const out = await db
      .select({ name: inventory.name })
      .from(inventory)
      .where(and(eq(inventory.trackStock, true), isNull(inventory.deletedAt), eq(inventory.stockQuantity, 0)))
      .orderBy(inventory.name)
      .limit(100)
    parts.push(out.length
      ? `НЕТ В НАЛИЧИИ (закончилось) — ${out.length} позиций: ${out.map(i => i.name).join(', ')}`
      : 'НЕТ В НАЛИЧИИ: всё в наличии.')
  } catch { /* skip */ }

  // Заканчивается (остаток >0 и ниже/равен порогу).
  try {
    const low = await db
      .select({ name: inventory.name, stock: inventory.stockQuantity, unit: inventory.unit, threshold: sql<number>`coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)` })
      .from(inventory)
      .where(and(eq(inventory.trackStock, true), isNull(inventory.deletedAt),
        gt(inventory.stockQuantity, 0), sql`${inventory.stockQuantity} <= coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)`))
      .limit(100)
    parts.push(low.length
      ? `ЗАКАНЧИВАЕТСЯ — ${low.length} позиций:\n${low.map(i => `- ${i.name}: ${quantityText(i.stock, i.unit)} (точка заказа ${quantityText(Number(i.threshold), i.unit)})`).join('\n')}`
      : 'ЗАКАНЧИВАЕТСЯ: нет позиций ниже порога.')
  } catch { /* skip */ }

  // Сегодня: выручка/чеки.
  try {
    const [today] = await db
      .select({ rev: sum(checks.totalAmount), cnt: count() })
      .from(checks)
      .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, todayStart)))
    parts.push(`СЕГОДНЯ: выручка ${Number(today?.rev ?? 0).toFixed(0)} ₽, закрыто чеков ${today?.cnt ?? 0}.`)
  } catch { /* skip */ }

  // Текущая смена.
  try {
    const [openShift] = await db.select().from(shifts).where(eq(shifts.status, 'open')).orderBy(desc(shifts.openedAt)).limit(1)
    parts.push(openShift
      ? `СМЕНА: открыта с ${fmtMsk(new Date(openShift.openedAt), true)}.`
      : 'СМЕНА: открытой смены нет.')
  } catch { /* skip */ }

  // Всего клиентов.
  try {
    const [cl] = await db.select({ cnt: count() }).from(profiles).where(eq(profiles.role, 'client'))
    parts.push(`ВСЕГО КЛИЕНТОВ: ${cl?.cnt ?? 0}.`)
  } catch { /* skip */ }

  return parts.join('\n\n')
}

// allowSql=false — без text-to-SQL по всей базе (персонал: только общий снимок).
async function buildContext(db: Database, action: string, payload?: Record<string, unknown>, question?: string, allowSql = true): Promise<string> {
  const thirtyDays = new Date(Date.now() - 30 * 86400000)
  // Границы — по БИЗНЕС-ДНЮ/БИЗНЕС-МЕСЯЦУ в МСК (по настройке business_day_start_hour,
  // по умолч. 09:00), а не по локальной полуночи сервера.
  const h = await getBusinessDayStartHour(db)
  const todayStart = bizDayStart(bizDayStr(0, h), h)
  const firstOfMonth = bizMonthStart(0, h)
  const firstOfLastMonth = bizMonthStart(-1, h)
  const lastMonthEnd = new Date(firstOfMonth.getTime() - 1)

  switch (action) {
    case 'revenue_summary': {
      try {
        const [stats] = await db
          .select({
            rev: sum(checks.totalAmount),
            cnt: count(),
            avgCheck: avg(checks.totalAmount),
          })
          .from(checks)
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDays)))
        const rev = Number(stats?.rev ?? 0).toFixed(2)
        const cnt = stats?.cnt ?? 0
        const avgC = Number(stats?.avgCheck ?? 0).toFixed(2)
        return `Выручка за последние 30 дней:\n- Итого: ${rev} руб\n- Чеков: ${cnt}\n- Средний чек: ${avgC} руб`
      } catch (e) {
        return `Не удалось получить данные о выручке: ${String(e)}`
      }
    }

    case 'daily_summary': {
      try {
        const [stats] = await db
          .select({
            rev: sum(checks.totalAmount),
            cnt: count(),
            avgCheck: avg(checks.totalAmount),
          })
          .from(checks)
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, todayStart)))
        const rev = Number(stats?.rev ?? 0).toFixed(2)
        const cnt = stats?.cnt ?? 0
        const avgC = Number(stats?.avgCheck ?? 0).toFixed(2)
        return `Сводка за сегодня (${fmtMsk(todayStart)}):\n- Выручка: ${rev} руб\n- Чеков: ${cnt}\n- Средний чек: ${avgC} руб`
      } catch (e) {
        return `Не удалось получить дневную сводку: ${String(e)}`
      }
    }

    case 'shift_report': {
      try {
        const [activeShift] = await db
          .select()
          .from(shifts)
          .where(eq(shifts.status, 'open'))
          .orderBy(desc(shifts.openedAt))
          .limit(1)

        const targetShift = activeShift ?? (await db
          .select()
          .from(shifts)
          .orderBy(desc(shifts.openedAt))
          .limit(1))[0]

        if (!targetShift) return 'Смены не найдены.'

        const opener = await db.select({ nickname: profiles.nickname })
          .from(profiles)
          .where(eq(profiles.id, targetShift.openedBy))
          .limit(1)

        const [revenue] = await db
          .select({ rev: sum(checks.totalAmount), cnt: count() })
          .from(checks)
          .where(and(eq(checks.status, 'closed'), eq(checks.shiftId, targetShift.id)))

        const durationMs = targetShift.closedAt
          ? new Date(targetShift.closedAt).getTime() - new Date(targetShift.openedAt).getTime()
          : Date.now() - new Date(targetShift.openedAt).getTime()
        const hours = Math.floor(durationMs / 3600000)
        const minutes = Math.floor((durationMs % 3600000) / 60000)

        const status = targetShift.status === 'open' ? 'Активная' : 'Последняя закрытая'
        return `${status} смена:\n- Открыл: ${opener[0]?.nickname ?? 'неизвестно'}\n- Начало: ${fmtMsk(new Date(targetShift.openedAt), true)}\n- Длительность: ${hours}ч ${minutes}мин\n- Выручка: ${Number(revenue?.rev ?? 0).toFixed(2)} руб\n- Чеков: ${revenue?.cnt ?? 0}`
      } catch (e) {
        return `Не удалось получить данные смены: ${String(e)}`
      }
    }

    case 'product_analysis': {
      try {
        const top = await db
          .select({
            name: inventory.name,
            qty: sum(checkItems.quantity),
            rev: sql<string>`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`,
          })
          .from(checkItems)
          .leftJoin(inventory, eq(inventory.id, checkItems.itemId))
          .leftJoin(checks, eq(checks.id, checkItems.checkId))
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDays)))
          .groupBy(inventory.name)
          .orderBy(desc(sql`sum(${checkItems.quantity}::numeric * ${checkItems.priceAtTime})`))
          .limit(10)
        if (!top.length) return 'Нет данных о продажах за последние 30 дней.'
        const rows = top.map((t, i) => `${i + 1}. ${t.name}: ${t.qty} шт — ${Number(t.rev).toFixed(2)} руб`).join('\n')
        return `Топ-10 товаров по выручке за 30 дней:\n${rows}`
      } catch (e) {
        return `Не удалось получить анализ товаров: ${String(e)}`
      }
    }

    case 'client_analysis': {
      try {
        const [total] = await db.select({ cnt: count() }).from(profiles).where(eq(profiles.role, 'client'))
        const [newThisMonth] = await db
          .select({ cnt: count() })
          .from(profiles)
          .where(and(eq(profiles.role, 'client'), gte(profiles.createdAt, firstOfMonth)))
        const [residents] = await db
          .select({ cnt: count() })
          .from(profiles)
          .where(and(eq(profiles.role, 'client'), eq(profiles.clientTier, 'resident')))

        const topSpenders = await db
          .select({ nickname: profiles.nickname, rev: sum(checks.totalAmount) })
          .from(checks)
          .leftJoin(profiles, eq(profiles.id, checks.playerId))
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDays)))
          .groupBy(profiles.nickname)
          .orderBy(desc(sum(checks.totalAmount)))
          .limit(5)

        const spendersList = topSpenders.map((s, i) => `${i + 1}. ${s.nickname ?? 'гость'}: ${Number(s.rev ?? 0).toFixed(2)} руб`).join('\n')
        return `Аналитика клиентов:\n- Всего клиентов: ${total?.cnt ?? 0}\n- Новых в этом месяце: ${newThisMonth?.cnt ?? 0}\n- Резидентов: ${residents?.cnt ?? 0}\n\nТоп-5 по тратам за 30 дней:\n${spendersList}`
      } catch (e) {
        return `Не удалось получить анализ клиентов: ${String(e)}`
      }
    }

    case 'expense_analysis': {
      try {
        const rows = await db
          .select({ cat: expenses.category, total: sum(expenses.amount) })
          .from(expenses)
          .where(gte(expenses.createdAt, thirtyDays))
          .groupBy(expenses.category)
          .orderBy(desc(sum(expenses.amount)))
        if (!rows.length) return 'Расходов за последние 30 дней не найдено.'
        const [totalRow] = await db
          .select({ total: sum(expenses.amount) })
          .from(expenses)
          .where(gte(expenses.createdAt, thirtyDays))
        const catLines = rows.map(r => `- ${r.cat}: ${Number(r.total ?? 0).toFixed(2)} руб`).join('\n')
        return `Расходы за последние 30 дней:\n${catLines}\nИтого: ${Number(totalRow?.total ?? 0).toFixed(2)} руб`
      } catch (e) {
        return `Не удалось получить анализ расходов: ${String(e)}`
      }
    }

    case 'low_stock_alert': {
      try {
        const items = await db
          .select({ name: inventory.name, stock: inventory.stockQuantity, threshold: sql<number>`coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)` })
          .from(inventory)
          .where(and(
            eq(inventory.trackStock, true),
            isNull(inventory.deletedAt),
            sql`${inventory.stockQuantity} <= coalesce(${inventory.reorderPoint}, ${inventory.minThreshold}, 0)`,
          ))
        if (!items.length) return 'Все отслеживаемые товары в норме по остаткам.'
        const lines = items.map(i => `- ${i.name}: ${i.stock} шт (порог: ${i.threshold})`).join('\n')
        return `Товары с низким остатком (${items.length} позиций):\n${lines}`
      } catch (e) {
        return `Не удалось проверить остатки: ${String(e)}`
      }
    }

    case 'popular_hours': {
      try {
        const rows = await db
          .select({
            // Час берём в МСК, а не UTC — иначе «популярные часы» съезжают на 3ч.
            hour: sql<number>`extract(hour from (${checks.closedAt} AT TIME ZONE 'Europe/Moscow'))::int`,
            cnt: count(),
            rev: sum(checks.totalAmount),
          })
          .from(checks)
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, thirtyDays)))
          .groupBy(sql`extract(hour from (${checks.closedAt} AT TIME ZONE 'Europe/Moscow'))`)
          .orderBy(desc(count()))
          .limit(8)
        if (!rows.length) return 'Нет данных о закрытых чеках за последние 30 дней.'
        const lines = rows.map(r => `- ${r.hour}:00 — ${r.cnt} чеков, ${Number(r.rev ?? 0).toFixed(0)} руб`).join('\n')
        return `Популярные часы (по закрытым чекам за 30 дней):\n${lines}`
      } catch (e) {
        return `Не удалось проанализировать популярные часы: ${String(e)}`
      }
    }

    case 'avg_check_trend': {
      try {
        // День — БИЗНЕС-ДЕНЬ клуба в МСК (как в analytics.router): сдвиг −h ч, иначе
        // date_trunc в часовом поясе сессии БД (UTC) резал вечер по 03:00 МСК.
        // h ∈ [0..23] — число из настройки, безопасно для sql.raw.
        const bizDay = sql`((${checks.createdAt} AT TIME ZONE 'Europe/Moscow') - interval '${sql.raw(String(h))} hours')::date`
        const rows = await db
          .select({
            day: sql<string>`${bizDay}::text`,
            avgCheck: avg(checks.totalAmount),
            cnt: count(),
          })
          .from(checks)
          // 14 полных бизнес-дней (включая сегодняшний), без обрезанного первого дня.
          .where(and(eq(checks.status, 'closed'), gte(checks.createdAt, bizDayStart(bizDayStr(13, h), h))))
          .groupBy(bizDay)
          .orderBy(bizDay)
        if (!rows.length) return 'Нет данных за последние 14 дней.'
        const lines = rows.map(r => `- ${r.day}: ${Number(r.avgCheck ?? 0).toFixed(0)} руб (${r.cnt} чеков)`).join('\n')
        return `Средний чек по дням за последние 14 дней:\n${lines}`
      } catch (e) {
        return `Не удалось получить тренд среднего чека: ${String(e)}`
      }
    }

    case 'refund_analysis': {
      try {
        const [stats] = await db
          .select({ cnt: count(), total: sum(refunds.totalAmount) })
          .from(refunds)
          .where(gte(refunds.createdAt, thirtyDays))
        const byReason = await db
          .select({ reason: refunds.reason, cnt: count(), total: sum(refunds.totalAmount) })
          .from(refunds)
          .where(gte(refunds.createdAt, thirtyDays))
          .groupBy(refunds.reason)
          .orderBy(desc(count()))
        const reasonLines = byReason.map(r => `- ${r.reason}: ${r.cnt} шт, ${Number(r.total ?? 0).toFixed(2)} руб`).join('\n')
        return `Возвраты за последние 30 дней:\n- Кол-во: ${stats?.cnt ?? 0}\n- Сумма: ${Number(stats?.total ?? 0).toFixed(2)} руб\n\nПо причинам:\n${reasonLines || '— нет данных'}`
      } catch (e) {
        return `Не удалось получить анализ возвратов: ${String(e)}`
      }
    }

    case 'salary_report': {
      try {
        const rows = await db
          .select({
            nickname: profiles.nickname,
            amount: salaryPayments.amount,
            date: salaryPayments.createdAt,
            method: salaryPayments.paymentMethod,
          })
          .from(salaryPayments)
          .leftJoin(profiles, eq(profiles.id, salaryPayments.profileId))
          .where(and(
            gte(salaryPayments.createdAt, firstOfLastMonth),
            lte(salaryPayments.createdAt, lastMonthEnd),
          ))
          .orderBy(desc(salaryPayments.createdAt))
        if (!rows.length) return 'Выплат зарплат в прошлом месяце не найдено.'
        const [totalRow] = await db
          .select({ total: sum(salaryPayments.amount) })
          .from(salaryPayments)
          .where(and(
            gte(salaryPayments.createdAt, firstOfLastMonth),
            lte(salaryPayments.createdAt, lastMonthEnd),
          ))
        const lines = rows.map(r => `- ${r.nickname ?? 'неизвестно'}: ${Number(r.amount).toFixed(2)} руб (${fmtMsk(new Date(r.date))}, ${r.method})`).join('\n')
        return `Зарплаты за прошлый месяц:\n${lines}\nИтого: ${Number(totalRow?.total ?? 0).toFixed(2)} руб`
      } catch (e) {
        return `Не удалось получить отчёт по зарплатам: ${String(e)}`
      }
    }

    case 'event_summary': {
      try {
        const upcoming = await db
          .select({ id: events.id, date: events.date, startTime: events.startTime, type: events.type, location: events.location })
          .from(events)
          .where(eq(events.status, 'planned'))
          .orderBy(events.date)
          .limit(5)
        const recentCompleted = await db
          .select({ id: events.id, date: events.date, type: events.type })
          .from(events)
          .where(eq(events.status, 'completed'))
          .orderBy(desc(events.date))
          .limit(5)
        const upLines = upcoming.length
          ? upcoming.map(e => `- ${e.date} ${e.startTime} | ${e.type} | ${e.location ?? '—'}`).join('\n')
          : '— нет запланированных'
        const completedLines = recentCompleted.length
          ? recentCompleted.map(e => `- ${e.date} | ${e.type}`).join('\n')
          : '— нет завершённых'
        return `Мероприятия:\n\nПредстоящие:\n${upLines}\n\nНедавно завершённые:\n${completedLines}`
      } catch (e) {
        return `Не удалось получить данные о мероприятиях: ${String(e)}`
      }
    }

    case 'certificate_usage': {
      try {
        const [total] = await db.select({ cnt: count() }).from(certificates)
        const [used] = await db.select({ cnt: count() }).from(certificates).where(eq(certificates.isUsed, true))
        const [active] = await db.select({ cnt: count() }).from(certificates).where(eq(certificates.isUsed, false))
        const [totalNominal] = await db.select({ total: sum(certificates.nominal) }).from(certificates)
        const [usedBalance] = await db.select({ total: sum(certificates.balance) }).from(certificates).where(eq(certificates.isUsed, false))
        return `Сертификаты:\n- Всего выдано: ${total?.cnt ?? 0}\n- Использовано: ${used?.cnt ?? 0}\n- Активных (неиспользованных): ${active?.cnt ?? 0}\n- Суммарный номинал: ${Number(totalNominal?.total ?? 0).toFixed(2)} руб\n- Остаток на активных: ${Number(usedBalance?.total ?? 0).toFixed(2)} руб`
      } catch (e) {
        return `Не удалось получить данные о сертификатах: ${String(e)}`
      }
    }

    case 'bonus_usage': {
      try {
        // Бонусы пишутся в bonus_history (amount > 0 — начисление, < 0 — списание),
        // а НЕ в transactions, поэтому считаем по bonus_history.
        const [accruals] = await db
          .select({ total: sum(bonusHistory.amount), cnt: count() })
          .from(bonusHistory)
          .where(and(gt(bonusHistory.amount, '0'), gte(bonusHistory.createdAt, thirtyDays)))
        const [spending] = await db
          .select({ total: sum(bonusHistory.amount), cnt: count() })
          .from(bonusHistory)
          .where(and(lt(bonusHistory.amount, '0'), gte(bonusHistory.createdAt, thirtyDays)))
        const spentAbs = Math.abs(Number(spending?.total ?? 0))
        return `Бонусная программа за 30 дней:\n- Начислено: ${Number(accruals?.total ?? 0).toFixed(2)} баллов (${accruals?.cnt ?? 0} операций)\n- Списано: ${spentAbs.toFixed(2)} баллов (${spending?.cnt ?? 0} операций)`
      } catch (e) {
        return `Не удалось получить данные о бонусах: ${String(e)}`
      }
    }

    case 'custom_query': {
      const query = question ?? (payload?.query as string) ?? ''
      const snapshot = await buildBusinessSnapshot(db)
      if (!query) return snapshot
      // Сначала пробуем точный ответ через SQL по всей базе; если не вышло —
      // подставляем общий снимок (покрывает частые вопросы).
      const dbBlock = allowSql ? await answerFromDb(db, query) : null
      if (dbBlock) {
        return `ВОПРОС ПОЛЬЗОВАТЕЛЯ: ${query}\n\n${dbBlock}\n\nСправочно (общая сводка клуба):\n${snapshot}`
      }
      return `АКТУАЛЬНЫЕ ДАННЫЕ КЛУБА:\n\n${snapshot}\n\nВОПРОС ПОЛЬЗОВАТЕЛЯ: ${query}`
    }

    default:
      return 'Нет данных для этого действия.'
  }
}

export const aiRouter = new Hono<AppEnv>()
aiRouter.use('*', requireAuth, requireRole('owner', 'staff'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleChat(c: any) {
  const db = c.var.db
  const { action, payload, question } = c.req.valid('json') as z.infer<typeof ActionSchema>
  const role: string = c.get('user').role
  const isOwner = role === 'owner'
  // Зарплаты и расходы — только владельцу (как и в «Управлении»).
  if (!isOwner && OWNER_ONLY_ACTIONS.has(action)) {
    return c.json({ error: 'Этот отчёт доступен только владельцу' }, 403)
  }
  // Кэш пер-клубный и пер-ролевой: Redis общий для всех клубов, а ответ персонала
  // собран без SQL по базе — владельцу его отдавать нельзя (и наоборот).
  const clubKey = c.var.club?.id ?? 'default'
  const cacheKey = `ai:${clubKey}:${role}:${action}:${JSON.stringify(payload ?? {})}:${question ?? ''}`

  const redis = getSharedRedis()
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return c.json({ result: cached, cached: true })
  } catch { /* redis unavailable */ }

  let context: string
  try {
    // Text-to-SQL по всей базе (зарплаты, расходы, личные данные) — только владельцу.
    context = await buildContext(db, action, payload, question, isOwner)
  } catch (e) {
    context = `Ошибка получения данных: ${String(e)}`
  }

  const userMessage = action === 'custom_query'
    ? context
    : question
      ? `${context}\n\nДополнительный вопрос: ${question}`
      : context

  let result: string
  try {
    result = await callAI(db, SYSTEM_PROMPT, userMessage)
  } catch (e) {
    return c.json({ error: `AI недоступен: ${String(e)}` }, 502)
  }

  try {
    await redis.set(cacheKey, result, 'EX', 60)
  } catch { /* redis unavailable */ }

  return c.json({ result })
}

aiRouter.post('/chat', zValidator('json', ActionSchema), handleChat)
aiRouter.post('/action', zValidator('json', ActionSchema), handleChat)

// ─── Tai: ассистент с инструментами, интерактивными блоками и действиями ─────
// Поток событий SSE (см. tai/blocks.ts). Старые /chat и /action оставлены для
// сборок приложения, выпущенных до этого контракта.

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/
const AssistantSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000), memo: z.string().max(1500).optional() }))
    .min(1)
    .max(40),
  context: z
    .object({
      screen: z.enum(['pos', 'check', 'analytics', 'other']).optional(),
      checkId: z.string().uuid().optional(),
      period: z.object({ from: z.string().regex(DATE_KEY), to: z.string().regex(DATE_KEY) }).optional(),
    })
    .optional(),
  voice: z.boolean().optional(),
})

aiRouter.post('/assistant', zValidator('json', AssistantSchema), async (c) => {
  const body = c.req.valid('json')
  // Без буферизации nginx: иначе текст придёт одним куском в конце.
  c.header('X-Accel-Buffering', 'no')
  c.header('Cache-Control', 'no-cache, no-transform')
  return streamSSE(c, async (stream) => {
    const controller = new AbortController()
    stream.onAbort(() => controller.abort())
    const emit = (event: TaiEvent) => stream.writeSSE({ data: JSON.stringify(event) })
    try {
      await runTai(c, body, emit, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) await emit({ type: 'error', message: taiErrorMessage(error) })
    }
  })
})

const ACTION_ID = /^[0-9a-f-]{36}$/i

// Нажатие «Открыть чек» / «Добавить» и т.п. — выполняется от имени нажавшего.
aiRouter.post('/assistant/actions/:id', async (c) => {
  const id = c.req.param('id')
  if (!ACTION_ID.test(id)) return c.json({ error: 'Неверная карточка' }, 400)
  const outcome = await confirmAction(c.var.club?.id ?? 'main', c.get('user').sub, id, createApiCaller(forwardedHeaders(c)))
  if (outcome.status !== 200) return c.json({ error: outcome.error }, outcome.status)
  return c.json({ action: outcome.card })
})

aiRouter.post('/assistant/actions/:id/dismiss', async (c) => {
  const id = c.req.param('id')
  if (!ACTION_ID.test(id)) return c.json({ error: 'Неверная карточка' }, 400)
  const card = await dismissAction(c.var.club?.id ?? 'main', c.get('user').sub, id)
  return c.json({ action: card })
})

// Распознавание речи на сервере — для браузеров без встроенного (в приложении речь
// распознаёт телефон). Запись голосом — до ~минуты, поэтому свой предел тела.
const STT_MODEL = (process.env['TAI_STT_MODEL'] ?? '').trim() || 'openai/gpt-4o-mini-transcribe'
const MAX_AUDIO_BYTES = 8 * 1024 * 1024

aiRouter.post('/assistant/transcribe', bodyLimit({ maxSize: MAX_AUDIO_BYTES }), async (c) => {
  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) return c.json({ error: 'Нет записи' }, 400)
  const apiKey = await resolveApiKey(c.var.db)
  const out = new FormData()
  out.set('model', STT_MODEL)
  out.set('language', 'ru')
  out.set('file', file, file.name || 'voice.webm')
  const res = await fetch(`${POLZA_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: out,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null)
  if (!res?.ok) {
    console.error('[tai] transcribe failed', res?.status, res ? (await res.text().catch(() => '')).slice(0, 200) : 'network')
    return c.json({ error: 'Не удалось распознать речь' }, 502)
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string }
  return c.json({ text: (data.text ?? '').trim() })
})

