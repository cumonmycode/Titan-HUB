/**
 * План на месяц: стратегия, цели, рубрики и календарь публикаций по всем
 * направлениям клуба с учётом турниров, вечеров и праздников. Замечание к плану —
 * Tai двигает, добавляет, убирает и переписывает темы, отвечает, что сделал.
 */
import { sql, type Database } from '@titan/database'
import { z } from 'zod'
import { chatJson } from './ai.js'
import { clubFacts, clubTitle, marketingContext, mskDate, mskToIso } from './context.js'
import { addComment, claimPlan, deletePost, ensurePlan, insertPost, listComments, listPosts, loadPlan, remember, updatePlan, updatePost } from './db.js'
import { CONTENT_TYPES, DIRECTIONS, DIRECTION_KEYS, FORMAT_LABEL, systemPrompt, todayLine } from './prompts.js'
import type { Author } from './writer.js'
import { MEMORY_KINDS, SmmError, type SmmPlan, type SmmPost } from './types.js'

const PostSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  platform: z.enum(['telegram', 'instagram']),
  format: z.enum(['post', 'carousel', 'story', 'reel']),
  topic: z.string().min(3).max(160),
  pillar: z.string().max(40).optional(),
  direction: z.string().max(40).optional(),
  brief: z.string().max(800),
  visual: z.string().max(400).optional(),
})
const PillarSchema = z.object({ key: z.string().min(1).max(40), title: z.string().min(1).max(80), share: z.number().min(0).max(100), about: z.string().max(400) })

const PlanSchema = z.object({
  summary: z.string().min(50).max(5000),
  goals: z.array(z.string().min(3).max(240)).min(1).max(6),
  pillars: z.array(PillarSchema).min(2).max(7),
  posts: z.array(PostSchema).min(1).max(120),
})

const PlanRevisionSchema = z.object({
  reply: z.string().min(2).max(800),
  summary: z.string().min(50).max(5000).optional(),
  goals: z.array(z.string().min(3).max(240)).max(6).optional(),
  pillars: z.array(PillarSchema).max(7).optional(),
  remove: z.array(z.number().int()).max(80).optional(),
  update: z.array(PostSchema.partial().extend({ n: z.number().int() })).max(80).optional(),
  add: z.array(PostSchema).max(40).optional(),
  memory: z.array(z.object({ kind: z.enum(MEMORY_KINDS), text: z.string().min(3).max(300) })).max(3).optional(),
})

const DONE_STATUSES = new Set(['published'])
/** Что можно пересоставить без потерь: Tai ещё не показывал текст людям. */
const REPLACEABLE = new Set(['idea', 'draft'])

export const monthRange = (month: string): { from: string; to: string } => {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: new Date(`${month}-01T00:00:00+03:00`).toISOString(), to: new Date(`${next}-01T00:00:00+03:00`).toISOString() }
}

export const isMonth = (v: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(v)

/** Дни месяца, на которые ещё можно планировать (с завтрашнего дня). */
function planDays(month: string): string[] {
  const today = mskDate()
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const out: string[] = []
  for (let d = 1; d <= last; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    if (date > today) out.push(date)
  }
  return out
}

const mskTime = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(11, 16) : '')
const mskDay = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 10) : '')

function postLine(p: SmmPost, n?: number): string {
  return `${n != null ? `#${n} ` : ''}${mskDay(p.publishAt)} ${mskTime(p.publishAt)} ${p.platform}/${p.format} [${p.status}]: ${p.topic}${p.brief ? ` — ${p.brief.slice(0, 160)}` : ''}`
}

const directionOf = (v: string | undefined) => (v && DIRECTION_KEYS.includes(v) ? v : null)

async function insertFromPlan(db: Database, plan: SmmPlan, p: z.infer<typeof PostSchema>, authorId: string | null): Promise<boolean> {
  const publishAt = mskToIso(p.date, p.time)
  if (!publishAt || Date.parse(publishAt) < Date.now()) return false
  await insertPost(db, {
    planId: plan.id,
    platform: p.platform,
    format: p.format,
    publishAt,
    topic: p.topic,
    pillar: p.pillar ?? null,
    direction: directionOf(p.direction),
    brief: p.brief,
    visual: p.visual ?? '',
    createdBy: authorId,
  })
  return true
}

/** Составить (или пересоставить) план месяца. Одобренные и вышедшие публикации сохраняются. */
export async function generatePlan(db: Database, month: string, opts: { wishes?: string; author: Author }): Promise<SmmPlan> {
  const plan = await ensurePlan(db, month)
  const days = planDays(month)
  if (!days.length) throw new SmmError('Этот месяц уже закончился', 400)
  try {
    const { from, to } = monthRange(month)
    const [name, facts, marketing, existing] = await Promise.all([clubTitle(db), clubFacts(db, 75), marketingContext(db), listPosts(db, { from, to })])
    const kept = existing.filter((p) => !REPLACEABLE.has(p.status) && p.status !== 'skipped')
    const { cadence, postTime } = marketing.settings
    const weeks = Math.max(1, Math.round((days.length / 7) * 10) / 10)
    const r = await chatJson(db, {
      system: systemPrompt(name),
      note: `план ${month}`,
      maxTokens: 14_000,
      temperature: 0.8,
      schema: PlanSchema,
      user: [
        todayLine(),
        `Факты о клубе:\n${facts}`,
        `Маркетинг:\n${marketing.text}`,
        '',
        `Задача: составь контент-план на ${month} (дни ${days[0]}…${days[days.length - 1]}, это ~${weeks} нед.).`,
        `Частота в неделю: Telegram-постов ${cadence.telegram}, Instagram-постов ${cadence.instagram}, сторис ${cadence.stories} (Instagram, иногда Telegram), рилс ${cadence.reels} (Instagram).`,
        `Время по умолчанию ${postTime}; ставь время под аудиторию: анонс вечера — днём в день игры или накануне вечером, рилс — вечером.`,
        `Направления клуба (каждое должно прозвучать за месяц, по весу бизнеса): ${DIRECTIONS.map((d) => `${d.key} — ${d.label}`).join('; ')}.`,
        'Используй инфоповоды: турниры и игровые вечера из фактов, праздники и значимые даты месяца, сезон; продавай мероприятия (ДР, корпоративы) заранее; подогревай пустые дни недели.',
        `Типы контента (скилл ig-plan) — каждую неделю есть все, два одинаковых подряд не ставь:\n${CONTENT_TYPES}`,
        'Плюс анонсы вечеров и турниров, закулисье и люди клуба, юмор и мемы мафии, интерактив (опросы, вопросы), отзывы.',
        'Каждой публикации — угол, а не тема: не «мафия», а «как ведущий за 3 секунды вычисляет новичка-мафию». В brief — конкретная история или цифра клуба, которую можно рассказать.',
        'Рилс — главный способ дотянуться до тех, кто не подписан: снимают сотрудники и гости — в brief опиши идею съёмки и формулу зацепки. Сторис — серия касаний на день: анонс, закулисье, опрос.',
        'Время: гостям удобно вечером после работы (18:00–20:00) и в обед; анонс игры — в день игры днём или накануне вечером. Но первые 2 секунды важнее часа выхода.',
        kept.length ? `Уже есть (не трогай, учитывай в ритме и не повторяй темы):\n${kept.map((p) => postLine(p)).join('\n')}` : '',
        opts.wishes ? `Пожелания владельца: ${opts.wishes}` : '',
        '',
        'Ответ — JSON:',
        '{"summary": "стратегия месяца: 3–6 коротких абзацев — главный фокус, инфоповоды, как растим охват и заявки", "goals": ["измеримые цели месяца"], "pillars": [{"key": "латиница", "title": "рубрика", "share": доля %, "about": "о чём"}], "posts": [{"date": "YYYY-MM-DD", "time": "HH:MM", "platform": "telegram|instagram", "format": "post|carousel|story|reel", "topic": "тема-заголовок", "pillar": "key рубрики", "direction": "key направления", "brief": "идея и цель публикации, конкретно (1–3 фразы)", "visual": "что на картинке или в кадре"}]}',
      ].filter((line) => line !== '').join('\n'),
    })

    const replaceable = existing.filter((p) => REPLACEABLE.has(p.status) && !p.busy)
    for (const p of replaceable) await deletePost(db, p.id)
    let added = 0
    for (const p of r.posts) if (await insertFromPlan(db, plan, p, opts.author.id)) added += 1
    await updatePlan(db, plan.id, { summary: r.summary, goals: r.goals, pillars: r.pillars, status: 'draft', busy: null, error: null })
    await addComment(db, { planId: plan.id, role: 'tai', text: `Составил план: ${added} публикаций. Посмотри стратегию и темы — утверди план, и я начну готовить посты за ${marketing.settings.reviewLeadHours} ч до выхода.` })
    return (await loadPlan(db, month))!
  } catch (error) {
    await updatePlan(db, plan.id, { busy: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Не получилось' })
    throw error
  }
}

export async function generatePlanInBackground(db: Database, month: string, opts: { wishes?: string; author: Author }, after?: (plan: SmmPlan) => Promise<void>): Promise<boolean> {
  const plan = await ensurePlan(db, month)
  if (!(await claimPlan(db, plan.id, 'plan'))) return false
  void generatePlan(db, month, opts)
    .then((p) => after?.(p))
    .catch((error) => console.error('[smm] план не составлен', month, error instanceof Error ? error.message : error))
  return true
}

/** Замечание к плану: перенести, добавить, убрать, переписать темы или стратегию. */
export async function revisePlan(db: Database, month: string, remark: string, author: Author): Promise<string> {
  const plan = await loadPlan(db, month)
  if (!plan) throw new SmmError('Плана на этот месяц ещё нет', 404)
  try {
    await addComment(db, { planId: plan.id, authorId: author.id, authorName: author.name, role: 'staff', text: remark })
    const { from, to } = monthRange(month)
    const [name, facts, marketing, posts, comments] = await Promise.all([clubTitle(db), clubFacts(db, 75), marketingContext(db), listPosts(db, { from, to }), listComments(db, { planId: plan.id }, 10)])
    const active = posts.filter((p) => p.status !== 'skipped')
    const r = await chatJson(db, {
      system: systemPrompt(name),
      note: `правка плана ${month}`,
      maxTokens: 8000,
      temperature: 0.5,
      schema: PlanRevisionSchema,
      user: [
        todayLine(),
        `Факты о клубе:\n${facts}`,
        `Маркетинг:\n${marketing.text}`,
        '',
        `План на ${month}. Стратегия:\n${plan.summary}`,
        `Цели: ${plan.goals.join('; ')}`,
        `Рубрики: ${plan.pillars.map((p) => `${p.key} — ${p.title} ${p.share}%`).join('; ')}`,
        `Публикации (#номер):\n${active.map((p, i) => postLine(p, i + 1)).join('\n')}`,
        comments.length ? `Переписка по плану:\n${comments.map((c) => `${c.role === 'tai' ? 'Tai' : c.authorName ?? 'сотрудник'}: ${c.text}`).join('\n')}` : '',
        '',
        `Замечание от ${author.name}: «${remark}»`,
        '',
        'Опубликованные (published) не трогай. Делай только то, что просят. Ответ — JSON с полями только для изменений:',
        '{"reply": "коротко, на «ты», что поменял", "summary"?: "...", "goals"?: [...], "pillars"?: [...], "remove"?: [номера], "update"?: [{"n": номер, "date"?: "YYYY-MM-DD", "time"?: "HH:MM", "topic"?: "...", "brief"?: "...", "platform"?: "...", "format"?: "...", "pillar"?: "...", "direction"?: "...", "visual"?: "..."}], "add"?: [{"date", "time", "platform", "format", "topic", "pillar", "direction", "brief", "visual"}], "memory"?: [{"kind": "voice|rule|avoid|insight|fact", "text": "..."}] — только если замечание — общее правило на будущее}',
      ].filter((line) => line !== '').join('\n'),
    })

    const byNumber = (n: number) => active[n - 1]
    for (const n of r.remove ?? []) {
      const post = byNumber(n)
      if (!post || DONE_STATUSES.has(post.status)) continue
      if (REPLACEABLE.has(post.status)) await deletePost(db, post.id)
      else await updatePost(db, post.id, { status: 'skipped' })
    }
    for (const u of r.update ?? []) {
      const post = byNumber(u.n)
      if (!post || DONE_STATUSES.has(post.status)) continue
      const day = u.date ?? mskDay(post.publishAt)
      const time = u.time ?? mskTime(post.publishAt)
      const publishAt = u.date || u.time ? mskToIso(day, time) : null
      // Сменилась суть — текст и картинки устарели: тема возвращается в «идеи», Tai напишет заново.
      const changed = !!(u.topic || u.brief || u.format || u.platform)
      await updatePost(db, post.id, {
        publishAt: publishAt ?? undefined,
        topic: u.topic,
        brief: u.brief,
        platform: u.platform,
        format: u.format,
        pillar: u.pillar,
        direction: u.direction ? directionOf(u.direction) : undefined,
        visual: u.visual,
        ...(changed ? { status: 'idea', body: '', script: null, reviewSentAt: null, approvedAt: null, approvedBy: null } : {}),
      })
      if (changed) await db.execute(sql`UPDATE smm_media SET selected = false WHERE post_id = ${post.id}::uuid AND source = 'ai'`)
    }
    for (const p of r.add ?? []) await insertFromPlan(db, plan, p, author.id)
    await updatePlan(db, plan.id, { summary: r.summary, goals: r.goals, pillars: r.pillars?.length ? r.pillars : undefined, busy: null, error: null })
    for (const m of r.memory ?? []) await remember(db, { kind: m.kind, text: m.text, source: 'remark', authorId: author.id })
    const reply = r.reply + (r.memory?.length ? ' Запомнил на будущее.' : '')
    await addComment(db, { planId: plan.id, role: 'tai', text: reply })
    return reply
  } catch (error) {
    await updatePlan(db, plan.id, { busy: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Не получилось' })
    throw error
  }
}

export async function revisePlanInBackground(db: Database, month: string, remark: string, author: Author): Promise<boolean> {
  const plan = await loadPlan(db, month)
  if (!plan) throw new SmmError('Плана на этот месяц ещё нет', 404)
  if (!(await claimPlan(db, plan.id, 'revise'))) return false
  void revisePlan(db, month, remark, author).catch((error) => console.error('[smm] правка плана не удалась', month, error instanceof Error ? error.message : error))
  return true
}

export const formatLabel = FORMAT_LABEL
