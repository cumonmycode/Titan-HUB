/**
 * API раздела «СММ» (/api/smm): лента публикаций, карточка поста с правками Tai,
 * план месяца, идеи, память, аналитика, площадки и настройки. Доступ — владелец и
 * сотрудники с правом «СММ»; площадки, бюджет и настройки — только владелец.
 *
 * Долгие задачи Tai (план, пост, правка, картинка) идут в фоне: ответ сразу,
 * приложение следит за полем busy (и шкалой progress) и перечитывает пост/план.
 * Цифры площадок — только по API; у публикаций — прогноз и факт.
 */
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth.js'
import { MAX_MEDIA_BODY_BYTES } from '../../lib/imageStore.js'
import { monthSpend, polzaBalance, SMM_MODELS } from './ai.js'
import { mskDate, mskToIso } from './context.js'
import {
  deletePost, deleteSlot, forget, insertPost, listAccounts, listComments, listMemory, listPosts, listReports, loadMedia, loadPlan, loadPost,
  claimPost, remember, reorderSlots, rows, updateMedia, updatePlan, updatePost,
} from './db.js'
import { analyticsPayload } from './analytics.js'
import { withForecast } from './forecast.js'
import { albumPhotos, connectLibrary, disconnectLibrary, libraryAlbums, libraryCounts, libraryState, searchLibrary, syncLibrary } from './library.js'
import { datesBetween } from './holidays.js'
import { knowledgeRouter } from './knowledge.router.js'
import { addArchivePhoto, addUpload, regenerateImage } from './media.js'
import { generatePlanInBackground, isMonth, monthRange, revisePlanInBackground } from './planner.js'
import { DIRECTIONS, FORMAT_LABEL, PLATFORM_LABEL } from './prompts.js'
import { generateReport } from './report.js'
import { getSmmSettings, saveSmmSettings, SettingsSchema } from './settings.js'
import { collectStats } from './stats.js'
import { approvers, checkChannel } from './telegram.js'
import { ACCOUNT_PLATFORMS, FORMATS, MEMORY_KINDS, PLATFORMS, SmmError, type SmmPost } from './types.js'
import { approvePost, markPublished, publishNow, restorePost, skipPost, withAuto, type SmmEnv } from './workflow.js'
import { connectInstagram, disconnectInstagram, instagramState } from './instagram.js'
import { makePostVideoInBackground } from './video.js'
import { reviseInBackground, suggestIdeas, writePostInBackground } from './writer.js'

export const smmRouter = new Hono<AppEnv>()
smmRouter.use('*', requireAuth, requireRole('owner', 'staff'), requirePermission('smm'))
smmRouter.route('/', knowledgeRouter)
const ownerOnly = requireRole('owner')
const uploadLimit = bodyLimit({ maxSize: MAX_MEDIA_BODY_BYTES, onError: (c) => c.json({ error: 'Файл больше 60 МБ' }, 413) })

const UUID = /^[0-9a-f-]{36}$/i
const envOf = (c: Context<AppEnv>): SmmEnv => ({ db: c.var.db, clubId: c.var.club?.id ?? null })
const actorOf = (c: Context<AppEnv>) => ({ id: c.get('user').sub, name: c.get('user').nickname })

/** Ошибка, понятная человеку (SmmError), — как есть; остальное — в журнал. */
function fail(c: Context<AppEnv>, error: unknown) {
  if (error instanceof SmmError) return c.json({ error: error.message }, error.status)
  console.error('[smm] api', error)
  return c.json({ error: 'Не получилось — попробуйте ещё раз' }, 500)
}

async function postOr404(c: Context<AppEnv>, allMedia = false): Promise<SmmPost> {
  const post = await loadPost(c.var.db, c.req.param('id') ?? '', allMedia)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  return post
}

/** Публикации для приложения: «выложит сам» и прогноз просмотров — одна форма для всех ответов. */
const decorate = async (c: Context<AppEnv>, posts: SmmPost[]): Promise<SmmPost[]> => withForecast(c.var.db, await withAuto(c.var.db, posts))

async function enriched(c: Context<AppEnv>, post: SmmPost | null): Promise<SmmPost | null> {
  return post ? ((await decorate(c, [post]))[0] ?? post) : null
}

const fresh = async (c: Context<AppEnv>, id: string) => c.json({ post: await enriched(c, await loadPost(c.var.db, id, true)) })

// ─── Справочник ──────────────────────────────────────────────────────────────

smmRouter.get('/meta', (c) =>
  c.json({
    directions: DIRECTIONS,
    platforms: PLATFORMS.map((key) => ({ key, label: PLATFORM_LABEL[key] })),
    formats: FORMATS.map((key) => ({ key, label: FORMAT_LABEL[key] })),
    models: SMM_MODELS,
  }),
)

// ─── Главная раздела ─────────────────────────────────────────────────────────

smmRouter.get('/overview', async (c) => {
  try {
    const db = c.var.db
    const month = mskDate().slice(0, 7)
    const now = Date.now()
    const [settings, posts, plan, accounts, reports, spent, people] = await Promise.all([
      getSmmSettings(db),
      listPosts(db, { from: new Date(now - 3 * 86_400_000).toISOString(), to: new Date(now + 14 * 86_400_000).toISOString() }),
      loadPlan(db, month),
      listAccounts(db),
      listReports(db, 1),
      monthSpend(db),
      approvers(db),
    ])
    // «Не выкладываем» остаются в ленте (серыми) — их видно и можно вернуть.
    const open = posts.filter((p) => p.status !== 'published' || Date.parse(p.publishedAt ?? '') > now - 86_400_000)
    const [counts] = rows<Record<string, number>>(await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'review')::int AS review,
        count(*) FILTER (WHERE status = 'approved' AND handoff_at IS NOT NULL AND published_url IS NULL)::int AS "awaitingLink",
        count(*) FILTER (WHERE status = 'failed' AND publish_at > now() - interval '7 days')::int AS failed,
        count(*) FILTER (WHERE status = 'published' AND published_at > now() - interval '7 days')::int AS "publishedWeek"
      FROM smm_posts
    `))
    const isOwner = c.get('user').role === 'owner'
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 7)
    return c.json({
      month,
      nextMonth,
      upcoming: await decorate(c, open),
      counts: counts ?? { review: 0, awaitingLink: 0, failed: 0, publishedWeek: 0 },
      plan,
      nextPlan: await loadPlan(db, nextMonth),
      accounts,
      lastReport: reports[0] ?? null,
      spend: { month: Math.round(spent), budget: settings.monthlyBudget },
      balance: isOwner ? await polzaBalance(db) : null,
      ready: {
        channel: accounts.some((a) => a.platform === 'telegram' && a.canPublish && a.isActive),
        instagram: accounts.some((a) => a.platform === 'instagram' && a.isActive),
        publisher: !!settings.publisherId,
        approvers: people.filter((p) => p.tgId).length,
      },
      autopilot: settings.autopilot,
    })
  } catch (error) {
    return fail(c, error)
  }
})

// ─── Публикации ──────────────────────────────────────────────────────────────

smmRouter.get('/posts', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const valid = (v?: string) => !v || !Number.isNaN(Date.parse(v))
  if (!valid(from) || !valid(to)) return c.json({ error: 'Неверный период' }, 400)
  return c.json({ posts: await decorate(c, await listPosts(c.var.db, { from, to })) })
})

const SwapSchema = z.object({ a: z.string().uuid(), b: z.string().uuid() })

/** Поменять местами время выхода двух публикаций (порядок выкладки в плане). */
smmRouter.post('/posts/swap', zValidator('json', SwapSchema), async (c) => {
  try {
    const { a, b } = c.req.valid('json')
    const [first, second] = await Promise.all([loadPost(c.var.db, a), loadPost(c.var.db, b)])
    if (!first || !second) return c.json({ error: 'Публикация не найдена' }, 404)
    if (first.status === 'published' || second.status === 'published') return c.json({ error: 'Вышедшую публикацию не двигаем' }, 409)
    if (!first.publishAt || !second.publishAt) return c.json({ error: 'У публикации нет даты' }, 400)
    // Время сменилось — ручную передачу человеку делаем заново в новое время.
    const reset = (p: SmmPost) => (p.handoffAt && !p.publishedUrl ? { handoffAt: null, remindCount: 0 } : {})
    await updatePost(c.var.db, first.id, { publishAt: second.publishAt, ...reset(first) })
    await updatePost(c.var.db, second.id, { publishAt: first.publishAt, ...reset(second) })
    return c.json({ ok: true })
  } catch (error) {
    return fail(c, error)
  }
})

const NewPostSchema = z.object({
  platform: z.enum(PLATFORMS),
  format: z.enum(FORMATS),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  topic: z.string().trim().min(2).max(160),
  brief: z.string().trim().max(800).optional(),
  direction: z.string().max(40).optional(),
  write: z.boolean().optional(),
})

smmRouter.post('/posts', zValidator('json', NewPostSchema), async (c) => {
  try {
    const body = c.req.valid('json')
    const publishAt = mskToIso(body.date, body.time)
    if (!publishAt) return c.json({ error: 'Неверная дата или время' }, 400)
    const plan = await loadPlan(c.var.db, body.date.slice(0, 7))
    const id = await insertPost(c.var.db, {
      planId: plan?.id ?? null,
      platform: body.platform,
      format: body.format,
      publishAt,
      topic: body.topic,
      brief: body.brief ?? '',
      direction: body.direction ?? null,
      createdBy: c.get('user').sub,
    })
    if (body.write) await writePostInBackground(c.var.db, id)
    return fresh(c, id)
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.get('/posts/:id', async (c) => {
  try {
    const post = await postOr404(c, true)
    const people = await approvers(c.var.db)
    return c.json({ post: await enriched(c, post), comments: await listComments(c.var.db, { postId: post.id }), canApprove: people.some((p) => p.id === c.get('user').sub) })
  } catch (error) {
    return fail(c, error)
  }
})

const ShotSchema = z.object({ text: z.string().max(400), seconds: z.number().optional(), overlay: z.string().max(120).optional(), sticker: z.string().max(160).optional() })
const PatchSchema = z.object({
  topic: z.string().trim().min(2).max(160).optional(),
  brief: z.string().max(800).optional(),
  body: z.string().max(4000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  platform: z.enum(PLATFORMS).optional(),
  format: z.enum(FORMATS).optional(),
  direction: z.string().max(40).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  script: z.object({ hook: z.string().max(300), formula: z.string().max(120).optional(), shots: z.array(ShotSchema).max(12), audio: z.string().max(300).optional(), cast: z.string().max(300).optional(), tips: z.string().max(600).optional() }).nullable().optional(),
})

/** Правка руками: текст, время, кто выкладывает. Опубликованное — только ссылка/цифры. */
smmRouter.patch('/posts/:id', zValidator('json', PatchSchema), async (c) => {
  try {
    const post = await postOr404(c)
    const body = c.req.valid('json')
    if (post.status === 'published' && (body.body !== undefined || body.date || body.time || body.platform || body.format)) {
      return c.json({ error: 'Публикация уже вышла — меняется только в самой соцсети' }, 409)
    }
    const msk = post.publishAt ? new Date(Date.parse(post.publishAt) + 3 * 3600_000).toISOString() : null
    const publishAt = body.date || body.time ? mskToIso(body.date ?? msk?.slice(0, 10) ?? mskDate(), body.time ?? msk?.slice(11, 16) ?? '12:00') : undefined
    if (publishAt === null) return c.json({ error: 'Неверная дата или время' }, 400)
    await updatePost(c.var.db, post.id, {
      topic: body.topic,
      brief: body.brief,
      body: body.body,
      publishAt,
      platform: body.platform,
      format: body.format,
      direction: body.direction,
      assigneeId: body.assigneeId,
      script: body.script,
      ...(body.body !== undefined && post.status === 'idea' && body.body.trim() ? { status: 'review', reviewSentAt: new Date().toISOString() } : {}),
      // Перенесли ручную публикацию — передать файлы заново в новое время.
      ...(publishAt && post.handoffAt && !post.publishedUrl ? { handoffAt: null, remindCount: 0 } : {}),
    })
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.delete('/posts/:id', async (c) => {
  try {
    const post = await postOr404(c)
    if (post.status === 'published') return c.json({ error: 'Вышедшую публикацию не удаляем — она нужна аналитике' }, 409)
    await deletePost(c.var.db, post.id)
    return c.json({ ok: true })
  } catch (error) {
    return fail(c, error)
  }
})

/** Tai пишет (или переписывает с нуля) текст и визуал. */
smmRouter.post('/posts/:id/write', async (c) => {
  try {
    const post = await postOr404(c)
    if (post.status === 'published') return c.json({ error: 'Публикация уже вышла' }, 409)
    if (!(await writePostInBackground(c.var.db, post.id))) return c.json({ error: 'Tai уже работает над публикацией' }, 409)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

const TextSchema = z.object({ text: z.string().trim().min(2).max(1500) })

/** Замечание к публикации — Tai переделает и ответит в обсуждении. */
smmRouter.post('/posts/:id/remark', zValidator('json', TextSchema), async (c) => {
  try {
    const post = await postOr404(c)
    const { text } = c.req.valid('json')
    if (!(await reviseInBackground(c.var.db, post.id, text, actorOf(c)))) return c.json({ error: 'Tai уже работает над публикацией' }, 409)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

const ImageSchema = z.object({ prompt: z.string().trim().max(4000).optional(), mediaId: z.string().uuid().optional() })

/** Новый вариант картинки (по своему описанию или прежнему). */
smmRouter.post('/posts/:id/image', zValidator('json', ImageSchema), async (c) => {
  try {
    const post = await postOr404(c)
    const body = c.req.valid('json')
    if (!(await claimPost(c.var.db, post.id, 'image'))) return c.json({ error: 'Tai уже работает над публикацией' }, 409)
    const db = c.var.db
    void regenerateImage(db, post.id, body)
      .then(() => updatePost(db, post.id, { busy: null }))
      .catch((error) => updatePost(db, post.id, { busy: null, error: error instanceof Error ? `Картинка не получилась: ${error.message}`.slice(0, 300) : 'Картинка не получилась' }))
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Видео нейросетью (Veo 3.1 Fast, ~45 ₽): Tai продумывает сцену, делает первый кадр и запускает Veo; готово через несколько минут. */
smmRouter.post('/posts/:id/video', zValidator('json', z.object({ prompt: z.string().trim().min(10).max(1900).optional() })), async (c) => {
  try {
    const post = await postOr404(c)
    if (post.media.some((m) => m.kind === 'video' && m.status === 'pending')) return c.json({ error: 'Видео уже делается' }, 409)
    if (!(await claimPost(c.var.db, post.id, 'video'))) return c.json({ error: 'Tai уже работает над публикацией' }, 409)
    makePostVideoInBackground(c.var.db, post.id, c.req.valid('json').prompt)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Свои фото или видео с телефона (например, снятый рилс). */
smmRouter.post('/posts/:id/media', uploadLimit, async (c) => {
  try {
    const post = await postOr404(c)
    const file = (await c.req.formData()).get('file')
    if (!(file instanceof File)) return c.json({ error: 'Нет файла' }, 400)
    await addUpload(c.var.db, post.id, Buffer.from(await file.arrayBuffer()))
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Выбрать вариант картинки в позиции (или убрать из публикации). */
smmRouter.patch('/posts/:id/media/:mediaId', zValidator('json', z.object({ selected: z.boolean() })), async (c) => {
  try {
    const post = await postOr404(c)
    const media = await loadMedia(c.var.db, c.req.param('mediaId'))
    if (!media || media.postId !== post.id) return c.json({ error: 'Файл не найден' }, 404)
    const { selected } = c.req.valid('json')
    if (selected && media.kind === 'image') {
      await c.var.db.execute(sql`UPDATE smm_media SET selected = false WHERE post_id = ${post.id}::uuid AND kind = 'image' AND sort = ${media.sort}`)
    }
    await updateMedia(c.var.db, media.id, { selected })
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Убрать позицию из публикации: файл и все его варианты (картинка, видео, своё фото). */
smmRouter.delete('/posts/:id/media/:mediaId', async (c) => {
  try {
    const post = await postOr404(c)
    if (post.status === 'published') return c.json({ error: 'Публикация уже вышла — меняется только в самой соцсети' }, 409)
    const media = await loadMedia(c.var.db, c.req.param('mediaId'))
    if (!media || media.postId !== post.id) return c.json({ error: 'Файл не найден' }, 404)
    if (media.status === 'pending') return c.json({ error: 'Файл ещё делается — уберите, когда будет готов' }, 409)
    await deleteSlot(c.var.db, post.id, media.kind, media.sort)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Порядок слайдов карусели и кадров сторис: прежние номера позиций в новом порядке. */
smmRouter.post('/posts/:id/media/order', zValidator('json', z.object({ sorts: z.array(z.number().int().min(0).max(999)).min(1).max(50) })), async (c) => {
  try {
    const post = await postOr404(c)
    if (post.status === 'published') return c.json({ error: 'Публикация уже вышла — меняется только в самой соцсети' }, 409)
    await reorderSlots(c.var.db, post.id, c.req.valid('json').sorts)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Фото из архива клуба — в публикацию как есть (кадр под формат). */
smmRouter.post('/posts/:id/media/archive', zValidator('json', z.object({ photoId: z.string().min(10).max(80) })), async (c) => {
  try {
    const post = await postOr404(c)
    if (post.status === 'published') return c.json({ error: 'Публикация уже вышла — меняется только в самой соцсети' }, 409)
    await addArchivePhoto(c.var.db, post.id, c.req.valid('json').photoId)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/posts/:id/approve', async (c) => {
  try {
    const post = await postOr404(c)
    if (!(await approvers(c.var.db)).some((p) => p.id === c.get('user').sub)) return c.json({ error: 'Одобряет владелец или сотрудник с правом «СММ»' }, 403)
    await approvePost(envOf(c), post.id, actorOf(c))
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/posts/:id/skip', async (c) => {
  try {
    const post = await postOr404(c)
    await skipPost(envOf(c), post.id)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/posts/:id/restore', async (c) => {
  try {
    const post = await postOr404(c)
    await restorePost(envOf(c), post.id)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

/** Сейчас: Telegram — в канал, Instagram/сторис/рилс — файлы и текст выкладывающему. */
smmRouter.post('/posts/:id/publish', async (c) => {
  try {
    const post = await postOr404(c)
    if (!(await approvers(c.var.db)).some((p) => p.id === c.get('user').sub)) return c.json({ error: 'Публикует владелец или сотрудник с правом «СММ»' }, 403)
    if (post.status !== 'approved') await approvePost(envOf(c), post.id, actorOf(c))
    await publishNow(envOf(c), post.id)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

const LinkSchema = z.object({ url: z.string().trim().url().max(500).refine((u) => /^https:\/\//.test(u), 'Нужна ссылка https://') })

smmRouter.post('/posts/:id/link', zValidator('json', LinkSchema), async (c) => {
  try {
    const post = await postOr404(c)
    await markPublished(envOf(c), post.id, c.req.valid('json').url)
    return fresh(c, post.id)
  } catch (error) {
    return fail(c, error)
  }
})

// ─── План месяца ─────────────────────────────────────────────────────────────

const monthParam = (c: Context<AppEnv>): string => {
  const month = c.req.param('month') ?? ''
  if (!isMonth(month)) throw new SmmError('Неверный месяц', 400)
  return month
}

async function planPayload(c: Context<AppEnv>, month: string) {
  const db = c.var.db
  const plan = await loadPlan(db, month)
  const { from, to } = monthRange(month)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return {
    plan,
    posts: await decorate(c, await listPosts(db, { from, to })),
    comments: plan ? await listComments(db, { planId: plan.id }) : [],
    // Праздники и поводы месяца — подписи к дням плана.
    dates: await datesBetween(db, `${month}-01`, `${month}-${String(last).padStart(2, '0')}`).catch(() => []),
  }
}

smmRouter.get('/plans/:month', async (c) => {
  try {
    return c.json(await planPayload(c, monthParam(c)))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/plans/:month/generate', zValidator('json', z.object({ wishes: z.string().trim().max(1500).optional() })), async (c) => {
  try {
    const month = monthParam(c)
    if (!(await generatePlanInBackground(c.var.db, month, { wishes: c.req.valid('json').wishes, author: actorOf(c) }))) {
      return c.json({ error: 'Tai уже составляет этот план' }, 409)
    }
    return c.json(await planPayload(c, month))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/plans/:month/approve', async (c) => {
  try {
    const month = monthParam(c)
    const plan = await loadPlan(c.var.db, month)
    if (!plan?.summary) return c.json({ error: 'Плана ещё нет' }, 404)
    if (!(await approvers(c.var.db)).some((p) => p.id === c.get('user').sub)) return c.json({ error: 'Утверждает владелец или сотрудник с правом «СММ»' }, 403)
    await updatePlan(c.var.db, plan.id, { status: 'active' })
    return c.json(await planPayload(c, month))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/plans/:month/remark', zValidator('json', TextSchema), async (c) => {
  try {
    const month = monthParam(c)
    if (!(await revisePlanInBackground(c.var.db, month, c.req.valid('json').text, actorOf(c)))) return c.json({ error: 'Tai уже работает с планом' }, 409)
    return c.json(await planPayload(c, month))
  } catch (error) {
    return fail(c, error)
  }
})

// ─── Идеи ────────────────────────────────────────────────────────────────────

smmRouter.post('/ideas', zValidator('json', z.object({
  direction: z.string().max(40).optional(),
  platform: z.enum(PLATFORMS).optional(),
  format: z.enum(FORMATS).optional(),
  wish: z.string().trim().max(500).optional(),
})), async (c) => {
  try {
    return c.json({ ideas: await suggestIdeas(c.var.db, c.req.valid('json')) })
  } catch (error) {
    return fail(c, error)
  }
})

// ─── Память Tai ──────────────────────────────────────────────────────────────

smmRouter.get('/memory', async (c) => c.json({ memory: await listMemory(c.var.db) }))

smmRouter.post('/memory', zValidator('json', z.object({ kind: z.enum(MEMORY_KINDS), text: z.string().trim().min(3).max(400) })), async (c) => {
  const body = c.req.valid('json')
  await remember(c.var.db, { kind: body.kind, text: body.text, source: 'staff', authorId: c.get('user').sub })
  return c.json({ memory: await listMemory(c.var.db) })
})

smmRouter.delete('/memory/:memoryId', async (c) => {
  const id = c.req.param('memoryId')
  if (!UUID.test(id)) return c.json({ error: 'Не найдено' }, 404)
  await forget(c.var.db, id)
  return c.json({ memory: await listMemory(c.var.db) })
})

// ─── Аналитика ───────────────────────────────────────────────────────────────

async function analyticsResponse(c: Context<AppEnv>) {
  const db = c.var.db
  const [payload, settings, spent] = await Promise.all([analyticsPayload(db), getSmmSettings(db), monthSpend(db)])
  return { ...payload, spend: { month: Math.round(spent), budget: settings.monthlyBudget } }
}

smmRouter.get('/analytics', async (c) => {
  try {
    return c.json(await analyticsResponse(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/analytics/collect', async (c) => {
  try {
    await collectStats(c.var.db)
    return c.json(await analyticsResponse(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.post('/reports/generate', zValidator('json', z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })), async (c) => {
  try {
    const body = c.req.valid('json')
    const report = await generateReport(c.var.db, body.from && body.to ? { from: body.from, to: body.to } : undefined)
    return c.json({ report })
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.get('/reports/:reportId', async (c) => {
  const id = c.req.param('reportId')
  const report = (await listReports(c.var.db, 50)).find((r) => r.id === id)
  return report ? c.json({ report }) : c.json({ error: 'Отчёт не найден' }, 404)
})

// ─── Настройки (владелец) ────────────────────────────────────────────────────

async function settingsPayload(c: Context<AppEnv>) {
  const db = c.var.db
  const [settings, accounts, staff, spent, balance] = await Promise.all([
    getSmmSettings(db),
    listAccounts(db),
    db.execute(sql`SELECT id, nickname, role, tg_id IS NOT NULL AS "hasTelegram" FROM profiles WHERE role IN ('owner', 'staff') AND deleted_at IS NULL ORDER BY nickname`).then((r) => rows(r)),
    monthSpend(db),
    polzaBalance(db),
  ])
  // photos — пустой список для старых сборок приложения: фото клуба теперь в «Базе знаний» по зонам.
  return { settings, accounts, photos: [], staff, spend: { month: Math.round(spent), budget: settings.monthlyBudget }, balance, models: SMM_MODELS }
}

smmRouter.get('/settings', ownerOnly, async (c) => c.json(await settingsPayload(c)))

smmRouter.put('/settings', ownerOnly, zValidator('json', SettingsSchema.partial().extend({ cadence: SettingsSchema.shape.cadence.partial().optional() })), async (c) => {
  try {
    const patch = c.req.valid('json')
    await saveSmmSettings(c.var.db, patch as Parameters<typeof saveSmmSettings>[1])
    return c.json(await settingsPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

/** @имя из ссылки на профиль: instagram.com/titan.kbr → titan.kbr. */
function handleFrom(input: string): string | null {
  const raw = input.trim()
  const fromUrl = /(?:instagram\.com|vk\.com|vk\.ru|t\.me)\/([A-Za-z0-9._-]{2,})/i.exec(raw)?.[1]
  const plain = /^@?([A-Za-z0-9._-]{2,})$/.exec(raw)?.[1]
  return fromUrl ?? plain ?? null
}

smmRouter.post('/accounts', ownerOnly, zValidator('json', z.object({ platform: z.enum(ACCOUNT_PLATFORMS), input: z.string().trim().min(2).max(300), title: z.string().trim().max(80).optional() })), async (c) => {
  try {
    const db = c.var.db
    const body = c.req.valid('json')
    if (body.platform === 'telegram') {
      const ch = await checkChannel(db, body.input)
      await db.execute(sql`DELETE FROM smm_accounts WHERE platform = 'telegram' AND tg_chat_id = ${ch.chatId}`)
      await db.execute(sql`
        INSERT INTO smm_accounts (platform, title, url, handle, tg_chat_id, can_publish, stats_error)
        VALUES ('telegram', ${body.title || ch.title}, ${ch.handle ? `https://t.me/${ch.handle}` : null}, ${ch.handle}, ${ch.chatId}, ${ch.canPublish}, ${ch.problem})
      `)
    } else {
      const handle = handleFrom(body.input)
      const url = /^https:\/\//.test(body.input) ? body.input : handle && body.platform === 'instagram' ? `https://www.instagram.com/${handle}/` : null
      if (!handle && !url) return c.json({ error: 'Укажите ссылку на профиль или @имя' }, 400)
      await db.execute(sql`
        INSERT INTO smm_accounts (platform, title, url, handle)
        VALUES (${body.platform}, ${body.title || (handle ? `@${handle}` : body.platform)}, ${url}, ${handle})
      `)
    }
    await collectStats(db).catch(() => undefined)
    return c.json(await settingsPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.patch('/accounts/:accountId', ownerOnly, zValidator('json', z.object({ isActive: z.boolean().optional(), title: z.string().trim().min(1).max(80).optional() })), async (c) => {
  const id = c.req.param('accountId')
  if (!UUID.test(id)) return c.json({ error: 'Не найдено' }, 404)
  const body = c.req.valid('json')
  if (body.isActive !== undefined) await c.var.db.execute(sql`UPDATE smm_accounts SET is_active = ${body.isActive}, updated_at = now() WHERE id = ${id}::uuid`)
  if (body.title) await c.var.db.execute(sql`UPDATE smm_accounts SET title = ${body.title}, updated_at = now() WHERE id = ${id}::uuid`)
  return c.json(await settingsPayload(c))
})

/** Перепроверить канал: Tai стал администратором — можно публиковать. */
smmRouter.post('/accounts/:accountId/check', ownerOnly, async (c) => {
  try {
    const id = c.req.param('accountId')
    const account = (await listAccounts(c.var.db)).find((a) => a.id === id)
    if (!account) return c.json({ error: 'Не найдено' }, 404)
    if (account.platform === 'telegram' && account.tgChatId) {
      const ch = await checkChannel(c.var.db, account.tgChatId)
      await c.var.db.execute(sql`UPDATE smm_accounts SET can_publish = ${ch.canPublish}, handle = ${ch.handle}, stats_error = ${ch.problem}, updated_at = now() WHERE id = ${id}::uuid`)
    }
    await collectStats(c.var.db).catch(() => undefined)
    return c.json(await settingsPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.delete('/accounts/:accountId', ownerOnly, async (c) => {
  const id = c.req.param('accountId')
  if (!UUID.test(id)) return c.json({ error: 'Не найдено' }, 404)
  await c.var.db.execute(sql`DELETE FROM smm_accounts WHERE id = ${id}::uuid`)
  return c.json(await settingsPayload(c))
})

// ─── Instagram API (владелец) ────────────────────────────────────────────────

smmRouter.get('/instagram', async (c) => {
  const state = await instagramState(c.var.db)
  return c.json({ connected: !!state, state })
})

smmRouter.put('/instagram', ownerOnly, zValidator('json', z.object({ token: z.string().trim().min(20).max(1000) })), async (c) => {
  try {
    const state = await connectInstagram(c.var.db, c.req.valid('json').token, c.get('user').sub)
    await collectStats(c.var.db).catch(() => undefined)
    return c.json({ connected: true, state })
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.delete('/instagram', ownerOnly, async (c) => {
  await disconnectInstagram(c.var.db)
  return c.json({ connected: false, state: null })
})

// ─── Фотоархив (Google Диск) ─────────────────────────────────────────────────

async function libraryPayload(c: Context<AppEnv>) {
  const db = c.var.db
  const [state, counts, albums] = await Promise.all([libraryState(db), libraryCounts(db), libraryAlbums(db)])
  return { connected: !!state, state, counts, albums: state ? albums : [] }
}

smmRouter.get('/library', async (c) => {
  try {
    return c.json(await libraryPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.put('/library', ownerOnly, zValidator('json', z.object({ link: z.string().trim().min(10).max(500) })), async (c) => {
  try {
    await connectLibrary(c.var.db, c.req.valid('json').link)
    return c.json(await libraryPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.delete('/library', ownerOnly, async (c) => {
  await disconnectLibrary(c.var.db)
  return c.json(await libraryPayload(c))
})

/** Перечитать архив сейчас (новые альбомы и фото) — в фоне, шкала в состоянии. */
smmRouter.post('/library/sync', ownerOnly, async (c) => {
  try {
    void syncLibrary(c.var.db).catch((error) => console.error('[smm] архив', error))
    return c.json(await libraryPayload(c))
  } catch (error) {
    return fail(c, error)
  }
})

smmRouter.get('/library/albums/:albumId', async (c) => {
  try {
    const id = c.req.param('albumId')
    if (!/^[\w-]{10,80}$/.test(id)) return c.json({ error: 'Альбом не найден' }, 404)
    return c.json({ photos: await albumPhotos(c.var.db, id) })
  } catch (error) {
    return fail(c, error)
  }
})

/** Поиск по описаниям архива — то же, чем пользуется Tai. */
smmRouter.get('/library/search', async (c) => {
  try {
    const q = (c.req.query('q') ?? '').trim().slice(0, 200)
    if (q.length < 2) return c.json({ photos: [] })
    return c.json({ photos: await searchLibrary(c.var.db, q, { limit: 60, kinds: ['photo', 'template', 'logo', 'design'], perAlbum: 60, minQuality: 1 }) })
  } catch (error) {
    return fail(c, error)
  }
})
