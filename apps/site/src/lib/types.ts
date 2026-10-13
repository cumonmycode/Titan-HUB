import type { HolidayId } from '@/content/holidays'

export interface ScheduleDay { day: number; title: string; time?: string }
export interface Price { name: string; price: number }
export interface EventRate { hours: number; price: number }
export interface Zone { id: string; name: string; capacity: number | null; hourlyRate: number }

/** Контакты клуба из HUB («Сайт → Контакты»); пустая строка — не задано. */
export interface SiteContactsData {
  phone: string; email: string; telegram: string; channel: string; whatsapp: string; vk: string; instagram: string
}

/** Кнопка таплинка (/link): готовый вид или своя ссылка. Правится в HUB («Сайт → Таплинк»). */
export type SiteLinkKind = 'book_game' | 'book_event' | 'tai' | 'telegram' | 'channel' | 'whatsapp' | 'vk' | 'instagram' | 'phone' | 'map' | 'site' | 'custom'
export interface SiteLink { id: string; kind: SiteLinkKind; label: string; url: string; on: boolean }
export interface SiteLinks { title: string; bio: string; links: SiteLink[] }

export interface SiteConfig {
  /** Праздничное оформление (включается в HUB) или null. */
  holiday: HolidayId | null
  venue: { name: string; address: string; hoursOpen: string; hoursClose: string }
  contacts: SiteContactsData | null
  /** Адрес сайта из HUB («Сайт → Домен») или null — встроенный. */
  url: string | null
  schedule: ScheduleDay[]
  eveningPrices: Price[]
  eventRates: EventRate[]
  zones: Zone[]
  /** Таплинк; null — HUB не ответил (страница покажет стандартный набор). */
  links: SiteLinks | null
  /** Tai — администратор клуба в Telegram. */
  taiUrl: string | null
  /** false — данные не пришли из HUB, показываем запасные (сайт не должен падать). */
  live: boolean
}

/** Резидент клуба на GoMafia; id — для ссылки на профиль gomafia.pro/stats/<id>. */
export interface Player { id: string | null; nickname: string; elo: number; avatar: string | null; tournaments: number | null }
export interface PlayersPayload { club: string | null; total: number; players: Player[] }

/** Что открывает кнопка заявки. */
export type RequestPreset =
  | { kind: 'game'; evening?: 'city_mafia' | 'sport_mafia' | 'board_games' | 'any' }
  | { kind: 'event'; format?: 'birthday' | 'corporate' | 'kids' | 'party' | 'other'; location?: 'titan' | 'exit' }
  | { kind: 'certificate' }
  | { kind: 'message'; topic?: 'partnership' | 'question' | 'other' }

export interface StoryStat { value: string; label: string }
export interface StorySummary {
  slug: string
  title: string
  tagline: string
  kind: string
  eventDate: string | null
  coverUrl: string | null
  stats: StoryStat[]
}
export interface Story extends StorySummary {
  body: string[]
  photos: string[]
  resultsUrl: string | null
  galleryUrl: string | null
}
