/**
 * Хранилище раздела «СММ» (raw SQL по таблицам миграции 084): публикации с медиа,
 * планы, замечания, память, площадки, отчёты. Даты наружу — ISO-строки.
 *
 * Даты в запросы передаём строкой с приведением `::timestamptz`: объект Date в
 * sql-шаблоне postgres-js не сериализует (см. память проекта).
 */
import { sql, type Database } from '@titan/database'
import type { SQL } from 'drizzle-orm'
import type {
  ReelScript, SmmAccount, SmmBusy, SmmComment, SmmForecast, SmmMedia, SmmMemory, SmmMemoryKind, SmmPlan, SmmPost, SmmPostStats, SmmProgress, SmmReport,
} from './types.js'

export function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[]
}

type Row = Record<string, unknown>

export const iso = (v: unknown): string | null => {
  if (v == null || v === '') return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const str = (v: unknown): string | null => (v == null ? null : String(v))
const num = (v: unknown): number => Number(v ?? 0) || 0
const json = <T>(v: unknown, fallback: T): T => {
  if (v == null) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

// ─── Публикации ──────────────────────────────────────────────────────────────

function mapMedia(r: Row): SmmMedia {
  return {
    id: String(r['id']),
    kind: r['kind'] === 'video' ? 'video' : 'image',
    source: r['source'] === 'upload' || r['source'] === 'archive' ? r['source'] : 'ai',
    status: (r['status'] as SmmMedia['status']) ?? 'done',
    url: str(r['url']),
    aspect: str(r['aspect']),
    prompt: str(r['prompt']),
    model: str(r['model']),
    costRub: num(r['cost_rub']),
    error: str(r['error']),
    selected: r['selected'] !== false,
    sort: num(r['sort']),
    createdAt: iso(r['created_at']) ?? '',
  }
}

function mapPost(r: Row, media: SmmMedia[]): SmmPost {
  return {
    id: String(r['id']),
    planId: str(r['plan_id']),
    accountId: str(r['account_id']),
    platform: r['platform'] === 'instagram' ? 'instagram' : 'telegram',
    format: (r['format'] as SmmPost['format']) ?? 'post',
    status: (r['status'] as SmmPost['status']) ?? 'idea',
    publishAt: iso(r['publish_at']),
    topic: String(r['topic'] ?? ''),
    pillar: str(r['pillar']),
    direction: str(r['direction']),
    brief: String(r['brief'] ?? ''),
    body: String(r['body'] ?? ''),
    visual: String(r['visual'] ?? ''),
    script: json<ReelScript | null>(r['script'], null),
    assigneeId: str(r['assignee_id']),
    assigneeName: str(r['assignee_name']),
    approvedBy: str(r['approved_by']),
    approvedAt: iso(r['approved_at']),
    handoffAt: iso(r['handoff_at']),
    publishedAt: iso(r['published_at']),
    publishedUrl: str(r['published_url']),
    stats: json<SmmPostStats>(r['stats'], {}),
    statsAt: iso(r['stats_at']),
    busy: (r['busy'] as SmmBusy | null) ?? null,
    progress: r['busy'] ? json<SmmProgress | null>(r['progress'], null) : null,
    error: str(r['error']),
    media,
    forecast: json<SmmForecast | null>(r['forecast'], null),
    extId: str(r['ext_id']),
    createdAt: iso(r['created_at']) ?? '',
    updatedAt: iso(r['updated_at']) ?? '',
  }
}

const POST_SELECT = sql`SELECT p.*, a.nickname AS assignee_name FROM smm_posts p LEFT JOIN profiles a ON a.id = p.assignee_id`

async function withMedia(db: Database, list: Row[], allMedia = false): Promise<SmmPost[]> {
  if (!list.length) return []
  const ids = list.map((r) => String(r['id']))
  const media = rows<Row>(await db.execute(sql`
    SELECT * FROM smm_media
    WHERE post_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      ${allMedia ? sql`` : sql`AND (selected OR status = 'pending')`}
    ORDER BY sort, created_at
  `))
  const byPost = new Map<string, SmmMedia[]>()
  for (const m of media) {
    const key = String(m['post_id'])
    byPost.set(key, [...(byPost.get(key) ?? []), mapMedia(m)])
  }
  return list.map((r) => mapPost(r, byPost.get(String(r['id'])) ?? []))
}

export async function loadPost(db: Database, id: string, allMedia = false): Promise<SmmPost | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = rows<Row>(await db.execute(sql`${POST_SELECT} WHERE p.id = ${id}::uuid`))
  if (!row) return null
  const [post] = await withMedia(db, [row], allMedia)
  return post ?? null
}

/** Публикации в окне дат (по времени выхода); без даты — в конце. */
export async function listPosts(db: Database, opts: { from?: string; to?: string; planId?: string; status?: string[] }): Promise<SmmPost[]> {
  const where: SQL[] = []
  if (opts.from) where.push(sql`p.publish_at >= ${opts.from}::timestamptz`)
  if (opts.to) where.push(sql`p.publish_at < ${opts.to}::timestamptz`)
  if (opts.planId) where.push(sql`p.plan_id = ${opts.planId}::uuid`)
  if (opts.status?.length) where.push(sql`p.status IN (${sql.join(opts.status.map((s) => sql`${s}`), sql`, `)})`)
  const list = rows<Row>(await db.execute(sql`
    ${POST_SELECT}
    ${where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``}
    ORDER BY p.publish_at NULLS LAST, p.created_at
    LIMIT 400
  `))
  return withMedia(db, list)
}

export interface PostPatch {
  planId?: string | null
  accountId?: string | null
  platform?: string
  format?: string
  status?: string
  publishAt?: string | null
  topic?: string
  pillar?: string | null
  direction?: string | null
  brief?: string
  body?: string
  visual?: string
  script?: ReelScript | null
  assigneeId?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  reviewSentAt?: string | null
  handoffAt?: string | null
  remindedAt?: string | null
  remindCount?: number
  publishedAt?: string | null
  publishedUrl?: string | null
  tgMessageId?: number | null
  stats?: SmmPostStats
  statsAt?: string | null
  busy?: SmmBusy | null
  progress?: SmmProgress | null
  forecast?: SmmForecast | null
  extId?: string | null
  error?: string | null
}

const COLUMNS: Record<keyof PostPatch, { col: string; cast?: string; json?: boolean }> = {
  planId: { col: 'plan_id', cast: 'uuid' },
  accountId: { col: 'account_id', cast: 'uuid' },
  platform: { col: 'platform' },
  format: { col: 'format' },
  status: { col: 'status' },
  publishAt: { col: 'publish_at', cast: 'timestamptz' },
  topic: { col: 'topic' },
  pillar: { col: 'pillar' },
  direction: { col: 'direction' },
  brief: { col: 'brief' },
  body: { col: 'body' },
  visual: { col: 'visual' },
  script: { col: 'script', json: true },
  assigneeId: { col: 'assignee_id', cast: 'uuid' },
  approvedBy: { col: 'approved_by', cast: 'uuid' },
  approvedAt: { col: 'approved_at', cast: 'timestamptz' },
  reviewSentAt: { col: 'review_sent_at', cast: 'timestamptz' },
  handoffAt: { col: 'handoff_at', cast: 'timestamptz' },
  remindedAt: { col: 'reminded_at', cast: 'timestamptz' },
  remindCount: { col: 'remind_count' },
  publishedAt: { col: 'published_at', cast: 'timestamptz' },
  publishedUrl: { col: 'published_url' },
  tgMessageId: { col: 'tg_message_id' },
  stats: { col: 'stats', json: true },
  statsAt: { col: 'stats_at', cast: 'timestamptz' },
  busy: { col: 'busy' },
  progress: { col: 'progress', json: true },
  forecast: { col: 'forecast', json: true },
  extId: { col: 'ext_id' },
  error: { col: 'error' },
}

function assignments(patch: PostPatch): SQL[] {
  const out: SQL[] = []
  for (const [key, value] of Object.entries(patch) as [keyof PostPatch, unknown][]) {
    const def = COLUMNS[key]
    if (!def || value === undefined) continue
    const col = sql.raw(def.col)
    if (value === null) out.push(sql`${col} = NULL`)
    else if (def.json) out.push(sql`${col} = ${JSON.stringify(value)}::jsonb`)
    else if (def.cast) out.push(sql`${col} = ${String(value)}::${sql.raw(def.cast)}`)
    else out.push(sql`${col} = ${value as string | number}`)
  }
  return out
}

export async function updatePost(db: Database, id: string, patch: PostPatch): Promise<void> {
  const sets = assignments(patch)
  if (patch.busy !== undefined) sets.push(patch.busy ? sql`busy_at = now()` : sql`busy_at = NULL`)
  // Работа закончилась — шкала уходит вместе с ней.
  if (patch.busy === null && patch.progress === undefined) sets.push(sql`progress = NULL`)
  if (!sets.length) return
  await db.execute(sql`UPDATE smm_posts SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}::uuid`)
}

export interface NewPost {
  planId?: string | null
  accountId?: string | null
  platform: string
  format: string
  status?: string
  publishAt: string | null
  topic: string
  pillar?: string | null
  direction?: string | null
  brief?: string
  visual?: string
  assigneeId?: string | null
  createdBy?: string | null
}

export async function insertPost(db: Database, p: NewPost): Promise<string> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO smm_posts (plan_id, account_id, platform, format, status, publish_at, topic, pillar, direction, brief, visual, assignee_id, created_by)
    VALUES (
      ${p.planId ?? null}::uuid, ${p.accountId ?? null}::uuid, ${p.platform}, ${p.format}, ${p.status ?? 'idea'},
      ${p.publishAt}::timestamptz, ${p.topic}, ${p.pillar ?? null}, ${p.direction ?? null}, ${p.brief ?? ''}, ${p.visual ?? ''},
      ${p.assigneeId ?? null}::uuid, ${p.createdBy ?? null}::uuid
    ) RETURNING id
  `))
  return row!.id
}

export async function deletePost(db: Database, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM smm_posts WHERE id = ${id}::uuid`)
}

/** Шкала готовности поста (без смены остального). */
export async function setPostProgress(db: Database, id: string, progress: SmmProgress): Promise<void> {
  await db.execute(sql`UPDATE smm_posts SET progress = ${JSON.stringify(progress)}::jsonb WHERE id = ${id}::uuid AND busy IS NOT NULL`)
}

/** Занять пост под работу Tai. false — уже занят (свежая работа идёт). */
export async function claimPost(db: Database, id: string, busy: SmmBusy): Promise<boolean> {
  const res = rows(await db.execute(sql`
    UPDATE smm_posts SET busy = ${busy}, busy_at = now(), progress = NULL, error = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND (busy IS NULL OR busy_at < now() - interval '10 minutes')
    RETURNING id
  `))
  return res.length > 0
}

// ─── Медиа ───────────────────────────────────────────────────────────────────

export interface NewMedia {
  postId: string
  kind: 'image' | 'video'
  source: 'ai' | 'upload' | 'archive'
  status: 'pending' | 'done' | 'failed'
  url?: string | null
  aspect?: string | null
  prompt?: string | null
  model?: string | null
  polzaId?: string | null
  costRub?: number
  sort?: number
}

export async function insertMedia(db: Database, m: NewMedia): Promise<string> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO smm_media (post_id, kind, source, status, url, aspect, prompt, model, polza_id, cost_rub, sort)
    VALUES (${m.postId}::uuid, ${m.kind}, ${m.source}, ${m.status}, ${m.url ?? null}, ${m.aspect ?? null}, ${m.prompt ?? null},
      ${m.model ?? null}, ${m.polzaId ?? null}, ${m.costRub ?? 0}, ${m.sort ?? 0})
    RETURNING id
  `))
  return row!.id
}

export async function updateMedia(db: Database, id: string, patch: { status?: string; url?: string | null; costRub?: number; error?: string | null; polzaId?: string | null; selected?: boolean }): Promise<void> {
  const sets: SQL[] = []
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`)
  if (patch.url !== undefined) sets.push(sql`url = ${patch.url}`)
  if (patch.costRub !== undefined) sets.push(sql`cost_rub = ${patch.costRub}`)
  if (patch.error !== undefined) sets.push(sql`error = ${patch.error}`)
  if (patch.polzaId !== undefined) sets.push(sql`polza_id = ${patch.polzaId}`)
  if (patch.selected !== undefined) sets.push(sql`selected = ${patch.selected}`)
  if (!sets.length) return
  await db.execute(sql`UPDATE smm_media SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}::uuid`)
}

/** Новый вариант в том же месте карусели: прежние варианты этой позиции снимаются. */
export async function unselectSlot(db: Database, postId: string, kind: 'image' | 'video', sort: number, keepId: string): Promise<void> {
  await db.execute(sql`
    UPDATE smm_media SET selected = false, updated_at = now()
    WHERE post_id = ${postId}::uuid AND kind = ${kind} AND sort = ${sort} AND id <> ${keepId}::uuid
  `)
}

export async function pendingMedia(db: Database): Promise<{ id: string; postId: string; polzaId: string; kind: string; createdAt: string }[]> {
  return rows<Row>(await db.execute(sql`
    SELECT id, post_id, polza_id, kind, created_at FROM smm_media
    WHERE status = 'pending' AND polza_id IS NOT NULL ORDER BY created_at LIMIT 10
  `)).map((r) => ({ id: String(r['id']), postId: String(r['post_id']), polzaId: String(r['polza_id']), kind: String(r['kind']), createdAt: iso(r['created_at']) ?? '' }))
}

export async function loadMedia(db: Database, id: string): Promise<(SmmMedia & { postId: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = rows<Row>(await db.execute(sql`SELECT * FROM smm_media WHERE id = ${id}::uuid`))
  return row ? { ...mapMedia(row), postId: String(row['post_id']) } : null
}

export async function deleteMedia(db: Database, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM smm_media WHERE id = ${id}::uuid`)
}

/** Следующая свободная позиция в публикации (новый файл встаёт последним). */
export async function nextSort(db: Database, postId: string): Promise<number> {
  const [row] = rows<{ next: number }>(await db.execute(sql`SELECT coalesce(max(sort), -1) + 1 AS next FROM smm_media WHERE post_id = ${postId}::uuid`))
  return Number(row?.next ?? 0)
}

/** Убрать позицию целиком: выбранный файл и все его варианты. */
export async function deleteSlot(db: Database, postId: string, kind: 'image' | 'video', sort: number): Promise<void> {
  await db.execute(sql`DELETE FROM smm_media WHERE post_id = ${postId}::uuid AND kind = ${kind} AND sort = ${sort}`)
}

/**
 * Новый порядок позиций: `sorts` — прежние номера позиций в нужном порядке. Варианты
 * картинки переезжают вместе со своей позицией; не названные позиции встают в конец.
 */
export async function reorderSlots(db: Database, postId: string, sorts: number[]): Promise<void> {
  const all = rows<{ sort: number }>(await db.execute(sql`SELECT DISTINCT sort FROM smm_media WHERE post_id = ${postId}::uuid ORDER BY sort`)).map((r) => Number(r.sort))
  const order = [...new Set(sorts.filter((n) => all.includes(n))), ...all.filter((n) => !sorts.includes(n))]
  if (order.every((n, i) => n === all[i])) return
  const cases = sql.join(order.map((n, i) => sql`WHEN ${n}::int THEN ${i}::int`), sql` `)
  await db.execute(sql`UPDATE smm_media SET sort = CASE sort ${cases} END, updated_at = now() WHERE post_id = ${postId}::uuid`)
}

// ─── Планы ───────────────────────────────────────────────────────────────────

function mapPlan(r: Row): SmmPlan {
  return {
    id: String(r['id']),
    month: String(r['month']),
    status: r['status'] === 'active' ? 'active' : 'draft',
    summary: String(r['summary'] ?? ''),
    goals: json<string[]>(r['goals'], []),
    pillars: json<SmmPlan['pillars']>(r['pillars'], []),
    busy: (r['busy'] as SmmBusy | null) ?? null,
    progress: r['busy'] ? json<SmmProgress | null>(r['progress'], null) : null,
    error: str(r['error']),
    updatedAt: iso(r['updated_at']) ?? '',
  }
}

export async function loadPlan(db: Database, month: string): Promise<SmmPlan | null> {
  const [row] = rows<Row>(await db.execute(sql`SELECT * FROM smm_plans WHERE month = ${month}`))
  return row ? mapPlan(row) : null
}

export async function loadPlanById(db: Database, id: string): Promise<SmmPlan | null> {
  const [row] = rows<Row>(await db.execute(sql`SELECT * FROM smm_plans WHERE id = ${id}::uuid`))
  return row ? mapPlan(row) : null
}

/** План месяца: есть — вернуть, нет — создать пустой черновик. */
export async function ensurePlan(db: Database, month: string): Promise<SmmPlan> {
  await db.execute(sql`INSERT INTO smm_plans (month) VALUES (${month}) ON CONFLICT (month) DO NOTHING`)
  return (await loadPlan(db, month))!
}

export async function updatePlan(db: Database, id: string, patch: { status?: string; summary?: string; goals?: string[]; pillars?: SmmPlan['pillars']; busy?: SmmBusy | null; progress?: SmmProgress; error?: string | null }): Promise<void> {
  const sets: SQL[] = []
  if (patch.progress !== undefined) sets.push(sql`progress = ${JSON.stringify(patch.progress)}::jsonb`)
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`)
  if (patch.summary !== undefined) sets.push(sql`summary = ${patch.summary}`)
  if (patch.goals !== undefined) sets.push(sql`goals = ${JSON.stringify(patch.goals)}::jsonb`)
  if (patch.pillars !== undefined) sets.push(sql`pillars = ${JSON.stringify(patch.pillars)}::jsonb`)
  if (patch.busy !== undefined) sets.push(patch.busy ? sql`busy = ${patch.busy}, busy_at = now()` : sql`busy = NULL, busy_at = NULL, progress = NULL`)
  if (patch.error !== undefined) sets.push(sql`error = ${patch.error}`)
  if (!sets.length) return
  await db.execute(sql`UPDATE smm_plans SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id}::uuid`)
}

export async function claimPlan(db: Database, id: string, busy: SmmBusy): Promise<boolean> {
  const res = rows(await db.execute(sql`
    UPDATE smm_plans SET busy = ${busy}, busy_at = now(), progress = NULL, error = NULL, updated_at = now()
    WHERE id = ${id}::uuid AND (busy IS NULL OR busy_at < now() - interval '15 minutes')
    RETURNING id
  `))
  return res.length > 0
}

// ─── Замечания ───────────────────────────────────────────────────────────────

function mapComment(r: Row): SmmComment {
  return {
    id: num(r['id']),
    postId: str(r['post_id']),
    planId: str(r['plan_id']),
    authorName: str(r['author_name']),
    role: r['role'] === 'tai' ? 'tai' : 'staff',
    text: String(r['text'] ?? ''),
    createdAt: iso(r['created_at']) ?? '',
  }
}

export async function addComment(db: Database, c: { postId?: string | null; planId?: string | null; authorId?: string | null; authorName?: string | null; role: 'staff' | 'tai'; text: string }): Promise<void> {
  await db.execute(sql`
    INSERT INTO smm_comments (post_id, plan_id, author_id, author_name, role, text)
    VALUES (${c.postId ?? null}::uuid, ${c.planId ?? null}::uuid, ${c.authorId ?? null}::uuid, ${c.authorName ?? null}, ${c.role}, ${c.text.slice(0, 2000)})
  `)
}

export async function listComments(db: Database, by: { postId?: string; planId?: string }, limit = 50): Promise<SmmComment[]> {
  const where = by.postId ? sql`post_id = ${by.postId}::uuid` : sql`plan_id = ${by.planId ?? null}::uuid`
  const list = rows<Row>(await db.execute(sql`SELECT * FROM smm_comments WHERE ${where} ORDER BY id DESC LIMIT ${limit}`))
  return list.reverse().map(mapComment)
}

// ─── Память Tai ──────────────────────────────────────────────────────────────

export async function listMemory(db: Database): Promise<SmmMemory[]> {
  return rows<Row>(await db.execute(sql`SELECT * FROM smm_memory ORDER BY created_at DESC LIMIT 200`)).map((r) => ({
    id: String(r['id']),
    kind: (r['kind'] as SmmMemoryKind) ?? 'rule',
    text: String(r['text'] ?? ''),
    source: (r['source'] as SmmMemory['source']) ?? 'staff',
    createdAt: iso(r['created_at']) ?? '',
  }))
}

/** Запомнить, если такого ещё нет (одно и то же правило не копится). */
export async function remember(db: Database, m: { kind: SmmMemoryKind; text: string; source: SmmMemory['source']; authorId?: string | null }): Promise<boolean> {
  const text = m.text.trim().slice(0, 400)
  if (!text) return false
  const res = rows(await db.execute(sql`
    INSERT INTO smm_memory (kind, text, source, author_id)
    SELECT ${m.kind}, ${text}, ${m.source}, ${m.authorId ?? null}::uuid
    WHERE NOT EXISTS (SELECT 1 FROM smm_memory WHERE lower(text) = lower(${text}))
    RETURNING id
  `))
  return res.length > 0
}

export async function forget(db: Database, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM smm_memory WHERE id = ${id}::uuid`)
}

// ─── Площадки ────────────────────────────────────────────────────────────────

export function mapAccount(r: Row): SmmAccount {
  return {
    id: String(r['id']),
    platform: (r['platform'] as SmmAccount['platform']) ?? 'other',
    title: String(r['title'] ?? ''),
    url: str(r['url']),
    handle: str(r['handle']),
    canPublish: r['can_publish'] === true,
    isActive: r['is_active'] !== false,
    followers: r['followers'] == null ? null : num(r['followers']),
    stats: json<Record<string, unknown>>(r['stats'], {}),
    statsAt: iso(r['stats_at']),
    statsError: str(r['stats_error']),
  }
}

export interface AccountRow extends SmmAccount {
  tgChatId: string | null
}

export async function listAccounts(db: Database): Promise<AccountRow[]> {
  return rows<Row>(await db.execute(sql`SELECT * FROM smm_accounts ORDER BY platform, created_at`)).map((r) => ({ ...mapAccount(r), tgChatId: str(r['tg_chat_id']) }))
}

/** Канал, куда Tai публикует сам: первый активный Telegram с правом публикации. */
export async function publishChannel(db: Database): Promise<AccountRow | null> {
  return (await listAccounts(db)).find((a) => a.platform === 'telegram' && a.isActive && a.canPublish && a.tgChatId) ?? null
}

// ─── Отчёты ──────────────────────────────────────────────────────────────────

export function mapReport(r: Row): SmmReport {
  return {
    id: String(r['id']),
    periodFrom: iso(r['period_from'])?.slice(0, 10) ?? String(r['period_from']).slice(0, 10),
    periodTo: iso(r['period_to'])?.slice(0, 10) ?? String(r['period_to']).slice(0, 10),
    title: String(r['title'] ?? ''),
    summary: String(r['summary'] ?? ''),
    metrics: json<SmmReport['metrics']>(r['metrics'], []),
    recommendations: json<SmmReport['recommendations']>(r['recommendations'], []),
    createdAt: iso(r['created_at']) ?? '',
  }
}

export async function listReports(db: Database, limit = 12): Promise<SmmReport[]> {
  return rows<Row>(await db.execute(sql`SELECT * FROM smm_reports ORDER BY created_at DESC LIMIT ${limit}`)).map(mapReport)
}
