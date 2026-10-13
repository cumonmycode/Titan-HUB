/**
 * Tai изучает клуб:
 *  1. История соцсетей — вся лента Telegram-канала (t.me/s, через шлюз) и Instagram (API)
 *     в smm_platform_posts, потом разбор частями: голос, рубрики, события, люди, что
 *     заходило и что нет → раздел 'socials' базы знаний.
 *  2. Портрет клуба — из публичного: карточка на GoMafia (описание, место, резиденты),
 *     прошедшие события с сайта, расписание и цены, выводы из соцсетей и слова
 *     владельца → раздел 'club'. Только факты из источников, без выдумок.
 * Запускается кнопкой в «Базе знаний» и раз в неделю кроном.
 */
import { sql, type Database } from '@titan/database'
import { z } from 'zod'
import { getClubIntegration } from '../../lib/secrets.js'
import { clubResidents } from '../../lib/gomafia.js'
import { chatJson } from './ai.js'
import { clubFacts, clubTitle } from './context.js'
import { listAccounts, rows, type AccountRow } from './db.js'
import { igAllMedia, instagramState } from './instagram.js'
import { claimDoc, getDoc, saveAiText, setDocProgress } from './knowledge.js'
import { webFetch } from './relay.js'
import { igFormat, parseChannelPage, upsertPlatformPost } from './stats.js'
import { plainText } from './telegram.js'
import { SmmError, step } from './types.js'

const TG_MAX_PAGES = 80
/** Сколько знаков ленты в одном заходе разбора. */
const CHUNK_CHARS = 40_000
const MAX_CHUNKS = 6
const STUDY_SYSTEM = 'Ты — Tai, SMM-менеджер клуба мафии. Изучаешь прошлые публикации клуба, чтобы продолжать в том же духе и не повторяться. Пишешь по-русски, коротко и по делу, только то, что видно в постах. Ответ — один JSON.'

// ─── 1. Вся история площадок ─────────────────────────────────────────────────

async function telegramHistory(db: Database, account: AccountRow): Promise<number> {
  if (!account.handle) return 0
  let before: number | null = null
  let seen = 0
  for (let page = 0; page < TG_MAX_PAGES; page += 1) {
    const res = await webFetch(`https://t.me/s/${account.handle}${before ? `?before=${before}` : ''}`).catch(() => null)
    if (!res?.ok) break
    const parsed = parseChannelPage(await res.text(), account.handle)
    for (const p of parsed.posts) {
      seen += 1
      await upsertPlatformPost(db, account, {
        extId: String(p.id), format: p.format, publishedAt: p.at, caption: p.text,
        permalink: `https://t.me/${account.handle}/${p.id}`, thumb: p.thumb, views: p.views, reactions: p.reactions,
      })
    }
    if (!parsed.before || !parsed.posts.length) break
    before = parsed.before
  }
  return seen
}

async function instagramHistory(db: Database, account: AccountRow): Promise<number> {
  if (!(await instagramState(db))) return 0
  const media = await igAllMedia(db)
  for (const m of media) {
    await upsertPlatformPost(db, account, {
      extId: m.id, format: igFormat(m), publishedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      caption: plainText(m.caption ?? ''), permalink: m.permalink ?? null, thumb: m.thumbnail_url ?? m.media_url ?? null,
      likes: m.like_count ?? null, comments: m.comments_count ?? null,
    })
  }
  return media.length
}

/** Выгрузить всю ленту площадок клуба. Возвращает, сколько постов увидели по площадкам. */
export async function collectHistory(db: Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const account of (await listAccounts(db)).filter((a) => a.isActive)) {
    try {
      const n = account.platform === 'telegram' ? await telegramHistory(db, account) : account.platform === 'instagram' ? await instagramHistory(db, account) : 0
      counts[account.platform] = (counts[account.platform] ?? 0) + n
    } catch (error) {
      console.warn('[smm] история площадки', account.title, error instanceof Error ? error.message : error)
    }
  }
  return counts
}

// ─── 2. Разбор истории ───────────────────────────────────────────────────────

const NotesSchema = z.object({
  voice: z.string().max(1500),
  rubrics: z.array(z.string().max(300)).max(15),
  events: z.array(z.string().max(300)).max(30),
  people: z.array(z.string().max(200)).max(20),
  facts: z.array(z.string().max(300)).max(25),
  hits: z.array(z.string().max(300)).max(10),
  misses: z.array(z.string().max(300)).max(10),
})
type Notes = z.infer<typeof NotesSchema>

const SummarySchema = z.object({ text: z.string().min(200).max(6000), facts: z.array(z.string().max(300)).max(30) })

interface HistoryRow {
  platform: string
  format: string
  published_at: string | Date | null
  caption: string
  views: number | null
  likes: number | null
  comments: number | null
}

function postLine(p: HistoryRow): string {
  const day = p.published_at ? new Date(p.published_at).toISOString().slice(0, 10) : '—'
  const nums = [p.views != null && `👁${p.views}`, p.likes != null && `❤${p.likes}`, p.comments != null && `💬${p.comments}`].filter(Boolean).join(' ')
  return `[${day} ${p.platform === 'telegram' ? 'TG' : 'IG'} ${p.format}${nums ? ` ${nums}` : ''}] ${p.caption.replace(/\s+/g, ' ').trim().slice(0, 900)}`
}

function chunks(lines: string[]): string[] {
  const out: string[] = []
  let current = ''
  for (const line of lines) {
    if (current.length + line.length > CHUNK_CHARS && current) {
      out.push(current)
      current = ''
    }
    current += `${line}\n`
  }
  if (current) out.push(current)
  // Слишком длинная история — берём самое свежее.
  return out.slice(-MAX_CHUNKS)
}

const NOTES_TASK = [
  'Выпиши из этих публикаций клуба (новые — внизу):',
  'voice — как клуб пишет: обращение, длина, эмодзи, шутки, типичные слова и обороты;',
  'rubrics — повторяющиеся рубрики и форматы (анонсы вечеров, итоги турниров, выезды, мерч и т.д.);',
  'events — события и инфоповоды с датами и названиями (турниры, выезды, праздники, места, результаты);',
  'people — люди и лица клуба, которых упоминают публично (ники игроков, ведущие, партнёры) и в какой роли;',
  'facts — факты о клубе (услуги, адреса, мерч, партнёры, традиции, цифры);',
  'hits — что набрало больше всего просмотров и реакций и почему (с цифрами); misses — что прошло слабо.',
  'Ответ — JSON: {"voice": "...", "rubrics": [...], "events": [...], "people": [...], "facts": [...], "hits": [...], "misses": [...]}',
].join('\n')

/** Разобрать всю историю площадок и записать выводы в базу знаний. */
export async function studySocials(db: Database): Promise<void> {
  try {
    await setDocProgress(db, 'socials', step('Собираю всю ленту Telegram и Instagram', 2, 30, 60))
    const counts = await collectHistory(db)
    const history = rows<HistoryRow>(await db.execute(sql`
      SELECT platform, format, published_at, caption, views, coalesce(likes, reactions) AS likes, comments
      FROM smm_platform_posts WHERE length(caption) > 15 ORDER BY published_at NULLS FIRST
    `))
    if (!history.length) throw new SmmError('В соцсетях клуба пока нечего изучать — подключите канал и Instagram', 400)
    const parts = chunks(history.map(postLine))
    const notes: Notes[] = []
    for (let i = 0; i < parts.length; i += 1) {
      const from = 30 + Math.round((55 * i) / parts.length)
      await setDocProgress(db, 'socials', step(`Читаю посты: часть ${i + 1} из ${parts.length}`, from, from + Math.round(55 / parts.length), 25))
      notes.push(await chatJson(db, { system: STUDY_SYSTEM, note: 'изучение соцсетей', maxTokens: 4000, temperature: 0.3, schema: NotesSchema, user: `${NOTES_TASK}\n\nПубликации:\n${parts[i]}` }))
    }
    await setDocProgress(db, 'socials', step('Свожу выводы', 85, 99, 25))
    const summary = await chatJson(db, {
      system: STUDY_SYSTEM,
      note: 'выводы по соцсетям',
      maxTokens: 5000,
      temperature: 0.3,
      schema: SummarySchema,
      user: [
        `Заметки по всей истории соцсетей клуба (${history.length} публикаций, части по порядку времени):`,
        JSON.stringify(notes),
        '',
        'Сведи в памятку для себя на будущее — по разделам, коротко, с датами и цифрами:',
        '«Как мы пишем» (голос и приёмы), «Рубрики и форматы», «События и традиции» (что и когда было), «Люди клуба» (только публичные ники и роли), «Что заходило» и «Что не заходило», «Не повторять» (темы и заходы, которые уже были недавно).',
        'Ответ — JSON: {"text": "памятка, 1500–4000 знаков, разделы с заголовками на отдельной строке", "facts": ["факты о клубе из постов, по одному"]}',
      ].join('\n'),
    })
    await saveAiText(db, 'socials', summary.text, { counts, posts: history.length, facts: summary.facts, studiedAt: new Date().toISOString() })
  } catch (error) {
    await setDocProgress(db, 'socials', null, error instanceof Error ? error.message.slice(0, 300) : 'Не получилось')
    throw error
  }
}

// ─── 3. Портрет клуба ────────────────────────────────────────────────────────

const PortraitSchema = z.object({ text: z.string().min(300).max(7000) })

async function gomafiaSource(db: Database): Promise<string> {
  const clubId = await getClubIntegration(db, 'gomafia_club_id').catch(() => null)
  if (!clubId) return ''
  const { club, residents, total } = await clubResidents(clubId).catch(() => ({ club: null, residents: [], total: 0 }))
  if (!club) return ''
  const top = residents.filter((r) => r.elo != null).sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0)).slice(0, 8)
  return [
    `GoMafia (gomafia.pro/club/${clubId}): «${club.title ?? ''}», город ${club.city ?? '—'}${club.rank ? `, ${club.rank}-е место в рейтинге клубов` : ''}, резидентов ${total}.`,
    club.description ? `Описание клуба на GoMafia: ${plainText(club.description).replace(/\s+/g, ' ')}` : '',
    top.length ? `Сильнейшие резиденты по рейтингу (ники): ${top.map((r) => `${r.login} (ELO ${Math.round(r.elo ?? 0)}${r.tournaments ? `, турниров ${r.tournaments}` : ''})`).join('; ')}.` : '',
  ].filter(Boolean).join('\n')
}

async function siteStories(db: Database): Promise<string> {
  const list = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT title, tagline, event_date FROM site_stories WHERE is_published ORDER BY event_date DESC NULLS LAST LIMIT 30
  `).catch(() => []))
  return list.length ? `События клуба с сайта: ${list.map((s) => `«${s['title']}»${s['event_date'] ? ` (${String(s['event_date']).slice(0, 10)})` : ''}${s['tagline'] ? ` — ${s['tagline']}` : ''}`).join('; ')}.` : ''
}

/** Собрать портрет клуба из публичных источников и слов владельца. */
export async function composePortrait(db: Database): Promise<void> {
  try {
    await setDocProgress(db, 'club', step('Собираю, что известно о клубе', 3, 30, 15))
    const [name, facts, gomafia, stories, club, socials] = await Promise.all([clubTitle(db), clubFacts(db, 30), gomafiaSource(db), siteStories(db), getDoc(db, 'club'), getDoc(db, 'socials')])
    const socialFacts = Array.isArray(socials.meta['facts']) ? (socials.meta['facts'] as string[]) : []
    await setDocProgress(db, 'club', step('Пишу портрет клуба', 30, 98, 40))
    const r = await chatJson(db, {
      system: `Ты — Tai, SMM-менеджер клуба «${name}». Собираешь портрет клуба для себя — чтобы писать о нём точно. Только факты из источников ниже; чего нет — не выдумывай. Пишешь по-русски. Ответ — один JSON.`,
      note: 'портрет клуба',
      maxTokens: 5000,
      temperature: 0.3,
      schema: PortraitSchema,
      user: [
        club.ownerText.trim() ? `Слова владельца (главный источник, важнее остальных):\n${club.ownerText.trim()}` : '',
        `Факты из системы клуба (адрес, расписание, цены, ближайшее):\n${facts}`,
        gomafia,
        stories,
        socialFacts.length ? `Факты из прошлых постов клуба:\n${socialFacts.map((f) => `- ${f}`).join('\n')}` : '',
        socials.aiText ? `Памятка по соцсетям (для контекста):\n${socials.aiText.slice(0, 3000)}` : '',
        '',
        'Напиши портрет клуба по разделам (заголовок — отдельной строкой): «Кто мы» (город, регион, чем занимаемся, сколько лет), «Форматы и расписание», «История и традиции» (турниры клуба, события, выезды), «Достижения и сообщество» (GoMafia, рейтинг, сильные игроки по никам), «Лица клуба», «Фишки и словарь клуба», «Как о нас говорить» (что подчёркивать).',
        'Ответ — JSON: {"text": "портрет, 1500–4500 знаков"}',
      ].filter(Boolean).join('\n\n'),
    })
    await saveAiText(db, 'club', r.text, { sources: { gomafia: !!gomafia, stories: !!stories, socials: socialFacts.length, owner: !!club.ownerText.trim() }, composedAt: new Date().toISOString() })
  } catch (error) {
    await setDocProgress(db, 'club', null, error instanceof Error ? error.message.slice(0, 300) : 'Не получилось')
    throw error
  }
}

/** Изучить всё: соцсети, потом портрет (он опирается на выводы из соцсетей). */
export async function studyClub(db: Database): Promise<void> {
  await studySocials(db).catch((error) => console.warn('[smm] изучение соцсетей', error instanceof Error ? error.message : error))
  await composePortrait(db)
}

export async function studyInBackground(db: Database, what: 'socials' | 'club'): Promise<boolean> {
  const label = what === 'socials' ? 'Собираю всю ленту Telegram и Instagram' : 'Собираю, что известно о клубе'
  if (!(await claimDoc(db, what, step(label, 2, 10, 10)))) return false
  const run = what === 'socials' ? () => studyClub(db) : () => composePortrait(db)
  void run().catch((error) => console.error('[smm] изучение клуба', what, error instanceof Error ? error.message : error))
  return true
}
