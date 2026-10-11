import { db, shifts, checks, checkPayments, cashOperations, refunds, profiles, eq, and, isNull, sql, desc, sum, gte, lt, type Database } from '@titan/database'
import { notify } from '../notifications/push.js'

// Переходный режим: пер-клубный db передаётся параметром, дефолт — модульный синглтон.
type DbLike = Database

export async function getCurrentShift(database: DbLike) {
  const [shift] = await database
    .select()
    .from(shifts)
    .where(eq(shifts.status, 'open'))
    .orderBy(desc(shifts.openedAt))
    .limit(1)
  return shift ?? null
}

export async function openShift(data: {
  openedBy: string
  cashStart: number
  eveningType: string
  note?: string
  adjustmentReason?: string
}, database: DbLike, clubId: string | null) {
  const existing = await getCurrentShift(database)
  if (existing) throw new Error('Shift already open')

  // Касса сводится непрерывно: ожидаемый старт = cashEnd прошлой смены.
  // Если прошлой смены нет — расхождения быть не может (старт = факт).
  const lastCashEnd = await getLastShiftCashEnd(database)
  const hadPriorShift = lastCashEnd !== null
  const expectedStart = lastCashEnd ?? data.cashStart
  const counted = data.cashStart
  const diff = counted - expectedStart

  // Любое расхождение факта с ожидаемым стартом фиксируется как операция с
  // кассой (внесение/изъятие) с обязательной причиной — книги всегда сходятся.
  if (hadPriorShift && diff !== 0 && !data.adjustmentReason?.trim()) {
    throw new Error('Требуется причина расхождения наличных при открытии смены')
  }

  let shift
  try {
    shift = await database.transaction(async (tx) => {
      const [created] = await tx
        .insert(shifts)
        .values({
          openedBy: data.openedBy,
          // Базис непрерывности — ожидаемый старт; расхождение закрываем операцией.
          cashStart: String(expectedStart),
          eveningType: data.eveningType as any,
          note: data.note,
          status: 'open',
        })
        .returning()

      if (hadPriorShift && diff !== 0) {
        await tx.insert(cashOperations).values({
          type: diff > 0 ? 'deposit' : 'withdrawal',
          amount: String(Math.abs(diff)),
          description: data.adjustmentReason!.trim(),
          shiftId: created.id,
          createdBy: data.openedBy,
        })
      }

      return created
    })
  } catch (e: any) {
    // Частичный уникальный индекс shifts_one_open (миграция 032) ловит гонку:
    // две параллельные попытки открыть смену → одна падает с 23505.
    if (e?.code === '23505' || /shifts_one_open|unique/i.test(String(e?.message))) {
      throw new Error('Shift already open')
    }
    throw e
  }

  // Fire-and-forget уведомление (вне денежной транзакции, не блокирует ответ).
  void notify({
    type: 'shift_open',
    title: 'Смена открыта',
    body: `Касса на старте: ${expectedStart} ₽`,
  }, database, clubId).catch(() => {})

  return shift
}

export async function closeShift(shiftId: string, closedBy: string, cashEnd: number, adjustmentReason: string | undefined, database: DbLike, clubId: string | null) {
  const counted = cashEnd
  // Всё в ОДНОЙ транзакции с блокировкой строки смены (FOR UPDATE): повторно
  // проверяем статус и отсутствие открытых чеков и считаем остаток ПОД блокировкой —
  // иначе параллельная оплата чека (в т.ч. webhook Platega) могла закрыть смену с
  // «потерянным» чеком и заниженным cashEnd, либо смену закрывали дважды.
  const { updated, diff } = await database.transaction(async (tx) => {
    const [shift] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for('update')
    if (!shift) throw new Error('Shift not found')
    if (shift.status !== 'open') throw new Error('Shift already closed')

    const [{ count: openChecks }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(checks)
      .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'open')))
    if (openChecks > 0) throw new Error(`Есть ${openChecks} незакрытых чек(а). Закройте их перед закрытием смены.`)

    const { expected } = await getShiftCashBalance(shiftId, tx)
    const d = counted - expected
    // Любое расхождение факта с ожидаемым остатком фиксируется операцией с кассой
    // (излишек → внесение, недостача → изъятие) с обязательной причиной.
    if (d !== 0 && !adjustmentReason?.trim()) {
      throw new Error('Требуется причина расхождения наличных при закрытии смены')
    }
    if (d !== 0) {
      await tx.insert(cashOperations).values({
        type: d > 0 ? 'deposit' : 'withdrawal',
        amount: String(Math.abs(d)),
        description: adjustmentReason!.trim(),
        shiftId,
        createdBy: closedBy,
      })
    }
    const [row] = await tx
      .update(shifts)
      .set({ status: 'closed', closedBy, cashEnd: String(counted), closedAt: new Date() })
      .where(eq(shifts.id, shiftId))
      .returning()
    return { updated: row, diff: d }
  })

  // Fire-and-forget уведомления (вне денежной транзакции, не блокируют ответ).
  void notify({
    type: 'shift_close',
    title: 'Смена закрыта',
    body: `Касса: ${counted} ₽`,
  }, database, clubId).catch(() => {})
  if (diff !== 0) {
    void notify({
      type: 'cash_discrepancy',
      title: 'Расхождение в кассе',
      body: `${diff > 0 ? 'Излишек (внесение)' : 'Недостача (изъятие)'}: ${Math.abs(diff)} ₽`,
    }, database, clubId).catch(() => {})
  }

  return updated
}

export async function getBirthdaysToday(database: DbLike) {
  // Дата по Москве (UTC+3). birthday — свободный text: сравниваем MM-DD через
  // substring (без ::date), чтобы битая строка не уронила запрос.
  const msk = new Date(Date.now() + 3 * 3600 * 1000)
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(msk.getUTCDate()).padStart(2, '0')
  const rows = await database.select({
    id: profiles.id,
    nickname: profiles.nickname,
    birthday: profiles.birthday,
    photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
  }).from(profiles)
    .where(and(
      eq(profiles.role, 'client'),
      isNull(profiles.deletedAt),
      sql`${profiles.birthday} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`,
      sql`substring(${profiles.birthday} from 6 for 5) = ${mm + '-' + dd}`,
    ))
  return rows
}

// exec — db или активная транзакция (tx). Позволяет считать остаток ВНУТРИ
// транзакции закрытия смены (под блокировкой строки), без отдельного соединения.
export async function getShiftCashBalance(shiftId: string, exec: any) {
  const [shift] = await exec.select().from(shifts).where(eq(shifts.id, shiftId))
  if (!shift) return { expected: 0, cashStart: 0 }

  const [cashSum] = await exec.select({ total: sum(checkPayments.amount) })
    .from(checkPayments)
    .innerJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(and(eq(checks.shiftId, shiftId), eq(checkPayments.method, 'cash')))

  const cashPayments = parseFloat(String(cashSum?.total ?? 0)) || 0
  const cashStart = parseFloat(String(shift.cashStart ?? 0)) || 0

  // Cash operations: deposits (+), withdrawals (-) и зарплаты (-) за смену.
  // Зарплата — это наличные, покинувшие кассу, поэтому уменьшает ожидаемый остаток.
  const [opsSum] = await exec.select({
    deposits: sql<string>`coalesce(sum(case when type = 'deposit' then amount::numeric else 0 end), 0)`,
    withdrawals: sql<string>`coalesce(sum(case when type = 'withdrawal' then amount::numeric else 0 end), 0)`,
    salaries: sql<string>`coalesce(sum(case when type = 'salary' then amount::numeric else 0 end), 0)`,
  })
    .from(cashOperations)
    .where(eq(cashOperations.shiftId, shiftId))

  const deposits = parseFloat(String(opsSum?.deposits ?? 0)) || 0
  const withdrawals = parseFloat(String(opsSum?.withdrawals ?? 0)) || 0
  const salaries = parseFloat(String(opsSum?.salaries ?? 0)) || 0

  // Возвраты наличными: при возврате по способам оплаты берём «cash»-тендер
  // напрямую; для старых возвратов (tenders=NULL) — пропорционально наличной
  // доле оригинального чека.
  // Возврат относится к смене, В КОТОРУЮ ОН СДЕЛАН (деньги ушли из кассы сейчас),
  // а не к смене исходного чека: иначе сегодняшний возврат вчерашнего наличного
  // чека не уменьшал сегодняшний ожидаемый остаток (ложная недостача при закрытии)
  // и задним числом менял уже закрытую вчерашнюю смену.
  const refundRows = await exec
    .select({
      refundTotal: refunds.totalAmount,
      checkId: refunds.checkId,
      tenders: refunds.tenders,
    })
    .from(refunds)
    .where(and(
      gte(refunds.createdAt, shift.openedAt),
      shift.closedAt ? lt(refunds.createdAt, shift.closedAt) : undefined,
    ))

  let cashRefundTotal = 0
  for (const r of refundRows) {
    if (r.tenders && Array.isArray(r.tenders)) {
      cashRefundTotal += (r.tenders as { method: string; amount: number }[])
        .filter(t => t.method === 'cash')
        .reduce((s, t) => s + (Number(t.amount) || 0), 0)
      continue
    }
    const refundAmt = parseFloat(String(r.refundTotal)) || 0
    const payments = await exec
      .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
      .from(checkPayments)
      .where(eq(checkPayments.checkId, r.checkId))
      .groupBy(checkPayments.method)
    const totalPaid = payments.reduce((s: number, p: any) => s + (parseFloat(String(p.total)) || 0), 0)
    const cashPaid = parseFloat(String(payments.find((p: any) => p.method === 'cash')?.total ?? 0)) || 0
    cashRefundTotal += totalPaid > 0 ? refundAmt * (cashPaid / totalPaid) : 0
  }

  const expected = cashStart + cashPayments + deposits - withdrawals - salaries - cashRefundTotal

  return { expected, cashStart, cashPayments, deposits, withdrawals, salaries, cashRefundTotal }
}

export async function getShiftAnalytics(shiftId: string, database: DbLike) {
  const shiftChecks = await database
    .select()
    .from(checks)
    .where(and(eq(checks.shiftId, shiftId), eq(checks.status, 'closed')))

  const totalRevenue = shiftChecks.reduce((s, c) => s + parseFloat(c.totalAmount), 0)
  const checksCount = shiftChecks.length

  const payments = await database
    .select({ method: checkPayments.method, total: sum(checkPayments.amount) })
    .from(checkPayments)
    .innerJoin(checks, eq(checks.id, checkPayments.checkId))
    .where(eq(checks.shiftId, shiftId))
    .groupBy(checkPayments.method)

  return { totalRevenue, checksCount, avgCheck: checksCount ? totalRevenue / checksCount : 0, payments }
}

export async function getLastShiftCashEnd(database: DbLike): Promise<number | null> {
  const [row] = await database
    .select({ cashEnd: shifts.cashEnd })
    .from(shifts)
    .where(eq(shifts.status, 'closed'))
    .orderBy(desc(shifts.closedAt))
    .limit(1)
  if (!row || row.cashEnd === null) return null
  // 0 — валидный остаток (касса пустая), не «нет прошлой смены».
  const n = parseFloat(String(row.cashEnd))
  return Number.isFinite(n) ? n : null
}

export async function getShiftHistory(page = 1, limit = 20, database: DbLike) {
  const offset = (page - 1) * limit
  const rows = await database
    .select({
      shift: shifts,
      openedByNickname: profiles.nickname,
    })
    .from(shifts)
    .leftJoin(profiles, eq(profiles.id, shifts.openedBy))
    .orderBy(desc(shifts.openedAt))
    .limit(limit)
    .offset(offset)

  return rows
}
