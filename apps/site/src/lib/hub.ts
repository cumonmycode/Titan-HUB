/**
 * Данные из Titan HUB для серверного рендера. Сайт ходит в API напрямую внутри
 * docker-сети с Host клубного поддомена (по нему API выбирает БД клуба). fetch в
 * Node не даёт подменить Host, поэтому — node:http. Кэш — unstable_cache (60 с):
 * праздник, цены и расписание из HUB доезжают до сайта в течение минуты.
 */
import http from 'node:http'
import https from 'node:https'
import { unstable_cache } from 'next/cache'
import { TOURNAMENTS, type Tournament } from '@/content/tournaments'
import { isHoliday } from '@/content/holidays'
import { type PlayersPayload, type ScheduleDay, type SiteConfig, type Story, type StorySummary } from './types'

const API_URL = process.env['SITE_API_URL'] ?? 'http://api:3001'
const CLUB_HOST = process.env['SITE_CLUB_HOST'] ?? 'kbr.titanpos.ru'
const TIMEOUT_MS = 4000
const REVALIDATE_SECONDS = 60

function getJson(path: string): Promise<unknown> {
  const url = new URL(path, API_URL)
  const lib = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'GET', headers: { host: CLUB_HOST, accept: 'application/json' }, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`HUB ${path}: ${res.statusCode}`))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error(`HUB ${path}: timeout`)))
    req.on('error', reject)
    req.end()
  })
}

/** Расписание по умолчанию — по сменам клуба за последние месяцы; правится в HUB. */
export const DEFAULT_SCHEDULE: ScheduleDay[] = [
  { day: 2, title: 'Городская мафия', time: '19:00' },
  { day: 4, title: 'Спортивная мафия', time: '19:00' },
  { day: 5, title: 'Городская мафия', time: '19:00' },
  { day: 6, title: 'Спортивная мафия', time: '19:00' },
  { day: 7, title: 'Настольные игры', time: '19:00' },
]

export const FALLBACK_CONFIG: SiteConfig = {
  holiday: null,
  venue: { name: 'TITAN KBR', address: 'Кабардинская улица, 152', hoursOpen: '19:00', hoursClose: '03:00' },
  schedule: DEFAULT_SCHEDULE,
  eveningPrices: [
    { name: 'Новичок', price: 800 }, { name: 'Резидент', price: 600 },
    { name: 'Студент', price: 300 }, { name: 'Одна игра', price: 200 },
  ],
  eventRates: [{ hours: 1, price: 5000 }, { hours: 2, price: 8000 }, { hours: 3, price: 10000 }],
  zones: [],
  live: false,
}

interface RawConfig {
  holiday?: unknown
  venue?: SiteConfig['venue']
  schedule?: ScheduleDay[] | null
  eveningPrices?: SiteConfig['eveningPrices']
  eventRates?: SiteConfig['eventRates']
  zones?: SiteConfig['zones']
}

// Ошибки не кэшируются: unstable_cache запоминает только успешный ответ, сбой
// бросается наружу и подменяется запасными данными до следующего запроса.
async function loadConfig(): Promise<SiteConfig> {
  const raw = (await getJson('/api/site/config')) as RawConfig
  return {
    holiday: isHoliday(raw.holiday) ? raw.holiday : null,
    venue: raw.venue ?? FALLBACK_CONFIG.venue,
    schedule: raw.schedule?.length ? raw.schedule : DEFAULT_SCHEDULE,
    eveningPrices: raw.eveningPrices?.length ? raw.eveningPrices : FALLBACK_CONFIG.eveningPrices,
    eventRates: raw.eventRates?.length ? raw.eventRates : FALLBACK_CONFIG.eventRates,
    zones: raw.zones ?? [],
    live: true,
  }
}

async function loadPlayers(): Promise<PlayersPayload> {
  const r = (await getJson('/api/site/players')) as PlayersPayload
  // Пустой рейтинг (GoMafia не ответила) не кэшируем на полчаса.
  if (!r.players?.length) throw new Error('GoMafia: пустой рейтинг')
  return r
}

const cachedConfig = unstable_cache(loadConfig, ['site-config'], { revalidate: REVALIDATE_SECONDS })
const cachedPlayers = unstable_cache(loadPlayers, ['site-players'], { revalidate: 30 * 60 })

export async function getSiteConfig(): Promise<SiteConfig> {
  try {
    return await cachedConfig()
  } catch (err) {
    console.error('[site] HUB недоступен, показываю запасные данные:', err instanceof Error ? err.message : err)
    return FALLBACK_CONFIG
  }
}

export async function getPlayers(): Promise<PlayersPayload> {
  try {
    return await cachedPlayers()
  } catch {
    return { club: null, total: 0, players: [] }
  }
}

// ─── Публикации (турниры, вечеринки) ─────────────────────────────────────────
// Ведутся в HUB («Сайт → Публикации»). Если HUB недоступен — встроенный список
// событий со старого сайта, чтобы портфолио не пропадало.

function fromContent(t: Tournament): Story {
  const photos = t.photos.map((p) => `/media/${p}-1600.webp`)
  return {
    slug: t.slug, title: t.title, tagline: t.tagline, kind: t.kind, eventDate: null,
    coverUrl: photos[0] ?? null, stats: t.stats, body: t.text, photos,
    resultsUrl: t.resultsUrl ?? null, galleryUrl: t.galleryUrl,
  }
}

async function loadStories(): Promise<StorySummary[]> {
  const r = (await getJson('/api/site/stories')) as { stories?: StorySummary[] }
  return r.stories ?? []
}

async function loadStory(slug: string): Promise<Story | null> {
  try {
    const r = (await getJson(`/api/site/stories/${encodeURIComponent(slug)}`)) as { story?: Story }
    return r.story ?? null
  } catch (err) {
    // 404 — публикации нет (кэшируем как «нет»); остальные сбои — наружу, без кэша.
    if (err instanceof Error && / 404$/.test(err.message)) return null
    throw err
  }
}

const cachedStories = unstable_cache(loadStories, ['site-stories'], { revalidate: REVALIDATE_SECONDS })

export async function getStories(): Promise<StorySummary[]> {
  try {
    return await cachedStories()
  } catch {
    return TOURNAMENTS.map(fromContent)
  }
}

export async function getStory(slug: string): Promise<Story | null> {
  try {
    return await unstable_cache(() => loadStory(slug), ['site-story', slug], { revalidate: REVALIDATE_SECONDS })()
  } catch {
    const t = TOURNAMENTS.find((x) => x.slug === slug)
    return t ? fromContent(t) : null
  }
}
