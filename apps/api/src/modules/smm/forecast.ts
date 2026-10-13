/**
 * Прогноз просмотров публикации — по похожим постам той же площадки за 90 дней:
 * медиана (ожидание) и разброс (нижняя и верхняя четверть). Свой формат берём, если
 * таких постов хотя бы три, иначе все посты площадки с поправкой на формат.
 * Свежие посты (меньше двух суток) в расчёт не идут — их просмотры ещё растут.
 *
 * В момент выхода прогноз замораживается (frozen) — с ним сравнивается факт.
 */
import { sql, type Database } from '@titan/database'
import { loadPost, rows, updatePost } from './db.js'
import type { SmmForecast, SmmPost } from './types.js'

const MIN_SAME_FORMAT = 3
const HISTORY_DAYS = 90
/** Во сколько раз формат обычно набирает больше (меньше) среднего поста площадки. */
const FORMAT_FACTOR: Record<SmmPost['format'], number> = { post: 1, carousel: 1.15, reel: 1.6, story: 0.5 }

interface Sample {
  platform: string
  format: string
  views: number
  likes: number | null
}

export interface ForecastModel {
  samples: Sample[]
}

export async function loadForecastModel(db: Database): Promise<ForecastModel> {
  const list = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT pp.platform, pp.format, pp.views, coalesce(pp.likes, pp.reactions) AS likes
    FROM smm_platform_posts pp JOIN smm_accounts a ON a.id = pp.account_id AND a.is_active
    WHERE pp.views IS NOT NULL
      AND pp.published_at > now() - make_interval(days => ${HISTORY_DAYS})
      AND pp.published_at < now() - interval '2 days'
  `).catch(() => []))
  return {
    samples: list.map((r) => ({
      platform: String(r['platform']),
      format: String(r['format']),
      views: Number(r['views']),
      likes: r['likes'] == null ? null : Number(r['likes']),
    })),
  }
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

/** Прогноз по готовой модели (без запросов к базе); нет истории площадки — null. */
export function forecastFor(model: ForecastModel, post: Pick<SmmPost, 'platform' | 'format'>): SmmForecast | null {
  const platform = model.samples.filter((s) => s.platform === post.platform)
  if (!platform.length) return null
  const same = platform.filter((s) => s.format === post.format)
  const base = same.length >= MIN_SAME_FORMAT ? same : platform
  const factor = base === same ? 1 : FORMAT_FACTOR[post.format]
  const views = base.map((s) => s.views).sort((a, b) => a - b)
  const likes = base.map((s) => s.likes).filter((v): v is number => v != null).sort((a, b) => a - b)
  const round = (v: number) => Math.max(0, Math.round(v * factor))
  return {
    metric: 'views',
    expected: round(quantile(views, 0.5)),
    low: round(quantile(views, 0.25)),
    high: round(quantile(views, 0.75)),
    basis: base.length,
    likes: likes.length ? round(quantile(likes, 0.5)) : null,
    at: new Date().toISOString(),
  }
}

/** Публикациям — прогноз: замороженный (вышедшим) или посчитанный сейчас. */
export async function withForecast(db: Database, posts: SmmPost[]): Promise<SmmPost[]> {
  if (!posts.length) return posts
  const model = await loadForecastModel(db)
  return posts.map((p) => (p.forecast?.frozen ? p : { ...p, forecast: forecastFor(model, p) ?? p.forecast }))
}

/** Заморозить прогноз в момент выхода (повторный вызов не перезаписывает). */
export async function freezeForecast(db: Database, postId: string): Promise<void> {
  const post = await loadPost(db, postId)
  if (!post || post.forecast?.frozen) return
  const forecast = forecastFor(await loadForecastModel(db), post)
  if (forecast) await updatePost(db, postId, { forecast: { ...forecast, frozen: true } })
}
