/**
 * Tai — ассистент кассы и аналитики (веб). `POST /api/ai/assistant` отвечает потоком
 * SSE: текст кусками, статусы, интерактивные блоки с данными клуба и карточки действий.
 * Контракт — apps/api/src/modules/ai/tai/blocks.ts (тот же, что у приложения HUB).
 */
import { api, ApiError } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api'

export type TaiRoute =
  | { screen: 'pos' }
  | { screen: 'check'; checkId: string }
  | { screen: 'pay'; checkId: string }
  | { screen: 'shift' }
  | { screen: 'analytics'; from: string; to: string }
  | { screen: 'analytics-checks'; from: string; to: string; hour?: number; method?: string }
  | { screen: 'analytics-check'; checkId: string }
  | { screen: 'analytics-products'; from: string; to: string }
  | { screen: 'analytics-players'; from: string; to: string }
  | { screen: 'player'; playerId: string }
  | { screen: 'inventory' }
  | { screen: 'events' }

export type TaiLink = { label: string; to: TaiRoute }
export type TaiMetric = { label: string; value: string; delta?: number; invert?: boolean; hint?: string }
export type TaiRow = { id: string; title: string; subtitle?: string; value?: string; avatar?: { name: string; url?: string | null }; to?: TaiRoute }
export type TaiPoint = { key: string; label: string; value: number; detail?: string; to?: TaiRoute; toLabel?: string }
export type TaiPart = { key: string; label: string; value: number; share: number; color?: string; to?: TaiRoute }

export type TaiActionCard = {
  id: string
  kind: 'open_check' | 'add_items' | 'change_item' | 'discount' | 'cancel_check'
  title: string
  rows: { label: string; value: string }[]
  total?: string
  confirmLabel: string
  destructive?: boolean
  status: 'pending' | 'done' | 'failed' | 'cancelled'
  result?: string
  to?: TaiRoute
}

export type TaiBlock =
  | { type: 'metrics'; title?: string; items: TaiMetric[]; link?: TaiLink }
  | { type: 'chart'; title: string; unit: 'money' | 'count'; points: TaiPoint[]; caption?: string }
  | { type: 'breakdown'; title: string; parts: TaiPart[]; total: string }
  | { type: 'list'; title: string; rows: TaiRow[]; more?: TaiLink; empty?: string }
  | { type: 'action'; action: TaiActionCard }
  | { type: 'choice'; question: string; options: { label: string; subtitle?: string; reply: string }[] }
  | { type: 'links'; links: TaiLink[] }

export type TaiEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'block'; block: TaiBlock }
  | { type: 'suggestions'; items: string[] }
  | { type: 'audio'; seq: number; format: 'mp3' | 'wav'; data: string }
  | { type: 'done'; memo: string }
  | { type: 'error'; message: string }

export type TaiContext = {
  screen?: 'pos' | 'check' | 'analytics' | 'other'
  checkId?: string
  period?: { from: string; to: string }
}

export type TaiTurn = { role: 'user' | 'assistant'; content: string; memo?: string }

function authHeader(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Задать вопрос и получать события по мере ответа. Ошибка до потока — ApiError (403 — нет подписки). */
export async function streamTai(
  body: { messages: TaiTurn[]; context?: TaiContext; voice?: boolean },
  onEvent: (event: TaiEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/ai/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...authHeader() },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) return
    throw new ApiError(0, 'Нет соединения с сервером', { error: String(error) })
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    const message = data?.error === 'ai_subscription_required' ? 'Tai не подключён для этого клуба.' : typeof data?.error === 'string' ? data.error : `Ошибка ${res.status}`
    throw new ApiError(res.status, message, data ?? undefined)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        onEvent(JSON.parse(data) as TaiEvent)
      } catch {
        // Неполный кадр — пропускаем, поток продолжается.
      }
    }
  }
}

export async function confirmTaiAction(id: string): Promise<TaiActionCard> {
  const { action } = await api.post<{ action: TaiActionCard }>(`/ai/assistant/actions/${id}`)
  return action
}

/** Озвучить короткую фразу голосом Tai. */
export async function speakTai(text: string): Promise<{ format: 'mp3' | 'wav'; data: string } | null> {
  return api.post<{ format: 'mp3' | 'wav'; data: string }>('/ai/assistant/speech', { text }).catch(() => null)
}

export async function dismissTaiAction(id: string): Promise<void> {
  await api.post(`/ai/assistant/actions/${id}/dismiss`).catch(() => undefined)
}

/** Распознать запись голоса на сервере — для браузеров без встроенного распознавания. */
export async function transcribeVoice(audio: Blob): Promise<string> {
  const form = new FormData()
  form.set('file', audio, audio.type.includes('mp4') ? 'voice.m4a' : 'voice.webm')
  const res = await fetch(`${BASE_URL}/ai/assistant/transcribe`, { method: 'POST', headers: authHeader(), body: form })
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Не удалось распознать речь')
  return data.text ?? ''
}

export const isTaiLocked = (error: unknown) =>
  error instanceof ApiError && error.status === 403 && (error.data as { error?: string } | undefined)?.error === 'ai_subscription_required'

export const taiErrorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
