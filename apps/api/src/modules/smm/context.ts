/**
 * Что Tai знает о клубе, когда придумывает и пишет: заведение и контакты, форматы,
 * расписание вечеров, цены, ближайшие турниры и мероприятия, прошедшие события с
 * сайта, что любят в баре, когда гостей мало. Плюс маркетинговая часть: голос
 * бренда, память, площадки и как заходили прошлые публикации.
 *
 * Частные мероприятия — без названий и заказчиков: только вид и дата.
 */
import { appSettings, inArray, sql, type Database } from '@titan/database'
import { getStringSetting } from '../../lib/appSettings.js'
import { DEFAULT_CLUB_BRIEF } from '../tg/dialog/client-tools.js'
import { gameConfigs, upcomingNights } from '../tg/games.js'
import { parseSchedule } from '../site/site.router.js'
import { readSiteContacts, readSiteDomain } from '../site/settings.js'
import { taiUsername } from '../tg/club.js'
import { listAccounts, listMemory, listReports, rows } from './db.js'
import { getSmmSettings, type SmmSettings } from './settings.js'

const WEEKDAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
const MSK_MS = 3 * 3600_000
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export const mskDate = (ms = Date.now()): string => new Date(ms + MSK_MS).toISOString().slice(0, 10)

/** «2026-10-20» + «19:00» по Москве → ISO. null — дата или время не распознаны. */
export function mskToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const d = new Date(`${date}T${time.padStart(5, '0')}:00+03:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Название клуба для промптов и подписей. */
export async function clubTitle(db: Database): Promise<string> {
  return (await getStringSetting('venue_name', '', db)) || 'TITAN KBR'
}

type Row = Record<string, unknown>

async function venue(db: Database): Promise<string[]> {
  const keys = ['venue_name', 'venue_address', 'hours_open', 'hours_close', 'site_schedule']
  const settings = await db.select().from(appSettings).where(inArray(appSettings.key, keys))
  const m = Object.fromEntries(settings.map((r) => [r.key, r.value ?? '']))
  const [contacts, domain, bot, brief] = await Promise.all([
    readSiteContacts(db).catch(() => null),
    readSiteDomain(db).catch(() => null),
    taiUsername(db).catch(() => null),
    getStringSetting('tai_club_brief', '', db),
  ])
  const lines = [
    `Клуб: ${m['venue_name'] || 'TITAN KBR'}${m['venue_address'] ? `, адрес: ${m['venue_address']}` : ''}${m['hours_open'] ? `, работает ${m['hours_open']}–${m['hours_close']}` : ''}.`,
    domain?.url ? `Сайт клуба (там онлайн-запись на игры и мероприятия): ${domain.url}` : '',
    bot ? `Telegram-бот клуба Tai: @${bot} — запись на игру, ответы на вопросы, бонусы.` : '',
    contacts?.phone ? `Телефон: ${contacts.phone}` : '',
    `О клубе и форматах:\n${brief.trim() || DEFAULT_CLUB_BRIEF}`,
  ]
  const schedule = parseSchedule(m['site_schedule'])
  if (schedule?.length) {
    lines.push(`Расписание вечеров: ${schedule.map((d) => `${WEEKDAYS[d.day] ?? ''} — ${d.title}${d.time ? ` в ${d.time}` : ''}`).join('; ')}.`)
  }
  return lines
}

async function prices(db: Database): Promise<string[]> {
  const [tariffRows, rateRows, zoneRows] = await Promise.all([
    db.execute(sql`SELECT name, price FROM tariffs WHERE is_active ORDER BY sort_order, name LIMIT 12`),
    db.execute(sql`SELECT hours, price FROM event_hourly_rates ORDER BY hours LIMIT 8`),
    db.execute(sql`SELECT name, capacity, hourly_rate FROM spaces WHERE is_active ORDER BY name LIMIT 8`),
  ])
  const tariffs = rows<Row>(tariffRows).map((t) => `${t['name']}: ${rub(Number(t['price']))}`)
  const rates = rows<Row>(rateRows).map((r) => `${r['hours']} ч — ${rub(Number(r['price']))}`)
  const zones = rows<Row>(zoneRows).map((z) => `${z['name']}${z['capacity'] ? ` (до ${z['capacity']} чел.)` : ''}: ${rub(Number(z['hourly_rate']))}/ч`)
  return [
    tariffs.length ? `Вход на вечер: ${tariffs.join('; ')}.` : '',
    rates.length ? `Мероприятие под ключ (ДР, корпоратив): ${rates.join('; ')}.` : '',
    zones.length ? `Аренда зон: ${zones.join('; ')}.` : '',
  ]
}

async function calendar(db: Database, days: number): Promise<string[]> {
  const nights = upcomingNights(await gameConfigs(db).catch(() => []), Math.min(days, 21))
  const from = mskDate()
  const to = mskDate(Date.now() + days * 86_400_000)
  const events = rows<Row>(await db.execute(sql`
    SELECT date, start_time, title, type, format FROM events
    WHERE date >= ${from} AND date <= ${to} AND status IN ('planned', 'active', 'needs_clarification')
    ORDER BY date, start_time LIMIT 80
  `))
  const tournaments = events.filter((e) => e['format'] === 'minicap').map((e) => `${e['date']} ${e['start_time']} — турнир (миникап)${e['title'] ? ` «${e['title']}»` : ''}`)
  const privateCount = events.filter((e) => e['format'] !== 'minicap').length
  return [
    nights.length ? `Игровые вечера ближайшие дни: ${nights.slice(0, 20).map((n) => `${n.date} ${n.title}${n.time ? ` в ${n.time}` : ''}`).join('; ')}.` : '',
    tournaments.length ? `Турниры: ${tournaments.join('; ')}.` : '',
    privateCount ? `Частных мероприятий в календаре (ДР, корпоративы, выезды) до ${to}: ${privateCount} — без имён, можно упоминать в общем («клуб нарасхват»).` : '',
  ]
}

async function pastStories(db: Database): Promise<string[]> {
  const stories = rows<Row>(await db.execute(sql`
    SELECT title, tagline, event_date, stats FROM site_stories WHERE is_published ORDER BY event_date DESC NULLS LAST LIMIT 6
  `).catch(() => []))
  if (!stories.length) return []
  return [`Прошедшие события клуба (с сайта): ${stories.map((s) => {
    const stats = Array.isArray(s['stats']) ? (s['stats'] as { value: string; label: string }[]).map((x) => `${x.value} ${x.label}`).join(', ') : ''
    return `${s['title']}${s['event_date'] ? ` (${String(s['event_date']).slice(0, 10)})` : ''}${s['tagline'] ? ` — ${s['tagline']}` : ''}${stats ? ` [${stats}]` : ''}`
  }).join('; ')}.`]
}

async function bar(db: Database): Promise<string[]> {
  const top = rows<Row>(await db.execute(sql`
    SELECT i.name, sum(ci.quantity)::int AS qty
    FROM check_items ci
    JOIN checks c ON c.id = ci.check_id AND c.status = 'closed' AND c.closed_at > now() - interval '30 days'
    JOIN inventory i ON i.id = ci.item_id
    GROUP BY i.name ORDER BY qty DESC LIMIT 8
  `).catch(() => []))
  return top.length ? [`Популярное в баре за месяц: ${top.map((t) => t['name']).join(', ')}.`] : []
}

/** Сколько гостей (закрытых чеков) в среднем по дням недели за 8 недель — где проседает. */
async function traffic(db: Database): Promise<string[]> {
  const byDow = rows<Row>(await db.execute(sql`
    SELECT extract(isodow FROM (closed_at AT TIME ZONE 'Europe/Moscow') - interval '6 hours')::int AS dow, count(*)::int AS n
    FROM checks WHERE status = 'closed' AND closed_at > now() - interval '56 days'
    GROUP BY 1 ORDER BY 1
  `).catch(() => []))
  if (!byDow.length) return []
  return [`Гостей в среднем за день по дням недели (8 недель): ${byDow.map((d) => `${WEEKDAYS[Number(d['dow'])] ?? '?'} ~${Math.round(Number(d['n']) / 8)}`).join(', ')}.`]
}

/** Факты о клубе для промпта: всё, что можно обещать и упоминать в постах. */
export async function clubFacts(db: Database, days = 45): Promise<string> {
  const parts = await Promise.all([venue(db), prices(db), calendar(db, days), pastStories(db), bar(db), traffic(db)].map((p) => p.catch((error) => {
    console.warn('[smm] контекст клуба: часть не загрузилась', error instanceof Error ? error.message : error)
    return [] as string[]
  })))
  return parts.flat().filter(Boolean).join('\n')
}

export interface MarketingContext {
  settings: SmmSettings
  text: string
}

/** Маркетинговая часть: голос, цели, память Tai, площадки, как заходили прошлые посты. */
export async function marketingContext(db: Database): Promise<MarketingContext> {
  const [settings, memory, accounts, reports, recent] = await Promise.all([
    getSmmSettings(db),
    listMemory(db),
    listAccounts(db),
    listReports(db, 1),
    db.execute(sql`
      SELECT platform, format, topic, published_at, stats FROM smm_posts
      WHERE status = 'published' AND published_at > now() - interval '45 days'
      ORDER BY published_at DESC LIMIT 25
    `).then((r) => rows<Row>(r)),
  ])
  const memoryLines = memory.slice(0, 60).map((m) => `- [${m.kind}] ${m.text}`)
  const accountLines = accounts.filter((a) => a.isActive).map((a) => `${a.platform}: ${a.title}${a.handle ? ` (@${a.handle})` : ''}${a.followers != null ? `, подписчиков ${a.followers}` : ''}`)
  const recentLines = recent.map((p) => {
    const s = (p['stats'] ?? {}) as Record<string, number>
    const nums = ['views', 'likes', 'comments', 'shares', 'saves', 'reach'].filter((k) => s[k] != null).map((k) => `${k} ${s[k]}`).join(', ')
    return `- ${String(p['published_at']).slice(0, 10)} ${p['platform']}/${p['format']}: ${p['topic']}${nums ? ` → ${nums}` : ''}`
  })
  const report = reports[0]
  const text = [
    `Голос бренда: ${settings.voice}`,
    `Аудитория: ${settings.audience}`,
    `Цели маркетинга: ${settings.goals}`,
    accountLines.length ? `Площадки: ${accountLines.join('; ')}.` : '',
    memoryLines.length ? `Память (правила владельца и выводы — соблюдай всегда):\n${memoryLines.join('\n')}` : '',
    recentLines.length ? `Последние публикации и их результат:\n${recentLines.join('\n')}` : '',
    report ? `Выводы последнего отчёта (${report.periodFrom}..${report.periodTo}): ${report.recommendations.map((r) => r.title).join('; ')}` : '',
  ].filter(Boolean).join('\n')
  return { settings, text }
}
