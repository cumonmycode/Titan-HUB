/**
 * Раздел HUB «Заявки» — все новые люди, которые ещё не стали клиентами:
 *   • записи на игру и обращения (bookings kind game/message: сайт, Tai, вручную) —
 *     карточка в bookings/bookingDetails.ts; заявки на мероприятия (kind event:
 *     корпоративы, дни рождения, сертификаты) остаются в «Событиях» — там их подтверждают;
 *   • регистрации из My Titan, ждущие подтверждения (profiles.registration_status = pending);
 *   • новые из Telegram — писали Tai, но в базе клуба их нет (tai_contacts без profile_id).
 * Новичка из Telegram можно сразу завести клиентом (в т.ч. из нового чека на кассе).
 * Монтируется как /api/leads.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, sql, taiContacts, eq, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { REGISTRATION_PENDING } from '../../lib/registration.js'
import { publishEvent } from '../../lib/realtime.js'

const TG_ID_RE = /^\d{3,20}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Новыми считаем тех, кто писал Tai за последние N дней. */
const NEWCOMER_DAYS = 60
const NEWCOMER_LIMIT = 100
const NICKNAME_TRIES = 20
const DEFAULT_TIER = 'newbie'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

export const leadsRouter = new Hono<AppEnv>()
leadsRouter.use('*', requireAuth, requireRole('owner', 'staff'))

/** Сколько ждёт в каждом списке — для строки раздела в «Управлении». */
leadsRouter.get('/summary', async (c) => {
  const res = await c.var.db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM bookings WHERE status = 'new' AND kind IN ('game', 'message')) AS requests,
      (SELECT count(*)::int FROM profiles WHERE registration_status = ${REGISTRATION_PENDING} AND deleted_at IS NULL) AS registrations,
      (SELECT count(*)::int FROM tai_contacts c
        WHERE c.profile_id IS NULL AND c.last_inbound_at > now() - make_interval(days => ${NEWCOMER_DAYS})
          AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.tg_id = c.tg_id AND p.deleted_at IS NULL)) AS newcomers
  `)
  const r = rows<{ requests: number; registrations: number; newcomers: number }>(res)[0]
  return c.json({ requests: r?.requests ?? 0, registrations: r?.registrations ?? 0, newcomers: r?.newcomers ?? 0 })
})

export interface Newcomer {
  tgId: string
  name: string
  username: string | null
  lastMessage: string | null
  lastAt: string | null
  messages: number
  needsAttention: boolean
}

/** Писали Tai, но в базе клуба их нет. q — поиск по имени или @нику (для кассы). */
async function listNewcomers(db: Database, q: string | null): Promise<Newcomer[]> {
  const like = q ? `%${q.replace(/^@/, '').replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null
  const res = await db.execute(sql`
    SELECT c.tg_id, c.first_name, c.username, c.needs_attention, c.last_inbound_at,
           lm.content AS last_message,
           (SELECT count(*)::int FROM tai_messages m WHERE m.chat_id = c.tg_id) AS messages
    FROM tai_contacts c
    LEFT JOIN LATERAL (
      SELECT m.content FROM tai_messages m WHERE m.chat_id = c.tg_id AND m.role = 'user' ORDER BY m.id DESC LIMIT 1
    ) lm ON true
    WHERE c.profile_id IS NULL
      AND c.last_inbound_at > now() - make_interval(days => ${NEWCOMER_DAYS})
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.tg_id = c.tg_id AND p.deleted_at IS NULL)
      ${like ? sql`AND (c.first_name ILIKE ${like} OR c.username ILIKE ${like})` : sql``}
    ORDER BY c.needs_attention DESC, c.last_inbound_at DESC
    LIMIT ${NEWCOMER_LIMIT}
  `)
  return rows<Record<string, unknown>>(res).map((r) => ({
    tgId: String(r['tg_id']),
    name: (r['first_name'] as string | null) ?? (r['username'] ? `@${String(r['username'])}` : 'Гость из Telegram'),
    username: (r['username'] as string | null) ?? null,
    lastMessage: (r['last_message'] as string | null) ?? null,
    lastAt: iso(r['last_inbound_at']),
    messages: Number(r['messages'] ?? 0),
    needsAttention: !!r['needs_attention'],
  }))
}

leadsRouter.get('/newcomers', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 64) || null
  return c.json({ items: await listNewcomers(c.var.db, q) })
})

/** Свободный ник: «Анна», занят — «Анна (@anna)», дальше «Анна 2», «Анна 3»… */
async function freeNickname(db: Database, base: string, username: string | null): Promise<string> {
  const candidates = [base, ...(username ? [`${base} (@${username})`] : []), ...Array.from({ length: NICKNAME_TRIES }, (_, i) => `${base} ${i + 2}`)]
  for (const nick of candidates) {
    const res = await db.execute(sql`SELECT 1 FROM profiles WHERE lower(nickname) = lower(${nick}) LIMIT 1`)
    if (!rows(res).length) return nick
  }
  return `${base} ${Date.now().toString(36)}`
}

const ClientSchema = z.object({
  nickname: z.string().trim().min(2).max(60).optional(),
  clientTier: z.string().trim().min(1).max(40).optional(),
})

// Новичок из Telegram → клиент клуба (Telegram привязан, Tai узнаёт его в личке).
leadsRouter.post('/newcomers/:tgId/client', zValidator('json', ClientSchema), async (c) => {
  const db = c.var.db
  const tgId = c.req.param('tgId')
  if (!TG_ID_RE.test(tgId)) return c.json({ error: 'Bad id' }, 400)
  const body = c.req.valid('json')
  const [contact] = await db.select().from(taiContacts).where(eq(taiContacts.tgId, tgId)).limit(1)
  if (!contact) return c.json({ error: 'Этот человек не писал боту клуба' }, 404)

  const user = c.get('user')
  const [creator] = await db.select({ nickname: profiles.nickname }).from(profiles).where(eq(profiles.id, user.sub)).limit(1)
  // Telegram уже за кем-то закреплён (уникален) — берём этот профиль, второй не плодим.
  const [holder] = await db.select().from(profiles).where(eq(profiles.tgId, tgId)).limit(1)
  let profile = holder && !holder.deletedAt ? holder : null
  if (!profile) {
    const base = (body.nickname ?? contact.firstName ?? contact.username ?? 'Гость').trim().slice(0, 60) || 'Гость'
    const nickname = body.nickname ? base : await freeNickname(db, base, contact.username)
    try {
      const [created] = await db.insert(profiles).values({
        nickname,
        fullName: contact.firstName ?? null,
        role: 'client',
        clientTier: body.clientTier ?? DEFAULT_TIER,
        // Архивный профиль держит этот Telegram — тогда без привязки (tg_id уникален).
        tgId: holder ? null : tgId,
        tgUsername: holder ? null : contact.username,
        signupSource: 'telegram',
        signupMeta: { by: user.sub, byName: creator?.nickname ?? null },
      }).returning()
      profile = created ?? null
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return c.json({ error: `Ник «${nickname}» уже занят — выберите другой` }, 409)
      throw error
    }
  }
  if (!profile) return c.json({ error: 'Клиент не создан' }, 500)
  await db.update(taiContacts).set({ profileId: profile.id, updatedAt: new Date() }).where(eq(taiContacts.tgId, tgId))
  publishEvent(c.var.club?.id, 'tai-inbox:updated', { tgId })
  return c.json({
    client: {
      id: profile.id, nickname: profile.nickname, role: profile.role, clientTier: profile.clientTier,
      balance: profile.balance, bonusPoints: profile.bonusPoints, photoUrl: profile.photoUrl ?? profile.tgPhotoUrl ?? null,
    },
    existing: !!(holder && !holder.deletedAt),
  }, 201)
})

/** Откуда регистрация: устройство из запроса входа My Titan и сам профиль. */
interface RegistrationRow {
  id: string
  nickname: string
  full_name: string | null
  phone: string | null
  birthday: string | null
  photo_url: string | null
  tg_id: string | null
  tg_username: string | null
  created_at: string
  signup_meta: Record<string, unknown> | null
  registration_status: string | null
  deleted_at: string | null
  platform: string | null
  device_name: string | null
  chat_tg_id: string | null
  chat_messages: number | null
  chat_paused: boolean | null
  chat_attention: boolean | null
}

const registrationSelect = sql`
  SELECT p.id, p.nickname, p.full_name, p.phone, p.birthday, p.photo_url, p.tg_id, p.tg_username, p.created_at,
         p.signup_meta, p.registration_status, p.deleted_at,
         w.platform, w.device_name,
         tc.tg_id AS chat_tg_id, tc.ai_paused AS chat_paused, tc.needs_attention AS chat_attention,
         (SELECT count(*)::int FROM tai_messages m WHERE m.chat_id = tc.tg_id) AS chat_messages
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT platform, device_name FROM wallet_login_codes
    WHERE profile_id = p.id AND mode = 'register' ORDER BY created_at DESC LIMIT 1
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT tg_id, ai_paused, needs_attention FROM tai_contacts
    WHERE profile_id = p.id OR (p.tg_id IS NOT NULL AND tg_id = p.tg_id)
    ORDER BY last_inbound_at DESC NULLS LAST LIMIT 1
  ) tc ON true
`

function registrationOf(r: RegistrationRow) {
  const meta = r.signup_meta ?? {}
  return {
    id: r.id,
    nickname: r.nickname,
    fullName: r.full_name,
    phone: r.phone,
    birthday: r.birthday,
    photoUrl: r.photo_url,
    tgUsername: r.tg_username,
    createdAt: iso(r.created_at),
    status: r.deleted_at ? 'rejected' : r.registration_status,
    platform: r.platform ?? (typeof meta['platform'] === 'string' ? meta['platform'] : null),
    device: r.device_name ?? (typeof meta['device'] === 'string' ? meta['device'] : null),
    chat: r.chat_tg_id
      ? { tgId: r.chat_tg_id, messages: Number(r.chat_messages ?? 0), aiPaused: !!r.chat_paused, needsAttention: !!r.chat_attention }
      : null,
  }
}

leadsRouter.get('/registrations', async (c) => {
  const res = await c.var.db.execute(sql`
    ${registrationSelect}
    WHERE p.registration_status = ${REGISTRATION_PENDING} AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `)
  return c.json({ items: rows<RegistrationRow>(res).map(registrationOf) })
})

// Карточка регистрации: откуда, когда, что заполнил, переписка с Tai и заявки с этого номера.
leadsRouter.get('/registrations/:id', async (c) => {
  const db = c.var.db
  const id = c.req.param('id')
  if (!UUID_RE.test(id)) return c.json({ error: 'Bad id' }, 400)
  const res = await db.execute(sql`${registrationSelect} WHERE p.id = ${id} LIMIT 1`)
  const row = rows<RegistrationRow>(res)[0]
  if (!row) return c.json({ error: 'Регистрация не найдена' }, 404)
  const tail = (row.phone ?? '').replace(/\D/g, '').slice(-10)
  const requests = tail.length === 10
    ? rows<Record<string, unknown>>(await db.execute(sql`
        SELECT id, title, kind, status, source, starts_at, created_at FROM bookings
        WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${tail}
        ORDER BY created_at DESC LIMIT 10
      `)).map((b) => ({
        id: String(b['id']), title: (b['title'] as string | null) ?? null, kind: String(b['kind']), status: String(b['status']),
        source: String(b['source']), startsAt: iso(b['starts_at']), createdAt: iso(b['created_at']),
      }))
    : []
  return c.json({ registration: registrationOf(row), requests })
})
