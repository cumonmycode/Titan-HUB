import { sql, type Database } from '@titan/database'
import { loadRequest, remindGuest } from '../modules/requests/notify.js'

// ─────────────────────────────────────────────────────────────────────────────
// Напоминание гостю в день визита через клиентского бота клуба. Тик раз в минуту
// (index.ts) по всем клубам: подтверждённые заявки с привязанным Telegram гостя,
// которые начинаются сегодня (МСК) не раньше чем через 30 минут. Шлём с 10:00 МСК
// (или сразу, если заявку подтвердили позже). reminded_at ставим и при сбое
// Telegram (гость заблокировал бота) — иначе крон повторял бы попытку каждую минуту.
// ─────────────────────────────────────────────────────────────────────────────

const REMIND_FROM_HOUR_MSK = 10
const MIN_LEAD_MINUTES = 30

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const running = new WeakSet<Database>()

export async function remindRequestGuestsForDb(db: Database): Promise<void> {
  const mskHour = new Date(Date.now() + 3 * 3600_000).getUTCHours()
  if (mskHour < REMIND_FROM_HOUR_MSK || running.has(db)) return
  running.add(db)
  try {
    const due = await db.execute(sql`
      SELECT b.id FROM bookings b
      LEFT JOIN events ev ON ev.id = b.event_id
      WHERE b.status = 'confirmed' AND b.guest_tg_chat IS NOT NULL AND b.reminded_at IS NULL
        AND (ev.id IS NULL OR ev.status IN ('planned', 'active', 'needs_clarification'))
        AND (CASE WHEN ev.id IS NOT NULL THEN ((ev.date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Europe/Moscow') ELSE b.starts_at END)
            BETWEEN now() + make_interval(mins => ${MIN_LEAD_MINUTES}::int)
                AND date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' + interval '1 day'
      LIMIT 50
    `)
    for (const { id } of rows<{ id: string }>(due)) {
      const r = await loadRequest(db, id)
      if (r) await remindGuest(db, r)
      await db.execute(sql`UPDATE bookings SET reminded_at = now() WHERE id = ${id}`)
    }
  } finally {
    running.delete(db)
  }
}
