/**
 * Потоковый клиент модели (Polza, OpenAI-совместимый /chat/completions).
 *
 * Отдаёт текст кусками по мере генерации и собранные вызовы инструментов — так
 * ответ Tai начинает появляться через ~1 с, а не после полной генерации.
 */
import type { Database } from '@titan/database'
import { getClubIntegration } from '../../../lib/secrets.js'

const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^["']|["']$/g, '')
export const POLZA_BASE = clean(process.env['POLZA_BASE_URL']) || 'https://polza.ai/api/v1'
// Модель ассистента задаётся отдельно от остальных ИИ-функций (POLZA_MODEL). По замеру
// 2026-10-11 на сценариях Tai gemini-3.5-flash-lite так же быстра, как 3.1, но точнее
// пишет выводы по данным; ~0,1 ₽ за реплику.
const MODEL = clean(process.env['TAI_MODEL']) || 'google/gemini-3.5-flash-lite'
const REQUEST_TIMEOUT_MS = 45_000

export interface LlmToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface LlmTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type LlmChunk = { type: 'text'; text: string } | { type: 'tools'; calls: LlmToolCall[] }

export class LlmError extends Error {}

/** Ключ модели клуба (интеграции клуба) с запасным из env. */
export async function resolveApiKey(db: Database): Promise<string> {
  const key = clean((await getClubIntegration(db, 'ai_api_key')) ?? process.env['POLZA_API_KEY'])
  if (!key) throw new LlmError('Ключ ИИ не настроен')
  return key
}

type StreamDelta = {
  content?: string | null
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
}

/**
 * Один шаг диалога с моделью. Текст отдаётся кусками; вызовы инструментов — одним
 * событием в конце (аргументы приходят частями, собираем их по index).
 */
export async function* streamChat(opts: {
  apiKey: string
  messages: LlmMessage[]
  tools: LlmTool[]
  maxTokens: number
  signal: AbortSignal
}): AsyncGenerator<LlmChunk> {
  const res = await fetch(`${POLZA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: opts.maxTokens,
      temperature: 0.3,
      messages: opts.messages,
      tools: opts.tools.length ? opts.tools : undefined,
    }),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    console.error('[tai] model error', res.status, body.slice(0, 300))
    throw new LlmError(`Модель не ответила (${res.status})`)
  }

  const calls = new Map<number, LlmToolCall>()
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      // Строки-комментарии «: polza-progress …» и пустые разделители пропускаем.
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      let delta: StreamDelta | undefined
      try {
        delta = (JSON.parse(payload) as { choices?: { delta?: StreamDelta }[] }).choices?.[0]?.delta
      } catch {
        continue
      }
      if (!delta) continue
      if (delta.content) yield { type: 'text', text: delta.content }
      for (const part of delta.tool_calls ?? []) {
        const current = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        calls.set(part.index, {
          ...current,
          id: part.id ?? current.id,
          function: {
            name: current.function.name + (part.function?.name ?? ''),
            arguments: current.function.arguments + (part.function?.arguments ?? ''),
          },
        })
      }
    }
  }
  if (calls.size) {
    const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    yield { type: 'tools', calls: ordered }
  }
}
