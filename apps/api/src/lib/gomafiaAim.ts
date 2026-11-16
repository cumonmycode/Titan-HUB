// ─────────────────────────────────────────────────────────────────────────────
// Клиент АИМ (admin.gomafia.pro) — судейской админки GoMafia, где заполняются протоколы
// турниров. Публичного API нет: повторяем запросы самой страницы.
//
//  • POST /login/  {action: form_action_login, login, password}  → cookie сессии + csrf_token
//  • GET  /tournament                                              → HTML списка турниров
//  • POST /controller-tournament-edit/ {action: get_game_data, id} → HTML протокола
//  • POST /controller-tournament-edit/ {action: save_game_result…} → сохранить стол
//
// Все POST — multipart, как FormData у страницы; ответы — JSON {result, csrf_token, …}.
// Истёкшая сессия: {"result":"fail","notification":"Время сессии истекло…"}.
// ─────────────────────────────────────────────────────────────────────────────

import { parseGameData, parseTournamentList, saveProtocolFields, type AimGame, type AimProtocol, type AimTournament } from './gomafiaAimParse.js'

const BASE = 'https://admin.gomafia.pro'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const TIMEOUT_MS = 15_000
const CONTROLLER = '/controller-tournament-edit/'

export type AimErrorCode = 'bad_credentials' | 'session_expired' | 'access_denied' | 'unavailable' | 'rejected'

export class AimError extends Error {
  constructor(
    readonly code: AimErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** Сессия АИМ одного пользователя: cookie и csrf_token, который АИМ обновляет в ответах. */
export class AimSession {
  constructor(
    public cookie: string,
    public csrf: string | null,
  ) {}
}

type Fetch = typeof fetch

/** Cookie из Set-Cookie ответа, слитые с уже известными (новое значение побеждает). */
export function mergeCookies(current: string, setCookies: string[]): string {
  const jar = new Map<string, string>()
  for (const part of current.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name) jar.set(name, value.join('='))
  }
  for (const header of setCookies) {
    const [pair] = header.split(';')
    const [name, ...value] = (pair ?? '').trim().split('=')
    if (!name) continue
    const cookieValue = value.join('=')
    if (cookieValue === 'deleted' || cookieValue === '') jar.delete(name)
    else jar.set(name, cookieValue)
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
}

function setCookiesOf(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

const SESSION_EXPIRED = /сесси[яи].*истекл|авторизуйтесь/i
const BAD_CREDENTIALS = /неверн.*(логин|пароль)/i

function failureOf(json: Record<string, unknown>, fallback: AimErrorCode): AimError {
  const data = (json['data'] ?? {}) as Record<string, unknown>
  const notification = String(json['notification'] ?? data['notification'] ?? '')
  const error = String(json['error'] ?? data['error'] ?? '')
  if (SESSION_EXPIRED.test(notification)) return new AimError('session_expired', 'Сессия АИМ истекла')
  if (error === 'get_access_denied' || /запрещ|нет доступа|недостаточно прав/i.test(notification)) {
    return new AimError('access_denied', 'Нет доступа к протоколу этого турнира')
  }
  return new AimError(fallback, notification || error || 'АИМ отказал')
}

export class AimClient {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    private readonly base = BASE,
  ) {}

  private async request(path: string, init: RequestInit & { cookie?: string }): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const { cookie, ...rest } = init
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        ...rest,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': UA,
          Origin: this.base,
          Referer: `${this.base}/`,
          'X-Requested-With': 'XMLHttpRequest',
          ...(cookie ? { Cookie: cookie } : {}),
        },
      })
    } catch {
      throw new AimError('unavailable', 'АИМ не отвечает')
    } finally {
      clearTimeout(timer)
    }
  }

  private async postForm(path: string, fields: Array<[string, string]>, session: AimSession): Promise<Record<string, unknown>> {
    const form = new FormData()
    if (session.csrf) form.append('csrf_token', session.csrf)
    for (const [name, value] of fields) form.append(name, value)
    const response = await this.request(path, { method: 'POST', body: form, cookie: session.cookie })
    session.cookie = mergeCookies(session.cookie, setCookiesOf(response))
    if (response.status >= 300 && response.status < 400) throw new AimError('session_expired', 'Сессия АИМ истекла')
    if (!response.ok) throw new AimError('unavailable', `АИМ ответил ${response.status}`)
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!json) throw new AimError('unavailable', 'АИМ вернул не JSON')
    if (typeof json['csrf_token'] === 'string') session.csrf = json['csrf_token']
    return json
  }

  /** Вход в АИМ. Пароль здесь не хранится — только cookie сессии. */
  async login(login: string, password: string): Promise<AimSession> {
    const form = new FormData()
    form.append('action', 'form_action_login')
    form.append('login', login)
    form.append('password', password)
    const response = await this.request('/login/', { method: 'POST', body: form })
    if (!response.ok) throw new AimError('unavailable', `АИМ ответил ${response.status}`)
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (!json) throw new AimError('unavailable', 'АИМ вернул не JSON')
    if (json['result'] !== 'success') {
      const notification = String(json['notification'] ?? '')
      throw BAD_CREDENTIALS.test(notification) || !notification
        ? new AimError('bad_credentials', 'Неверный логин или пароль АИМ')
        : new AimError('rejected', notification)
    }
    const cookie = mergeCookies('', setCookiesOf(response))
    if (!cookie) throw new AimError('unavailable', 'АИМ не выдал сессию')
    return new AimSession(cookie, typeof json['csrf_token'] === 'string' ? json['csrf_token'] : null)
  }

  /** Турниры, доступные пользователю в АИМ (раздел «Турниры»), включая завершённые. */
  async tournaments(session: AimSession): Promise<AimTournament[]> {
    const response = await this.request('/tournament', { method: 'GET', cookie: session.cookie })
    session.cookie = mergeCookies(session.cookie, setCookiesOf(response))
    const location = response.headers.get('location') ?? ''
    if ((response.status >= 300 && response.status < 400) || /\/login/.test(location)) {
      throw new AimError('session_expired', 'Сессия АИМ истекла')
    }
    if (!response.ok) throw new AimError('unavailable', `АИМ ответил ${response.status}`)
    const html = await response.text()
    if (/<form[^>]+id="login"/.test(html)) throw new AimError('session_expired', 'Сессия АИМ истекла')
    return parseTournamentList(html)
  }

  /**
   * Протокол турнира (вкладка «Данные игр»). Её открывает только тот, кто может править
   * таблицу — обычно ГС; остальным АИМ отказывает (AimError `access_denied`).
   */
  async gameData(session: AimSession, tournamentId: number): Promise<AimGame[]> {
    const json = await this.postForm(CONTROLLER, [['action', 'get_game_data'], ['id', String(tournamentId)]], session)
    if (json['result'] !== 'success') throw failureOf(json, 'access_denied')
    const params = (json['params'] ?? {}) as Record<string, unknown>
    const html = params['game_data_container']
    if (typeof html !== 'string') throw new AimError('access_denied', 'Нет доступа к протоколу этого турнира')
    return parseGameData(html)
  }

  /** Сохранить протокол стола. АИМ перезаписывает стол целиком, поэтому повтор безопасен. */
  async saveProtocol(session: AimSession, tournamentId: number, aimTableId: number, protocol: AimProtocol): Promise<void> {
    const json = await this.postForm(CONTROLLER, saveProtocolFields(tournamentId, aimTableId, protocol), session)
    if (json['result'] !== 'success') throw failureOf(json, 'rejected')
  }
}
