/**
 * Тексты и фото сайта. Правятся в приложении HUB («Сайт → Содержимое») и приходят в
 * /api/site/config (поле content). Встроенные тексты из src/content — запасные: если HUB
 * не ответил или раздел ещё не заполнен, сайт показывает их.
 */
import { FORMATS, type Format, type FormatId } from '@/content/formats'
import { DOCS, REVIEWS, TEAM, VALUES } from '@/content/people'
import { SITE } from '@/content/site'

export interface FormatText { id: FormatId; title: string; short: string; text: string; photo: string; hidden?: boolean }
export interface TeamMember { name: string; role: string; photo?: string }
export interface Review { author: string; text: string }
export interface Value { title: string; text: string }
export interface Doc { title: string; text: string; href: string; cover?: string }
export interface Page { title: string; lead: string; text: string[] }
export type PageId = 'home' | 'games' | 'events' | 'kids' | 'studio' | 'residents' | 'contact'

export interface SiteContent {
  formats: FormatText[]
  team: TeamMember[]
  reviews: Review[]
  values: Value[]
  docs: Doc[]
  pages: Record<PageId, Page>
}

export const BUILTIN_CONTENT: SiteContent = {
  formats: FORMATS.map((f) => ({ id: f.id, title: f.title, short: f.short, text: f.text, photo: f.photo })),
  team: TEAM.map((m) => ({ name: m.name, role: m.role })),
  reviews: REVIEWS.map((r) => ({ author: r.author, text: r.text })),
  values: VALUES.map((v) => ({ title: v.title, text: v.text })),
  docs: DOCS.map((d) => ({ title: d.title, text: d.text, href: d.href, cover: d.cover })),
  pages: {
    // Главная: строки заголовка (через перевод строки), text — слова, которые сменяют друг друга.
    home: { title: 'Мафия в Нальчике.\nКаждый вечер —', lead: 'Клуб TITAN KBR: игры с ведущими, турниры с рейтингом GoMafia, праздники и выезд со всем реквизитом.', text: ['городская', 'спортивная', 'детская', 'корпоративная'] },
    games: { title: 'Игровые вечера', lead: 'Городская мафия для всех, спортивная — по правилам ФСМ с рейтингом, и настольные игры компанией. Приходите один или с друзьями.', text: [] },
    events: { title: 'Праздник с мафией', lead: 'Дни рождения, корпоративы, детские праздники и тематические вечеринки. Проводим в штабе клуба или приезжаем к вам со всем реквизитом.', text: [] },
    kids: {
      title: 'Детская мафия',
      lead: 'Игра, где логика встречается с весельем. Каждый ребёнок пробует себя детективом, мирным жителем или хитрым мафиози.',
      text: [
        'В TITAN KBR мафия становится настоящим приключением. Мы проводим адаптированные игры для ребят разных возрастов — в формате игрового шоу.',
        'Дети учатся мыслить стратегически, развивают внимание, речь и уверенность в себе — в увлекательной, безопасной и позитивной атмосфере.',
        'Детская мафия идеальна для дней рождения, школьных мероприятий и весёлых выходных: море эмоций, добрый смех и впечатления, о которых говорят ещё долго.',
      ],
    },
    studio: { title: 'Мафия — наше призвание', lead: `TITAN KBR (ex ${SITE.formerName}) создан в ${SITE.since} году. Мы проводим турниры и вечера мафии — спортивной, городской, детской и корпоративной — и создаём атмосферу азарта, общения и эмоций.`, text: [] },
    residents: { title: 'Резидентам', lead: 'Правила, книги, рейтинг и приложение клуба — всё, что нужно, чтобы расти в спортивной мафии.', text: [] },
    contact: { title: 'Контакты', lead: 'Клуб открыт для всех, кто любит мафию, общение и яркие эмоции. Турниры, миникапы, корпоративы и праздники в формате мафии.', text: [] },
  },
}

const isList = (v: unknown): v is unknown[] => Array.isArray(v)

/** Содержимое из HUB поверх встроенного: битый или пустой раздел — встроенный. */
export function mergeContent(raw: unknown): SiteContent {
  if (!raw || typeof raw !== 'object') return BUILTIN_CONTENT
  const r = raw as Partial<Record<keyof SiteContent, unknown>>
  const pick = <K extends Exclude<keyof SiteContent, 'pages'>>(key: K): SiteContent[K] => (isList(r[key]) ? (r[key] as SiteContent[K]) : BUILTIN_CONTENT[key])
  const pagesRaw = (r.pages && typeof r.pages === 'object' ? r.pages : {}) as Partial<Record<PageId, Page>>
  const pages = Object.fromEntries((Object.keys(BUILTIN_CONTENT.pages) as PageId[]).map((id) => {
    const p = pagesRaw[id]
    return [id, p && typeof p.title === 'string' ? { title: p.title, lead: p.lead ?? '', text: Array.isArray(p.text) ? p.text : [] } : BUILTIN_CONTENT.pages[id]]
  })) as Record<PageId, Page>
  return { formats: pick('formats'), team: pick('team'), reviews: pick('reviews'), values: pick('values'), docs: pick('docs'), pages }
}

/** Карточки форматов: тексты и фото из HUB, куда ведут и какую заявку открывают — из сайта. */
export function formatsOf(content: SiteContent): Format[] {
  const byId = new Map(content.formats.map((f) => [f.id, f]))
  const ordered = content.formats.map((f) => f.id).filter((id) => FORMATS.some((b) => b.id === id))
  const ids = [...ordered, ...FORMATS.map((f) => f.id).filter((id) => !byId.has(id))]
  return ids.flatMap((id) => {
    const base = FORMATS.find((f) => f.id === id)!
    const t = byId.get(id)
    if (t?.hidden) return []
    return [{ ...base, ...(t ? { title: t.title, short: t.short, text: t.text, photo: t.photo || base.photo } : {}) }]
  })
}

/** Фото — имя встроенного снимка («table-night») или ссылка из хранилища HUB. */
export function photoProps(ref: string | undefined): { name?: string; url?: string } {
  if (!ref) return {}
  return /^https?:\/\//.test(ref) ? { url: ref } : { name: ref }
}
