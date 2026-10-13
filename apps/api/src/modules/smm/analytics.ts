/**
 * Аналитика СММ для приложения. По каждой площадке: история (подписчики, охват),
 * сравнение форматов, лучшие дни недели и часы, топ публикаций за 60 дней (и не
 * только от Tai). По нашим вышедшим постам — прогноз против факта и точность.
 * Цифры за 7 и 30 дней и аудитория Instagram лежат в сводке площадки (accounts.stats).
 */
import { sql, type Database } from '@titan/database'
import { listAccounts, listPosts, listReports, rows } from './db.js'
import { withForecast } from './forecast.js'
import { accountHistory } from './stats.js'
import type { SmmFormat, SmmPost } from './types.js'
import { withAuto } from './workflow.js'

const WINDOW_DAYS = 60
const MIN_POSTS = 2
const HOUR_BUCKETS = [[6, 12], [12, 15], [15, 18], [18, 21], [21, 24], [0, 6]] as const

export interface TopPost {
  extId: string
  format: SmmFormat
  publishedAt: string | null
  caption: string
  permalink: string | null
  thumb: string | null
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  postId: string | null
}

export interface PlatformInsight {
  accountId: string
  platform: string
  posts: number
  formats: { format: SmmFormat; posts: number; avgViews: number; avgLikes: number | null }[]
  weekdays: { weekday: number; posts: number; avgViews: number }[]
  hours: { from: number; to: number; posts: number; avgViews: number }[]
  top: TopPost[]
}

export interface ForecastAccuracy {
  posts: number
  /** Сколько вышло в коридоре прогноза, выше и ниже. */
  inside: number
  above: number
  below: number
  /** Факт к прогнозу в среднем: 1.2 — на 20% больше ожидания. */
  ratio: number | null
}

type Row = Record<string, unknown>
const num = (v: unknown) => (v == null ? null : Number(v))
const avg = (list: number[]) => (list.length ? Math.round(list.reduce((s, v) => s + v, 0) / list.length) : 0)

/** Час и день недели по Москве. */
function msk(iso: string): { weekday: number; hour: number } {
  const d = new Date(Date.parse(iso) + 3 * 3600_000)
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() }
}

function insightOf(accountId: string, platform: string, list: Row[]): PlatformInsight {
  const mature = list.filter((r) => r['views'] != null && r['published_at'] && Date.parse(String(r['published_at'])) < Date.now() - 86_400_000)
  const views = (r: Row) => Number(r['views'])
  const formats = (['post', 'carousel', 'reel', 'story'] as SmmFormat[])
    .map((format) => {
      const of = mature.filter((r) => r['format'] === format)
      const likes = of.map((r) => num(r['likes']) ?? num(r['reactions'])).filter((v): v is number => v != null)
      return { format, posts: of.length, avgViews: avg(of.map(views)), avgLikes: likes.length ? avg(likes) : null }
    })
    .filter((f) => f.posts > 0)
  const feed = mature.filter((r) => r['format'] !== 'story')
  const weekdays = [1, 2, 3, 4, 5, 6, 0]
    .map((weekday) => {
      const of = feed.filter((r) => msk(String(r['published_at'])).weekday === weekday)
      return { weekday, posts: of.length, avgViews: avg(of.map(views)) }
    })
    .filter((w) => w.posts >= MIN_POSTS)
  const hours = HOUR_BUCKETS
    .map(([from, to]) => {
      const of = feed.filter((r) => {
        const h = msk(String(r['published_at'])).hour
        return h >= from && h < to
      })
      return { from, to, posts: of.length, avgViews: avg(of.map(views)) }
    })
    .filter((h) => h.posts >= MIN_POSTS)
  const top = [...list]
    .filter((r) => r['views'] != null && r['format'] !== 'story')
    .sort((a, b) => views(b) - views(a))
    .slice(0, 6)
    .map((r) => ({
      extId: String(r['ext_id']),
      format: String(r['format']) as SmmFormat,
      publishedAt: r['published_at'] ? new Date(String(r['published_at'])).toISOString() : null,
      caption: String(r['caption'] ?? ''),
      permalink: r['permalink'] ? String(r['permalink']) : null,
      thumb: r['thumb_url'] ? String(r['thumb_url']) : null,
      views: num(r['views']),
      reach: num(r['reach']),
      likes: num(r['likes']) ?? num(r['reactions']),
      comments: num(r['comments']),
      shares: num(r['shares']),
      saves: num(r['saves']),
      postId: r['post_id'] ? String(r['post_id']) : null,
    }))
  return { accountId, platform, posts: list.length, formats, weekdays, hours, top }
}

/** Насколько прогнозы сбылись: по вышедшим постам с замороженным прогнозом и фактом. */
export function accuracyOf(posts: SmmPost[]): ForecastAccuracy {
  const judged = posts.filter((p) => p.forecast?.frozen && p.forecast.expected > 0 && typeof p.stats.views === 'number')
  const ratios = judged.map((p) => p.stats.views! / p.forecast!.expected)
  return {
    posts: judged.length,
    inside: judged.filter((p) => p.stats.views! >= p.forecast!.low && p.stats.views! <= p.forecast!.high).length,
    above: judged.filter((p) => p.stats.views! > p.forecast!.high).length,
    below: judged.filter((p) => p.stats.views! < p.forecast!.low).length,
    ratio: ratios.length ? Math.round((ratios.reduce((s, v) => s + v, 0) / ratios.length) * 100) / 100 : null,
  }
}

export async function analyticsPayload(db: Database) {
  const [accounts, history, published, reports, platformRows] = await Promise.all([
    listAccounts(db),
    accountHistory(db, WINDOW_DAYS),
    listPosts(db, { from: new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString(), status: ['published'] }),
    listReports(db, 12),
    db.execute(sql`
      SELECT * FROM smm_platform_posts WHERE published_at > now() - make_interval(days => ${WINDOW_DAYS}) ORDER BY published_at DESC
    `).then((r) => rows<Row>(r)),
  ])
  const posts = await withForecast(db, await withAuto(db, published.reverse()))
  const platforms = accounts
    .filter((a) => a.isActive && (a.platform === 'telegram' || a.platform === 'instagram'))
    .map((a) => insightOf(a.id, a.platform, platformRows.filter((r) => r['account_id'] === a.id)))
  return { accounts, history, platforms, posts, accuracy: accuracyOf(posts), reports }
}
