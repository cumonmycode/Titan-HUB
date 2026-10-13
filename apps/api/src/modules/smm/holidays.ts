/**
 * Праздники и памятные даты для контент-плана: российские, республиканские (КБР),
 * развлекательные инфоповоды, сезоны продаж (корпоративы, выпускные) и свои даты клуба
 * (smm_dates). На каждую значимую дату Tai ставит тематический пост; в траурные дни —
 * никаких развлекательных постов.
 *
 * Плавающие даты (Ураза-байрам, Курбан-байрам, Пасха, Масленица) заданы по годам;
 * мусульманские — ориентировочно (±1 день, точную дату объявляет муфтият).
 */
import { sql, type Database } from '@titan/database'
import { rows } from './db.js'

/** celebrate — поздравить и позвать; sell — повод продать (корпоратив, подарок, ДР); fun — повод для игры и юмора;
 * respect — уважительно, без развлекательного тона; mourning — траур: развлекательных постов в этот день нет. */
export type DateTone = 'celebrate' | 'sell' | 'fun' | 'respect' | 'mourning'

export interface ClubDate {
  /** YYYY-MM-DD; у сезона — первый день. */
  date: string
  /** Последний день сезона (у обычной даты нет). */
  until?: string
  title: string
  tone: DateTone
  /** 3 — обязателен тематический пост, 2 — желателен, 1 — по возможности. */
  weight: 1 | 2 | 3
  note: string
  /** Своя дата клуба (из настроек), а не встроенная. */
  own?: boolean
  id?: string
}

interface Fixed {
  md: string
  title: string
  tone: DateTone
  weight: 1 | 2 | 3
  note: string
}

const FIXED: Fixed[] = [
  { md: '01-01', title: 'Новый год', tone: 'celebrate', weight: 3, note: 'поздравление и первая игра года' },
  { md: '01-07', title: 'Рождество', tone: 'celebrate', weight: 1, note: 'тёплое поздравление' },
  { md: '01-25', title: 'Татьянин день — День студентов', tone: 'fun', weight: 2, note: 'студенты, сессия, повод прийти компанией' },
  { md: '02-14', title: 'День всех влюблённых', tone: 'fun', weight: 2, note: 'мафия для пар, свидание за игровым столом, «кому ты доверишь свою роль»' },
  { md: '02-23', title: 'День защитника Отечества', tone: 'sell', weight: 3, note: 'поздравить; заранее (за 2–3 недели) продавать корпоративы и подарочные сертификаты' },
  { md: '03-08', title: 'Международный женский день', tone: 'sell', weight: 3, note: 'поздравить; заранее продавать корпоративы, сертификаты, женский миникап' },
  { md: '03-28', title: 'День возрождения балкарского народа', tone: 'respect', weight: 2, note: 'уважительное поздравление, без игрового юмора' },
  { md: '04-01', title: 'День смеха', tone: 'fun', weight: 2, note: 'розыгрыши, мемы мафии, блеф' },
  { md: '05-01', title: 'Праздник Весны и Труда', tone: 'celebrate', weight: 1, note: 'длинные выходные — позвать на игры' },
  { md: '05-09', title: 'День Победы', tone: 'respect', weight: 3, note: 'только уважительное поздравление: без игр, юмора и продаж' },
  { md: '05-21', title: 'День памяти адыгов (черкесов) — жертв Кавказской войны', tone: 'mourning', weight: 3, note: 'траурный день: развлекательных постов и анонсов нет, допустимы только слова памяти' },
  { md: '06-01', title: 'День защиты детей', tone: 'sell', weight: 2, note: 'детская мафия, праздник для детей' },
  { md: '06-12', title: 'День России', tone: 'celebrate', weight: 2, note: 'поздравление, выходной — позвать на игру' },
  { md: '06-27', title: 'День молодёжи', tone: 'fun', weight: 2, note: 'молодые игроки клуба, позвать новичков' },
  { md: '07-08', title: 'День семьи, любви и верности', tone: 'celebrate', weight: 1, note: 'семьи и пары за столом' },
  { md: '09-01', title: 'День знаний и День государственности КБР', tone: 'celebrate', weight: 2, note: 'новый сезон, набор в школу мафии; поздравление республике' },
  { md: '09-20', title: 'День адыгов (черкесов)', tone: 'respect', weight: 2, note: 'уважительное поздравление, культура и традиции' },
  { md: '10-05', title: 'День учителя', tone: 'sell', weight: 1, note: 'повод для корпоратива коллектива' },
  { md: '10-31', title: 'Хэллоуин', tone: 'fun', weight: 3, note: 'тематическая игра и вечеринка, костюмы, анонс заранее' },
  { md: '11-04', title: 'День народного единства', tone: 'celebrate', weight: 2, note: 'выходной — позвать на игру' },
  { md: '12-31', title: 'Канун Нового года', tone: 'celebrate', weight: 3, note: 'итоги года клуба, поздравление' },
]

interface Season {
  from: string
  to: string
  title: string
  tone: DateTone
  weight: 1 | 2 | 3
  note: string
}

/** Сезоны продаж и поведения аудитории (каждый год). */
const SEASONS: Season[] = [
  { from: '11-01', to: '12-27', title: 'Сезон новогодних корпоративов', tone: 'sell', weight: 3, note: 'продавать корпоративы и аренду зала заранее: с начала ноября, каждую неделю' },
  { from: '01-25', to: '02-08', title: 'Студенческие каникулы', tone: 'fun', weight: 1, note: 'студенты свободны — дневные и вечерние игры' },
  { from: '06-15', to: '06-30', title: 'Выпускные', tone: 'sell', weight: 2, note: 'мафия для выпускников и классов' },
  { from: '06-01', to: '08-31', title: 'Летние каникулы', tone: 'sell', weight: 1, note: 'детская мафия, дни рождения детей' },
]

/** Плавающие даты по годам. Мусульманские — ориентировочно. */
const FLOATING: Record<number, Fixed[]> = {
  2026: [
    { md: '02-16', title: 'Масленица (неделя до 22 февраля)', tone: 'fun', weight: 1, note: 'весёлый повод, без продаж' },
    { md: '03-20', title: 'Ураза-байрам', tone: 'respect', weight: 3, note: 'выходной в КБР; уважительное поздравление, без бара и алкоголя' },
    { md: '04-12', title: 'Пасха', tone: 'respect', weight: 1, note: 'короткое поздравление' },
    { md: '05-27', title: 'Курбан-байрам', tone: 'respect', weight: 3, note: 'выходной в КБР; уважительное поздравление, без бара и алкоголя' },
  ],
  2027: [
    { md: '03-08', title: 'Масленица (неделя до 14 марта)', tone: 'fun', weight: 1, note: 'весёлый повод, без продаж' },
    { md: '03-10', title: 'Ураза-байрам', tone: 'respect', weight: 3, note: 'выходной в КБР; уважительное поздравление, без бара и алкоголя' },
    { md: '05-02', title: 'Пасха', tone: 'respect', weight: 1, note: 'короткое поздравление' },
    { md: '05-17', title: 'Курбан-байрам', tone: 'respect', weight: 3, note: 'выходной в КБР; уважительное поздравление, без бара и алкоголя' },
  ],
}

/** Рамадан: вечерних гостей-мусульман меньше, бар — без акцента. */
const RAMADAN: Record<number, { from: string; to: string }> = {
  2026: { from: '02-18', to: '03-19' },
  2027: { from: '02-08', to: '03-09' },
}

const TONE_LABEL: Record<DateTone, string> = {
  celebrate: 'праздник',
  sell: 'повод продать',
  fun: 'повод поиграть',
  respect: 'уважительно',
  mourning: 'траур',
}

export interface OwnDate {
  id: string
  day: string
  title: string
  note: string
}

export async function listOwnDates(db: Database): Promise<OwnDate[]> {
  return rows<OwnDate>(await db.execute(sql`SELECT id, day, title, note FROM smm_dates ORDER BY day, title`)).map((r) => ({ id: String(r.id), day: r.day, title: r.title, note: r.note ?? '' }))
}

const yearsOf = (from: string, to: string): number[] => {
  const out: number[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) out.push(y)
  return out
}

/** Все даты (и сезоны), которые пересекаются с промежутком [from; to] (YYYY-MM-DD). */
export async function datesBetween(db: Database, from: string, to: string): Promise<ClubDate[]> {
  const own = await listOwnDates(db).catch(() => [] as OwnDate[])
  const out: ClubDate[] = []
  const inRange = (date: string) => date >= from && date <= to
  for (const year of yearsOf(from, to)) {
    for (const f of [...FIXED, ...(FLOATING[year] ?? [])]) {
      const date = `${year}-${f.md}`
      if (inRange(date)) out.push({ date, title: f.title, tone: f.tone, weight: f.weight, note: f.note })
    }
    for (const s of SEASONS) {
      const start = `${year}-${s.from}`
      const end = `${year}-${s.to}`
      if (start <= to && end >= from) out.push({ date: start, until: end, title: s.title, tone: s.tone, weight: s.weight, note: s.note })
    }
    const ramadan = RAMADAN[year]
    if (ramadan && `${year}-${ramadan.from}` <= to && `${year}-${ramadan.to}` >= from) {
      out.push({ date: `${year}-${ramadan.from}`, until: `${year}-${ramadan.to}`, title: 'Рамадан (ориентировочно)', tone: 'respect', weight: 1, note: 'вечерних гостей-мусульман меньше; без акцента на бар и алкоголь' })
    }
    for (const d of own) {
      // MM-DD — каждый год; YYYY-MM-DD — один раз, в свой год.
      const date = d.day.length === 5 ? `${year}-${d.day}` : d.day
      if (inRange(date) && date.startsWith(String(year))) out.push({ date, title: d.title, tone: 'celebrate', weight: 3, note: d.note || 'своя дата клуба', own: true, id: d.id })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.weight - a.weight)
}

/** Строки для промпта: дата, что за повод, как использовать. */
export function datesText(list: ClubDate[]): string {
  return list
    .map((d) => `- ${d.date}${d.until ? `…${d.until}` : ''}: ${d.title} [${TONE_LABEL[d.tone]}, важность ${d.weight}] — ${d.note}`)
    .join('\n')
}

/** Даты, на которые в плане обязателен тематический пост (важность 3, не сезоны и не траур). */
export const mustCover = (list: ClubDate[]): ClubDate[] => list.filter((d) => d.weight === 3 && !d.until && d.tone !== 'mourning')

/** Траурные дни из промежутка — в них нельзя ставить развлекательные публикации. */
export const mourningDays = (list: ClubDate[]): string[] => list.filter((d) => d.tone === 'mourning').map((d) => d.date)
