/**
 * Жизненный цикл публикации и фоновая работа Tai по СММ.
 *
 *  идея → (за reviewLeadHours до выхода, рилс — за 3 дня) Tai пишет текст и визуал →
 *  на одобрение: push в HUB и превью с кнопками в Telegram → одобрено →
 *  Telegram-пост выходит сам в срок; Instagram, сторис и рилс — Tai присылает
 *  файлы и текст выкладывающему и ждёт ссылку (напоминает, пока не пришлют).
 *
 * Крон раз в минуту: доводит видео, публикует, передаёт, напоминает, готовит
 * ближайшие посты. Раз в час — цифры свежих постов, раз в день — все цифры площадок
 * и фотоархив, по понедельникам — отчёт, 25-го — черновик плана на следующий месяц.
 */
import { appSettings, sql, type Database } from '@titan/database'
import { getStringSetting } from '../../lib/appSettings.js'
import { notify } from '../notifications/push.js'
import { mskDate } from './context.js'
import { addComment, claimPost, listPosts, loadPlan, loadPlanById, loadPost, rows, updatePost } from './db.js'
import { freezeForecast } from './forecast.js'
import { describePending, syncLibrary } from './library.js'
import { pollVideos } from './media.js'
import { generatePlan } from './planner.js'
import { generateReport } from './report.js'
import { getSmmSettings } from './settings.js'
import { collectStats } from './stats.js'
import { studyInBackground } from './study.js'
import { approvers, publisherFor, publishToChannel, sendHandoff, sendReviewTo, tell, whenText } from './telegram.js'
import { instagramCanPublish, instagramState, publishToInstagram, refreshInstagramToken } from './instagram.js'
import { SmmError, autoPublishes, type SmmPost } from './types.js'
import { writePost } from './writer.js'

export interface SmmEnv {
  db: Database
  clubId: string | null
}

export const clubKeyOf = (clubId: string | null): string => clubId ?? 'main'
export const postUrl = (id: string) => `/manage/smm/post?id=${id}`

const MAX_REMINDERS = 4
const REMIND_EVERY_MS = 3 * 3600_000
const REEL_LEAD_HOURS = 72
/** Опоздали с публикацией больше чем на столько — не публикуем молча, а сообщаем. */
const LATE_LIMIT_MS = 6 * 3600_000

async function push(env: SmmEnv, userIds: string[], title: string, body: string, url: string): Promise<void> {
  for (const userId of userIds) {
    await notify({ type: 'smm', title, body, meta: { url }, userId }, env.db, env.clubId).catch((error) => console.warn('[smm] push', error))
  }
}

// ─── Кто выкладывает ─────────────────────────────────────────────────────────

/**
 * Выложит ли Tai сам: Telegram-пост и карусель — всегда; Instagram — если подключён
 * API и визуал на месте (рилс — с видео). Иначе — передача человеку.
 */
export async function canAutoPublish(db: Database, post: SmmPost): Promise<boolean> {
  return autoPublishes(post) || (await instagramCanPublish(db, post))
}

/** Отметить у публикаций, кто выкладывает, — приложению для статуса и кнопок. */
export async function withAuto(db: Database, posts: SmmPost[]): Promise<SmmPost[]> {
  const ig = !!(await instagramState(db))
  return Promise.all(posts.map(async (p) => ({ ...p, autoPublish: autoPublishes(p) || (ig && (await instagramCanPublish(db, p))) })))
}

// ─── Действия ────────────────────────────────────────────────────────────────

export interface Actor {
  id: string | null
  name: string
}

/** Одобрить: Telegram-пост выйдет сам в срок (время прошло — сейчас), остальное передадим человеку. */
export async function approvePost(env: SmmEnv, postId: string, by: Actor): Promise<SmmPost> {
  const post = await loadPost(env.db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  if (post.status === 'published') throw new SmmError('Уже опубликовано', 409)
  if (post.busy && post.busy !== 'video') throw new SmmError('Tai ещё работает над публикацией — подождите минуту', 409)
  if (!post.body.trim()) throw new SmmError('Сначала Tai должен написать текст', 409)
  await updatePost(env.db, postId, { status: 'approved', approvedBy: by.id, approvedAt: new Date().toISOString(), error: null })
  const approved = (await loadPost(env.db, postId))!
  // Рилс без видео — сразу задача на съёмку; снятое уже загружено — снимать нечего.
  const hasVideo = approved.media.some((m) => m.kind === 'video' && m.status === 'done')
  if (approved.format === 'reel' && !hasVideo) await sendFilmingTask(env, approved).catch((error) => console.warn('[smm] задача на съёмку', error))
  return approved
}

export async function skipPost(env: SmmEnv, postId: string): Promise<void> {
  const post = await loadPost(env.db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  if (post.status === 'published') throw new SmmError('Уже опубликовано', 409)
  await updatePost(env.db, postId, { status: 'skipped' })
}

/** Вернуть в работу пропущенную или неудавшуюся публикацию. */
export async function restorePost(env: SmmEnv, postId: string): Promise<void> {
  const post = await loadPost(env.db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  await updatePost(env.db, postId, { status: post.body ? 'review' : 'idea', reviewSentAt: post.body ? new Date().toISOString() : null, error: null })
}

/** Выложено: ссылка от человека (или найдена). */
export async function markPublished(env: SmmEnv, postId: string, url: string | null): Promise<SmmPost> {
  const post = await loadPost(env.db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  await updatePost(env.db, postId, { status: 'published', publishedUrl: url ?? post.publishedUrl, publishedAt: post.publishedAt ?? new Date().toISOString(), error: null })
  await freezeForecast(env.db, postId).catch(() => undefined)
  return (await loadPost(env.db, postId))!
}

/**
 * Опубликовать сейчас: Telegram — в канал, остальное — сразу передать человеку.
 * Публикация одна: повторный вызов по уже вышедшему посту — ошибка.
 */
export async function publishNow(env: SmmEnv, postId: string): Promise<SmmPost> {
  const post = await loadPost(env.db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  if (post.status === 'published') throw new SmmError('Уже опубликовано', 409)
  if (!post.body.trim()) throw new SmmError('Нет текста публикации', 409)
  if (await canAutoPublish(env.db, post)) {
    // Захват от двойной публикации (кнопка + крон в одну минуту).
    const [claimed] = rows(await env.db.execute(sql`
      UPDATE smm_posts SET status = 'published', published_at = now(), updated_at = now()
      WHERE id = ${postId}::uuid AND status <> 'published' RETURNING id
    `))
    if (!claimed) throw new SmmError('Уже опубликовано', 409)
    try {
      if (post.platform === 'instagram') {
        const { mediaId, url } = await publishToInstagram(env.db, post)
        await updatePost(env.db, postId, { publishedUrl: url, extId: mediaId, error: null })
      } else {
        const { messageId, url } = await publishToChannel(env.db, post)
        await updatePost(env.db, postId, { tgMessageId: messageId, publishedUrl: url, error: null })
      }
    } catch (error) {
      await updatePost(env.db, postId, { status: 'failed', publishedAt: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Не опубликовалось' })
      throw error
    }
    await freezeForecast(env.db, postId).catch(() => undefined)
    return (await loadPost(env.db, postId))!
  }
  await handoff(env, post)
  return (await loadPost(env.db, postId))!
}

/** Передать выкладывающему файлы и текст (Instagram, сторис, рилс). */
async function handoff(env: SmmEnv, post: SmmPost): Promise<void> {
  const settings = await getSmmSettings(env.db)
  const person = await publisherFor(env.db, settings, post)
  if (!person) throw new SmmError('Некому передать публикацию — назначьте, кто выкладывает Instagram, в настройках СММ', 400)
  const sent = await sendHandoff(env.db, clubKeyOf(env.clubId), post, person)
  await updatePost(env.db, post.id, { handoffAt: new Date().toISOString(), remindedAt: new Date().toISOString(), remindCount: 0, assigneeId: post.assigneeId ?? person.id, error: sent ? null : `${person.nickname} не получил сообщение в Telegram — откройте публикацию в HUB` })
  await push(env, [person.id], `Пора выложить: ${post.topic}`, `${post.platform === 'instagram' ? 'Instagram' : 'Telegram'} · файлы и текст — в публикации`, postUrl(post.id))
}

/** Рилс одобрен — сразу задача на съёмку: снять нужно заранее. */
async function sendFilmingTask(env: SmmEnv, post: SmmPost): Promise<void> {
  const settings = await getSmmSettings(env.db)
  const person = await publisherFor(env.db, settings, post)
  if (!person) return
  const script = post.script
  const steps = script ? `\n\nЗацепка: ${script.hook}\n${script.shots.map((s, i) => `${i + 1}. ${s.text}${s.overlay ? ` — текст «${s.overlay}»` : ''}`).join('\n')}${script.audio ? `\nЗвук: ${script.audio}` : ''}${script.cast ? `\nКто: ${script.cast}` : ''}${script.tips ? `\n💡 ${script.tips}` : ''}` : ''
  await tell(env.db, person.tgId, `🎬 Нужно снять рилс к ${whenText(post.publishAt)}: <b>${escape(post.topic)}</b>${escape(steps)}\n\nСнятое видео можно загрузить прямо в публикацию в HUB — я приложу его к подписи.`)
  await push(env, [person.id], `Снять рилс: ${post.topic}`, `К ${whenText(post.publishAt)} · сценарий в публикации`, postUrl(post.id))
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Отправить готовый пост на одобрение: push в HUB и превью с кнопками в Telegram. */
export async function requestReview(env: SmmEnv, raw: SmmPost): Promise<void> {
  const [post] = await withAuto(env.db, [raw])
  if (!post) return
  const people = await approvers(env.db)
  const autopilot = post.status === 'approved'
  const intro = autopilot ? '🤖 Автопилот: выйдет сам, если не остановишь' : '📝 На одобрение'
  for (const person of people) if (person.tgId) await sendReviewTo(env.db, post, person.tgId, intro).catch(() => false)
  await push(env, people.map((p) => p.id), autopilot ? `Выйдет сам: ${post.topic}` : `На одобрение: ${post.topic}`, `${post.platform === 'instagram' ? 'Instagram' : 'Telegram'} · ${whenText(post.publishAt)}`, postUrl(post.id))
  await updatePost(env.db, post.id, { reviewSentAt: new Date().toISOString() })
}

// ─── Крон ────────────────────────────────────────────────────────────────────

const running = new WeakSet<Database>()

type CronMarks = { stats?: string; fresh?: string; report?: string; plan?: string; study?: string }
const MARKS_KEY = 'smm_cron'

async function readMarks(db: Database): Promise<CronMarks> {
  try {
    return JSON.parse(await getStringSetting(MARKS_KEY, '{}', db)) as CronMarks
  } catch {
    return {}
  }
}

async function writeMarks(db: Database, marks: CronMarks): Promise<void> {
  const value = JSON.stringify(marks)
  await db.insert(appSettings).values({ key: MARKS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

/** Есть ли в клубе что-то от СММ — пустые клубы крон не трогает. */
async function smmInUse(db: Database): Promise<boolean> {
  const [row] = rows<{ n: number }>(await db.execute(sql`SELECT (SELECT count(*) FROM smm_plans) + (SELECT count(*) FROM smm_accounts) AS n`).catch(() => [{ n: 0 }]))
  return Number(row?.n ?? 0) > 0
}

async function resetStale(db: Database): Promise<void> {
  await db.execute(sql`
    UPDATE smm_posts SET busy = NULL, busy_at = NULL, error = coalesce(error, 'Tai не закончил — попробуйте ещё раз'), updated_at = now()
    WHERE busy IS NOT NULL AND busy <> 'video' AND busy_at < now() - interval '12 minutes'
  `)
  await db.execute(sql`
    UPDATE smm_plans SET busy = NULL, busy_at = NULL, error = coalesce(error, 'Tai не закончил — попробуйте ещё раз'), updated_at = now()
    WHERE busy IS NOT NULL AND busy_at < now() - interval '20 minutes'
  `)
}

async function publishDue(env: SmmEnv, due: SmmPost[]): Promise<void> {
  for (const post of due) {
    if (!(await canAutoPublish(env.db, post))) continue
    const late = Date.now() - Date.parse(post.publishAt!)
    if (late > LATE_LIMIT_MS) {
      await updatePost(env.db, post.id, { status: 'failed', error: 'Время выхода прошло, пока сервер не работал — опубликуйте вручную или перенесите' })
      continue
    }
    try {
      await publishNow(env, post.id)
    } catch (error) {
      const people = await approvers(env.db)
      await push(env, people.filter((p) => p.role === 'owner').map((p) => p.id), `Не вышел пост: ${post.topic}`, error instanceof Error ? error.message : 'ошибка', postUrl(post.id))
    }
  }
}

async function handoffDue(env: SmmEnv, posts: SmmPost[]): Promise<void> {
  const soon = Date.now() + 15 * 60_000
  for (const post of posts.filter((p) => !p.handoffAt && p.publishAt && Date.parse(p.publishAt) <= soon)) {
    if (await canAutoPublish(env.db, post)) continue
    await handoff(env, post).catch((error) => updatePost(env.db, post.id, { error: error instanceof Error ? error.message : 'не передано' }))
  }
}

async function remindLinks(env: SmmEnv, posts: SmmPost[]): Promise<void> {
  const rowsDue = rows<{ id: string; remind_count: number; reminded_at: string | null }>(await env.db.execute(sql`
    SELECT id, remind_count, reminded_at FROM smm_posts
    WHERE status = 'approved' AND handoff_at IS NOT NULL AND published_url IS NULL
      AND remind_count < ${MAX_REMINDERS} AND coalesce(reminded_at, handoff_at) < now() - make_interval(secs => ${REMIND_EVERY_MS / 1000})
  `))
  for (const due of rowsDue) {
    const post = posts.find((p) => p.id === due.id) ?? (await loadPost(env.db, due.id))
    if (!post) continue
    const settings = await getSmmSettings(env.db)
    const person = await publisherFor(env.db, settings, post)
    const count = Number(due.remind_count) + 1
    if (person) await sendHandoff(env.db, clubKeyOf(env.clubId), post, person, 'remind')
    await updatePost(env.db, post.id, { remindedAt: new Date().toISOString(), remindCount: count })
    if (count >= MAX_REMINDERS) {
      const owners = (await approvers(env.db)).filter((p) => p.role === 'owner')
      await push(env, owners.map((p) => p.id), `Нет ссылки: ${post.topic}`, `${person?.nickname ?? 'Выкладывающий'} так и не прислал ссылку — проверьте, вышла ли публикация`, postUrl(post.id))
    }
  }
}

async function reviewDue(env: SmmEnv): Promise<void> {
  const list = await listPosts(env.db, { from: new Date().toISOString(), status: ['review', 'approved'] })
  for (const post of list.filter((p) => !p.busy && p.body && !p.handoffAt && p.status !== 'published')) {
    const sent = rows(await env.db.execute(sql`SELECT 1 FROM smm_posts WHERE id = ${post.id}::uuid AND review_sent_at IS NULL AND approved_at IS NULL`))
    if (sent.length) await requestReview(env, post)
  }
}

/** Подготовить одну ближайшую идею (по одной за тик — нейросеть не перегружаем). */
async function prepareNext(env: SmmEnv): Promise<void> {
  const settings = await getSmmSettings(env.db)
  const horizon = new Date(Date.now() + Math.max(settings.reviewLeadHours, REEL_LEAD_HOURS) * 3600_000).toISOString()
  const ideas = await listPosts(env.db, { from: new Date(Date.now() + 30 * 60_000).toISOString(), to: horizon, status: ['idea'] })
  for (const post of ideas) {
    if (post.busy) continue
    const lead = (post.format === 'reel' ? REEL_LEAD_HOURS : settings.reviewLeadHours) * 3600_000
    if (Date.parse(post.publishAt!) - Date.now() > lead) continue
    if (post.planId) {
      const plan = await loadPlanById(env.db, post.planId)
      if (plan?.status !== 'active') continue
    }
    if (!(await claimPost(env.db, post.id, 'text'))) continue
    try {
      await writePost(env.db, post.id)
    } catch (error) {
      console.warn('[smm] подготовка поста', post.id, error instanceof Error ? error.message : error)
    }
    return
  }
}

/**
 * Раз в час — цифры свежих постов; раз в день (с 10:00 МСК) — все цифры площадок,
 * ключ Instagram и фотоархив; отчёт по понедельникам (с 11:00), план 25-го (с 12:00);
 * по средам ночью (с 04:00) Tai заново изучает соцсети клуба и обновляет его портрет.
 */
async function periodic(env: SmmEnv): Promise<void> {
  const msk = new Date(Date.now() + 3 * 3600_000)
  const hour = msk.getUTCHours()
  const today = mskDate()
  const marks = await readMarks(env.db)
  if (hour >= 10 && marks.stats !== today) {
    await writeMarks(env.db, { ...marks, stats: today, fresh: msk.toISOString().slice(0, 13) })
    await refreshInstagramToken(env.db).catch((error) => console.warn('[smm] ключ Instagram', error))
    await collectStats(env.db).catch((error) => console.warn('[smm] статистика', error))
    // Архив: новые альбомы и фото, затем описание новых (понемногу — дёшево).
    void syncLibrary(env.db).then(() => describePending(env.db)).catch((error) => console.warn('[smm] архив', error))
  } else if (marks.fresh !== msk.toISOString().slice(0, 13)) {
    await writeMarks(env.db, { ...marks, fresh: msk.toISOString().slice(0, 13) })
    await collectStats(env.db, { fresh: true }).catch((error) => console.warn('[smm] свежие цифры', error))
  }
  if (msk.getUTCDay() === 1 && hour >= 11 && marks.report !== today && (await listPosts(env.db, { from: new Date(Date.now() - 8 * 86_400_000).toISOString(), status: ['published'] })).length) {
    await writeMarks(env.db, { ...(await readMarks(env.db)), report: today })
    try {
      const report = await generateReport(env.db)
      const people = (await approvers(env.db)).filter((p) => p.role === 'owner')
      await push(env, people.map((p) => p.id), report.title, report.summary.slice(0, 160), '/manage/smm/analytics')
    } catch (error) {
      console.warn('[smm] отчёт', error instanceof Error ? error.message : error)
    }
  }
  if (msk.getUTCDay() === 3 && hour >= 4 && marks.study !== today) {
    await writeMarks(env.db, { ...(await readMarks(env.db)), study: today })
    await studyInBackground(env.db, 'socials').catch((error) => console.warn('[smm] изучение клуба', error instanceof Error ? error.message : error))
  }
  const nextMonth = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth() + 1, 1)).toISOString().slice(0, 7)
  if (msk.getUTCDate() >= 25 && hour >= 12 && marks.plan !== nextMonth) {
    await writeMarks(env.db, { ...(await readMarks(env.db)), plan: nextMonth })
    const existing = await loadPlan(env.db, nextMonth)
    if (!existing?.summary) {
      try {
        const plan = await generatePlan(env.db, nextMonth, { author: { id: null, name: 'Tai' } })
        const owners = (await approvers(env.db)).filter((p) => p.role === 'owner')
        await push(env, owners.map((p) => p.id), `План на ${nextMonth} готов`, 'Посмотри стратегию и темы и утверди план', `/manage/smm/plan?month=${nextMonth}`)
        await addComment(env.db, { planId: plan.id, role: 'tai', text: 'Составил план заранее — поправь, если что-то не так.' })
      } catch (error) {
        console.warn('[smm] план следующего месяца', error instanceof Error ? error.message : error)
      }
    }
  }
}

export async function smmTick(db: Database, clubId: string | null): Promise<void> {
  if (running.has(db)) return
  running.add(db)
  try {
    if (!(await smmInUse(db))) return
    const env: SmmEnv = { db, clubId }
    await resetStale(db)
    await pollVideos(db)
    const approved = await listPosts(db, { from: new Date(Date.now() - 3 * 86_400_000).toISOString(), to: new Date(Date.now() + 20 * 60_000).toISOString(), status: ['approved'] })
    const due = approved.filter((p) => !p.busy && p.publishAt && Date.parse(p.publishAt) <= Date.now())
    await publishDue(env, due)
    await handoffDue(env, approved.filter((p) => !p.busy))
    await remindLinks(env, approved)
    // Сначала подготовить ближайшую идею — тогда она уходит на одобрение в этот же тик.
    await prepareNext(env)
    await reviewDue(env)
    await periodic(env)
  } catch (error) {
    console.error('[smm] крон', error)
  } finally {
    running.delete(db)
  }
}
