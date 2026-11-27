/**
 * Содержимое сайта клуба, которое правится в приложении HUB («Сайт → Содержимое»):
 * форматы, команда, отзывы, ценности, документы и заголовки страниц. Приложение и есть
 * CMS: сайт читает это из /api/site/config, отдельной админки нет.
 *
 * Хранение — app_settings.site_content: { formats?, team?, reviews?, values?, docs?, pages? }.
 * Раздел, которого нет в хранилище, отдаётся по умолчанию — это тексты, с которыми сайт
 * жил до переноса (apps/site/src/content), поэтому после переключения сайт не меняется.
 * Команда — сотрудники клуба: имя и фото берутся из их карточек, на сайте — роль.
 */
import { z } from 'zod'
import { appSettings, eq, inArray, profiles, type Database } from '@titan/database'

export const SITE_CONTENT_KEY = 'site_content'

const text = (max: number) => z.string().trim().max(max)
/** Фото: имя встроенного снимка сайта («table-night») или ссылка https:// из хранилища. */
const photoRef = z.string().trim().max(500).refine((v) => v === '' || /^https:\/\/\S+$/.test(v) || /^[a-z0-9-]+$/.test(v), 'Фото — ссылка https:// или имя снимка')
const hrefRef = z.string().trim().max(500).refine((v) => v === '' || /^https:\/\/\S+$/.test(v) || /^\/[\w\-./]*$/.test(v), 'Ссылка — https:// или путь /…')

export const FORMAT_IDS = ['city', 'sport', 'board', 'kids', 'corporate', 'party'] as const
export const FormatSchema = z.object({
  id: z.enum(FORMAT_IDS),
  title: text(60).min(1),
  short: text(80),
  text: text(600),
  photo: photoRef,
  hidden: z.boolean().default(false),
})
export const TeamMemberSchema = z.object({
  /** Сотрудник клуба: имя и фото — из его карточки в HUB. */
  profileId: z.string().uuid().nullable().default(null),
  name: text(60),
  role: text(60),
  photo: photoRef.default(''),
})
export const ReviewSchema = z.object({ author: text(60).min(1), text: text(600).min(1) })
export const ValueSchema = z.object({ title: text(40).min(1), text: text(160) })
export const DocSchema = z.object({ title: text(80).min(1), text: text(300), href: hrefRef, cover: photoRef.default('') })
export const PageSchema = z.object({ title: text(80).min(1), lead: text(400), text: z.array(text(800)).max(8).default([]) })
export const PAGE_IDS = ['home', 'games', 'events', 'kids', 'studio', 'residents', 'contact'] as const
export type PageId = (typeof PAGE_IDS)[number]
export const PagesSchema = z.object(Object.fromEntries(PAGE_IDS.map((id) => [id, PageSchema])) as Record<PageId, typeof PageSchema>)

export const SECTION_SCHEMAS = {
  formats: z.array(FormatSchema).max(FORMAT_IDS.length),
  team: z.array(TeamMemberSchema).max(20),
  reviews: z.array(ReviewSchema).max(30),
  values: z.array(ValueSchema).max(12),
  docs: z.array(DocSchema).max(20),
  pages: PagesSchema,
} as const
export type SectionId = keyof typeof SECTION_SCHEMAS
export const SECTION_IDS = Object.keys(SECTION_SCHEMAS) as SectionId[]

type Format = z.infer<typeof FormatSchema>
type TeamMember = z.infer<typeof TeamMemberSchema>
type Page = z.infer<typeof PageSchema>

export interface SiteContent {
  formats: Format[]
  team: TeamMember[]
  reviews: z.infer<typeof ReviewSchema>[]
  values: z.infer<typeof ValueSchema>[]
  docs: z.infer<typeof DocSchema>[]
  pages: Record<PageId, Page>
}

// ─── Тексты по умолчанию — как на сайте до переноса ──────────────────────────
export const DEFAULT_CONTENT: SiteContent = {
  formats: [
    { id: 'city', title: 'Городская мафия', short: 'Психологическая игра для всех', text: 'Захватывающая психологическая игра, где каждое слово, взгляд и жест могут стать ключом к победе. Новичкам ведущий объяснит правила прямо перед игрой.', photo: 'table-night', hidden: false },
    { id: 'sport', title: 'Спортивная мафия', short: 'Строгие правила, рейтинг ELO', text: 'Интеллектуальное сражение по правилам ФСМ: стратегии, турниры и рейтинг на GoMafia. Пройдите Школу мафии и станьте мастером игры.', photo: 'girls-violet', hidden: false },
    { id: 'kids', title: 'Детская мафия', short: 'Дни рождения, школы, выходные', text: 'Адаптированные игры для детей: каждый пробует себя детективом, мирным жителем или хитрым мафиози. Логика, речь и уверенность — в весёлом игровом шоу.', photo: 'kid-mask', hidden: false },
    { id: 'corporate', title: 'Корпоративная мафия', short: 'В штабе или у вас', text: 'Игра с профессиональным ведущим, антуражем и сценарием для команды. Приедем со всем реквизитом в офис или проведём вечер в штабе.', photo: 'team-bench', hidden: false },
    { id: 'party', title: 'Тематические вечеринки', short: 'Ваша идея — наша постановка', text: 'Киновечер, неоновая вечеринка, ретро-ночь, stand-up, квизы, караоке или crazy birthday — превращаем любую идею в живое событие.', photo: '5y-2', hidden: false },
    { id: 'board', title: 'Настольные игры', short: 'Компанией — в штаб', text: 'Приходите с друзьями поиграть в настольные игры: хороший кофе, быстрый интернет и уютный зал.', photo: 'friendscup-1', hidden: false },
  ],
  team: [
    { profileId: null, name: 'Тигран Саркисян', role: 'Ведущий', photo: '' },
    { profileId: null, name: 'Кантемир Гетаов', role: 'Ведущий', photo: '' },
  ],
  reviews: [
    { author: 'Анзор Шерхов', text: 'Лучшее место для досуга! Профессиональный ведущий, интересные настольные игры, большой ассортимент напитков и снэков. Всем советую!' },
    { author: 'Залина Табухова', text: 'Недавно узнала, что в Нальчике есть клуб, где можно играть в мафию. Ходила два раза и со всеми сдружилась — буду ещё ходить. Ребята классные!' },
    { author: 'Валерия Савина', text: 'Хотите познакомиться с новыми людьми, развить память и аналитические способности, весело провести время? Вам сюда!' },
  ],
  values: [
    { title: 'Драйв', text: 'Зажигаем эмоции в каждой игре.' },
    { title: 'Интеллект', text: 'Стратегия и хитрость побеждают всегда.' },
    { title: 'Команда', text: 'Вместе мы сильнее в мафии.' },
    { title: 'Честность', text: 'Правила для всех — без исключений.' },
    { title: 'Эмоции', text: 'Азарт, смех и незабываемые вечера.' },
    { title: 'Уют', text: 'Комфорт в новом зале для всех.' },
  ],
  docs: [
    { title: 'Правила игры в мафию', text: 'Официальная редакция правил спортивной мафии Федерации спортивной мафии.', href: '/docs/pravila-fsm.pdf', cover: 'book-rules' },
    { title: '50 оттенков красного', text: 'Стратегии за каждую роль, тактические приёмы, определение цветов через счёт и игра на допы.', href: '/docs/50-ottenkov-krasnogo.pdf', cover: 'book-red' },
    { title: 'Мафия в стиле Дзен', text: 'Самое полное издание о классической мафии на сегодняшний день.', href: '/docs/mafia-v-stile-dzen.pdf', cover: 'book-zen' },
  ],
  pages: {
    home: { title: 'Найди мафию, прежде чем она найдёт тебя', lead: 'Клуб TITAN KBR: игры с ведущими, турниры с рейтингом GoMafia, праздники и выезд со всем реквизитом.', text: [] },
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
    studio: { title: 'Мафия — наше призвание', lead: 'TITAN KBR (ex Red Empire) создан в 2017 году. Мы проводим турниры и вечера мафии — спортивной, городской, детской и корпоративной — и создаём атмосферу азарта, общения и эмоций.', text: [] },
    residents: { title: 'Резидентам', lead: 'Правила, книги, рейтинг и приложение клуба — всё, что нужно, чтобы расти в спортивной мафии.', text: [] },
    contact: { title: 'Контакты', lead: 'Клуб открыт для всех, кто любит мафию, общение и яркие эмоции. Турниры, миникапы, корпоративы и праздники в формате мафии.', text: [] },
  },
}

type Stored = Partial<Record<SectionId, unknown>>

async function readStored(db: Database): Promise<Stored> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SITE_CONTENT_KEY)).limit(1)
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {}
  } catch {
    return {}
  }
}

/** Страницы — по одной: битая или не заданная страница берёт текст по умолчанию. */
function pagesOf(stored: Stored): Record<PageId, Page> {
  const raw = (stored.pages ?? {}) as Record<string, unknown>
  return Object.fromEntries(PAGE_IDS.map((id) => {
    const parsed = PageSchema.safeParse(raw[id])
    return [id, parsed.success ? parsed.data : DEFAULT_CONTENT.pages[id]]
  })) as Record<PageId, Page>
}

function listOf<K extends Exclude<SectionId, 'pages'>>(stored: Stored, key: K): SiteContent[K] {
  const parsed = SECTION_SCHEMAS[key].safeParse(stored[key])
  return (parsed.success ? parsed.data : DEFAULT_CONTENT[key]) as SiteContent[K]
}

/** Команда: у сотрудника клуба имя и фото — живые, из его карточки. */
async function resolveTeam(db: Database, team: TeamMember[]): Promise<TeamMember[]> {
  const ids = team.map((m) => m.profileId).filter((id): id is string => !!id)
  if (!ids.length) return team
  const rows = await db.select({ id: profiles.id, nickname: profiles.nickname, fullName: profiles.fullName, photoUrl: profiles.photoUrl, tgPhotoUrl: profiles.tgPhotoUrl, deletedAt: profiles.deletedAt })
    .from(profiles).where(inArray(profiles.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return team.flatMap((m) => {
    if (!m.profileId) return [m]
    const p = byId.get(m.profileId)
    if (!p || p.deletedAt) return []
    return [{ ...m, name: m.name || p.fullName || p.nickname, photo: m.photo || p.photoUrl || p.tgPhotoUrl || '' }]
  })
}

export async function readSiteContent(db: Database): Promise<SiteContent> {
  const stored = await readStored(db)
  return {
    formats: listOf(stored, 'formats'),
    team: await resolveTeam(db, listOf(stored, 'team')),
    reviews: listOf(stored, 'reviews'),
    values: listOf(stored, 'values'),
    docs: listOf(stored, 'docs'),
    pages: pagesOf(stored),
  }
}

/** Какие разделы владелец уже менял (остальные — тексты по умолчанию). */
export async function editedSections(db: Database): Promise<SectionId[]> {
  const stored = await readStored(db)
  return SECTION_IDS.filter((k) => stored[k] !== undefined)
}

/** Сохранить раздел; null — вернуть тексты по умолчанию. */
export async function writeSection(db: Database, key: SectionId, value: unknown): Promise<void> {
  const stored = await readStored(db)
  const next: Stored = { ...stored }
  if (value === null) delete next[key]
  else next[key] = value
  const json = JSON.stringify(next)
  await db.insert(appSettings).values({ key: SITE_CONTENT_KEY, value: json }).onConflictDoUpdate({ target: appSettings.key, set: { value: json, updatedAt: new Date() } })
}
