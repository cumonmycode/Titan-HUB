/**
 * Публичный API сайта клуба (titanmafia.ru): витрина и приём заявок.
 *
 * nginx сайта проксирует /api/site/* в API с Host клубного поддомена, поэтому
 * c.var.db / c.var.club — клуб сайта. Монтируется ДО requireActiveSubscription,
 * как /api/bookings/public: гость без авторизации.
 *
 *  GET  /config   — заведение, часы, цены вечера (тарифы «на экране ТВ»),
 *                   почасовые тарифы мероприятий и зоны — всё живое из HUB;
 *  GET  /players  — резиденты клуба на GoMafia по ELO (кэш 30 мин);
 *  POST /requests — заявка с сайта → bookings (kind) → «Заявки с сайта» в HUB
 *                   и push владельцам. Мероприятие создаётся при подтверждении.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  sql, appSettings, tariffs, inventory, spaces, eventHourlyRates, certificates, customers,
  eq, and, asc, inArray, type Database,
} from '@titan/database'
import type { AppEnv } from '../../types.js'
import { clientIp } from '../../lib/clientIp.js'
import { getClubIntegration } from '../../lib/secrets.js'
import { clubResidents, type GomafiaPlayer } from '../../lib/gomafia.js'
import { notifyOwners, publicRateLimited, startError } from '../bookings/publicGuards.js'
import { findPublished, listPublished, publicStory } from './stories.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const CREATE_MAX_PER_WINDOW = parseInt(process.env['SITE_REQUEST_LIMIT'] ?? '6')
const CREATE_WINDOW_SECONDS = 600
const CONFIG_MAX_AGE_SECONDS = 60
const PLAYERS_MAX_AGE_SECONDS = 600
const PLAYERS_TTL_MS = 30 * 60 * 1000
const PLAYERS_MAX_PAGES = 12
const PLAYERS_TOP = 30

export const siteRouter = new Hono<AppEnv>()

// ─── Витрина ─────────────────────────────────────────────────────────────────
const VENUE_KEYS = ['venue_name', 'venue_address', 'hours_open', 'hours_close', 'site_schedule', 'site_theme']
// Темы сайта — переключаются владельцем в HUB («Настройки → Сайт»).
export const SITE_THEMES = ['case', 'protocol', 'night', 'classic'] as const
export type SiteTheme = (typeof SITE_THEMES)[number]
export const DEFAULT_SITE_THEME: SiteTheme = 'case'
export const isSiteTheme = (v: unknown): v is SiteTheme => typeof v === 'string' && (SITE_THEMES as readonly string[]).includes(v)

export interface ScheduleDay { day: number; title: string; time?: string }

// Расписание вечеров для сайта: app_settings.site_schedule = JSON
// [{ day: 1..7 (ISO, пн=1), title, time? }]. Битый JSON → null (сайт покажет своё).
export function parseSchedule(raw: string | undefined): ScheduleDay[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return null
    return arr
      .filter((d): d is ScheduleDay => !!d && typeof d === 'object'
        && Number.isInteger((d as ScheduleDay).day) && typeof (d as ScheduleDay).title === 'string')
      .map((d) => ({ day: d.day, title: d.title.slice(0, 60), ...(typeof d.time === 'string' ? { time: d.time.slice(0, 11) } : {}) }))
  } catch {
    return null
  }
}

siteRouter.get('/config', async (c) => {
  const db = c.var.db
  const settings = await db.select().from(appSettings).where(inArray(appSettings.key, VENUE_KEYS))
  const m = Object.fromEntries(settings.map((r) => [r.key, r.value]))

  // Цены вечера = тарифы-статусы, которые клуб показывает гостям на ТВ (/menu):
  // флаг «на экране ТВ» живёт на backing-позиции тарифа; без позиции — показываем.
  const tariffRows = await db.select({ name: tariffs.name, price: tariffs.price, itemId: tariffs.itemId })
    .from(tariffs).where(eq(tariffs.isActive, true)).orderBy(asc(tariffs.sortOrder), asc(tariffs.name))
  const itemIds = tariffRows.map((t) => t.itemId).filter((id): id is string => !!id)
  const visible = itemIds.length
    ? new Map((await db.select({ id: inventory.id, on: inventory.isScreenVisible }).from(inventory)
      .where(inArray(inventory.id, itemIds))).map((r) => [r.id, r.on]))
    : new Map<string, boolean>()
  const eveningPrices = tariffRows
    .filter((t) => (t.itemId ? visible.get(t.itemId) ?? true : true))
    .map((t) => ({ name: t.name, price: Number(t.price) }))

  const rates = await db.select({ hours: eventHourlyRates.hours, price: eventHourlyRates.price })
    .from(eventHourlyRates).orderBy(asc(eventHourlyRates.hours))
  const zones = await db.select({ id: spaces.id, name: spaces.name, capacity: spaces.capacity, hourlyRate: spaces.hourlyRate })
    .from(spaces).where(and(eq(spaces.isActive, true), eq(spaces.isScreenVisible, true))).orderBy(asc(spaces.name))

  c.header('Cache-Control', `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
  return c.json({
    theme: isSiteTheme(m['site_theme']) ? m['site_theme'] : DEFAULT_SITE_THEME,
    venue: {
      name: m['venue_name'] || 'TITAN KBR',
      address: m['venue_address'] || '',
      hoursOpen: m['hours_open'] || '',
      hoursClose: m['hours_close'] || '',
    },
    schedule: parseSchedule(m['site_schedule']),
    eveningPrices,
    eventRates: rates.map((r) => ({ hours: r.hours, price: Number(r.price) })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, capacity: z.capacity, hourlyRate: Number(z.hourlyRate) })),
  })
})

// ─── Резиденты на GoMafia ────────────────────────────────────────────────────
interface PublicPlayer { nickname: string; elo: number; avatar: string | null; tournaments: number | null }
interface PlayersPayload { club: string | null; total: number; players: PublicPlayer[] }
const playersCache = new Map<string, { at: number; value: PlayersPayload }>()

async function loadPlayers(gomafiaClubId: string): Promise<PlayersPayload> {
  const cached = playersCache.get(gomafiaClubId)
  if (cached && Date.now() - cached.at < PLAYERS_TTL_MS) return cached.value
  const all: GomafiaPlayer[] = []
  let club: string | null = null
  let total = 0
  for (let page = 1; page <= PLAYERS_MAX_PAGES; page++) {
    const r = await clubResidents(gomafiaClubId, { page })
    club = club ?? r.club?.title ?? null
    total = r.total
    all.push(...r.residents)
    if (all.length >= r.total || r.residents.length === 0) break
  }
  const players = all
    .filter((p) => p.elo != null && p.login)
    .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0))
    .slice(0, PLAYERS_TOP)
    .map((p) => ({ nickname: p.login, elo: Math.round(p.elo ?? 0), avatar: p.avatar, tournaments: p.tournaments }))
  const value = { club, total: total || all.length, players }
  // Пустой ответ (GoMafia недоступна) не кэшируем — следующий запрос попробует снова.
  if (players.length) playersCache.set(gomafiaClubId, { at: Date.now(), value })
  return value
}

siteRouter.get('/players', async (c) => {
  const gomafiaClubId = await getClubIntegration(c.var.db, 'gomafia_club_id').catch(() => null)
  if (!gomafiaClubId) return c.json({ club: null, total: 0, players: [] })
  try {
    const value = await loadPlayers(gomafiaClubId)
    c.header('Cache-Control', `public, max-age=${PLAYERS_MAX_AGE_SECONDS}`)
    return c.json(value)
  } catch (err) {
    console.error('[site] GoMafia недоступна:', err)
    return c.json({ club: null, total: 0, players: [] })
  }
})

// ─── Публикации (турниры, вечеринки) ─────────────────────────────────────────
siteRouter.get('/stories', async (c) => {
  const list = await listPublished(c.var.db)
  c.header('Cache-Control', `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
  return c.json({ stories: list.map((r) => publicStory(r, false)) })
})

siteRouter.get('/stories/:slug', async (c) => {
  const row = await findPublished(c.var.db, c.req.param('slug'))
  if (!row) return c.json({ error: 'not found' }, 404)
  c.header('Cache-Control', `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
  return c.json({ story: publicStory(row, true) })
})

// ─── Приём заявок ────────────────────────────────────────────────────────────
const phone = z.string().trim().min(5).max(30)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^\d{2}:\d{2}$/)
const base = {
  name: z.string().trim().min(1).max(120),
  phone,
  telegram: z.string().trim().max(64).optional(),
  comment: z.string().trim().max(1000).optional(),
  page: z.string().max(120).optional(),
  // Согласие на обработку ПДн (152-ФЗ) — без него заявку не принимаем.
  consent: z.literal(true),
  // Ловушка для ботов: поле скрыто от людей, заполненное — тихо отбрасываем.
  website: z.string().max(200).optional(),
}

const EVENING = { city_mafia: 'Городская мафия', sport_mafia: 'Спортивная мафия', board_games: 'Настольные игры', any: 'Любой вечер' } as const
const FORMAT = {
  birthday: 'День рождения', corporate: 'Корпоратив', kids: 'Детская мафия',
  party: 'Тематическая вечеринка', other: 'Мероприятие',
} as const
const TOPIC = { partnership: 'Сотрудничество', question: 'Вопрос', other: 'Сообщение' } as const

const RequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('game'), ...base, date, time,
    evening: z.enum(['city_mafia', 'sport_mafia', 'board_games', 'any']),
    guests: z.number().int().min(1).max(20),
    newbie: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('event'), ...base, date, time,
    format: z.enum(['birthday', 'corporate', 'kids', 'party', 'other']),
    location: z.enum(['titan', 'exit']),
    address: z.string().trim().max(300).optional(),
    guests: z.number().int().min(1).max(500).optional(),
    tariffHours: z.number().int().min(1).max(24).optional(),
    spaceId: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal('certificate'), ...base, date, time,
    code: z.string().trim().min(1).max(40),
    location: z.enum(['titan', 'exit']),
    address: z.string().trim().max(300).optional(),
    guests: z.number().int().min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal('message'), ...base,
    topic: z.enum(['partnership', 'question', 'other']),
    comment: z.string().trim().min(1).max(1500),
  }),
])
type SiteRequest = z.infer<typeof RequestSchema>

interface Draft {
  kind: 'event' | 'game' | 'message'
  title: string
  startsAt: string | null // null → сейчас (обращение без даты)
  location: 'titan' | 'exit'
  address: string | null
  guests: number | null
  tariffHours: number | null
  spaceId: string | null
  lines: string[] // дополнительные строки сводки для comment
  meta: Record<string, unknown>
}

// Сертификат: если номер совпал с сертификатом HUB — подсказываем персоналу остаток.
async function certificateNote(db: Database, code: string): Promise<string> {
  const [cert] = await db.select({ balance: certificates.balance, isUsed: certificates.isUsed })
    .from(certificates).where(eq(certificates.code, code.toUpperCase())).limit(1)
  if (!cert) return `Сертификат № ${code}`
  if (cert.isUsed || Number(cert.balance) <= 0) return `Сертификат № ${code} — в HUB уже использован`
  return `Сертификат № ${code} — в HUB, остаток ${Math.round(Number(cert.balance)).toLocaleString('ru-RU')} ₽`
}

async function draftOf(db: Database, r: SiteRequest): Promise<Draft> {
  const common = { telegram: r.telegram || null, page: r.page || null, source: 'site' }
  switch (r.kind) {
    case 'game':
      return {
        kind: 'game', title: `Запись на игру · ${EVENING[r.evening]}`,
        startsAt: `${r.date}T${r.time}:00+03:00`, location: 'titan', address: null,
        guests: r.guests, tariffHours: null, spaceId: null,
        lines: [r.newbie ? 'Впервые у нас' : ''],
        meta: { ...common, evening: r.evening, newbie: !!r.newbie },
      }
    case 'event':
      return {
        kind: 'event', title: FORMAT[r.format],
        startsAt: `${r.date}T${r.time}:00+03:00`, location: r.location,
        address: r.location === 'exit' ? (r.address || null) : null,
        guests: r.guests ?? null, tariffHours: r.tariffHours ?? null, spaceId: r.spaceId ?? null,
        lines: [],
        meta: { ...common, format: r.format },
      }
    case 'certificate':
      return {
        kind: 'event', title: `Сертификат № ${r.code}`,
        startsAt: `${r.date}T${r.time}:00+03:00`, location: r.location,
        address: r.location === 'exit' ? (r.address || null) : null,
        guests: r.guests ?? null, tariffHours: null, spaceId: null,
        lines: [await certificateNote(db, r.code)],
        meta: { ...common, certificate: r.code },
      }
    case 'message':
      return {
        kind: 'message', title: TOPIC[r.topic], startsAt: null, location: 'titan', address: null,
        guests: null, tariffHours: null, spaceId: null, lines: [],
        meta: { ...common, topic: r.topic },
      }
  }
}

const NOTIFY_TITLE: Record<Draft['kind'], string> = {
  game: '🎲 Запись на игру',
  event: '🎉 Заявка на мероприятие',
  message: '✉️ Сообщение с сайта',
}

function phoneTailOf(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10)
}

siteRouter.post('/requests', zValidator('json', RequestSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Проверьте поля формы' }, 400)
}), async (c) => {
  const db = c.var.db
  const r = c.req.valid('json')
  // Бот заполнил скрытое поле — отвечаем «ок», ничего не сохраняя.
  if (r.website) return c.json({ ok: true })

  const phoneTail = phoneTailOf(r.phone)
  if (phoneTail.length < 10) return c.json({ error: 'Укажите номер телефона полностью' }, 400)
  if (await publicRateLimited('sr', c.var.club?.id ?? '', clientIp(c), phoneTail, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_SECONDS)) {
    return c.json({ error: 'Слишком много заявок — попробуйте позже или позвоните нам' }, 429)
  }
  if (r.kind !== 'message') {
    const bad = startError(r.date, r.time)
    if (bad) return c.json({ error: bad }, 400)
  }
  if (r.kind === 'event' && r.spaceId) {
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.id, r.spaceId), eq(spaces.isActive, true))).limit(1)
    if (!space) return c.json({ error: 'Эта зона сейчас недоступна — выберите другую' }, 400)
  }

  const d = await draftOf(db, r)
  const comment = [...d.lines, r.telegram ? `Telegram: ${r.telegram}` : '', r.comment ?? '']
    .filter(Boolean).join('\n') || null

  // Дедуп двойной отправки: та же новая заявка (вид, телефон, начало/заголовок) —
  // под advisory-lock, чтобы два одновременных запроса не создали две записи.
  const dedupKey = `site-request:${d.kind}:${phoneTail}:${d.startsAt ?? d.title}`
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dedupKey}, 0))`)
    const sameStart = d.startsAt
      ? sql`starts_at = ${d.startsAt}::timestamptz`
      : sql`title = ${d.title} AND created_at > now() - interval '1 day'`
    const dup = await tx.execute(sql`
      SELECT id FROM bookings
      WHERE status = 'new' AND kind = ${d.kind} AND source = 'site'
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneTail}
        AND ${sameStart}
      LIMIT 1
    `)
    const existing = rows<{ id: string }>(dup)[0]?.id
    if (existing) return { id: existing, duplicate: true }
    const startsAt = d.startsAt ? sql`${d.startsAt}::timestamptz` : sql`now()`
    const res = await tx.execute(sql`
      INSERT INTO bookings (space_id, name, phone, guests, starts_at, comment, status, source, location, address, tariff_hours, title, kind, meta)
      VALUES (${d.spaceId}, ${r.name}, ${r.phone}, ${d.guests}, ${startsAt}, ${comment}, 'new', 'site',
              ${d.location}, ${d.address}, ${d.tariffHours}, ${d.title}, ${d.kind}, ${JSON.stringify(d.meta)}::jsonb)
      RETURNING id
    `)
    return { id: rows<{ id: string }>(res)[0]?.id ?? null, duplicate: false }
  })
  if (created.duplicate) return c.json({ ok: true, duplicate: true })

  // Заказчик мероприятия → справочник «Заказчики» (дедуп по последним 10 цифрам).
  if (d.kind === 'event') {
    try {
      const found = await db.execute(sql`
        SELECT id FROM customers WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${phoneTail} LIMIT 1
      `)
      if (!rows(found).length) await db.insert(customers).values({ name: r.name, phone: r.phone })
    } catch { /* non-fatal */ }
  }

  const when = d.startsAt
    ? new Date(d.startsAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null
  const body = [d.title, r.name, when, d.location === 'exit' ? 'выезд' : null, d.guests ? `${d.guests} гост.` : null]
    .filter(Boolean).join(' · ')
  await notifyOwners(db, c.var.club?.id, {
    type: 'site_request', title: NOTIFY_TITLE[d.kind], body, meta: { bookingId: created.id, url: '/events' },
  })

  return c.json({ ok: true })
})
