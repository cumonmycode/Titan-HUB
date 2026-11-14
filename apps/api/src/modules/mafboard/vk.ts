// ─────────────────────────────────────────────────────────────────────────────
// Вход MafBoard Studio в VK Видео Live (DevAPI, dev.live.vkvideo.ru).
//
// VK выдаёт токены только по коду с секретом приложения, и обновляет их тоже с секретом.
// Секрет нельзя отдавать в программу на компьютере ведущего, поэтому обмен идёт здесь:
//   1. MBS просит ссылку на вход (begin) и открывает её в браузере;
//   2. VK возвращает браузер на callback с кодом, сервер меняет код на токены;
//   3. MBS забирает токены своей сессией (claim) и хранит их в связке ключей Mac;
//   4. новый токен доступа MBS просит здесь же (refresh), сервер подставляет секрет.
// Сервер токены ведущего не хранит: ожидающий вход живёт в памяти 10 минут и после claim
// удаляется.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto'

export const VK_AUTHORIZE_URL = 'https://auth.live.vkvideo.ru/app/oauth2/authorize'
export const VK_TOKEN_URL = 'https://api.live.vkvideo.ru/oauth/server/token'
export const VK_REVOKE_URL = 'https://api.live.vkvideo.ru/oauth/server/revoke'
/** Ключ трансляции, название и категория эфира, сообщения в чат. */
export const VK_SCOPES = 'channel:credentials,channel:stream:settings,chat:message:send'
/** Столько ждём, пока ведущий войдёт в браузере. */
export const VK_LOGIN_TTL_MS = 10 * 60_000
/** Ожидающих входов одновременно: защита памяти от потока запросов. */
const VK_PENDING_LIMIT = 1000

export interface VkAppConfig {
  clientId: string
  clientSecret: string
  /** Должен совпадать до символа с указанным в кабинете VK. */
  redirectUri: string
}

export interface VkTokens {
  accessToken: string
  refreshToken: string | null
  expiresIn: number | null
}

/** Ошибка VK: `revoked` — токен обновления больше не годится, войти надо заново. */
export class VkError extends Error {
  constructor(readonly kind: 'revoked' | 'rejected' | 'network', message: string) {
    super(message)
  }
}

/** Обращения к VK. В тестах — подделка, на проде — fetch. */
export interface VkGateway {
  exchange(app: VkAppConfig, code: string): Promise<VkTokens>
  refresh(app: VkAppConfig, refreshToken: string): Promise<VkTokens>
  revoke(app: VkAppConfig, token: string, hint: 'access_token' | 'refresh_token'): Promise<void>
}

function basic(app: VkAppConfig): string {
  return `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`
}

async function post(app: VkAppConfig, url: string, form: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: basic(app), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new VkError('network', 'VK не ответил')
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok) return body ?? {}
  // Текст ответа VK наружу не отдаём: в нём бывают токены.
  const code = typeof body?.['error'] === 'string' ? body['error'] : ''
  if (code === 'invalid_grant' || response.status === 401) throw new VkError('revoked', 'Вход в VK не действует')
  throw new VkError('rejected', `VK отказал (${response.status}${code ? `, ${code}` : ''})`)
}

function tokensFrom(body: unknown): VkTokens {
  const data = (body ?? {}) as Record<string, unknown>
  const accessToken = typeof data['access_token'] === 'string' ? data['access_token'] : ''
  if (!accessToken) throw new VkError('rejected', 'VK не выдал токен')
  return {
    accessToken,
    refreshToken: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : null,
    expiresIn: typeof data['expires_in'] === 'number' ? data['expires_in'] : null,
  }
}

export const liveVkGateway: VkGateway = {
  async exchange(app, code) {
    return tokensFrom(await post(app, VK_TOKEN_URL, { grant_type: 'authorization_code', code, redirect_uri: app.redirectUri }))
  },
  async refresh(app, refreshToken) {
    return tokensFrom(await post(app, VK_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: app.redirectUri }))
  },
  async revoke(app, token, hint) {
    await post(app, VK_REVOKE_URL, { token, token_type_hint: hint })
  },
}

export function authorizeUrl(app: VkAppConfig, state: string): string {
  const query = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', scope: VK_SCOPES, state })
  return `${VK_AUTHORIZE_URL}?${query.toString()}`
}

type Pending =
  | { userId: string; expiresAt: number; state: 'waiting' }
  | { userId: string; expiresAt: number; state: 'done'; tokens: VkTokens }
  | { userId: string; expiresAt: number; state: 'failed'; message: string }

/** Ожидающие входы по `state`. Один процесс API — память подходит, перезапуск лишь попросит войти снова. */
export class VkLogins {
  private readonly pending = new Map<string, Pending>()

  begin(userId: string, now: number): string | null {
    this.sweep(now)
    if (this.pending.size >= VK_PENDING_LIMIT) return null
    const state = randomBytes(32).toString('base64url')
    this.pending.set(state, { userId, expiresAt: now + VK_LOGIN_TTL_MS, state: 'waiting' })
    return state
  }

  /** Кто начал этот вход, если он ещё ждёт ответа VK. */
  waiting(state: string, now: number): string | null {
    this.sweep(now)
    const entry = this.pending.get(state)
    return entry?.state === 'waiting' ? entry.userId : null
  }

  finish(state: string, result: { tokens: VkTokens } | { message: string }): void {
    const entry = this.pending.get(state)
    if (entry?.state !== 'waiting') return
    this.pending.set(state, 'tokens' in result
      ? { userId: entry.userId, expiresAt: entry.expiresAt, state: 'done', tokens: result.tokens }
      : { userId: entry.userId, expiresAt: entry.expiresAt, state: 'failed', message: result.message })
  }

  /** Итог входа для того же ведущего. Готовый итог отдаётся один раз. */
  claim(state: string, userId: string, now: number): { status: 'waiting' } | { status: 'done'; tokens: VkTokens } | { status: 'failed'; message: string } | null {
    this.sweep(now)
    const entry = this.pending.get(state)
    if (!entry || entry.userId !== userId) return null
    if (entry.state === 'waiting') return { status: 'waiting' }
    this.pending.delete(state)
    return entry.state === 'done' ? { status: 'done', tokens: entry.tokens } : { status: 'failed', message: entry.message }
  }

  private sweep(now: number): void {
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(state)
    }
  }
}

/** Страница, которую ведущий видит в браузере после входа. */
export function callbackPage(ok: boolean): string {
  const title = ok ? 'Вход выполнен' : 'Войти не удалось'
  const text = ok ? 'Вернитесь в MafBoard Studio, эту вкладку можно закрыть.' : 'Вернитесь в MafBoard Studio и попробуйте войти ещё раз.'
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>MafBoard Studio</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box;font-family:-apple-system,system-ui,sans-serif;background:#0b0b0f;color:#f5f5f7}p{color:#a1a1a6}</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`
}
