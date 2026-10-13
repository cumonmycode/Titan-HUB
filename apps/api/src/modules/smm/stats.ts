/**
 * Цифры площадок: подписчики и охват.
 *  - Telegram: подписчики — через бота (getChatMemberCount), просмотры постов — с
 *    публичной страницы t.me/s/<канал> (через шлюз: из РФ Telegram закрыт).
 *  - Instagram без входа почти ничего не отдаёт: пробуем публичный профиль (тоже
 *    через шлюз) — если пустили, подтягиваем подписчиков, лайки и находим вышедшие
 *    посты; если нет — Tai просит скриншот статистики и разбирает его нейросетью.
 */
import { sql, type Database } from '@titan/database'
import { z } from 'zod'
import { igInsights, igProfile, igRecentMedia, instagramState } from './instagram.js'
import { webFetch } from './relay.js'
import { chatJson } from './ai.js'
import { mskDate } from './context.js'
import { listAccounts, listPosts, loadPost, rows, updatePost, type AccountRow } from './db.js'
import { channelMembers, plainText } from './telegram.js'
import type { SmmPost, SmmPostStats } from './types.js'

const IG_APP_ID = '936619743392459'

/** «1.2K» → 1200, «3,4M» → 3 400 000. */
export function parseCount(text: string): number | null {
  const m = /([\d.,]+)\s*([KkMm])?/.exec(text.replace(/\s/g, ''))
  if (!m) return null
  const n = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(n)) return null
  const mult = m[2]?.toLowerCase() === 'k' ? 1_000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1
  return Math.round(n * mult)
}

/** Просмотры постов с t.me/s/<канал>: id сообщения → просмотры. */
export function parseChannelPage(html: string, handle: string): Map<number, number> {
  const views = new Map<number, number>()
  for (const block of html.split('tgme_widget_message_wrap').slice(1)) {
    const id = new RegExp(`data-post="${handle}/(\\d+)"`, 'i').exec(block)?.[1]
    const v = /tgme_widget_message_views">([^<]+)</.exec(block)?.[1]
    if (id && v) {
      const n = parseCount(v)
      if (n != null) views.set(Number(id), n)
    }
  }
  return views
}

async function saveSnapshot(db: Database, accountId: string, s: { followers?: number | null; views?: number | null; posts?: number | null; engagement?: number | null; source: string; raw?: unknown }): Promise<void> {
  await db.execute(sql`
    INSERT INTO smm_account_stats (account_id, day, followers, views, posts, engagement, source, raw)
    VALUES (${accountId}::uuid, ${mskDate()}::date, ${s.followers ?? null}, ${s.views ?? null}, ${s.posts ?? null}, ${s.engagement ?? null}, ${s.source}, ${JSON.stringify(s.raw ?? {})}::jsonb)
    ON CONFLICT (account_id, day) DO UPDATE SET
      followers = coalesce(EXCLUDED.followers, smm_account_stats.followers),
      views = coalesce(EXCLUDED.views, smm_account_stats.views),
      posts = coalesce(EXCLUDED.posts, smm_account_stats.posts),
      engagement = coalesce(EXCLUDED.engagement, smm_account_stats.engagement),
      source = EXCLUDED.source, raw = EXCLUDED.raw
  `)
  await db.execute(sql`
    UPDATE smm_accounts SET
      followers = coalesce(${s.followers ?? null}::int, followers),
      stats = ${JSON.stringify({ views: s.views ?? null, posts: s.posts ?? null, engagement: s.engagement ?? null, source: s.source })}::jsonb,
      stats_at = now(), stats_error = NULL, updated_at = now()
    WHERE id = ${accountId}::uuid
  `)
}

async function markError(db: Database, accountId: string, error: string): Promise<void> {
  await db.execute(sql`UPDATE smm_accounts SET stats_error = ${error.slice(0, 300)}, stats_at = now() WHERE id = ${accountId}::uuid`)
}

async function collectTelegram(db: Database, account: AccountRow): Promise<void> {
  const followers = account.tgChatId ? await channelMembers(db, account.tgChatId) : null
  let views: Map<number, number> = new Map()
  if (account.handle) {
    try {
      const res = await webFetch(`https://t.me/s/${account.handle}`)
      if (res.ok) views = parseChannelPage(await res.text(), account.handle)
    } catch (error) {
      console.warn('[smm] страница канала не открылась', error instanceof Error ? error.message : error)
    }
  }
  const recent = [...views.entries()].sort((a, b) => b[0] - a[0]).slice(0, 10).map(([, v]) => v)
  const avg = recent.length ? Math.round(recent.reduce((s, v) => s + v, 0) / recent.length) : null
  if (followers == null && avg == null) {
    await markError(db, account.id, 'Не удалось получить цифры: проверьте, что Tai — администратор канала')
    return
  }
  await saveSnapshot(db, account.id, { followers, views: avg, posts: views.size || null, engagement: followers && avg ? Math.round((avg / followers) * 1000) / 10 : null, source: 'auto' })
  if (!views.size) return
  const published = rows<{ id: string; tg_message_id: string | number; stats: SmmPostStats | null }>(await db.execute(sql`
    SELECT id, tg_message_id, stats FROM smm_posts WHERE platform = 'telegram' AND tg_message_id IS NOT NULL AND published_at > now() - interval '60 days'
  `))
  for (const p of published) {
    const v = views.get(Number(p.tg_message_id))
    if (v != null) await updatePost(db, p.id, { stats: { ...(p.stats ?? {}), views: v, source: 'auto' }, statsAt: new Date().toISOString() })
  }
}

type IgNode = {
  shortcode?: string
  taken_at_timestamp?: number
  video_view_count?: number
  edge_liked_by?: { count?: number }
  edge_media_preview_like?: { count?: number }
  edge_media_to_comment?: { count?: number }
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] }
}

const norm = (s: string) => plainText(s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim().slice(0, 60)

/** Вышедший пост ищем по началу подписи и времени после передачи человеку. */
function matchNode(post: SmmPost, nodes: IgNode[]): IgNode | null {
  const head = norm(post.body)
  if (head.length < 12) return null
  const since = (post.handoffAt ? Date.parse(post.handoffAt) : Date.parse(post.publishAt ?? '')) - 3600_000
  return nodes.find((n) => {
    const caption = norm(n.edge_media_to_caption?.edges?.[0]?.node?.text ?? '')
    const at = (n.taken_at_timestamp ?? 0) * 1000
    return at >= since && caption.length >= 12 && (caption.startsWith(head.slice(0, 30)) || head.startsWith(caption.slice(0, 30)))
  }) ?? null
}

type IgUser = { edge_followed_by?: { count?: number }; edge_owner_to_timeline_media?: { count?: number; edges?: { node: IgNode }[] } }

async function fetchIgUser(handle: string): Promise<IgUser | null> {
  try {
    const res = await webFetch(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(handle)}`, { headers: { 'x-ig-app-id': IG_APP_ID } })
    if (!res.ok) return null
    return ((await res.json()) as { data?: { user?: IgUser } }).data?.user ?? null
  } catch {
    return null
  }
}

const shortcode = (url: string | null | undefined) => (url ? /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(url)?.[1] ?? null : null)

/** Официальный путь: Instagram API — подписчики, публикации со ссылками и метриками. */
async function collectInstagramApi(db: Database, account: AccountRow): Promise<void> {
  const profile = await igProfile(db)
  const media = await igRecentMedia(db, 25)
  const recent = media.slice(0, 9)
  const avg = recent.length ? Math.round(recent.reduce((s, m) => s + (m.like_count ?? 0) + (m.comments_count ?? 0), 0) / recent.length) : null
  const followers = profile.followers_count ?? null
  await saveSnapshot(db, account.id, {
    followers,
    posts: profile.media_count ?? null,
    views: avg,
    engagement: followers && avg != null ? Math.round((avg / followers) * 1000) / 10 : null,
    source: 'auto',
  })
  const posts = await listPosts(db, { from: new Date(Date.now() - 45 * 86_400_000).toISOString(), status: ['approved', 'published'] })
  for (const post of posts.filter((p) => p.platform === 'instagram' && p.format !== 'story')) {
    const code = shortcode(post.publishedUrl)
    const head = norm(post.body)
    const since = (post.handoffAt ? Date.parse(post.handoffAt) : Date.parse(post.publishAt ?? '')) - 3600_000
    const node = code
      ? media.find((m) => shortcode(m.permalink) === code)
      : post.status === 'approved' && post.handoffAt
        ? media.find((m) => Date.parse(m.timestamp ?? '') >= since && head.length >= 12 && norm(m.caption ?? '').startsWith(head.slice(0, 30)))
        : undefined
    if (!node) continue
    const insights = await igInsights(db, node)
    const stats: SmmPostStats = { ...post.stats, likes: node.like_count ?? post.stats.likes, comments: node.comments_count ?? post.stats.comments, ...insights, source: 'auto' }
    await updatePost(db, post.id, {
      stats,
      statsAt: new Date().toISOString(),
      ...(post.status === 'approved' ? { status: 'published', publishedUrl: node.permalink ?? null, publishedAt: node.timestamp ? new Date(node.timestamp).toISOString() : new Date().toISOString() } : {}),
    })
  }
}

async function collectInstagram(db: Database, account: AccountRow): Promise<void> {
  if (await instagramState(db)) {
    await collectInstagramApi(db, account)
    return
  }
  if (!account.handle) {
    await markError(db, account.id, 'Не указан @аккаунт Instagram')
    return
  }
  const user = await fetchIgUser(account.handle)
  if (!user) {
    await markError(db, account.id, 'Instagram не отдаёт цифры без входа — Tai попросит скриншот статистики')
    return
  }
  const nodes = (user.edge_owner_to_timeline_media?.edges ?? []).map((e) => e.node)
  const likes = (n: IgNode) => n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? 0
  const followers = user.edge_followed_by?.count ?? null
  const recent = nodes.slice(0, 9)
  const avgLikes = recent.length ? Math.round(recent.reduce((s, n) => s + likes(n) + (n.edge_media_to_comment?.count ?? 0), 0) / recent.length) : null
  await saveSnapshot(db, account.id, {
    followers,
    posts: user.edge_owner_to_timeline_media?.count ?? null,
    views: avgLikes,
    engagement: followers && avgLikes != null ? Math.round((avgLikes / followers) * 1000) / 10 : null,
    source: 'auto',
  })
  const posts = await listPosts(db, { from: new Date(Date.now() - 45 * 86_400_000).toISOString(), status: ['approved', 'published'] })
  for (const post of posts.filter((p) => p.platform === 'instagram' && p.format !== 'story')) {
    const shortcode = post.publishedUrl ? /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(post.publishedUrl)?.[1] : null
    const node = shortcode ? nodes.find((n) => n.shortcode === shortcode) : post.status === 'approved' && post.handoffAt ? matchNode(post, nodes) : null
    if (!node?.shortcode) continue
    const stats: SmmPostStats = { ...post.stats, likes: likes(node), comments: node.edge_media_to_comment?.count ?? 0, ...(node.video_view_count ? { views: node.video_view_count } : {}), source: 'auto' }
    await updatePost(db, post.id, {
      stats,
      statsAt: new Date().toISOString(),
      ...(post.status === 'approved' ? { status: 'published', publishedUrl: `https://www.instagram.com/p/${node.shortcode}/`, publishedAt: new Date((node.taken_at_timestamp ?? Date.now() / 1000) * 1000).toISOString() } : {}),
    })
  }
}

/** Обойти площадки клуба и обновить цифры. Ошибка одной площадки не мешает остальным. */
export async function collectStats(db: Database): Promise<void> {
  for (const account of (await listAccounts(db)).filter((a) => a.isActive)) {
    try {
      if (account.platform === 'telegram') await collectTelegram(db, account)
      else if (account.platform === 'instagram') await collectInstagram(db, account)
    } catch (error) {
      console.warn('[smm] статистика площадки', account.title, error instanceof Error ? error.message : error)
      await markError(db, account.id, 'Не удалось обновить цифры').catch(() => undefined)
    }
  }
}

// ─── Скриншот статистики ─────────────────────────────────────────────────────

const ScreenshotSchema = z.object({
  platform: z.enum(['instagram', 'telegram', 'vk', 'other']).optional(),
  scope: z.enum(['account', 'post', 'unknown']),
  followers: z.number().int().nullable().optional(),
  reach: z.number().int().nullable().optional(),
  views: z.number().int().nullable().optional(),
  likes: z.number().int().nullable().optional(),
  comments: z.number().int().nullable().optional(),
  saves: z.number().int().nullable().optional(),
  shares: z.number().int().nullable().optional(),
  profileVisits: z.number().int().nullable().optional(),
  periodDays: z.number().int().nullable().optional(),
  captionHint: z.string().max(200).nullable().optional(),
  summary: z.string().max(400),
})

export interface ScreenshotResult {
  summary: string
  applied: 'account' | 'post' | null
}

/** Разобрать скриншот статистики (Instagram и др.) и записать цифры в профиль или пост. */
export async function applyScreenshot(db: Database, image: Buffer, mime: string, target: { postId?: string; accountId?: string } = {}): Promise<ScreenshotResult> {
  const r = await chatJson(db, {
    kind: 'vision',
    note: 'скриншот статистики',
    maxTokens: 800,
    temperature: 0,
    schema: ScreenshotSchema,
    system: 'Ты разбираешь скриншоты статистики соцсетей (Instagram, Telegram, VK). Достаёшь только видимые на экране числа, ничего не выдумываешь. Ответ — один JSON.',
    user: [
      { type: 'text', text: 'Что за статистика на скриншоте: профиль за период (scope "account") или одна публикация ("post")? Верни JSON: {"platform", "scope", "followers", "reach", "views", "likes", "comments", "saves", "shares", "profileVisits", "periodDays", "captionHint": "начало подписи поста, если видно", "summary": "1–2 фразы по-русски, что видно"}. Числа «1,2 тыс.» → 1200. Чего нет — null.' },
      { type: 'image_url', image_url: { url: `data:${mime};base64,${image.toString('base64')}` } },
    ],
  })
  const accounts = await listAccounts(db)
  if (r.scope === 'post' || target.postId) {
    const posts = target.postId ? [] : await listPosts(db, { from: new Date(Date.now() - 60 * 86_400_000).toISOString(), status: ['published'] })
    const hint = norm(r.captionHint ?? '')
    const post = target.postId
      ? await loadPost(db, target.postId)
      : posts.find((p) => p.platform === (r.platform === 'telegram' ? 'telegram' : 'instagram') && hint.length > 10 && norm(p.body).startsWith(hint.slice(0, 25)))
    if (post) {
      const stats: SmmPostStats = { ...post.stats, source: 'screenshot' }
      for (const key of ['views', 'likes', 'comments', 'saves', 'shares', 'reach'] as const) if (r[key] != null) stats[key] = r[key]!
      await updatePost(db, post.id, { stats, statsAt: new Date().toISOString() })
      return { summary: `${r.summary} Записал к публикации «${post.topic}».`, applied: 'post' }
    }
  }
  const account = (target.accountId && accounts.find((a) => a.id === target.accountId)) || accounts.find((a) => a.isActive && a.platform === (r.platform ?? 'instagram'))
  if (account && (r.followers != null || r.reach != null || r.views != null)) {
    await saveSnapshot(db, account.id, { followers: r.followers ?? null, views: r.reach ?? r.views ?? null, engagement: null, source: 'screenshot', raw: r })
    return { summary: `${r.summary} Записал в статистику «${account.title}».`, applied: 'account' }
  }
  return { summary: `${r.summary} Не понял, к чему это отнести — пришли скрин статистики профиля или конкретного поста.`, applied: null }
}

/** История подписчиков площадок за N дней — для графиков. */
export async function accountHistory(db: Database, days = 60): Promise<{ accountId: string; day: string; followers: number | null; views: number | null }[]> {
  return rows<Record<string, unknown>>(await db.execute(sql`
    SELECT account_id, day, followers, views FROM smm_account_stats
    WHERE day >= (now() AT TIME ZONE 'Europe/Moscow')::date - ${days}::int ORDER BY day
  `)).map((r) => ({
    accountId: String(r['account_id']),
    day: r['day'] instanceof Date ? (r['day'] as Date).toISOString().slice(0, 10) : String(r['day']).slice(0, 10),
    followers: r['followers'] == null ? null : Number(r['followers']),
    views: r['views'] == null ? null : Number(r['views']),
  }))
}
