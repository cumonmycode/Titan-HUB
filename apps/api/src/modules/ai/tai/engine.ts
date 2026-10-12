/**
 * Цикл диалога Tai: модель → инструменты (параллельно) → модель … до ответа.
 *
 * Почему быстрее старого /ai/chat: один потоковый запрос вместо двух
 * последовательных, без схемы всей базы в промпте; текст идёт кусками, а данные
 * появляются блоками сразу после инструмента. Карточка действия или вопрос с
 * вариантами завершают ход без лишнего обращения к модели.
 */
import type { Context } from 'hono'
import type { AppEnv } from '../../../types.js'
import type { TaiBlock, TaiEvent, TaiScreenContext } from './blocks.js'
import { businessDates, systemPrompt } from './context.js'
import { mskTime, num, rub } from './format.js'
import { createApiCaller, forwardedHeaders, InternalApiError, type ApiCaller } from './internal.js'
import { LlmError, resolveApiKey, streamChat, type LlmMessage, type LlmToolCall } from './llm.js'
import { SpeechStream } from './speech.js'
import { getTaiSettings } from './settings.js'
import { FOLLOW_UPS, llmTools, SCREEN_SUGGESTIONS, toolsFor } from './tools/index.js'
import type { ToolContext, ToolDef, ToolResult } from './tools/types.js'
import type { Database } from '@titan/database'

export interface TaiTurn {
  role: 'user' | 'assistant'
  content: string
  /** Что Tai показал в этом ответе (блоки) — чтобы «а за вчера?» понималось. */
  memo?: string
}

export interface TaiRequest {
  messages: TaiTurn[]
  context?: TaiScreenContext
  /** Ответ озвучат: модель пишет живой речью, числа словами. */
  voice?: boolean
  /** Озвучивать по ходу ответа событиями audio (по умолчанию = voice). Telegram озвучивает сам целиком. */
  speak?: boolean
}

/** Кто спрашивает и где: всё, что runTai брал из запроса Hono. */
export interface TaiEnv {
  db: Database
  user: { sub: string; role: string; nickname: string }
  clubKey: string
  clubName: string
  permissions: Record<string, boolean> | undefined
  /** Заголовки для вызовов API от имени сотрудника (токен, Host клуба). */
  headers: Record<string, string>
  /** Дополнительные инструменты канала (Telegram: опрос клиенту, свой кошелёк). */
  extraTools?: ToolDef[]
  /** Дополнительные правила промпта для канала. */
  extraPrompt?: string
  /** Свой набор инструментов вместо кассовых (диалог с клиентом). */
  tools?: ToolDef[]
  /** Свой системный промпт вместо промпта коллеги (диалог с клиентом). */
  prompt?: string
  temperature?: number
  /** Можно ли материться — для группового чата своя настройка, иначе общая Tai. */
  profanity?: boolean
}

type Emit = (event: TaiEvent) => Promise<void>

const MAX_ROUNDS = 5
const HISTORY_CHARS = 12_000
const TOOL_RESULT_CHARS = 8_000

/** История диалога в пределах бюджета: свежие реплики важнее старых. */
function history(turns: TaiTurn[]): LlmMessage[] {
  const out: LlmMessage[] = []
  let budget = HISTORY_CHARS
  for (const turn of [...turns].reverse()) {
    const content = turn.role === 'assistant' && turn.memo ? `${turn.content}\n[показано: ${turn.memo}]` : turn.content
    if (budget - content.length < 0 && out.length) break
    budget -= content.length
    out.unshift({ role: turn.role, content: content.slice(0, 4_000) })
  }
  return out
}

type ScreenCheck = { id: string; status: string; guestName: string | null; totalAmount: string | number; createdAt: string; items: { checkItem: { quantity: number }; item: { name: string } | null }[] }

/** Строка «где пользователь» для промпта; чек на экране — с позициями. */
async function screenLine(api: ApiCaller, context: TaiScreenContext | undefined): Promise<string> {
  if (context?.checkId) {
    const check = await api.get<{ check: ScreenCheck }>(`/api/pos/checks/${context.checkId}`).then((r) => r.check).catch(() => null)
    if (check) {
      const items = check.items.map((i) => `${i.item?.name ?? 'позиция'}${i.checkItem.quantity > 1 ? ` ×${i.checkItem.quantity}` : ''}`).join(', ') || 'пусто'
      return `Пользователь открыл чек гостя ${check.guestName ?? 'Гость'} (checkId ${check.id}, ${check.status === 'open' ? 'открыт' : 'закрыт'} с ${mskTime(check.createdAt)}): ${items}; сумма ${rub(num(check.totalAmount))}.`
    }
  }
  if (context?.screen === 'analytics' && context.period) return `Пользователь смотрит аналитику за ${context.period.from}..${context.period.to}.`
  if (context?.screen === 'pos') return 'Пользователь на экране кассы.'
  return ''
}

/** Что сказать голосом, если ответ — только блоки без текста. */
function voiceFallback(blocks: TaiBlock[]): string {
  const action = blocks.find((b) => b.type === 'action')
  if (action?.type === 'action') return `${action.action.title}${action.action.total ? `, итого ${action.action.total}` : ''}. Подтверждаешь?`
  const choice = blocks.find((b) => b.type === 'choice')
  if (choice?.type === 'choice') return choice.question
  return blocks.length ? 'Глянь на экран.' : ''
}

function toolError(error: unknown): string {
  if (error instanceof InternalApiError) {
    if (error.status === 403) return `Нет доступа: ${error.message}`
    if (error.status === 404) return `Не найдено: ${error.message}`
    return error.message
  }
  console.error('[tai] tool failed', error)
  return 'Не удалось получить данные'
}

function parseArgs(call: LlmToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}') as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function runTai(c: Context<AppEnv>, request: TaiRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const user = c.get('user')
  return runTaiWith(
    {
      db: c.var.db,
      user: { sub: user.sub, role: user.role, nickname: user.nickname },
      clubKey: c.var.club?.id ?? 'main',
      clubName: c.var.club?.name ?? 'Титан',
      permissions: c.var.permissions,
      headers: forwardedHeaders(c),
    },
    request,
    emit,
    signal,
  )
}

export async function runTaiWith(env: TaiEnv, request: TaiRequest, emit: Emit, signal: AbortSignal): Promise<void> {
  const { db, user } = env
  const isOwner = user.role === 'owner'
  const api = createApiCaller(env.headers)
  const tools = env.tools ? new Map(env.tools.map((tool) => [tool.name, tool])) : toolsFor(isOwner)
  for (const tool of env.extraTools ?? []) tools.set(tool.name, tool)
  const [apiKey, dates, screen, settings] = await Promise.all([resolveApiKey(db), businessDates(db), screenLine(api, request.context), getTaiSettings(db)])

  const ctx: ToolContext = {
    api,
    db,
    isOwner,
    permissions: env.permissions,
    dates,
    clubKey: env.clubKey,
    userSub: user.sub,
    screenCheckId: request.context?.checkId ?? null,
    memo: new Map(),
  }

  const prompt = env.prompt ?? systemPrompt({ clubName: env.clubName, nickname: user.nickname, isOwner, dates, screenLine: screen, voice: !!request.voice, profanity: env.profanity ?? settings.profanity })
  const messages: LlmMessage[] = [
    { role: 'system', content: env.extraPrompt ? `${prompt}\n${env.extraPrompt}` : prompt },
    ...history(request.messages),
  ]

  const memos: string[] = []
  const used: string[] = []
  const shown: TaiBlock[] = []
  let lastStatus = ''
  // Голосовой режим: фразы озвучиваются по ходу ответа и уходят звуком в том же потоке.
  const speak = request.speak ?? !!request.voice
  const speech = speak ? new SpeechStream(apiKey, settings, (audio) => emit({ type: 'audio', ...audio }), signal) : null

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Последний круг — без инструментов: модель обязана ответить текстом.
    const offerTools = round < MAX_ROUNDS - 1
    let text = ''
    let calls: LlmToolCall[] = []
    for await (const chunk of streamChat({ apiKey, messages, tools: offerTools ? llmTools(tools) : [], maxTokens: request.voice ? 400 : 900, signal, temperature: env.temperature })) {
      if (chunk.type === 'text') {
        text += chunk.text
        speech?.push(chunk.text)
        await emit({ type: 'delta', text: chunk.text })
      } else {
        calls = chunk.calls
      }
    }
    if (!calls.length) break

    messages.push({ role: 'assistant', content: text || null, tool_calls: calls })
    const prepared = calls.map((call) => ({ call, args: parseArgs(call), tool: tools.get(call.function.name) }))
    for (const { tool, args } of prepared) {
      const status = tool?.status(args) ?? ''
      if (status && status !== lastStatus) {
        lastStatus = status
        await emit({ type: 'status', text: status })
      }
    }

    const results: ToolResult[] = await Promise.all(
      prepared.map(async ({ tool, args, call }) => {
        if (!tool) return { data: { error: `Нет инструмента ${call.function.name}` } }
        try {
          return await tool.run(args, ctx)
        } catch (error) {
          return { data: { error: toolError(error) } }
        }
      }),
    )

    for (const [index, result] of results.entries()) {
      for (const block of result.blocks ?? []) {
        shown.push(block)
        await emit({ type: 'block', block })
      }
      if (result.memo) memos.push(result.memo)
      const name = prepared[index]!.call.function.name
      if (!result.terminal) used.push(name)
      messages.push({ role: 'tool', tool_call_id: prepared[index]!.call.id, content: JSON.stringify(result.data).slice(0, TOOL_RESULT_CHARS) })
    }

    // Карточка действия или вопрос — ход окончен, ждём пользователя.
    if (results.every((r, i) => r.terminal || prepared[i]!.call.function.name === 'show_links')) break
  }

  if (speech) await speech.finish(voiceFallback(shown))

  const lastTool = used[used.length - 1]
  const suggestions = (lastTool ? FOLLOW_UPS[lastTool] : SCREEN_SUGGESTIONS[request.context?.screen ?? 'other']) ?? []
  const asked = request.messages[request.messages.length - 1]?.content.toLowerCase() ?? ''
  const fresh = suggestions.filter((s) => s.toLowerCase() !== asked).slice(0, 3)
  if (fresh.length) await emit({ type: 'suggestions', items: fresh })
  await emit({ type: 'done', memo: memos.join('; ').slice(0, 1_200) })
}

/** Текст ошибки для клиента: без внутренних подробностей. */
export function taiErrorMessage(error: unknown): string {
  if (error instanceof LlmError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return 'Запрос прерван'
  if (error instanceof Error && error.name === 'TimeoutError') return 'Модель отвечает слишком долго — попробуйте ещё раз'
  console.error('[tai] failed', error)
  return 'Tai не смог ответить — попробуйте ещё раз'
}
