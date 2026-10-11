'use client'
import { create } from 'zustand'
import {
  confirmTaiAction,
  dismissTaiAction,
  isTaiLocked,
  streamTai,
  taiErrorText,
  type TaiActionCard,
  type TaiBlock,
  type TaiContext,
  type TaiEvent,
  type TaiRoute,
  type TaiTurn,
} from '@/lib/tai'

/**
 * Диалог с Tai на время работы вкладки (как в приложении HUB): панель закрыли и открыли —
 * разговор продолжается, «Новый диалог» начинает заново. История уходит на сервер с
 * каждым вопросом. Здесь же — открытие панели Tai с контекстом экрана.
 */

export type TaiUserMessage = { id: string; role: 'user'; text: string }
export type TaiReply = {
  id: string
  role: 'tai'
  text: string
  blocks: TaiBlock[]
  status: string | null
  suggestions: string[]
  memo?: string
  error?: string
  streaming: boolean
  voice: boolean
  /** Голосом — сколько текста и блоков уже озвучено (показываем вместе со звуком). null — всё. */
  gate: { chars: number; blocks: number } | null
}
export type TaiMessage = TaiUserMessage | TaiReply

type TaiState = {
  messages: TaiMessage[]
  busy: boolean
  locked: boolean
  context: TaiContext
  panelOpen: boolean
  openPanel: (context?: TaiContext) => void
  closePanel: () => void
  setContext: (context: TaiContext) => void
  send: (text: string, options?: { display?: string; voice?: boolean }) => Promise<void>
  stop: () => void
  reset: () => void
  confirm: (actionId: string) => Promise<TaiActionCard | null>
  dismiss: (actionId: string) => void
  /** Действие выполнено — экраны перечитывают данные (касса, чек). */
  onActionDone?: (card: TaiActionCard) => void
}

let controller: AbortController | null = null

/** Звук ответа уходит в голосовой режим чата, а не в состояние диалога. */
export type TaiAudioClip = Extract<TaiEvent, { type: 'audio' }> & { replyId: string; blocks: number }
let audioListener: ((clip: TaiAudioClip) => void) | null = null
export function setTaiAudioListener(listener: ((clip: TaiAudioClip) => void) | null) {
  audioListener = listener
}
export function revealTai(replyId: string, chars: number, blocks: number) {
  patchReply(replyId, (m) => (m.gate ? { gate: { chars: Math.max(m.gate.chars, chars), blocks: Math.max(m.gate.blocks, blocks) } } : {}))
}
export function ungateTai() {
  useTaiStore.setState((state) => ({ messages: state.messages.map((m) => (m.role === 'tai' && m.gate ? { ...m, gate: null } : m)) }))
}
let counter = 0
const nextId = () => `${Date.now().toString(36)}-${(counter += 1)}`

const YES = /^(да|давай|ага|подтверждаю|подтверди|открывай|открой|добавляй|добавь|применяй|ок|окей|верно|точно|выполняй|делай)[\s.!,]*$/i
const NO = /^(нет|не надо|отмена|отмени|стоп|не нужно)[\s.!,]*$/i

function lastReply(messages: TaiMessage[]): TaiReply | undefined {
  return [...messages].reverse().find((m): m is TaiReply => m.role === 'tai')
}

function pendingAction(messages: TaiMessage[]): TaiActionCard | null {
  const block = lastReply(messages)?.blocks.find((b) => b.type === 'action' && b.action.status === 'pending')
  return block?.type === 'action' ? block.action : null
}

function history(messages: TaiMessage[]): TaiTurn[] {
  return messages
    .filter((m) => m.role === 'user' || !m.error)
    .slice(-16)
    .map((m) => (m.role === 'user' ? { role: 'user' as const, content: m.text } : { role: 'assistant' as const, content: m.text.trim() || (m.blocks.length ? '(показал данные)' : '…'), memo: m.memo }))
}

function patchReply(id: string, patch: (reply: TaiReply) => Partial<TaiReply>) {
  useTaiStore.setState((state) => ({ messages: state.messages.map((m) => (m.id === id && m.role === 'tai' ? { ...m, ...patch(m) } : m)) }))
}

function setAction(id: string, update: (card: TaiActionCard) => TaiActionCard) {
  useTaiStore.setState((state) => ({
    messages: state.messages.map((m) =>
      m.role === 'tai' && m.blocks.some((b) => b.type === 'action' && b.action.id === id)
        ? { ...m, blocks: m.blocks.map((b) => (b.type === 'action' && b.action.id === id ? { type: 'action' as const, action: update(b.action) } : b)) }
        : m,
    ),
  }))
}

export const useTaiStore = create<TaiState>((set, get) => ({
  messages: [],
  busy: false,
  locked: false,
  context: {},
  panelOpen: false,
  openPanel: (context) => set((state) => ({ panelOpen: true, context: context ?? state.context })),
  closePanel: () => set({ panelOpen: false }),
  setContext: (context) => set({ context }),

  send: async (raw, options = {}) => {
    const text = raw.trim()
    if (!text || get().busy) return

    const pending = pendingAction(get().messages)
    if (pending && (YES.test(text) || NO.test(text))) {
      set((state) => ({ messages: [...state.messages, { id: nextId(), role: 'user', text: options.display ?? text }] }))
      if (YES.test(text)) await get().confirm(pending.id)
      else get().dismiss(pending.id)
      return
    }

    const reply: TaiReply = { id: nextId(), role: 'tai', text: '', blocks: [], status: 'Думаю…', suggestions: [], streaming: true, voice: !!options.voice, gate: options.voice && audioListener ? { chars: 0, blocks: 0 } : null }
    let heardAudio = false
    const turns = [...history(get().messages), { role: 'user' as const, content: text }]
    set((state) => ({ messages: [...state.messages, { id: nextId(), role: 'user', text: options.display ?? text }, reply], busy: true }))

    controller?.abort()
    const current = new AbortController()
    controller = current
    try {
      await streamTai(
        { messages: turns, context: get().context, voice: options.voice },
        (event) => {
          if (event.type === 'status') patchReply(reply.id, () => ({ status: event.text }))
          else if (event.type === 'delta') patchReply(reply.id, (m) => ({ text: m.text + event.text, status: null }))
          else if (event.type === 'block') patchReply(reply.id, (m) => ({ blocks: [...m.blocks, event.block], status: null }))
          else if (event.type === 'suggestions') patchReply(reply.id, () => ({ suggestions: event.items }))
          else if (event.type === 'done') patchReply(reply.id, () => ({ memo: event.memo }))
          else if (event.type === 'error') patchReply(reply.id, () => ({ error: event.message }))
          else if (event.type === 'audio') {
            heardAudio = true
            const blocks = (useTaiStore.getState().messages.find((m) => m.id === reply.id) as TaiReply | undefined)?.blocks.length ?? 0
            audioListener?.({ ...event, replyId: reply.id, blocks })
          }
        },
        current.signal,
      )
    } catch (error) {
      if (current.signal.aborted) return
      if (isTaiLocked(error)) set({ locked: true })
      patchReply(reply.id, () => ({ error: taiErrorText(error) }))
    } finally {
      patchReply(reply.id, (m) => ({ streaming: false, status: null, text: m.text.trimEnd(), ...(heardAudio ? {} : { gate: null }) }))
      if (controller === current) controller = null
      set({ busy: false })
    }
  },

  stop: () => {
    controller?.abort()
    controller = null
    set((state) => ({ busy: false, messages: state.messages.map((m) => (m.role === 'tai' && m.streaming ? { ...m, streaming: false, status: null } : m)) }))
  },

  reset: () => {
    get().stop()
    set({ messages: [] })
  },

  confirm: async (actionId) => {
    try {
      const card = await confirmTaiAction(actionId)
      setAction(actionId, () => card)
      if (card.status === 'done') get().onActionDone?.(card)
      return card
    } catch (error) {
      setAction(actionId, (card) => ({ ...card, status: 'failed', result: taiErrorText(error) }))
      return null
    }
  },

  dismiss: (actionId) => {
    setAction(actionId, (card) => ({ ...card, status: 'cancelled' }))
    void dismissTaiAction(actionId)
  },
}))

/** Адрес веб-приложения для перехода из Tai. */
export function taiHref(to: TaiRoute): string {
  const range = (from: string, toDate: string) => `from=${from}&to=${toDate}`
  switch (to.screen) {
    case 'pos':
    case 'shift':
      return '/pos'
    case 'check':
    case 'pay':
      return `/pos/${to.checkId}`
    case 'analytics':
      return `/dashboard?${range(to.from, to.to)}`
    case 'analytics-checks':
      return `/dashboard?tab=finance&${range(to.from, to.to)}`
    case 'analytics-check':
      return `/dashboard?check=${to.checkId}`
    case 'analytics-products':
      return `/dashboard?tab=bar&${range(to.from, to.to)}`
    case 'analytics-players':
      return `/dashboard?tab=players&${range(to.from, to.to)}`
    case 'player':
      return `/dashboard?player=${to.playerId}`
    case 'inventory':
      return '/manage/inventory'
    case 'events':
      return '/events'
  }
}
