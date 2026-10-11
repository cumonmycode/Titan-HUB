import { db, profiles, transactions, appSettings, eq, and, inArray, isNull, sql, type Database } from '@titan/database'
import { notify } from '../modules/notifications/push.js'

// ─── Ежедневная сверка целостности балансов клиентов ─────────────────────────
//
// profiles.balance — АВТОРИТЕТНОЕ поле (плюс = депозит, минус = долг). Меняется
// атомарно (FOR UPDATE) одновременно с проводкой в transactions. Проверено по
// КАЖДОЙ точке записи profiles.balance в коде (clients/pos/refunds):
//
//   • clients.router POST /:id/balance  → transaction type 'deposit' | 'withdrawal'
//   • pos.router    оплата депозитом     → type 'withdrawal' (amount = списано)
//   • pos.router    оплата в долг         → type 'withdrawal' (amount = ушло в минус)
//   • refunds.router возврат на баланс    → type 'deposit'    (amount = зачислено)
//
// Все остальные типы проводок к profiles.balance НЕ относятся и в реконструкции
// НЕ участвуют:
//   • 'payment'      — фискальная проводка оплаты чека (выручка), баланс не трогает;
//   • 'refund'       — проводка факта возврата по чеку, баланс не трогает
//                      (само зачисление на баланс пишется отдельной 'deposit');
//   • 'bonus_*'      — бонусы (отдельное поле profiles.bonusPoints);
//   • 'visit_adjust' — виртуальные посещения, без денег.
//
// Отсюда точный ИНВАРИАНТ леджера:
//   profiles.balance == Σ(amount по 'deposit') − Σ(amount по 'withdrawal')
// по проводкам с playerId = клиента. amount в transactions всегда положителен
// (записывается как Math.abs), знак задаётся типом проводки.
//
// Кран ТОЛЬКО читает (SELECT). Никаких мутаций баланса/данных. Не бросает наружу.

// Допуск сравнения: балансы — numeric(12,2), храним до копейки. Берём пол-копейки,
// чтобы не ловить ложные срабатывания на округлении представления.
const EPSILON = 0.005

// Сколько расхождений печатать/слать детально (чтобы не залить лог при системной
// поломке, когда «разъехались» сотни строк). Полное число всегда в сводке.
const MAX_DETAIL = 50

type Mismatch = {
  id: string
  nickname: string
  expected: number // реконструкция из леджера
  actual: number // profiles.balance
  delta: number // actual − expected (на сколько факт расходится с леджером)
}

type OverLimit = {
  id: string
  nickname: string
  balance: number // отрицательный (долг)
  debt: number // |balance|
}

// database — БД клуба (пер-клубный cron). Планировщик передаёт db каждого
// active-клуба и его id (clubId — SSE-канал уведомлений клуба; null — основной домен).
export async function auditBalances(database: Database, clubId: string | null): Promise<void> {
  try {
    // ── 1. Реконструкция баланса из леджера ──────────────────────────────────
    // Считаем ожидаемый баланс по проводкам и сравниваем с profiles.balance.
    // LEFT JOIN: клиенты без единой балансовой проводки тоже попадают (expected=0),
    // чтобы поймать «висячий» ненулевой баланс без истории. Сравнение и фильтр
    // расхождения — в SQL, наружу приходят только проблемные строки.
    const mismatchRows = await database
      .select({
        id: profiles.id,
        nickname: profiles.nickname,
        actual: sql<string>`${profiles.balance}::numeric`,
        expected: sql<string>`coalesce(sum(
          case
            when ${transactions.type} = 'deposit' then ${transactions.amount}::numeric
            when ${transactions.type} = 'withdrawal' then -${transactions.amount}::numeric
            else 0
          end
        ), 0)`,
      })
      .from(profiles)
      .leftJoin(
        transactions,
        and(
          eq(transactions.playerId, profiles.id),
          inArray(transactions.type, ['deposit', 'withdrawal']),
        ),
      )
      // Только не удалённые профили: у архивных баланс «заморожен», расхождения
      // по ним не операционны и лишь шумят.
      .where(isNull(profiles.deletedAt))
      .groupBy(profiles.id, profiles.nickname, profiles.balance)
      .having(
        sql`abs(${profiles.balance}::numeric - coalesce(sum(
          case
            when ${transactions.type} = 'deposit' then ${transactions.amount}::numeric
            when ${transactions.type} = 'withdrawal' then -${transactions.amount}::numeric
            else 0
          end
        ), 0)) > ${EPSILON}`,
      )

    const mismatches: Mismatch[] = mismatchRows.map((r) => {
      const expected = parseFloat(r.expected) || 0
      const actual = parseFloat(r.actual) || 0
      return {
        id: r.id,
        nickname: r.nickname,
        expected: Math.round(expected * 100) / 100,
        actual: Math.round(actual * 100) / 100,
        delta: Math.round((actual - expected) * 100) / 100,
      }
    })

    // ── 2. Guardrail: долги сверх лимита max_client_debt ─────────────────────
    // Тот же лимит, что POS/clients проверяют ПЕРЕД списанием. Здесь — пост-фактум
    // контроль: долг мог уйти за лимит другим путём (смена настройки в меньшую
    // сторону, гонка, ручная правка БД). 0/пусто → лимит выключен, проверку пропускаем.
    const [maxDebtRow] = await database
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'max_client_debt'))
    const maxDebt = parseFloat(maxDebtRow?.value ?? '0') || 0

    let overLimit: OverLimit[] = []
    if (maxDebt > 0) {
      const overRows = await database
        .select({ id: profiles.id, nickname: profiles.nickname, balance: sql<string>`${profiles.balance}::numeric` })
        .from(profiles)
        .where(and(
          isNull(profiles.deletedAt),
          // Долг (отрицательный баланс) глубже лимита, с допуском на копейку.
          sql`${profiles.balance}::numeric < ${-maxDebt - EPSILON}`,
        ))
        .orderBy(sql`${profiles.balance}::numeric asc`)
      overLimit = overRows.map((r) => {
        const balance = Math.round((parseFloat(r.balance) || 0) * 100) / 100
        return { id: r.id, nickname: r.nickname, balance, debt: Math.abs(balance) }
      })
    }

    // ── 3. Сводка в лог (стиль проекта: [тег] сообщение) ─────────────────────
    if (mismatches.length === 0 && overLimit.length === 0) {
      console.log('[balance-audit] OK — расхождений баланса с леджером нет, лимиты долга соблюдены')
      return
    }

    if (mismatches.length > 0) {
      console.error(`[balance-audit] РАСХОЖДЕНИЕ: ${mismatches.length} клиент(ов) не сходятся с леджером`)
      for (const m of mismatches.slice(0, MAX_DETAIL)) {
        console.error(
          `[balance-audit]   ${m.nickname} (${m.id}): баланс ${m.actual}, по леджеру ${m.expected}, дельта ${m.delta > 0 ? '+' : ''}${m.delta}`,
        )
      }
      if (mismatches.length > MAX_DETAIL) {
        console.error(`[balance-audit]   …и ещё ${mismatches.length - MAX_DETAIL} (см. сводку)`)
      }
    }

    if (overLimit.length > 0) {
      console.error(`[balance-audit] ЛИМИТ ДОЛГА: ${overLimit.length} клиент(ов) сверх ${maxDebt}₽`)
      for (const o of overLimit.slice(0, MAX_DETAIL)) {
        console.error(`[balance-audit]   ${o.nickname} (${o.id}): долг ${o.debt}₽ (лимит ${maxDebt}₽)`)
      }
      if (overLimit.length > MAX_DETAIL) {
        console.error(`[balance-audit]   …и ещё ${overLimit.length - MAX_DETAIL} (см. сводку)`)
      }
    }

    // ── 4. Алерт владельцу/персоналу ТОЛЬКО при наличии проблем ──────────────
    // notify(userId=null) = broadcast всему персоналу/владельцу: пишет в
    // notifications, шлёт SSE/web-push/Telegram (по настройкам типов) и НИКОГДА
    // не бросает наружу. Тип 'balance_audit' (неизвестен карте настроек →
    // доставляется по умолчанию, deep-link ведёт на /manage/balances).
    const parts: string[] = []
    if (mismatches.length > 0) parts.push(`${mismatches.length} расхожд. с леджером`)
    if (overLimit.length > 0) parts.push(`${overLimit.length} долг(ов) сверх лимита`)

    await notify({
      type: 'balance_audit',
      title: '⚠️ Аудит балансов: расхождения',
      body: `Найдено: ${parts.join(', ')}. Подробности — в разделе «Депозиты и долги».`,
      meta: {
        url: '/manage/balances',
        mismatchCount: mismatches.length,
        overLimitCount: overLimit.length,
        // Превью первых строк — чтобы алерт был информативен без захода в логи.
        mismatches: mismatches.slice(0, 10),
        overLimit: overLimit.slice(0, 10),
      },
    }, database, clubId)
  } catch (e) {
    // Кран не должен ронять процесс/планировщик — логируем и выходим.
    console.error('[balance-audit] проход не выполнен', e)
  }
}
