/**
 * Сайт клуба (titanmafia.ru) в HUB: праздничное оформление, расписание вечеров и публикации
 * (турниры, вечеринки). Сайт подхватывает изменения в течение минуты.
 */

/** Адрес сайта для ссылок и превью; файлы сайта (/media/…) открываем отсюда же. */
export const SITE_URL = 'https://www.titanmafia.ru'
/** Зеркало сайта на поддомене HUB — работает и до переключения домена. */
export const SITE_MIRROR = 'https://site.titanpos.ru'

/** Праздничное оформление поверх Liquid Glass; список совпадает с сайтом (content/holidays.ts). */
export type SiteHoliday =
  | 'new_year' | 'winter' | 'valentine' | 'defender' | 'womens_day' | 'maslenitsa'
  | 'spring' | 'summer' | 'autumn' | 'halloween' | 'club_birthday'

export const SITE_HOLIDAYS: { id: SiteHoliday; label: string; text: string; colors: string[] }[] = [
  { id: 'new_year', label: 'Новый год', text: 'Снег, гирлянда и снеговик', colors: ['#FFFFFF', '#C9DCFF', '#F4C95D'] },
  { id: 'winter', label: 'Зима', text: 'Тихий снегопад, холодный оттенок', colors: ['#FFFFFF', '#E3EEFF', '#9DB8FF'] },
  { id: 'valentine', label: 'День влюблённых', text: 'Летящие сердца, розовый оттенок', colors: ['#FF5C8A', '#FF8FB1', '#E8336B'] },
  { id: 'defender', label: '23 февраля', text: 'Золотые звёзды', colors: ['#F4C95D', '#FFE29A', '#D9A93B'] },
  { id: 'womens_day', label: '8 Марта', text: 'Лепестки и ветка мимозы', colors: ['#FFB3D1', '#FFD6E5', '#F7E35B'] },
  { id: 'maslenitsa', label: 'Масленица', text: 'Искры и солнце', colors: ['#FFB547', '#FFD27A', '#FF8A3D'] },
  { id: 'spring', label: 'Весна', text: 'Лепестки сакуры', colors: ['#FFD1E3', '#FFFFFF', '#FFC2D6'] },
  { id: 'summer', label: 'Лето', text: 'Солнечные блики и солнце', colors: ['#FFE08A', '#8FF0E0', '#FFFFFF'] },
  { id: 'autumn', label: 'Осень', text: 'Падающие листья, тёплый оттенок', colors: ['#E8742B', '#F2A93B', '#C7442E'] },
  { id: 'halloween', label: 'Хэллоуин', text: 'Летучие мыши, тыквы и паутина', colors: ['#FF7A1A', '#22172F', '#8B5CF6'] },
  { id: 'club_birthday', label: 'День рождения клуба', text: 'Конфетти и воздушные шары', colors: ['#F4C95D', '#9B7BFF', '#FF6FA3'] },
]

export interface ScheduleDay { day: number; title: string; time?: string }
export interface SiteConfig { holiday: SiteHoliday | null; holidays: SiteHoliday[]; schedule: ScheduleDay[] | null }

export const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
export const EVENING_TITLES = ['Городская мафия', 'Спортивная мафия', 'Настольные игры', 'Детская мафия', 'Турнир']

/** Расписание по сменам клуба — то же, что сайт показывает, пока в HUB не задано своё. */
export const DEFAULT_SCHEDULE: ScheduleDay[] = [
  { day: 2, title: 'Городская мафия', time: '19:00' },
  { day: 4, title: 'Спортивная мафия', time: '19:00' },
  { day: 5, title: 'Городская мафия', time: '19:00' },
  { day: 6, title: 'Спортивная мафия', time: '19:00' },
  { day: 7, title: 'Настольные игры', time: '19:00' },
]

export interface StoryStat { value: string; label: string }
export interface Story {
  id: string
  slug: string
  title: string
  tagline: string | null
  kind: 'tournament' | 'party' | 'event'
  event_date: string | null
  body: string | null
  stats: StoryStat[]
  cover_url: string | null
  photos: string[]
  results_url: string | null
  gallery_url: string | null
  is_published: boolean
  sort_order: number
}

export interface StoryDraft {
  slug: string
  title: string
  tagline: string
  kind: Story['kind']
  eventDate: string | null
  body: string
  stats: StoryStat[]
  coverUrl: string | null
  photos: string[]
  resultsUrl: string
  galleryUrl: string
  isPublished: boolean
  sortOrder: number
}

export const STORY_KINDS: { id: Story['kind']; label: string }[] = [
  { id: 'tournament', label: 'Турнир' },
  { id: 'party', label: 'Вечеринка' },
  { id: 'event', label: 'Событие' },
]

export const EMPTY_DRAFT: StoryDraft = {
  slug: '', title: '', tagline: '', kind: 'tournament', eventDate: null, body: '', stats: [],
  coverUrl: null, photos: [], resultsUrl: '', galleryUrl: '', isPublished: false, sortOrder: 0,
}

export function draftOf(s: Story): StoryDraft {
  return {
    slug: s.slug, title: s.title, tagline: s.tagline ?? '', kind: s.kind, eventDate: s.event_date ? s.event_date.slice(0, 10) : null,
    body: s.body ?? '', stats: s.stats ?? [], coverUrl: s.cover_url, photos: s.photos ?? [], resultsUrl: s.results_url ?? '',
    galleryUrl: s.gallery_url ?? '', isPublished: s.is_published, sortOrder: s.sort_order,
  }
}

/** Ссылка на фото для показа в HUB: файлы сайта (/media/…) — с зеркала сайта. */
export const photoSrc = (url: string): string => (url.startsWith('/') ? `${SITE_MIRROR}${url}` : url)

const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

/** «Society Mafia Cup 2026» → «society-mafia-cup-2026». */
export function slugify(title: string): string {
  return title.toLowerCase().split('').map((ch) => RU[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}
