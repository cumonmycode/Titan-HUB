/**
 * Сайт клуба (titanmafia.ru) в HUB: тема, расписание вечеров и публикации
 * (турниры, вечеринки). Сайт подхватывает изменения в течение минуты.
 */

/** Адрес сайта для ссылок и превью; файлы сайта (/media/…) открываем отсюда же. */
export const SITE_URL = 'https://www.titanmafia.ru'
/** Зеркало сайта на поддомене HUB — работает и до переключения домена. */
export const SITE_MIRROR = 'https://site.titanpos.ru'

export type SiteTheme = 'case' | 'protocol' | 'night' | 'classic'

export const SITE_THEMES: { id: SiteTheme; label: string; text: string; colors: string[] }[] = [
  { id: 'case', label: 'Дело о мафии', text: 'Доска улик на фиолетовой стене штаба: полароиды, красная нить, печати.', colors: ['#2E1766', '#EEE7DA', '#E5322D'] },
  { id: 'protocol', label: 'Протокол судьи', text: 'Судейский бланк игры: девять мест заняты форматами клуба, десятое — гостя.', colors: ['#F4F4F0', '#111111', '#1F3FD1'] },
  { id: 'night', label: 'Город засыпает', text: 'Сайт как раунд игры: при прокрутке ночь сменяется днём.', colors: ['#05040A', '#1E2C8F', '#E8728F'] },
  { id: 'classic', label: 'Классика', text: 'Фото клуба во весь экран, карточки форматов — привычно и понятно.', colors: ['#0B0B10', '#7C4DFF', '#FFFFFF'] },
]

export interface ScheduleDay { day: number; title: string; time?: string }
export interface SiteConfig { theme: SiteTheme; themes: SiteTheme[]; schedule: ScheduleDay[] | null }

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
