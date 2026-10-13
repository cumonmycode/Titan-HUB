/**
 * Нейросети раздела «СММ» через Polza (тот же ключ, что у Tai):
 *  - тексты, планы, отчёты и разбор скриншотов — Claude Sonnet 5.5 (лучший русский
 *    копирайтинг; ответ строго JSON по схеме);
 *  - картинки — Nano Banana 2.1 в 2K (точный русский текст на картинке, до 10
 *    референсов — фото клуба), запасная — GPT Image 2.5;
 *  - видео — Veo 3.1 Fast: 8 с со звуком, 9:16, ~45 ₽ — лучшее качество за деньги.
 * Модели меняются переменными SMM_TEXT_MODEL / SMM_IMAGE_MODEL / SMM_VIDEO_MODEL.
 *
 * Каждый вызов пишет стоимость в smm_spend; перед вызовом — проверка бюджета месяца.
 */
import { sql, type Database } from '@titan/database'
import type { z } from 'zod'
import { LlmError, POLZA_BASE, resolveApiKey } from '../ai/tai/llm.js'
import { rows } from './db.js'
import { getSmmSettings } from './settings.js'
import { SmmError } from './types.js'

const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^["']|["']$/g, '')

export const SMM_MODELS = {
  text: clean(process.env['SMM_TEXT_MODEL']) || 'anthropic/claude-sonnet-5.5',
  image: clean(process.env['SMM_IMAGE_MODEL']) || 'google/gemini-nano-banana-2.1',
  imageFallback: 'openai/gpt-image-2.5-flare',
  video: clean(process.env['SMM_VIDEO_MODEL']) || 'google/veo3_fast',
}

type SpendKind = 'text' | 'image' | 'video' | 'vision'
/** Сколько примерно стоит вызов — чтобы не начинать то, на что бюджета уже нет. */
const ESTIMATE_RUB: Record<SpendKind, number> = { text: 3, vision: 2, image: 5, video: 45 }
const CHAT_TIMEOUT_MS = 180_000
const IMAGE_TIMEOUT_MS = 170_000
const POLL_EVERY_MS = 4_000
const IMAGE_RESOLUTION = '2K'

export async function smmApiKey(db: Database): Promise<string> {
  try {
    return await resolveApiKey(db)
  } catch (error) {
    if (error instanceof LlmError) throw new SmmError('Ключ нейросетей не настроен — добавьте Polza в «Интеграциях»', 400)
    throw error
  }
}

// ─── Бюджет ──────────────────────────────────────────────────────────────────

export async function recordSpend(db: Database, kind: SpendKind, model: string, costRub: number, note?: string): Promise<void> {
  if (!(costRub > 0)) return
  await db.execute(sql`INSERT INTO smm_spend (kind, model, cost_rub, note) VALUES (${kind}, ${model}, ${costRub}, ${note?.slice(0, 200) ?? null})`).catch((error) => console.error('[smm] spend', error))
}

/** Потрачено на нейросети СММ с начала месяца (МСК), ₽. */
export async function monthSpend(db: Database): Promise<number> {
  const [row] = rows<{ total: string | number | null }>(await db.execute(sql`
    SELECT coalesce(sum(cost_rub), 0) AS total FROM smm_spend
    WHERE at >= date_trunc('month', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'
  `))
  return Number(row?.total ?? 0) || 0
}

async function assertBudget(db: Database, kind: SpendKind): Promise<void> {
  const { monthlyBudget } = await getSmmSettings(db)
  if (!monthlyBudget) return
  const spent = await monthSpend(db)
  if (spent + ESTIMATE_RUB[kind] > monthlyBudget) {
    throw new SmmError(`Бюджет на нейросети в этом месяце закончился (${Math.round(spent)} из ${monthlyBudget} ₽) — увеличьте его в настройках СММ`, 402)
  }
}

// ─── Запросы к Polza ─────────────────────────────────────────────────────────

type PolzaError = { error?: { code?: string; message?: string } }

function polzaFailure(status: number, body: PolzaError): SmmError {
  const message = body.error?.message ?? ''
  console.error('[smm] polza', status, body.error?.code ?? '', message.slice(0, 300))
  // У ключа Polza бывает свой лимит трат — денег на аккаунте хватает, а ключу нельзя.
  if ((status === 402 || body.error?.code === 'INSUFFICIENT_BALANCE') && /лимит/i.test(message)) {
    return new SmmError('У ключа Polza закончился лимит трат — увеличьте или снимите лимит этого ключа на polza.ai (раздел «API-ключи»)', 402)
  }
  if (status === 402 || body.error?.code === 'INSUFFICIENT_BALANCE') return new SmmError('На балансе Polza не хватает денег — пополните баланс на polza.ai', 402)
  if (status === 401 || status === 403) return new SmmError('Ключ Polza не принят — проверьте его в «Интеграциях»', 400)
  if (status === 400 && message) return new SmmError(`Нейросеть отклонила запрос: ${message.slice(0, 160)}`, 502)
  if (status === 429) return new SmmError('Нейросеть перегружена — попробуйте через минуту', 502)
  return new SmmError('Нейросеть не ответила — попробуйте ещё раз', 502)
}

async function polza<T>(apiKey: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${POLZA_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new SmmError('Нейросеть думает слишком долго — попробуйте ещё раз', 502)
    throw new SmmError('Нет связи с нейросетью — попробуйте ещё раз', 502)
  }
  const data = (await res.json().catch(() => ({}))) as T & PolzaError
  if (!res.ok) throw polzaFailure(res.status, data)
  return data
}

export async function polzaBalance(db: Database): Promise<number | null> {
  try {
    const data = await polza<{ amount?: string }>(await smmApiKey(db), '/balance', undefined, 10_000)
    const n = Number(data.amount)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// ─── Текст (JSON) ────────────────────────────────────────────────────────────

export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string | ChatPart[] }

/** Достаёт объект JSON из ответа модели: без обёртки ```json и пояснений вокруг. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('в ответе нет JSON')
  return JSON.parse(trimmed.slice(start, end + 1))
}

interface ChatJsonOpts<T> {
  system: string
  user: string | ChatPart[]
  schema: z.ZodType<T>
  maxTokens?: number
  temperature?: number
  kind?: 'text' | 'vision'
  note?: string
}

/**
 * Запрос к текстовой модели с ответом строго по схеме. Не прошёл проверку — второй
 * заход с текстом ошибки (модель сама исправляет JSON).
 */
export async function chatJson<T>(db: Database, opts: ChatJsonOpts<T>): Promise<T> {
  const kind = opts.kind ?? 'text'
  await assertBudget(db, kind)
  const apiKey = await smmApiKey(db)
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ]
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = await polza<{ choices?: { message?: { content?: string | null } }[]; usage?: { cost_rub?: number } }>(
      apiKey,
      '/chat/completions',
      {
        model: SMM_MODELS.text,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: opts.temperature ?? 0.7,
        response_format: { type: 'json_object' },
        messages,
      },
      CHAT_TIMEOUT_MS,
    )
    await recordSpend(db, kind, SMM_MODELS.text, Number(data.usage?.cost_rub ?? 0), opts.note)
    const content = data.choices?.[0]?.message?.content ?? ''
    try {
      const parsed = opts.schema.safeParse(extractJson(content))
      if (parsed.success) return parsed.data
      lastError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'неверный JSON'
    }
    messages.push({ role: 'assistant', content }, { role: 'user', content: `Ответ не прошёл проверку (${lastError}). Верни исправленный JSON целиком, без пояснений.` })
  }
  console.error('[smm] модель вернула неверный JSON:', lastError)
  throw new SmmError('Tai ответил не по форме — попробуйте ещё раз', 502)
}

// ─── Картинки и видео ────────────────────────────────────────────────────────

type MediaResponse = {
  id?: string
  status?: string
  data?: unknown
  output?: unknown
  usage?: { cost_rub?: number }
  error?: { message?: string } | string
}

/** Ссылка на результат: Polza отдаёт {url}, [{url}] или output.url — смотря по модели. */
export function resultUrl(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = resultUrl(item)
      if (url) return url
    }
    return null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return resultUrl(obj['url']) ?? resultUrl(obj['video_url']) ?? resultUrl(obj['image_url']) ?? resultUrl(obj['output'])
  }
  return null
}

const mediaError = (r: MediaResponse): string => (typeof r.error === 'string' ? r.error : r.error?.message) || 'генерация не удалась'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Картинке не хватает соотношения 4:5 у запасной модели — ближайшее 3:4. */
const fallbackAspect = (aspect: string): string => (aspect === '4:5' ? '3:4' : aspect)

async function imageOnce(apiKey: string, model: string, prompt: string, aspect: string, references: string[]): Promise<{ url: string; cost: number }> {
  const input: Record<string, unknown> = { prompt: prompt.slice(0, 19_000), aspect_ratio: aspect, image_resolution: IMAGE_RESOLUTION }
  if (model.includes('banana')) input['output_format'] = 'jpeg'
  if (references.length) input['images'] = references.slice(0, 8).map((url) => ({ type: 'url', data: url }))
  let r = await polza<MediaResponse>(apiKey, '/media', { model, input }, IMAGE_TIMEOUT_MS)
  const deadline = Date.now() + IMAGE_TIMEOUT_MS
  while ((r.status === 'pending' || r.status === 'processing') && r.id && Date.now() < deadline) {
    await sleep(POLL_EVERY_MS)
    r = await polza<MediaResponse>(apiKey, `/media/${encodeURIComponent(r.id)}`, undefined, 20_000)
  }
  if (r.status === 'failed' || r.status === 'cancelled') throw new SmmError(`Картинка не получилась: ${mediaError(r).slice(0, 160)}`, 502)
  const url = resultUrl(r.data) ?? resultUrl(r.output)
  if (!url) throw new SmmError('Картинка не успела сгенерироваться — попробуйте ещё раз', 502)
  return { url, cost: Number(r.usage?.cost_rub ?? 0) || 0 }
}

/** Картинка: основная модель, при сбое провайдера — запасная. Возвращает временную ссылку Polza (7 дней). */
export async function generateImage(db: Database, opts: { prompt: string; aspect: string; references?: string[]; note?: string }): Promise<{ url: string; cost: number; model: string }> {
  await assertBudget(db, 'image')
  const apiKey = await smmApiKey(db)
  const references = opts.references ?? []
  try {
    const r = await imageOnce(apiKey, SMM_MODELS.image, opts.prompt, opts.aspect, references)
    await recordSpend(db, 'image', SMM_MODELS.image, r.cost, opts.note)
    return { ...r, model: SMM_MODELS.image }
  } catch (error) {
    if (error instanceof SmmError && error.status === 402) throw error
    console.warn('[smm] основная модель картинок не справилась, пробую запасную', error instanceof Error ? error.message : error)
    const r = await imageOnce(apiKey, SMM_MODELS.imageFallback, opts.prompt, fallbackAspect(opts.aspect), references)
    await recordSpend(db, 'image', SMM_MODELS.imageFallback, r.cost, opts.note)
    return { ...r, model: SMM_MODELS.imageFallback }
  }
}

/** Видео делается минуты — запускаем задачу и опрашиваем её кроном (pollVideo). */
export async function startVideo(db: Database, opts: { prompt: string; aspect: '9:16' | '16:9'; references?: string[] }): Promise<{ polzaId: string; model: string }> {
  await assertBudget(db, 'video')
  const apiKey = await smmApiKey(db)
  const input: Record<string, unknown> = { prompt: opts.prompt.slice(0, 1_900), aspect_ratio: opts.aspect, enableTranslation: 'true' }
  const references = (opts.references ?? []).slice(0, 3)
  if (references.length) input['images'] = references.map((url) => ({ type: 'url', data: url }))
  const r = await polza<MediaResponse>(apiKey, '/media', { model: SMM_MODELS.video, input, async: true }, 30_000)
  if (!r.id) throw new SmmError('Видео не запустилось — попробуйте ещё раз', 502)
  return { polzaId: r.id, model: SMM_MODELS.video }
}

export type VideoState = { status: 'pending' } | { status: 'done'; url: string; cost: number } | { status: 'failed'; error: string }

export async function pollVideo(db: Database, polzaId: string): Promise<VideoState> {
  const r = await polza<MediaResponse>(await smmApiKey(db), `/media/${encodeURIComponent(polzaId)}`, undefined, 20_000)
  if (r.status === 'failed' || r.status === 'cancelled') return { status: 'failed', error: mediaError(r).slice(0, 200) }
  if (r.status !== 'completed') return { status: 'pending' }
  const url = resultUrl(r.data) ?? resultUrl(r.output)
  if (!url) return { status: 'failed', error: 'нет ссылки на видео' }
  const cost = Number(r.usage?.cost_rub ?? 0) || 0
  await recordSpend(db, 'video', SMM_MODELS.video, cost)
  return { status: 'done', url, cost }
}
