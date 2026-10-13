/**
 * Tai пишет публикацию: текст под площадку и формат, бриф и промпты картинок,
 * сценарий рилса — и сразу делает визуал. По замечанию сотрудника переписывает
 * (текст, картинку, время) и решает, стоит ли запомнить замечание как правило.
 */
import { sql, type Database } from '@titan/database'
import { z } from 'zod'
import { chatJson } from './ai.js'
import { clubFacts, clubTitle, marketingContext, mskDate, mskToIso } from './context.js'
import { addComment, claimPost, listComments, listPosts, loadPost, remember, setPostProgress, updatePost } from './db.js'
import { datesBetween, datesText } from './holidays.js'
import { knowledgeText, listZones, similarPastPosts, usableZones, zoneByCode, type Zone } from './knowledge.js'
import { archiveCandidates, archiveLine, type LibraryPhoto } from './library.js'
import { generateImages, type ImageJob } from './media.js'
import { DIRECTIONS, FORMAT_LABEL, FORMAT_RULES, HOOK_FORMULAS, PLATFORM_LABEL, PLATFORM_RULES, VISUAL_RULES, systemPrompt, todayLine, whenLine } from './prompts.js'
import { humanize, lintText } from './style.js'
import { MEMORY_KINDS, SmmError, step, type ReelScript, type SmmPost } from './types.js'

const ImageSchema = z.object({
  prompt: z.string().max(6000).optional(),
  zone: z.string().max(8).nullable().optional(),
  logo: z.boolean().optional(),
  photo: z.string().max(8).optional(),
  mode: z.enum(['as_is', 'edit', 'inspire']).optional(),
})
type ImageSpec = z.infer<typeof ImageSchema>
const ScriptSchema = z.object({
  hook: z.string().max(300),
  formula: z.string().max(120).optional(),
  shots: z.array(z.object({ text: z.string().max(400), seconds: z.number().optional(), overlay: z.string().max(120).optional(), sticker: z.string().max(160).optional() })).min(1).max(12),
  audio: z.string().max(300).optional(),
  cast: z.string().max(300).optional(),
  tips: z.string().max(600).optional(),
})
const MemorySchema = z.object({ kind: z.enum(MEMORY_KINDS), text: z.string().min(3).max(300) })

const DraftSchema = z.object({
  body: z.string().min(20).max(4000),
  visual: z.string().max(600),
  images: z.array(ImageSchema).max(8),
  script: ScriptSchema.nullable().optional(),
})

const FixSchema = z.object({ body: z.string().min(20).max(4000) })

/** Сколько картинок нейросети на формат: карусель — по слайду, сторис — кадры без живой съёмки. */
const MAX_IMAGES: Record<SmmPost['format'], number> = { post: 1, carousel: 8, story: 3, reel: 1 }
const hasScript = (format: SmmPost['format']) => format === 'reel' || format === 'story'

const ARCHIVE_RULES = [
  'Фото из архива — поле "photo" с кодом Ф: "mode": "as_is" — настоящее фото как есть (Tai сам обрежет под формат, prompt не нужен); "edit" — поправить фото (в prompt — что: свет, кадр, крупная надпись); "inspire" — новая картинка по мотивам фото (в prompt — сцена).',
  'Живые фото людей клуба цепляют сильнее нарисованных: анонсы вечеров, итоги турниров, атмосфера, отзывы, люди клуба — сначала архив. С нуля рисуй, только если в архиве нет подходящего (правила, инфографика, мемы). Одно фото — в одну позицию.',
].join('\n')

/** Картинки из ответа модели — в задания: «Ф3» — третье найденное фото архива, «З2» — вторая зона клуба. */
function toJobs(images: ImageSpec[], candidates: LibraryPhoto[], zones: Zone[], sortOf: (image: ImageSpec & { slot?: number }, i: number) => number): ImageJob[] {
  return images
    .map((image, i) => {
      const photo = image.photo ? candidates[Number(image.photo.replace(/\D/g, '')) - 1] : undefined
      const zone = zoneByCode(zones, image.zone ?? undefined)
      const job: ImageJob = { prompt: image.prompt ?? '', sort: sortOf(image, i), zone: zone && usableZones([zone]).length ? zone : undefined, logo: image.logo }
      return photo ? { ...job, photo, mode: image.mode ?? 'as_is' } : job
    })
    .filter((job) => job.photo || job.prompt.trim().length >= 10)
}

/** Поводы в день выхода (±1 день): Tai свяжет пост с праздником, если тема позволяет. */
async function dayOccasions(db: Database, publishAt: string | null): Promise<string> {
  const at = publishAt ? Date.parse(publishAt) : Date.now()
  const list = await datesBetween(db, mskDate(at - 86_400_000), mskDate(at + 86_400_000)).catch(() => [])
  if (!list.length) return ''
  return [
    `Поводы рядом с днём выхода:\n${datesText(list)}`,
    'Если тема публикации — про этот повод или позволяет его естественно связать, свяжи. В траурный день — никаких развлечений и продаж. Уважительные даты — без шуток.',
  ].join('\n')
}

const RevisionSchema = z.object({
  reply: z.string().min(2).max(600),
  topic: z.string().min(2).max(160).optional(),
  body: z.string().min(20).max(4000).optional(),
  visual: z.string().max(600).optional(),
  images: z.array(ImageSchema.extend({ slot: z.number().int().min(0).max(9).optional() })).max(5).optional(),
  script: ScriptSchema.nullable().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  memory: z.array(MemorySchema).max(3).optional(),
})

const IdeasSchema = z.object({
  ideas: z.array(z.object({
    topic: z.string().min(3).max(160),
    brief: z.string().max(600),
    platform: z.enum(['telegram', 'instagram']),
    format: z.enum(['post', 'carousel', 'story', 'reel']),
    direction: z.string().max(40),
  })).min(1).max(15),
})
export type SmmIdea = z.infer<typeof IdeasSchema>['ideas'][number]

const directionLabel = (key: string | null) => DIRECTIONS.find((d) => d.key === key)?.label ?? key ?? '—'

function scriptText(script: ReelScript | null): string {
  if (!script) return ''
  return `Сценарий: зацепка «${script.hook}»; кадры: ${script.shots.map((s, i) => `${i + 1}) ${s.text}${s.overlay ? ` [текст: ${s.overlay}]` : ''}`).join(' ')}${script.audio ? `; звук: ${script.audio}` : ''}${script.cast ? `; кто: ${script.cast}` : ''}`
}

function postBriefing(post: SmmPost): string {
  return [
    `Площадка: ${PLATFORM_LABEL[post.platform]}. Формат: ${FORMAT_LABEL[post.format]}. ${whenLine(post.publishAt)}`,
    `Тема: ${post.topic}`,
    post.pillar ? `Рубрика: ${post.pillar}` : '',
    `Направление: ${directionLabel(post.direction)}`,
    post.brief ? `Идея и цель: ${post.brief}` : '',
    post.visual ? `Бриф визуала: ${post.visual}` : '',
  ].filter(Boolean).join('\n')
}

const IMAGE_COUNT: Record<SmmPost['format'], string> = {
  post: '1',
  carousel: '6–8, по одной на слайд, по порядку; текст слайда — крупно на картинке, в кавычках',
  story: '1–3 — только для кадров, которые не снимут вживую (вертикаль 9:16, место под текст)',
  reel: '1 — обложка 9:16 с текстом зацепки',
}

const SCRIPT_SHAPE: Record<SmmPost['format'], string> = {
  post: 'null',
  carousel: 'null',
  story: '{"hook": "тема дня одной фразой", "shots": [{"text": "что показать или снять на кадре", "overlay": "текст на экране, до 12 слов", "sticker": "опрос: вариант / вариант — только на одном кадре"}]}',
  reel: '{"hook": "сказанная фраза зацепки", "formula": "номер и название формулы", "shots": [{"text": "что снимать и что говорить", "seconds": 3, "overlay": "текст на экране, до 6 слов"}], "audio": "звук", "cast": "кто снимает и кто в кадре", "tips": "как снять лучше"}',
}

/**
 * Довести текст до «человеческого»: убрать машинные следы, проверить стоп-лист и
 * правила площадки; нашлось — один заход на переписывание найденного.
 */
async function polish(db: Database, name: string, post: Pick<SmmPost, 'id' | 'platform' | 'format'>, body: string): Promise<string> {
  const clean = humanize(body)
  const issues = lintText(clean, post.platform, post.format)
  if (!issues.length) return clean
  try {
    const fixed = await chatJson(db, {
      system: systemPrompt(name),
      note: `шлифовка ${post.id}`,
      maxTokens: 3000,
      temperature: 0.4,
      schema: FixSchema,
      user: [
        `Текст публикации (${PLATFORM_LABEL[post.platform]}, ${FORMAT_LABEL[post.format]}):`,
        clean,
        '',
        `Исправь только это, смысл и факты не меняй:\n${issues.map((i) => `- ${i}`).join('\n')}`,
        `Правила площадки:\n${PLATFORM_RULES[post.platform]}`,
        'Ответ — JSON: {"body": "исправленный текст целиком"}',
      ].join('\n'),
    })
    return humanize(fixed.body)
  } catch (error) {
    console.warn('[smm] шлифовка не удалась', error instanceof Error ? error.message : error)
    return clean
  }
}

/** Темы соседних публикаций — чтобы не повторяться. */
async function neighbours(db: Database, post: SmmPost): Promise<string> {
  const at = post.publishAt ? Date.parse(post.publishAt) : Date.now()
  const list = await listPosts(db, { from: new Date(at - 10 * 86_400_000).toISOString(), to: new Date(at + 10 * 86_400_000).toISOString() })
  const lines = list.filter((p) => p.id !== post.id && p.status !== 'skipped').slice(0, 30).map((p) => `${p.publishAt?.slice(0, 10) ?? '—'} ${p.platform}/${p.format}: ${p.topic}`)
  return lines.length ? `Соседние публикации (не повторяй их темы и заходы):\n${lines.join('\n')}` : ''
}

/** Убрать прежние картинки Tai (нейросеть и архив): новый черновик — новый визуал; свои фото остаются. */
async function dropAiImages(db: Database, postId: string): Promise<void> {
  await db.execute(sql`UPDATE smm_media SET selected = false, updated_at = now() WHERE post_id = ${postId}::uuid AND source IN ('ai', 'archive') AND kind = 'image'`)
}

interface WriteContext {
  name: string
  facts: string
  marketing: Awaited<ReturnType<typeof marketingContext>>
  zones: Zone[]
  archive: LibraryPhoto[]
  knowledge: string
  similar: string
  occasions: string
}

/** Всё, что Tai знает под конкретную публикацию: клуб, мафия, интерьер, архив, прошлые посты, поводы дня. */
async function writeContext(db: Database, post: SmmPost, remark = ''): Promise<WriteContext> {
  const zones = await listZones(db)
  const topic = [post.topic, post.brief, remark].join(' ')
  const [name, facts, marketing, archive, knowledge, similar, occasions] = await Promise.all([
    clubTitle(db),
    clubFacts(db),
    marketingContext(db),
    archiveCandidates(db, { ...post, brief: `${post.brief} ${remark}` }),
    knowledgeText(db, { mafia: 'full', zones }),
    similarPastPosts(db, topic),
    dayOccasions(db, post.publishAt),
  ])
  return { name, facts, marketing, zones, archive, knowledge, similar, occasions }
}

const contextLines = (ctx: WriteContext): string[] => [
  `Факты о клубе:\n${ctx.facts}`,
  `Что ты знаешь:\n${ctx.knowledge}`,
  `Маркетинг:\n${ctx.marketing.text}`,
  ctx.similar,
  ctx.occasions,
  archiveLine(ctx.archive),
]

/** Форма одной картинки в ответе: зона и логотип — если есть зоны; Ф-код — если есть архив. */
function imageShape(ctx: WriteContext): string {
  const zone = usableZones(ctx.zones).length ? ', "zone": "З-код, только если сцена у нас в клубе, иначе null", "logo": false' : ', "logo": false'
  const archive = ctx.archive.length ? ', "photo": "Ф-код, если берёшь фото архива", "mode": "as_is|edit|inspire"' : ''
  return `{"prompt": "подробный промпт картинки"${zone}${archive}}`
}

/**
 * Подготовить публикацию целиком: текст, визуал, сценарий. Итог — на одобрение
 * (или сразу «одобрено», если включён автопилот). Пост должен быть занят claimPost.
 */
export async function writePost(db: Database, postId: string): Promise<SmmPost> {
  const post = await loadPost(db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  try {
    await setPostProgress(db, post.id, step('Изучаю тему и прошлые посты', 2, 8, 4))
    const ctx = await writeContext(db, post)
    await setPostProgress(db, post.id, step('Пишу текст', 8, 40, 25))
    const draft = await chatJson(db, {
      system: systemPrompt(ctx.name),
      note: `пост ${post.id}`,
      maxTokens: 5000,
      schema: DraftSchema,
      user: [
        todayLine(),
        ...contextLines(ctx),
        await neighbours(db, post),
        '',
        'Задача: подготовь публикацию.',
        postBriefing(post),
        '',
        `Правила площадки:\n${PLATFORM_RULES[post.platform]}`,
        `Правила формата:\n${FORMAT_RULES[post.format]}`,
        post.format === 'reel' ? `Формулы зацепки — выбери ту, что подходит идее, и заполни конкретикой клуба:\n${HOOK_FORMULAS}` : '',
        `Правила визуала:\n${VISUAL_RULES}`,
        ctx.archive.length ? ARCHIVE_RULES : '',
        '',
        'Ответ — JSON:',
        `{"body": "готовый текст публикации", "visual": "одной фразой — что на картинке, для людей", "images": [${imageShape(ctx)}], "script": ${SCRIPT_SHAPE[post.format]}}`,
        `Картинок: ${IMAGE_COUNT[post.format]}.`,
      ].filter((line) => line !== '').join('\n'),
    })
    await setPostProgress(db, post.id, step('Шлифую текст', 40, 50, 10))
    const body = await polish(db, ctx.name, post, draft.body)
    await updatePost(db, post.id, { body, visual: draft.visual, script: hasScript(post.format) ? (draft.script ?? null) : null, status: 'draft', busy: 'image' })
    await dropAiImages(db, post.id)
    let imageError: string | null = null
    try {
      await generateImages(db, post, toJobs(draft.images.slice(0, MAX_IMAGES[post.format]), ctx.archive, ctx.zones, (_, i) => i), { from: 50, to: 97 })
    } catch (error) {
      imageError = error instanceof Error ? `Картинка не получилась: ${error.message}` : 'Картинка не получилась'
    }
    const { autopilot } = ctx.marketing.settings
    await updatePost(db, post.id, { status: autopilot ? 'approved' : 'review', busy: null, error: imageError, reviewSentAt: null })
    return (await loadPost(db, post.id))!
  } catch (error) {
    await updatePost(db, post.id, { busy: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Не получилось' })
    throw error
  }
}

/** Запустить подготовку в фоне (приложение ждёт по полю busy). false — уже идёт. */
export async function writePostInBackground(db: Database, postId: string, after?: (post: SmmPost) => Promise<void>): Promise<boolean> {
  if (!(await claimPost(db, postId, 'text'))) return false
  void writePost(db, postId)
    .then((post) => after?.(post))
    .catch((error) => console.error('[smm] не удалось подготовить пост', postId, error instanceof Error ? error.message : error))
  return true
}

export interface Author {
  id: string | null
  name: string
}

/**
 * Замечание к публикации: Tai переписывает нужное (текст, визуал, время), отвечает,
 * что сделал, и запоминает общее правило, если замечание про стиль, а не про пост.
 */
export async function revisePost(db: Database, postId: string, remark: string, author: Author): Promise<{ post: SmmPost; reply: string }> {
  const post = await loadPost(db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  try {
    await addComment(db, { postId, authorId: author.id, authorName: author.name, role: 'staff', text: remark })
    await setPostProgress(db, postId, step('Вношу правки', 3, 55, 20))
    const [ctx, comments] = await Promise.all([writeContext(db, post, remark), listComments(db, { postId }, 12)])
    const { name, archive } = ctx
    const history = comments.map((c) => `${c.role === 'tai' ? 'Tai' : c.authorName ?? 'сотрудник'}: ${c.text}`).join('\n')
    const images = post.media.filter((m) => m.kind === 'image' && m.status === 'done')
    const revision = await chatJson(db, {
      system: systemPrompt(name),
      note: `правка ${post.id}`,
      maxTokens: 5000,
      temperature: 0.5,
      schema: RevisionSchema,
      user: [
        todayLine(),
        ...contextLines(ctx),
        '',
        'Публикация сейчас:',
        postBriefing(post),
        `Текст:\n${post.body || '(ещё не написан)'}`,
        scriptText(post.script),
        images.length ? `Картинки (слоты): ${images.map((m) => `слот ${m.sort}: ${m.prompt?.slice(0, 300) ?? 'своё фото'}`).join('; ')}` : 'Картинок нет.',
        history ? `Переписка по публикации:\n${history}` : '',
        '',
        `Замечание от ${author.name}: «${remark}»`,
        '',
        `Правила площадки:\n${PLATFORM_RULES[post.platform]}`,
        `Правила формата:\n${FORMAT_RULES[post.format]}`,
        `Правила визуала:\n${VISUAL_RULES}`,
        archive.length ? ARCHIVE_RULES : '',
        '',
        'Сделай, что просят, ничего лишнего не меняй. Ответ — JSON с полями только для того, что меняешь:',
        `{"reply": "коротко, на «ты», что сделал (1–2 фразы)", "topic"?: "...", "body"?: "новый текст целиком", "visual"?: "...", "images"?: [${imageShape(ctx).replace(/}$/, ', "slot": номер слота}')}] — только картинки, которые надо переделать или заменить (остальные не трогай: каждая стоит денег), "script"?: {...}, "date"?: "YYYY-MM-DD", "time"?: "HH:MM" — если просят перенести, "memory"?: [{"kind": "voice|rule|avoid|insight|fact", "text": "правило на будущее"}] — только если замечание общее (про стиль, слова, подход), а не про этот пост}`,
      ].filter((line) => line !== '').join('\n'),
    })

    const publishAt = revision.date || revision.time
      ? mskToIso(revision.date ?? post.publishAt?.slice(0, 10) ?? '', revision.time ?? (post.publishAt ? new Date(Date.parse(post.publishAt) + 3 * 3600_000).toISOString().slice(11, 16) : '12:00'))
      : null
    // Изменилось содержание — снова на одобрение; только перенос времени статус не трогает.
    const contentChanged = !!(revision.body || revision.visual || revision.images?.length || revision.script !== undefined || revision.topic)
    const keepStatus = post.status === 'published' || !contentChanged || (post.status === 'idea' && !revision.body)
    await updatePost(db, post.id, {
      topic: revision.topic,
      body: revision.body ? await polish(db, name, post, revision.body) : undefined,
      visual: revision.visual,
      script: revision.script === undefined ? undefined : revision.script,
      publishAt: publishAt ?? undefined,
      status: keepStatus ? undefined : 'review',
      // Автор замечания видит новую версию сам (в HUB или превью в Telegram) — крон не рассылает повторно.
      reviewSentAt: keepStatus ? undefined : new Date().toISOString(),
      approvedAt: keepStatus ? undefined : null,
      approvedBy: keepStatus ? undefined : null,
      busy: revision.images?.length ? 'image' : undefined,
    })
    for (const m of revision.memory ?? []) await remember(db, { kind: m.kind, text: m.text, source: 'remark', authorId: author.id })
    let reply = revision.reply
    if (revision.images?.length) {
      try {
        await generateImages(db, post, toJobs(revision.images, archive, ctx.zones, (image, i) => image.slot ?? images[i]?.sort ?? i), { from: 55, to: 97 })
      } catch (error) {
        reply += ` Но картинка не получилась: ${error instanceof Error ? error.message : 'ошибка'}`
      }
    }
    if (revision.memory?.length) reply += ' Запомнил на будущее.'
    await addComment(db, { postId, role: 'tai', text: reply })
    await updatePost(db, post.id, { busy: null, error: null })
    return { post: (await loadPost(db, post.id))!, reply }
  } catch (error) {
    await updatePost(db, post.id, { busy: null, error: error instanceof Error ? error.message.slice(0, 300) : 'Не получилось' })
    throw error
  }
}

export async function reviseInBackground(db: Database, postId: string, remark: string, author: Author, after?: (r: { post: SmmPost; reply: string }) => Promise<void>, onError?: (message: string) => Promise<void>): Promise<boolean> {
  if (!(await claimPost(db, postId, 'revise'))) return false
  void revisePost(db, postId, remark, author)
    .then((r) => after?.(r))
    .catch(async (error) => {
      console.error('[smm] правка не удалась', postId, error instanceof Error ? error.message : error)
      await onError?.(error instanceof SmmError ? error.message : 'Не получилось — попробуй ещё раз').catch(() => undefined)
    })
  return true
}

/** Идеи публикаций по направлениям — без сохранения: понравившиеся добавляют в план. */
export async function suggestIdeas(db: Database, opts: { direction?: string; platform?: string; format?: string; wish?: string; count?: number }): Promise<SmmIdea[]> {
  const [name, facts, marketing, knowledge, dates] = await Promise.all([
    clubTitle(db),
    clubFacts(db, 30),
    marketingContext(db),
    knowledgeText(db, { mafia: 'brief' }),
    datesBetween(db, mskDate(), mskDate(Date.now() + 45 * 86_400_000)).catch(() => []),
  ])
  const count = Math.min(Math.max(opts.count ?? 8, 3), 12)
  const r = await chatJson(db, {
    system: systemPrompt(name),
    note: 'идеи',
    maxTokens: 3000,
    temperature: 0.95,
    schema: IdeasSchema,
    user: [
      todayLine(),
      `Факты о клубе:\n${facts}`,
      `Что ты знаешь:\n${knowledge}`,
      `Маркетинг:\n${marketing.text}`,
      dates.length ? `Праздники и поводы ближайших полутора месяцев:\n${datesText(dates)}` : '',
      '',
      `Придумай ${count} свежих идей публикаций${opts.direction ? ` по направлению «${directionLabel(opts.direction)}»` : ' по всем направлениям клуба'}${opts.platform ? ` для ${opts.platform}` : ''}${opts.format ? ` в формате ${opts.format}` : ''}.`,
      opts.wish ? `Пожелание: ${opts.wish}` : '',
      `Направления: ${DIRECTIONS.map((d) => `${d.key} — ${d.label}`).join('; ')}.`,
      'Нужны разные заходы: польза, закулисье, люди клуба, юмор, интерактив, анонсы, итоги, тренды рилс, поводы и праздники. Идея — конкретная, чтобы сразу было понятно, что снимать или писать; опирайся на историю и традиции клуба, но не повторяй то, что уже было.',
      'Ответ — JSON: {"ideas": [{"topic": "короткий заголовок", "brief": "в чём идея и зачем (1–2 фразы)", "platform": "telegram|instagram", "format": "post|carousel|story|reel", "direction": "ключ направления"}]}',
    ].filter(Boolean).join('\n'),
  })
  return r.ideas
}
