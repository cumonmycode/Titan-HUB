/**
 * Клиент Telegram Bot API для бота Tai: сообщения с кнопками, правка, ответы на
 * нажатия, голосовые, файлы, пересылка опросов. Ходит через тот же шлюз, что и
 * lib/telegram.ts (TELEGRAM_API_ROOT — Cloudflare Worker для сервера в РФ).
 *
 * Методы отправки не бросают: возвращают { ok:false, code, error }, чтобы
 * вызывающий понял, что человек заблокировал бота (403), и не писал ему первым.
 */
import { TG_API } from './telegram.js'

export interface InlineButton {
  text: string
  callback_data?: string
  url?: string
}

export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true }

export interface SendOptions {
  html?: boolean
  markup?: ReplyMarkup
  threadId?: number | null
  replyTo?: number | null
}

export type SendResult = { ok: true; messageId: number } | { ok: false; code: number; error: string }

/** Человек заблокировал бота или ни разу его не запускал — писать первым нельзя. */
export const isBlocked = (r: SendResult): boolean => !r.ok && r.code === 403

const TEXT_LIMIT = 4096
const TIMEOUT_MS = 20_000
const FILE_TIMEOUT_MS = 30_000

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Длинный текст — на части по абзацам, каждая не длиннее лимита Telegram. */
export function splitText(text: string, limit = TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = Math.max(rest.lastIndexOf('\n\n', limit), rest.lastIndexOf('\n', limit), rest.lastIndexOf(' ', limit))
    const at = cut > limit / 2 ? cut : limit
    parts.push(rest.slice(0, at))
    rest = rest.slice(at).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

type Raw = { ok?: boolean; result?: unknown; error_code?: number; description?: string }

const usernames = new Map<string, string>()

export class TgBot {
  constructor(readonly token: string) {}

  private async raw(method: string, init: { json?: Record<string, unknown>; form?: FormData }, timeoutMs = TIMEOUT_MS): Promise<Raw> {
    try {
      const res = await fetch(`${TG_API}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: init.json ? { 'Content-Type': 'application/json' } : undefined,
        body: init.json ? JSON.stringify(init.json) : init.form,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const data = (await res.json().catch(() => ({}))) as Raw
      if (!res.ok && data.ok === undefined) return { ok: false, error_code: res.status, description: `HTTP ${res.status}` }
      return data
    } catch (error) {
      return { ok: false, error_code: 0, description: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Вызов метода; результат или null. Ошибку пишем в журнал. */
  async call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    const r = await this.raw(method, { json: body })
    if (!r.ok) {
      console.warn(`[tg] ${method}: ${r.error_code} ${r.description}`)
      return null
    }
    return r.result as T
  }

  async send(chatId: string | number, text: string, opts: SendOptions = {}): Promise<SendResult> {
    const parts = splitText(text)
    let last: SendResult = { ok: false, code: 0, error: 'empty' }
    for (const [index, part] of parts.entries()) {
      const isLast = index === parts.length - 1
      const r = await this.raw('sendMessage', {
        json: {
          chat_id: chatId,
          text: part,
          disable_web_page_preview: true,
          ...(opts.html ? { parse_mode: 'HTML' } : {}),
          ...(opts.threadId ? { message_thread_id: opts.threadId } : {}),
          ...(opts.replyTo && index === 0 ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
          ...(opts.markup && isLast ? { reply_markup: opts.markup } : {}),
        },
      })
      if (!r.ok) {
        // Разметка не прошла проверку Telegram — повторяем без неё, текст важнее.
        if (opts.html && r.error_code === 400 && /parse entities/i.test(r.description ?? '')) {
          return this.send(chatId, stripHtml(text), { ...opts, html: false })
        }
        return { ok: false, code: r.error_code ?? 0, error: r.description ?? 'error' }
      }
      last = { ok: true, messageId: (r.result as { message_id: number }).message_id }
    }
    return last
  }

  async edit(chatId: string | number, messageId: number, text: string, opts: Pick<SendOptions, 'html' | 'markup'> = {}): Promise<boolean> {
    const r = await this.raw('editMessageText', {
      json: {
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, TEXT_LIMIT),
        disable_web_page_preview: true,
        ...(opts.html ? { parse_mode: 'HTML' } : {}),
        ...(opts.markup ? { reply_markup: opts.markup } : {}),
      },
    })
    return !!r.ok || /not modified/i.test(r.description ?? '')
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.raw('answerCallbackQuery', { json: { callback_query_id: id, ...(text ? { text } : {}) } })
  }

  async chatAction(chatId: string | number, action: 'typing' | 'record_voice', threadId?: number | null): Promise<void> {
    await this.raw('sendChatAction', { json: { chat_id: chatId, action, ...(threadId ? { message_thread_id: threadId } : {}) } })
  }

  /** Голосовое: ogg/opus или mp3 Telegram показывает как голосовое сообщение. */
  async sendVoice(chatId: string | number, audio: Buffer, format: 'ogg' | 'mp3', opts: Pick<SendOptions, 'threadId' | 'replyTo' | 'markup'> = {}): Promise<SendResult> {
    const form = new FormData()
    form.set('chat_id', String(chatId))
    if (opts.threadId) form.set('message_thread_id', String(opts.threadId))
    if (opts.replyTo) form.set('reply_parameters', JSON.stringify({ message_id: opts.replyTo, allow_sending_without_reply: true }))
    if (opts.markup) form.set('reply_markup', JSON.stringify(opts.markup))
    const mime = format === 'ogg' ? 'audio/ogg' : 'audio/mpeg'
    form.set('voice', new Blob([new Uint8Array(audio)], { type: mime }), `tai.${format}`)
    const r = await this.raw('sendVoice', { form }, FILE_TIMEOUT_MS)
    if (!r.ok) return { ok: false, code: r.error_code ?? 0, error: r.description ?? 'error' }
    return { ok: true, messageId: (r.result as { message_id: number }).message_id }
  }

  async forward(chatId: string | number, fromChatId: string | number, messageId: number): Promise<SendResult> {
    const r = await this.raw('forwardMessage', { json: { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId } })
    if (!r.ok) return { ok: false, code: r.error_code ?? 0, error: r.description ?? 'error' }
    return { ok: true, messageId: (r.result as { message_id: number }).message_id }
  }

  /** Файл из Telegram (голосовое) — до 20 МБ, ограничение Bot API. */
  async download(fileId: string): Promise<{ data: Buffer; path: string } | null> {
    const file = await this.call<{ file_path?: string }>('getFile', { file_id: fileId })
    if (!file?.file_path) return null
    try {
      const res = await fetch(`${TG_API}/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) })
      if (!res.ok) return null
      return { data: Buffer.from(await res.arrayBuffer()), path: file.file_path }
    } catch {
      return null
    }
  }

  /** @username бота без «@» (кэш на процесс: имя бота не меняется). */
  async username(): Promise<string | null> {
    const cached = usernames.get(this.token)
    if (cached) return cached
    const me = await this.call<{ username?: string }>('getMe', {})
    if (me?.username) usernames.set(this.token, me.username)
    return me?.username ?? null
  }
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
