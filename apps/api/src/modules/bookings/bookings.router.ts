/**
 * Заявки онлайн-записи в HUB («Мероприятия → Заявки»). Принимает их сайт клуба
 * (requests/intake.router.ts); здесь — список и решение персонала. Подтверждение
 * заявки-мероприятия создаёт planned-мероприятие (titan/exit, кабинка, плановые
 * часы) и пишет event_id; итог уходит в чат персонала и гостю (requests/notify.ts).
 *
 * Таблица bookings — raw SQL; мероприятия/справочники — drizzle.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, events, profiles, eq, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { notifyRequestStatus } from '../requests/notify.js'
import { findOverlappingEvent, lockEventBooking } from '../events/events.router.js'
import { cancelEventTx } from '../events/eventLifecycle.js'
import { publishEvent } from '../../lib/realtime.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}
function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h! * 60 + m!) + Math.round(hours * 60)
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
// timestamptz → дата/время в МСК.
function mskParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) }
}

// Дата/время/зона/часы, которые видит гость: после подтверждения бронь живёт как
// мероприятие, и персонал может его перенести (время, зона) — показываем актуальное
// из events, а не исходную заявку. ev/es/s — алиасы events/spaces в запросах ниже.
const guestStartsAt = sql`CASE WHEN ev.id IS NOT NULL THEN ((ev.date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Europe/Moscow') ELSE b.starts_at END`
const guestZoneName = sql`CASE WHEN ev.id IS NOT NULL THEN es.name ELSE s.name END`
const guestHours = sql`COALESCE(ev.planned_hours, b.tariff_hours)`

// ─── Внутренний роутер (авторизация) ─────────────────────────────────────────
export const bookingsRouter = new Hono<AppEnv>()
bookingsRouter.use('*', requireAuth)

bookingsRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const status = c.req.query('status')
  const res = await db.execute(sql`
    SELECT b.id, b.space_id, s.name AS zone_name, b.name, b.phone, b.guests, b.title,
           b.starts_at, b.duration_hours, b.tariff_hours, b.location, b.address,
           b.comment, b.status, b.source, b.kind, b.meta, b.event_id, b.created_at,
           (b.guest_tg_chat IS NOT NULL) AS guest_follows
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    ${status ? sql`WHERE b.status = ${status}` : sql``}
    ORDER BY b.starts_at DESC
    LIMIT 300
  `)
  return c.json({ bookings: rows(res) })
})

// «Старые брони» — брони пространств штаба, чьё мероприятие уже завершено (чек
// закрыт → событие completed). Для одноимённого раздела в «Мероприятиях».
bookingsRouter.get('/archive', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  // Дата/время/зона/часы — фактические, из мероприятия (персонал мог его перенести).
  const res = await db.execute(sql`
    SELECT b.id, COALESCE(ev.space_id, b.space_id) AS space_id, ${guestZoneName} AS zone_name, b.name, b.phone, b.guests, b.title,
           ${guestStartsAt} AS starts_at, ${guestHours} AS tariff_hours, b.location, b.address, b.comment, b.status,
           b.event_id, ev.status AS event_status, ch.total_amount AS check_total
    FROM bookings b
    JOIN events ev ON ev.id = b.event_id
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN spaces es ON es.id = ev.space_id
    LEFT JOIN checks ch ON ch.id = ev.check_id
    WHERE b.space_id IS NOT NULL AND b.location = 'titan' AND ev.status = 'completed'
    ORDER BY starts_at DESC -- выходной столбец (актуальное время мероприятия)
    LIMIT 200
  `)
  return c.json({ bookings: rows(res) })
})

const PatchSchema = z.object({ status: z.enum(['new', 'confirmed', 'cancelled', 'done']) })

export type DecideResult =
  | { kind: 'not_found' }
  | { kind: 'conflict'; event: typeof events.$inferSelect }
  | { kind: 'refused'; error: string }
  | { kind: 'ok'; eventId: string | null; cancelledCheckIds: string[] }

/**
 * Решение по заявке: подтвердить (заявка-мероприятие создаёт planned-мероприятие) или
 * отклонить (с отменой созданного мероприятия). actorId — кто решил (создатель события);
 * его же зовёт Tai, когда сам подтверждает заявку гостя (requests/tai-desk.ts).
 */
export async function decideBooking(db: Database, id: string, status: 'new' | 'confirmed' | 'cancelled' | 'done', actorId: string): Promise<DecideResult> {
  // Подтверждение — в ОДНОЙ транзакции: строка брони под FOR UPDATE (два параллельных
  // подтверждения не создадут два мероприятия — второе увидит event_id первого), а
  // проверка пересечения и вставка события — под тем же advisory-lock (зона, дата),
  // что и POST /events, иначе бронь с сайта могла занять уже занятую зону.
  return db.transaction<DecideResult>(async (tx) => {
    const res = await tx.execute(sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1 FOR UPDATE`)
    const bk = rows<Record<string, unknown>>(res)[0]
    if (!bk) return { kind: 'not_found' }

    // Подтверждается только новая заявка: отменённую гостем (или персоналом) бронь
    // подтверждение воскрешало бы — с мероприятием на уже освобождённое время.
    if (status === 'confirmed' && bk['status'] !== 'new') {
      return { kind: 'refused', error: bk['status'] === 'cancelled' ? 'Бронь уже отменена — подтвердить её нельзя' : 'Бронь уже обработана' }
    }

    let eventId = (bk['event_id'] as string | null) ?? null

    // Отмена брони, по которой уже создано мероприятие: отменяем и его (та же логика,
    // что отмена мероприятия — чеки, склад, расходы), иначе гостю «Отменена», а в
    // календаре клуба мероприятие живёт дальше. Идущее/завершённое — не трогаем.
    let cancelledCheckIds: string[] = []
    if (status === 'cancelled' && eventId) {
      const [ev] = await tx.select({ status: events.status }).from(events).where(eq(events.id, eventId)).for('update')
      if (ev?.status === 'active') return { kind: 'refused', error: 'Мероприятие уже идёт — сначала завершите или отмените его' }
      if (ev?.status === 'completed') return { kind: 'refused', error: 'Мероприятие по этой брони уже завершено' }
      if (ev && ev.status !== 'cancelled') {
        cancelledCheckIds = (await cancelEventTx(tx, eventId, actorId))?.cancelledCheckIds ?? []
      }
    }
    // Мероприятие создаёт только заявка-мероприятие. Запись на игровой вечер и
    // обращение с сайта (kind game/message) подтверждаются как «приняты» — без события.
    const createsEvent = (bk['kind'] ?? 'event') === 'event'
    if (status === 'confirmed' && !eventId && createsEvent) {
      const { date, time } = mskParts(bk['starts_at'] as string)
      const hours = bk['tariff_hours'] != null ? Number(bk['tariff_hours']) : (bk['duration_hours'] != null ? Number(bk['duration_hours']) : 0)
      const endTime = hours > 0 ? addHours(time, hours) : null
      const isExit = bk['location'] === 'exit'
      const spaceId = (bk['space_id'] as string | null) ?? null
      if (!isExit && spaceId) {
        // Те же блокировки, что у POST /events: дата брони и, если она за полночь, следующая.
        await lockEventBooking(tx, { spaceId, date, startTime: time, endTime, plannedHours: hours > 0 ? hours : null })
        const overlap = await findOverlappingEvent(tx, {
          type: 'titan', spaceId, date, startTime: time, endTime, plannedHours: hours > 0 ? hours : null,
        })
        if (overlap) return { kind: 'conflict', event: overlap }
      }
      const [ev] = await tx.insert(events).values({
        type: isExit ? 'exit' : 'titan',
        title: (bk['title'] as string | null) || `Бронь: ${String(bk['name'])}`,
        location: isExit ? ((bk['address'] as string | null) ?? null) : 'TITAN',
        spaceId,
        date,
        startTime: time,
        endTime,
        paymentType: 'fixed',
        // Кабинка в клубе: виджет обещает гостю «ставка зоны × часы, итог по факту» —
        // значит, чек по ставке зоны живым счётчиком. Выезд — пакет мероприятия по часам.
        billingMode: !isExit && spaceId ? 'rental' : 'hourly',
        plannedHours: hours > 0 ? hours : null,
        status: 'planned',
        customerName: String(bk['name']),
        customerPhone: String(bk['phone']),
        comment: (bk['comment'] as string | null) ?? null,
        format: 'regular',
        createdBy: actorId,
      }).returning()
      eventId = ev?.id ?? null
    }

    await tx.execute(sql`UPDATE bookings SET status = ${status}, event_id = ${eventId}, updated_at = now() WHERE id = ${id}`)
    return { kind: 'ok', eventId, cancelledCheckIds }
  })
}

bookingsRouter.patch('/:id', requireRole('owner', 'staff'), zValidator('json', PatchSchema), async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  const { status } = c.req.valid('json')
  const user = c.get('user')
  const result = await decideBooking(db, id, status, user.sub)

  if (result.kind === 'not_found') return c.json({ error: 'not found' }, 404)
  if (result.kind === 'refused') return c.json({ error: result.error }, 409)
  if (result.kind === 'conflict') {
    const cf = result.event
    return c.json({
      error: 'На это время зона уже занята другим мероприятием — измените время брони или зону',
      conflict: { id: cf.id, title: cf.title, startTime: cf.startTime, endTime: cf.endTime },
    }, 409)
  }
  for (const checkId of result.cancelledCheckIds) publishEvent(c.var.club?.id, 'check:deleted', { checkId })
  if (status === 'confirmed' || status === 'cancelled') {
    const [actor] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, user.sub)).limit(1)
    const host = (c.req.header('host') ?? '').split(':')[0]
    void notifyRequestStatus(db, id, status, actor?.nickname ?? 'администратор', host ? `https://${host}` : null)
  }
  const eventId = result.eventId
  return c.json({ ok: true, status, eventId })
})
