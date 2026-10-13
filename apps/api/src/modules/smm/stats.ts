/**
 * Цифры площадок — только по API, без скриншотов.
 *  - Telegram: подписчики — getChatMemberCount (Tai — администратор канала); посты
 *    канала с просмотрами, реакциями и временем — публичная страница t.me/s/<канал>
 *    (через шлюз: из РФ Telegram закрыт), до пяти страниц назад.
 *  - Instagram (официальный API): профиль, охват, просмотры, вовлечённость, визиты и
 *    переходы за 7 и 30 дней, охват и новые подписчики по дням, аудитория, все
 *    публикации с метриками и живые сторис.
 * Публикации площадок — в smm_platform_posts (из них прогноз, лучшее время, сравнение
 * форматов, топ); снимок дня — smm_account_stats; сводка — smm_accounts.stats.
 * Раз в день — полный сбор, раз в час — свежие посты (первые двое суток).
 */
import { sql, type Database } from '@titan/database'
import { mskDate } from './context.js'
import { listAccounts, listPosts, rows, updatePost, type AccountRow } from './db.js'
import { freezeForecast } from './forecast.js'
import { igAudience, igDaily, igInsights, igPeriod, igProfile, igRecentMedia, igStories, instagramState, type IgMedia } from './instagram.js'
import { webFetch } from './relay.js'
import { channelMembers, plainText } from './telegram.js'
import type { SmmFormat, SmmPost, SmmPostStats } from './types.js'

const TG_PAGES = 5
const HISTORY_DAYS = 120
const IG_MEDIA_LIMIT = 50
const IG_MEDIA_FRESH_LIMIT = 10
const FRESH_MS = 48 * 3600_000
const DAY_MS = 86_400_000

/** «1.2K» → 1200, «3,4M» → 3 400 000. */
export function parseCount(text: string): number | null {
  const m = /([\d.,]+)\s*([KkMm])?/.exec(text.replace(/\s/g, ''))
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1
  return Math.round(n * mult)
}

export interface ChannelPost {
  id: number
  views: number | null
  reactions: number
  at: string | null
  text: string
  format: SmmFormat
  thumb: string | null
}

/** Посты с t.me/s/<канал>: просмотры, реакции, время, начало текста; `before` — следующая страница. */
export function parseChannelPage(html: string, handle: string): { posts: ChannelPost[]; before: number | null } {
  const posts: ChannelPost[] = []
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const id = new RegExp(`data-post="${handle}/(\\d+)"`, 'i').exec(block)?.[1]
    if (!id) continue
    const views = /tgme_widget_message_views">([^<]+)</.exec(block)?.[1]
    let reactions = 0
    for (const m of block.matchAll(/class="tgme_reaction[^"]*">[\s\S]*?<\/i>\s*([\d.,]+[KkMm]?)\s*<\/span>/g)) reactions += parseCount(m[1]!) ?? 0
    const text = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1] ?? ''
    posts.push({
      id: Number(id),
      views: views ? parseCount(views) : null,
      reactions,
      at: /<time datetime="([^"]+)"/.exec(block)?.[1] ?? null,
      text: plainText(text.replace(/<br\s*\/?>/gi, '\n')).slice(0, 200),
      format: /tgme_widget_message_grouped/.test(block) ? 'carousel' : 'post',
      thumb: /tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/.exec(block)?.[1] ?? null,
    })
  }
  const before = /tme_messages_more[^>]*data-before="(\d+)"/.exec(html)?.[1]
  return { posts, before: before ? Number(before) : null }
}

// ─── Запись ──────────────────────────────────────────────────────────────────

interface PlatformPost {
  extId: string
  format: SmmFormat
  publishedAt: string | null
  caption: string
  permalink: string | null
  thumb: string | null
  views?: number | null
  reach?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  reactions?: number | null
  interactions?: number | null
}

async function upsertPlatformPost(db: Database, account: AccountRow, p: PlatformPost): Promise<void> {
  const n = (v: number | null | undefined) => (v == null ? null : Math.round(v))
  await db.execute(sql`
    INSERT INTO smm_platform_posts (account_id, ext_id, platform, format, published_at, caption, permalink, thumb_url, views, reach, likes, comments, shares, saves, reactions, interactions, stats_at)
    VALUES (${account.id}::uuid, ${p.extId}, ${account.platform}, ${p.format}, ${p.publishedAt}::timestamptz, ${p.caption.slice(0, 300)}, ${p.permalink}, ${p.thumb},
      ${n(p.views)}, ${n(p.reach)}, ${n(p.likes)}, ${n(p.comments)}, ${n(p.shares)}, ${n(p.saves)}, ${n(p.reactions)}, ${n(p.interactions)}, now())
    ON CONFLICT (account_id, ext_id) DO UPDATE SET
      format = EXCLUDED.format, published_at = coalesce(EXCLUDED.published_at, smm_platform_posts.published_at),
      caption = EXCLUDED.caption, permalink = coalesce(EXCLUDED.permalink, smm_platform_posts.permalink), thumb_url = coalesce(EXCLUDED.thumb_url, smm_platform_posts.thumb_url),
      views = coalesce(EXCLUDED.views, smm_platform_posts.views), reach = coalesce(EXCLUDED.reach, smm_platform_posts.reach),
      likes = coalesce(EXCLUDED.likes, smm_platform_posts.likes), comments = coalesce(EXCLUDED.comments, smm_platform_posts.comments),
      shares = coalesce(EXCLUDED.shares, smm_platform_posts.shares), saves = coalesce(EXCLUDED.saves, smm_platform_posts.saves),
      reactions = coalesce(EXCLUDED.reactions, smm_platform_posts.reactions), interactions = coalesce(EXCLUDED.interactions, smm_platform_posts.interactions),
      stats_at = now()
  `)
}

interface Snapshot {
  followers?: number | null
  views?: number | null
  posts?: number | null
  engagement?: number | null
  summary: Record<string, unknown>
}

async function saveSnapshot(db: Database, accountId: string, s: Snapshot): Promise<void> {
  await db.execute(sql`
    INSERT INTO smm_account_stats (account_id, day, followers, views, posts, engagement, source)
    VALUES (${accountId}::uuid, ${mskDate()}::date, ${s.followers ?? null}, ${s.views ?? null}, ${s.posts ?? null}, ${s.engagement ?? null}, 'auto')
    ON CONFLICT (account_id, day) DO UPDATE SET
      followers = coalesce(EXCLUDED.followers, smm_account_stats.followers),
      views = coalesce(EXCLUDED.views, smm_account_stats.views),
      posts = coalesce(EXCLUDED.posts, smm_account_stats.posts),
      engagement = coalesce(EXCLUDED.engagement, smm_account_stats.engagement),
      source = 'auto'
  `)
  await db.execute(sql`
    UPDATE smm_accounts SET
      followers = coalesce(${s.followers ?? null}::int, followers),
      stats = ${JSON.stringify({ ...s.summary, views: s.views ?? null, posts: s.posts ?? null, engagement: s.engagement ?? null, source: 'auto' })}::jsonb,
      stats_at = now(), stats_error = NULL, updated_at = now()
    WHERE id = ${accountId}::uuid
  `)
}

/** Метрика по дням в историю площадки (охват, новые подписчики Instagram). */
async function saveDaily(db: Database, accountId: string, column: 'reach' | 'new_followers', series: { day: string; value: number }[]): Promise<void> {
  const col = sql.raw(column)
  for (const point of series) {
    await db.execute(sql`
      INSERT INTO smm_account_stats (account_id, day, ${col}, source) VALUES (${accountId}::uuid, ${point.day}::date, ${point.value}, 'auto')
      ON CONFLICT (account_id, day) DO UPDATE SET ${col} = EXCLUDED.${col}
    `)
  }
}

async function markError(db: Database, accountId: string, error: string): Promise<void> {
  await db.execute(sql`UPDATE smm_accounts SET stats_error = ${error.slice(0, 300)}, stats_at = now() WHERE id = ${accountId}::uuid`)
}

const median = (list: number[]): number | null => {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2)
}

/** Средние по зрелым постам (старше суток): просмотры и реакции на пост. */
async function matureAverages(db: Database, accountId: string): Promise<{ views: number | null; posts30: number; views30: number; reactions30: number }> {
  const list = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT views, coalesce(likes, reactions, 0) AS likes, published_at FROM smm_platform_posts
    WHERE account_id = ${accountId}::uuid AND format <> 'story' AND published_at > now() - interval '30 days'
    ORDER BY published_at DESC
  `))
  const mature = list.filter((r) => Date.parse(String(r['published_at'])) < Date.now() - DAY_MS && r['views'] != null)
  return {
    views: median(mature.slice(0, 10).map((r) => Number(r['views']))),
    posts30: list.length,
    views30: list.reduce((s, r) => s + Number(r['views'] ?? 0), 0),
    reactions30: list.reduce((s, r) => s + Number(r['likes'] ?? 0), 0),
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function collectTelegram(db: Database, account: AccountRow, fresh: boolean): Promise<void> {
  const followers = account.tgChatId ? await channelMembers(db, account.tgChatId) : null
  let pages = 0
  let before: number | null = null
  let seen = 0
  if (account.handle) {
    const handle = account.handle
    while (pages < (fresh ? 1 : TG_PAGES)) {
      const res = await webFetch(`https://t.me/s/${handle}${before ? `?before=${before}` : ''}`).catch(() => null)
      if (!res?.ok) break
      const page = parseChannelPage(await res.text(), handle)
      pages += 1
      for (const p of page.posts) {
        seen += 1
        await upsertPlatformPost(db, account, {
          extId: String(p.id),
          format: p.format,
          publishedAt: p.at,
          caption: p.text,
          permalink: `https://t.me/${handle}/${p.id}`,
          thumb: p.thumb,
          views: p.views,
          reactions: p.reactions,
        })
      }
      const oldest = page.posts[0]?.at
      if (!page.before || !page.posts.length || (oldest && Date.parse(oldest) < Date.now() - HISTORY_DAYS * DAY_MS)) break
      before = page.before
    }
  }
  if (followers == null && !seen) {
    await markError(db, account.id, 'Не удалось получить цифры: проверьте, что Tai — администратор канала')
    return
  }
  // Наши посты: цифры и связь с постами канала по номеру сообщения.
  await db.execute(sql`
    UPDATE smm_platform_posts pp SET post_id = p.id FROM smm_posts p
    WHERE pp.account_id = ${account.id}::uuid AND p.platform = 'telegram' AND p.tg_message_id IS NOT NULL AND p.tg_message_id::text = pp.ext_id
  `)
  const ours = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT p.id, p.stats, pp.views, pp.reactions FROM smm_posts p JOIN smm_platform_posts pp ON pp.post_id = p.id AND pp.account_id = ${account.id}::uuid
    WHERE p.published_at > now() - interval '60 days'
  `))
  for (const r of ours) {
    const prev = (r['stats'] ?? {}) as SmmPostStats
    await updatePost(db, String(r['id']), {
      stats: { ...prev, views: r['views'] == null ? prev.views : Number(r['views']), reactions: Number(r['reactions'] ?? 0), source: 'auto' },
      statsAt: new Date().toISOString(),
    })
  }
  const avg = await matureAverages(db, account.id)
  const err = followers && avg.views != null ? Math.round((avg.views / followers) * 1000) / 10 : null
  await saveSnapshot(db, account.id, {
    followers,
    views: avg.views,
    posts: avg.posts30,
    engagement: err,
    summary: { tg: { avgViews: avg.views, err, posts30: avg.posts30, views30: avg.views30, reactions30: avg.reactions30, avgReactions: avg.posts30 ? Math.round((avg.reactions30 / avg.posts30) * 10) / 10 : null } },
  })
}

// ─── Instagram ───────────────────────────────────────────────────────────────

const shortcode = (url: string | null | undefined) => (url ? /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(url)?.[1] ?? null : null)
const norm = (s: string) => plainText(s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim().slice(0, 60)

function igFormat(m: IgMedia): SmmFormat {
  if (m.media_product_type === 'STORY') return 'story'
  if (m.media_product_type === 'REELS') return 'reel'
  return m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : 'post'
}

/** Наш пост к публикации Instagram: по id, по ссылке или (передан человеку) по началу подписи. */
function matchOurs(posts: SmmPost[], m: IgMedia): SmmPost | undefined {
  const code = shortcode(m.permalink)
  return posts.find((p) => p.extId === m.id)
    ?? (code ? posts.find((p) => shortcode(p.publishedUrl) === code) : undefined)
    ?? posts.find((p) => {
      if (p.extId || p.publishedUrl || !p.handoffAt) return false
      const head = norm(p.body)
      const since = Date.parse(p.handoffAt) - 3600_000
      return head.length >= 12 && Date.parse(m.timestamp ?? '') >= since && norm(m.caption ?? '').startsWith(head.slice(0, 30))
    })
}

async function collectInstagram(db: Database, account: AccountRow, fresh: boolean): Promise<void> {
  if (!(await instagramState(db))) {
    await markError(db, account.id, 'Подключите Instagram по API в настройках СММ — цифры придут сами')
    return
  }
  const known = new Map(rows<{ ext_id: string; stats_at: string }>(await db.execute(sql`SELECT ext_id, stats_at FROM smm_platform_posts WHERE account_id = ${account.id}::uuid`)).map((r) => [r.ext_id, Date.parse(String(r.stats_at))]))
  const media = [...(await igRecentMedia(db, fresh ? IG_MEDIA_FRESH_LIMIT : IG_MEDIA_LIMIT)), ...(await igStories(db))]
  const ours = (await listPosts(db, { from: new Date(Date.now() - 45 * DAY_MS).toISOString(), status: ['approved', 'published'] })).filter((p) => p.platform === 'instagram')
  for (const m of media) {
    const at = Date.parse(m.timestamp ?? '')
    if (Number.isFinite(at) && at < Date.now() - HISTORY_DAYS * DAY_MS) continue
    const age = Date.now() - at
    const last = known.get(m.id)
    // Метрики: новые — всегда; свежие (до 2 суток) — раз в час; до двух недель — раз в сутки.
    const due = last == null || (age < FRESH_MS && Date.now() - last > 50 * 60_000) || (!fresh && age < 14 * DAY_MS && Date.now() - last > 20 * 3600_000)
    const insights = due ? await igInsights(db, m) : {}
    const format = igFormat(m)
    await upsertPlatformPost(db, account, {
      extId: m.id,
      format,
      publishedAt: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      caption: plainText(m.caption ?? '').slice(0, 300),
      permalink: m.permalink ?? null,
      thumb: m.thumbnail_url ?? m.media_url ?? null,
      views: insights['views'],
      reach: insights['reach'],
      likes: insights['likes'] ?? m.like_count ?? null,
      comments: insights['comments'] ?? m.comments_count ?? null,
      shares: insights['shares'],
      saves: insights['saves'],
      interactions: insights['interactions'],
    })
    const post = matchOurs(ours, m)
    if (!post) continue
    await db.execute(sql`UPDATE smm_platform_posts SET post_id = ${post.id}::uuid WHERE account_id = ${account.id}::uuid AND ext_id = ${m.id}`)
    const stats: SmmPostStats = { ...post.stats, likes: insights['likes'] ?? m.like_count ?? post.stats.likes, comments: insights['comments'] ?? m.comments_count ?? post.stats.comments, source: 'auto' }
    for (const key of ['views', 'reach', 'shares', 'saves', 'interactions'] as const) if (insights[key] != null) stats[key] = insights[key]
    await updatePost(db, post.id, {
      stats,
      statsAt: new Date().toISOString(),
      extId: m.id,
      // Вышло руками — Tai сам нашёл публикацию: ссылка и статус.
      ...(post.status === 'approved' ? { status: 'published', publishedUrl: m.permalink ?? null, publishedAt: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString() } : {}),
    })
    if (post.status === 'approved') await freezeForecast(db, post.id)
  }

  const profile = await igProfile(db)
  if (fresh) {
    await db.execute(sql`UPDATE smm_accounts SET followers = coalesce(${profile.followers_count ?? null}::int, followers), stats_at = now() WHERE id = ${account.id}::uuid`)
    return
  }
  const [period7, period30, audience, reach, follows] = await Promise.all([
    igPeriod(db, 7).catch(() => null),
    igPeriod(db, 30).catch(() => null),
    igAudience(db).catch(() => null),
    igDaily(db, 'reach', 30),
    igDaily(db, 'follower_count', 30),
  ])
  await saveDaily(db, account.id, 'reach', reach)
  await saveDaily(db, account.id, 'new_followers', follows)
  const avg = await matureAverages(db, account.id)
  const engagement = period30?.reach && period30.engaged != null ? Math.round((period30.engaged / period30.reach) * 1000) / 10 : null
  await saveSnapshot(db, account.id, {
    followers: profile.followers_count ?? null,
    views: avg.views,
    posts: profile.media_count ?? null,
    engagement,
    summary: { period7, period30, audience },
  })
}

/**
 * Обойти площадки клуба и обновить цифры. `fresh` — лёгкий заход раз в час: только
 * свежие посты и подписчики. Ошибка одной площадки не мешает остальным.
 */
export async function collectStats(db: Database, opts: { fresh?: boolean } = {}): Promise<void> {
  for (const account of (await listAccounts(db)).filter((a) => a.isActive)) {
    try {
      if (account.platform === 'telegram') await collectTelegram(db, account, !!opts.fresh)
      else if (account.platform === 'instagram') await collectInstagram(db, account, !!opts.fresh)
    } catch (error) {
      console.warn('[smm] статистика площадки', account.title, error instanceof Error ? error.message : error)
      if (!opts.fresh) await markError(db, account.id, 'Не удалось обновить цифры').catch(() => undefined)
    }
  }
}

export interface HistoryPoint {
  accountId: string
  day: string
  followers: number | null
  views: number | null
  reach: number | null
  newFollowers: number | null
}

/** История площадок за N дней — для графиков. */
export async function accountHistory(db: Database, days = 60): Promise<HistoryPoint[]> {
  const num = (v: unknown) => (v == null ? null : Number(v))
  return rows<Record<string, unknown>>(await db.execute(sql`
    SELECT account_id, day, followers, views, reach, new_followers FROM smm_account_stats
    WHERE day >= (now() AT TIME ZONE 'Europe/Moscow')::date - ${days}::int ORDER BY day
  `)).map((r) => ({
    accountId: String(r['account_id']),
    day: r['day'] instanceof Date ? (r['day'] as Date).toISOString().slice(0, 10) : String(r['day']).slice(0, 10),
    followers: num(r['followers']),
    views: num(r['views']),
    reach: num(r['reach']),
    newFollowers: num(r['new_followers']),
  }))
}
