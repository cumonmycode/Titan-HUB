// ─────────────────────────────────────────────────────────────────────────────
// Тонкий клиент Telegram Bot API для ИСХОДЯЩИХ вызовов (sendPoll и т.п.).
// Постинг опросов не требует «живого» бот-процесса — достаточно HTTP-вызова от
// токена бота. (Чтение результатов опросов потребует getUpdates/вебхук — отдельно.)
// ─────────────────────────────────────────────────────────────────────────────

// Корень Bot API. На сервере в РФ api.telegram.org заблокирован — TELEGRAM_API_ROOT
// указывает на шлюз (Cloudflare Worker, infra/telegram-relay), который проксирует
// вызовы в Telegram. Без переменной — прямой адрес, как раньше.
export const TG_API = (process.env['TELEGRAM_API_ROOT'] || 'https://api.telegram.org').replace(/\/+$/, '')

export interface SendPollParams {
  chatId: string | number
  /** message_thread_id топика форума (если опрос в топик супергруппы). */
  messageThreadId?: number | null
  question: string
  options: string[]
  isAnonymous?: boolean
  allowsMultipleAnswers?: boolean
}

export interface SendPollResult {
  ok: boolean
  messageId?: number
  pollId?: string
  error?: string
}

/**
 * Отправить опрос в чат/топик. options — массив строк (оборачиваем в
 * InputPollOption по требованию Bot API ≥7.3). Никогда не бросает — возвращает
 * { ok:false, error } при сетевой/Telegram-ошибке (описание из поля description).
 */
export async function sendTelegramPoll(token: string, p: SendPollParams): Promise<SendPollResult> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/sendPoll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: p.chatId,
        ...(p.messageThreadId ? { message_thread_id: p.messageThreadId } : {}),
        question: p.question,
        options: p.options.map((t) => ({ text: t })),
        is_anonymous: p.isAnonymous ?? false,
        allows_multiple_answers: p.allowsMultipleAnswers ?? false,
        type: 'regular',
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      description?: string
      result?: { message_id?: number; poll?: { id?: string } }
    }
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` }
    }
    return { ok: true, messageId: data.result?.message_id, pollId: data.result?.poll?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Вебхук (приём апдейтов: сбор участников + позже результаты опросов) ──────────

async function tgCall(token: string, method: string, body: Record<string, unknown>): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown }
    if (!res.ok || !data?.ok) return { ok: false, error: data?.description || `HTTP ${res.status}` }
    return { ok: true, result: data.result }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function setTelegramWebhook(
  token: string,
  url: string,
  secretToken: string,
  allowedUpdates: string[],
): Promise<{ ok: boolean; error?: string }> {
  return tgCall(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: allowedUpdates,
    drop_pending_updates: false,
  })
}

export function deleteTelegramWebhook(token: string): Promise<{ ok: boolean; error?: string }> {
  return tgCall(token, 'deleteWebhook', { drop_pending_updates: false })
}

export async function getTelegramWebhookInfo(token: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const r = await tgCall(token, 'getWebhookInfo', {})
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, url: (r.result?.url as string) ?? '' }
}

// Список администраторов чата (единственный способ получить часть участников
// мгновенно). Возвращает массив user-объектов (без ботов решает вызывающий).
export async function getChatAdministrators(token: string, chatId: string | number): Promise<{ ok: boolean; admins?: any[]; error?: string }> {
  const r = await tgCall(token, 'getChatAdministrators', { chat_id: chatId })
  if (!r.ok) return { ok: false, error: r.error }
  const admins = Array.isArray(r.result) ? r.result.map((m: any) => m.user).filter(Boolean) : []
  return { ok: true, admins }
}

// Базовая инфо о чате (title/type) — чтобы сразу показать настроенные группы в
// списке выбора, не дожидаясь активности. Возвращает null при любой ошибке.
export async function getTelegramChat(token: string, chatId: string | number): Promise<{ id: string; title: string | null; type: string | null } | null> {
  const r = await tgCall(token, 'getChat', { chat_id: chatId })
  if (!r.ok || !r.result) return null
  const res = r.result as any
  return { id: String(res.id ?? chatId), title: (res.title as string) ?? null, type: (res.type as string) ?? null }
}

// Является ли пользователь админом/создателем чата (для гейта команд @all/@tvari).
export async function isTelegramChatAdmin(token: string, chatId: string | number, userId: string | number): Promise<boolean> {
  const r = await tgCall(token, 'getChatMember', { chat_id: chatId, user_id: userId })
  if (!r.ok) return false
  const status = r.result?.status as string | undefined
  return status === 'creator' || status === 'administrator'
}

/** Кнопка-ссылка под сообщением (Telegram принимает только http(s) и tg://). */
export interface TgUrlButton { text: string; url: string }

// Отправить текстовое сообщение в чат/топик. Никогда не бросает. messageId — для
// последующей правки (editTelegramMessage).
export async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  opts?: { messageThreadId?: number | null; parseMode?: 'HTML' | 'Markdown'; replyToMessageId?: number | null; buttons?: TgUrlButton[][] },
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const r = await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    ...(opts?.messageThreadId ? { message_thread_id: opts.messageThreadId } : {}),
    ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts?.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
    ...(opts?.buttons?.length ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
    disable_web_page_preview: true,
  })
  return { ok: r.ok, error: r.error, messageId: typeof r.result?.message_id === 'number' ? r.result.message_id : undefined }
}

// Заменить текст отправленного сообщения (кнопки сохраняются, если переданы). Не бросает.
export async function editTelegramMessage(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  opts?: { parseMode?: 'HTML' | 'Markdown'; buttons?: TgUrlButton[][] },
): Promise<{ ok: boolean; error?: string }> {
  return tgCall(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts?.buttons?.length ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
    disable_web_page_preview: true,
  })
}

// Имя бота (для ссылок t.me/<бот>?start=…). null — токен неверный или Telegram недоступен.
export async function getTelegramBotUsername(token: string): Promise<string | null> {
  const r = await tgCall(token, 'getMe', {})
  return r.ok && typeof r.result?.username === 'string' ? r.result.username : null
}
