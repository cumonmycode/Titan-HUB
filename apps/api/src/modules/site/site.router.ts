/**
 * Публичный API сайта клуба: витрина и единая онлайн-запись.
 *
 * nginx сайта проксирует /api/site/* в API с Host клубного поддомена, поэтому
 * c.var.db / c.var.club — клуб сайта. Монтируется ДО requireActiveSubscription:
 * гость без авторизации.
 *
 *  GET  /config   — заведение, часы, контакты, адрес сайта, цены вечера (тарифы
 *                   «на экране ТВ»), почасовые тарифы и зоны для брони — живое из HUB;
 *  GET  /tonight  — запись на сегодня: «Да» в опросе Telegram (+8) и ники игроков;
 *  GET  /players  — резиденты клуба на GoMafia по ELO (кэш 30 мин);
 *  POST /requests — заявка (requests/intake.router.ts) → bookings → «Заявки» в HUB.
 */
import { Hono } from 'hono'
import {
  appSettings, tariffs, inventory, spaces, eventHourlyRates, profiles,
  eq, and, asc, inArray, isNull, type Database,
} from '@titan/database'
import type { AppEnv } from '../../types.js'
import { getClubIntegration } from '../../lib/secrets.js'
import { clubResidents, type GomafiaPlayer } from '../../lib/gomafia.js'
import { requestsIntakeRouter } from '../requests/intake.router.js'
import { getBusinessDayStartHour } from '../../lib/appSettings.js'
import { businessDayStartMs } from '../../lib/prechecks.js'
import { listLastPolls, votersForToday } from '../../lib/pollState.js'
import { readPollConfigs } from '../../lib/polls.js'
import { readAliases } from '../../lib/tgAliases.js'
import { findPublished, listPublished, publicStory } from './stories.js'
import { readSiteContacts, readSiteDomain } from './settings.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

const CONFIG_MAX_AGE_SECONDS = 60
const PLAYERS_MAX_AGE_SECONDS = 600
const PLAYERS_TTL_MS = 30 * 60 * 1000
const PLAYERS_MAX_PAGES = 12
const PLAYERS_TOP = 60
// Запись на сегодня: к голосам «Да» прибавляем базу (формула владельца) и
// пересчитываем раз в полчаса — счётчик на сайте меняется не чаще.
const SIGNUPS_BASE = 8
const SIGNUPS_TTL_MS = 30 * 60 * 1000
const SIGNUPS_MAX_AGE_SECONDS = 300
const SIGNUPS_NAMES_MAX = 12

export const siteRouter = new Hono<AppEnv>()

// ─── Витрина ─────────────────────────────────────────────────────────────────
const VENUE_KEYS = ['venue_name', 'venue_address', 'hours_open', 'hours_close', 'site_schedule', 'site_holiday']
// Праздничное оформление сайта — включает владелец в HUB («Сайт → Оформление»);
// пусто — обычный вид. Список совпадает с apps/site/src/content/holidays.ts.
export const SITE_HOLIDAYS = [
  'new_year', 'winter', 'valentine', 'defender', 'womens_day', 'maslenitsa',
  'spring', 'summer', 'autumn', 'halloween', 'club_birthday',
] as const
export type SiteHoliday = (typeof SITE_HOLIDAYS)[number]
export const isSiteHoliday = (v: unknown): v is SiteHoliday => typeof v === 'string' && (SITE_HOLIDAYS as readonly string[]).includes(v)

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
  // Бронь зоны — все активные зоны клуба (как было в форме /book, которую заменил сайт).
  const zones = await db.select({ id: spaces.id, name: spaces.name, capacity: spaces.capacity, hourlyRate: spaces.hourlyRate })
    .from(spaces).where(eq(spaces.isActive, true)).orderBy(asc(spaces.name))
  const [contacts, domain] = await Promise.all([readSiteContacts(db), readSiteDomain(db)])

  c.header('Cache-Control', `public, max-age=${CONFIG_MAX_AGE_SECONDS}`)
  return c.json({
    holiday: isSiteHoliday(m['site_holiday']) ? m['site_holiday'] : null,
    venue: {
      name: m['venue_name'] || 'TITAN KBR',
      address: m['venue_address'] || '',
      hoursOpen: m['hours_open'] || '',
      hoursClose: m['hours_close'] || '',
    },
    contacts,
    url: domain.url,
    schedule: parseSchedule(m['site_schedule']),
    eveningPrices,
    eventRates: rates.map((r) => ({ hours: r.hours, price: Number(r.price) })),
    zones: zones.map((z) => ({ id: z.id, name: z.name, capacity: z.capacity, hourlyRate: Number(z.hourlyRate) })),
  })
})

// ─── Запись на сегодня (опрос в Telegram) ────────────────────────────────────
// Опрос сегодняшнего вечера (опубликован с начала бизнес-дня): сколько отметили
// «Да» + SIGNUPS_BASE и клубные ники тех, кто сопоставлен с клиентом HUB. Наружу
// — только ники, без имён из Telegram и фото. Нет опроса — { poll: false }.
interface Signups { poll: boolean; evening: string | null; going: number; names: string[] }
const signupsCache = new Map<string, { at: number; value: Signups }>()

async function loadSignups(db: Database): Promise<Signups> {
  const since = businessDayStartMs(await getBusinessDayStartHour(db))
  const today = (await listLastPolls(db)).filter((p) => Date.parse(p.postedAt) >= since)
  if (!today.length) return { poll: false, evening: null, going: 0, names: [] }

  const configs = await readPollConfigs(db)
  const evening = today.map((p) => configs.find((cfg) => cfg.chatId === p.chatId)?.title).find(Boolean) ?? null
  const voters = await votersForToday(db, since, ['да'])
  const tgIds = [...voters.keys()]
  if (!tgIds.length) return { poll: true, evening, going: SIGNUPS_BASE, names: [] }

  // tgId → профиль (основной tg_id или алиас доп. аккаунта), как в предчеках.
  const profileIds = new Set<string>()
  const byPrimary = await db.select({ id: profiles.id, tgId: profiles.tgId })
    .from(profiles).where(and(inArray(profiles.tgId, tgIds), isNull(profiles.deletedAt)))
  const matched = new Set(byPrimary.map((r) => r.tgId))
  for (const r of byPrimary) profileIds.add(r.id)
  const aliases = await readAliases(db)
  for (const tg of tgIds) if (!matched.has(tg) && aliases[tg]) profileIds.add(aliases[tg]!.profileId)

  const named = profileIds.size
    ? await db.select({ nickname: profiles.nickname }).from(profiles)
      .where(and(inArray(profiles.id, [...profileIds]), isNull(profiles.deletedAt)))
    : []
  const names = named.map((p) => p.nickname.trim()).filter(Boolean)
    .sort((x, y) => x.localeCompare(y, 'ru')).slice(0, SIGNUPS_NAMES_MAX)
  return { poll: true, evening, going: tgIds.length + SIGNUPS_BASE, names }
}

siteRouter.get('/tonight', async (c) => {
  const key = c.var.club?.id ?? 'main'
  const cached = signupsCache.get(key)
  let value = cached && Date.now() - cached.at < SIGNUPS_TTL_MS ? cached.value : null
  if (!value) {
    value = await loadSignups(c.var.db)
    signupsCache.set(key, { at: Date.now(), value })
  }
  c.header('Cache-Control', `public, max-age=${SIGNUPS_MAX_AGE_SECONDS}`)
  return c.json(value)
})

// ─── Резиденты на GoMafia ────────────────────────────────────────────────────
interface PublicPlayer { id: string; nickname: string; elo: number; avatar: string | null; tournaments: number | null }
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
    .map((p) => ({ id: p.gomafiaId, nickname: p.login, elo: Math.round(p.elo ?? 0), avatar: p.avatar, tournaments: p.tournaments }))
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

// ─── Приём заявок (единая онлайн-запись) ─────────────────────────────────────
siteRouter.route('/requests', requestsIntakeRouter)
