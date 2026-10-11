/**
 * Жизненный цикл мероприятия, общий для всех путей закрытия/отмены чеков.
 *
 * Завершение: мероприятие переходит в «Завершено» по закрытию чека — и из кассы
 * (/pay, /comp), и вебхуком СБП (Platega, общий settle эквайеров). Раньше логика
 * жила только в /pay, и оплаченное по QR мероприятие навсегда оставалось «Идёт».
 *
 * Отмена: PATCH status=cancelled, мягкий DELETE и отмена брони с мероприятием
 * отменяют открытые чеки события и возвращают на склад списанное по ним.
 *
 * Все функции вызываются ВНУТРИ транзакции вызывающего.
 */
import type { Database } from '@titan/database'
import { events, eventParticipants, checks, expenses, eq, and, ne, isNull, inArray, sql } from '@titan/database'
import { reverseCheckMovements } from '../inventory/ledger.js'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type DbOrTx = Database | Tx

export type CompletedEvent = { id: string; title: string | null }

/**
 * Миникап (своего чека у события нет — только чеки участников) завершается, когда
 * не осталось ОТКРЫТЫХ чеков участников и хотя бы один закрыт (оплачен/списан).
 * Вызывается и после закрытия чека участника, и после его отмены: если последний
 * открытый чек отменили, а остальные уже оплачены, миникап иначе «шёл» бы вечно.
 */
export async function completeMinicapIfDone(tx: DbOrTx, eventId: string): Promise<CompletedEvent | null> {
  const [row] = await tx.update(events).set({ status: 'completed' })
    .where(and(
      eq(events.id, eventId),
      isNull(events.checkId),
      eq(events.format, 'minicap'),
      eq(events.status, 'active'),
      sql`NOT EXISTS (SELECT 1 FROM checks oc WHERE oc.linked_event_id = ${eventId} AND oc.status = 'open')`,
      sql`EXISTS (SELECT 1 FROM checks cc WHERE cc.linked_event_id = ${eventId} AND cc.status = 'closed')`,
    ))
    .returning({ id: events.id, title: events.title })
  return row ?? null
}

/**
 * Авто-завершение мероприятия после ЗАКРЫТИЯ чека (вызывать после смены статуса
 * чека на closed в той же транзакции). Основной чек события (events.check_id) →
 * событие «Завершено»; чек участника миникапа → миникап завершается, когда закрыт
 * последний открытый чек участника. Доп. чеки с той же привязкой событие не трогают.
 * Возвращает завершённое событие (для уведомления после коммита) или null.
 */
export async function completeLinkedEvent(
  tx: DbOrTx,
  check: { id: string; linkedEventId: string | null },
): Promise<CompletedEvent | null> {
  if (!check.linkedEventId) return null
  const [main] = await tx.update(events).set({ status: 'completed' })
    .where(and(eq(events.id, check.linkedEventId), eq(events.checkId, check.id), ne(events.status, 'cancelled')))
    .returning({ id: events.id, title: events.title })
  if (main) return main
  return completeMinicapIfDone(tx, check.linkedEventId)
}

/**
 * Отмена чеков мероприятия: открытые чеки (миникап — все чеки участников, иначе —
 * основной чек события) → cancelled, списанное по ним возвращается на склад (как
 * DELETE /pos/checks/:id); расходы события (приз/обед/иные миникапа) удаляются, чтобы
 * не оставаться в опексе аналитики. Статус самого события здесь НЕ меняется.
 * Возвращает id отменённых чеков (для realtime-событий кассы после коммита).
 */
export async function cancelEventChecksTx(
  tx: Tx,
  ev: { id: string; format: string | null; checkId: string | null },
  userId: string,
  reason = 'Отмена мероприятия',
): Promise<string[]> {
  let cancelled: { id: string }[] = []
  if (ev.format === 'minicap') {
    const parts = await tx.select({ checkId: eventParticipants.checkId }).from(eventParticipants)
      .where(eq(eventParticipants.eventId, ev.id))
    const ids = parts.map((p) => p.checkId).filter((id): id is string => !!id)
    if (ids.length) {
      cancelled = await tx.update(checks).set({ status: 'cancelled' })
        .where(and(inArray(checks.id, ids), eq(checks.status, 'open'))).returning({ id: checks.id })
    }
  } else if (ev.checkId) {
    cancelled = await tx.update(checks).set({ status: 'cancelled' })
      .where(and(eq(checks.id, ev.checkId), eq(checks.status, 'open'))).returning({ id: checks.id })
  }
  for (const ch of cancelled) await reverseCheckMovements(tx, ch.id, reason, userId)
  await tx.delete(expenses).where(eq(expenses.eventId, ev.id))
  return cancelled.map((ch) => ch.id)
}

/**
 * Полная отмена мероприятия по id (мягкий DELETE /events/:id, отмена брони):
 * строка события под FOR UPDATE, отмена чеков (cancelEventChecksTx), статус
 * cancelled и attendeesCount = число привязанных чеков (как PATCH status=cancelled).
 * null — события нет.
 */
export async function cancelEventTx(
  tx: Tx,
  eventId: string,
  userId: string,
): Promise<{ event: typeof events.$inferSelect; cancelledCheckIds: string[] } | null> {
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for('update')
  if (!ev) return null
  const cancelledCheckIds = await cancelEventChecksTx(tx, ev, userId)
  const [{ cnt }] = await tx.select({ cnt: sql<number>`count(*)::int` }).from(checks).where(eq(checks.linkedEventId, eventId))
  const [updated] = await tx.update(events).set({ status: 'cancelled', attendeesCount: cnt })
    .where(eq(events.id, eventId)).returning()
  return { event: updated ?? ev, cancelledCheckIds }
}
