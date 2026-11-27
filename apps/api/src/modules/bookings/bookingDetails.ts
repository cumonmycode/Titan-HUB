/**
 * Карточка заявки в HUB: откуда пришла (сайт, Tai в Telegram, виджет, вручную — и
 * каким каналом), кто её создал и кто решил, журнал действий, найденный клиент клуба
 * и диалог гостя с Tai. Плюс ручное создание заявки (звонок, Instagram, пришёл сам)
 * и заметка персонала. Подключается к bookingsRouter (registerBookingDetailRoutes).
 */
import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireRole } from '../../middleware/auth.js'
import { notify } from '../notifications/push.js'
import { startError } from './publicGuards.js'

type Exec = Pick<Database, 'execute'>

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTE_MAX = 1_000
const LOG_LIMIT = 50

/** Как заявка попала в HUB, если её создали вручную. */
export const MANUAL_CHANNELS = {
  phone: 'Звонок',
  walk_in: 'Пришёл в клуб',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram (вручную)',
  vk: 'ВКонтакте',
  other: 'Другое',
} as const
type ManualChannel = keyof typeof MANUAL_CHANNELS

export interface BookingSource {
  key: 'site' | 'tai' | 'widget' | 'manual' | 'other'
  label: string
  detail: string | null
}

/** Источник заявки по bookings.source и meta. */
export function bookingSource(source: string | null, meta: Record<string, unknown> | null, createdByName: string | null): BookingSource {
  const m = meta ?? {}
  switch (source) {
    case 'site':
      return { key: 'site', label: 'Сайт клуба', detail: typeof m['page'] === 'string' && m['page'] ? `Страница ${m['page']}` : 'Форма записи' }
    case 'tai':
      return { key: 'tai', label: 'Telegram · Tai', detail: typeof m['telegram'] === 'string' && m['telegram'] ? `Записался через бота, ${m['telegram']}` : 'Записался в личке бота' }
    case 'widget':
      return { key: 'widget', label: 'Виджет брони', detail: 'Старая форма /book' }
    case 'manual': {
      const channel = typeof m['channel'] === 'string' ? MANUAL_CHANNELS[m['channel'] as ManualChannel] ?? null : null
      return { key: 'manual', label: 'Вручную в HUB', detail: [channel, createdByName ? `создал ${createdByName}` : null].filter(Boolean).join(' · ') || null }
    }
    default:
      return { key: 'other', label: source || 'Неизвестно', detail: null }
  }
}

/** Запись в журнал заявки. actorName — подпись (например, «Tai»), иначе ник сотрудника. */
export async function logBooking(exec: Exec, bookingId: string, action: string, actorId: string | null, note: string | null, actorName?: string): Promise<void> {
  const name = actorName ? sql`${actorName}` : actorId ? sql`(SELECT nickname FROM profiles WHERE id = ${actorId})` : sql`NULL`
  await exec.execute(sql`
    INSERT INTO booking_log (booking_id, action, actor_id, actor_name, note)
    VALUES (${bookingId}, ${action}, ${actorId}, ${name}, ${note})
  `)
}

const phoneTail = (raw: string | null | undefined): string => (raw ?? '').replace(/\D/g, '').slice(-10)

/** Клиент клуба по заявке: явный профиль (Tai), Telegram гостя или телефон. */
async function linkedClient(db: Database, b: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const meta = (b['meta'] as Record<string, unknown> | null) ?? {}
  const profileId = typeof meta['profileId'] === 'string' && UUID_RE.test(meta['profileId']) ? meta['profileId'] : null
  const tgId = (b['guest_tg_id'] as string | null) ?? (typeof meta['tgId'] === 'string' ? meta['tgId'] : null)
  const tail = phoneTail(b['phone'] as string | null)
  const byProfile = profileId ? sql`id = ${profileId}` : sql`false`
  const res = await db.execute(sql`
    SELECT id, nickname, full_name, client_tier, phone, COALESCE(photo_url, tg_photo_url, gomafia_photo_url) AS photo_url, created_at
    FROM profiles
    WHERE deleted_at IS NULL AND role = 'client' AND (
      ${byProfile}
      OR ${tgId ? sql`tg_id = ${tgId}` : sql`false`}
      OR ${tail.length === 10 ? sql`right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${tail}` : sql`false`}
    )
    ORDER BY ${profileId ? sql`(id = ${profileId}) DESC,` : sql``} created_at
    LIMIT 1
  `)
  return rows(res)[0] ?? null
}

/** Сколько ещё заявок было с этого телефона — постоянный ли это гость. */
async function previousRequests(db: Database, id: string, phone: string | null): Promise<number> {
  const tail = phoneTail(phone)
  if (tail.length < 10) return 0
  const res = await db.execute(sql`
    SELECT count(*)::int AS n FROM bookings
    WHERE id <> ${id} AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${tail}
  `)
  return Number(rows<{ n: number }>(res)[0]?.n ?? 0)
}

async function bookingDetail(db: Database, id: string) {
  const res = await db.execute(sql`
    SELECT b.*, s.name AS zone_name, cb.nickname AS created_by_name, dp.nickname AS decided_by_name,
           ev.title AS event_title, ev.status AS event_status, ev.date AS event_date, ev.start_time AS event_start
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN profiles cb ON cb.id = b.created_by
    LEFT JOIN profiles dp ON dp.id = b.decided_by
    LEFT JOIN events ev ON ev.id = b.event_id
    WHERE b.id = ${id}
    LIMIT 1
  `)
  const b = rows<Record<string, unknown>>(res)[0]
  if (!b) return null
  const meta = (b['meta'] as Record<string, unknown> | null) ?? null
  const tgId = (b['guest_tg_id'] as string | null) ?? (typeof meta?.['tgId'] === 'string' ? (meta['tgId'] as string) : null)
  const [client, previous, logRes, chatRes] = await Promise.all([
    linkedClient(db, b),
    previousRequests(db, id, b['phone'] as string | null),
    db.execute(sql`
      SELECT id, action, actor_name, note, created_at FROM booking_log
      WHERE booking_id = ${id} ORDER BY created_at, id LIMIT ${LOG_LIMIT}
    `),
    tgId
      ? db.execute(sql`
          SELECT c.tg_id, c.ai_paused, c.needs_attention, c.dm_open,
                 (SELECT count(*)::int FROM tai_messages m WHERE m.chat_id = c.tg_id) AS messages
          FROM tai_contacts c WHERE c.tg_id = ${tgId} LIMIT 1
        `)
      : Promise.resolve(null),
  ])
  const chat = chatRes ? rows<Record<string, unknown>>(chatRes)[0] ?? null : null
  const source = bookingSource(b['source'] as string | null, meta, (b['created_by_name'] as string | null) ?? null)
  // Первая строка журнала — сама заявка (создание не пишется в booking_log).
  const created = { id: 0, action: 'created', actor_name: (b['created_by_name'] as string | null) ?? null, note: source.label, created_at: b['created_at'] }
  const { claim_token: _token, staff_tg_chat: _chat, staff_tg_message_id: _msg, ...safe } = b
  return {
    booking: safe,
    source,
    client,
    previousRequests: previous,
    guestChat: chat
      ? { tgId: String(chat['tg_id']), aiPaused: !!chat['ai_paused'], needsAttention: !!chat['needs_attention'], dmOpen: chat['dm_open'] !== false, messages: Number(chat['messages'] ?? 0) }
      : null,
    log: [created, ...rows(logRes)],
  }
}

const ManualSchema = z.object({
  kind: z.enum(['event', 'game', 'message']),
  channel: z.enum(Object.keys(MANUAL_CHANNELS) as [ManualChannel, ...ManualChannel[]]),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
  title: z.string().trim().max(160).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  guests: z.number().int().min(1).max(500).optional(),
  location: z.enum(['titan', 'exit']).optional(),
  address: z.string().trim().max(300).optional(),
  comment: z.string().trim().max(1_500).optional(),
})

const DEFAULT_TITLE = { event: 'Мероприятие', game: 'Запись на игру', message: 'Обращение' } as const

export function registerBookingDetailRoutes(router: Hono<AppEnv>): void {
  router.get('/:id', requireRole('owner', 'staff'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Bad id' }, 400)
    const detail = await bookingDetail(c.var.db, id)
    if (!detail) return c.json({ error: 'Заявка не найдена' }, 404)
    return c.json(detail)
  })

  // Заявка, принятая по телефону, в директе или лично, — в тот же список, что и с сайта.
  router.post('/', requireRole('owner', 'staff'), zValidator('json', ManualSchema), async (c) => {
    const db = c.var.db
    const r = c.req.valid('json')
    const user = c.get('user')
    if (r.kind !== 'message' && (!r.date || !r.time)) return c.json({ error: 'Укажите дату и время' }, 400)
    if (r.date && r.time) {
      const bad = startError(r.date, r.time)
      if (bad) return c.json({ error: bad }, 400)
    }
    const startsAt = r.date && r.time ? sql`${`${r.date}T${r.time}:00+03:00`}::timestamptz` : sql`now()`
    const location = r.kind === 'event' ? (r.location ?? 'titan') : 'titan'
    const title = r.title || DEFAULT_TITLE[r.kind]
    const meta = { source: 'manual', channel: r.channel }
    const res = await db.execute(sql`
      INSERT INTO bookings (name, phone, guests, starts_at, comment, status, source, location, address, title, kind, meta, created_by)
      VALUES (${r.name}, ${r.phone ?? ''}, ${r.guests ?? null}, ${startsAt}, ${r.comment || null}, 'new', 'manual', ${location},
              ${location === 'exit' ? (r.address || null) : null}, ${title}, ${r.kind}, ${JSON.stringify(meta)}::jsonb, ${user.sub})
      RETURNING id
    `)
    const id = rows<{ id: string }>(res)[0]?.id
    if (!id) return c.json({ error: 'Заявка не сохранилась' }, 500)
    void notify({
      type: 'site_request',
      title: `📝 Заявка: ${MANUAL_CHANNELS[r.channel]}`,
      body: `${title} · ${r.name}`,
      meta: { url: '/events' },
    }, db, c.var.club?.id ?? null).catch(() => {})
    return c.json({ ok: true, id }, 201)
  })

  router.patch('/:id/note', requireRole('owner', 'staff'), zValidator('json', z.object({ note: z.string().trim().max(NOTE_MAX) })), async (c) => {
    const db = c.var.db
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Bad id' }, 400)
    const { note } = c.req.valid('json')
    const res = await db.execute(sql`UPDATE bookings SET staff_note = ${note || null}, updated_at = now() WHERE id = ${id} RETURNING id`)
    if (!rows(res).length) return c.json({ error: 'Заявка не найдена' }, 404)
    await logBooking(db, id, 'note', c.get('user').sub, note || 'Заметка удалена')
    return c.json({ ok: true })
  })
}
