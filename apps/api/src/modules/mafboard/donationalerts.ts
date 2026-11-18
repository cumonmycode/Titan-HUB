// ─────────────────────────────────────────────────────────────────────────────
// Вход MafBoard Studio в DonationAlerts: донаты в ленте чатов и плашкой в эфире.
//
// DonationAlerts меняет код на токены и обновляет их только с секретом приложения, поэтому обмен
// идёт здесь, так же как у VK (vk.ts): MBS просит ссылку (begin), ведущий входит в браузере,
// DonationAlerts возвращает браузер на callback, MBS забирает токены своей сессией (claim).
// Дальше MBS сама читает донаты по токену доступа. Сервер токены ведущего не хранит.
// ─────────────────────────────────────────────────────────────────────────────

import { VkError, type VkAppConfig, type VkTokens } from './vk.js'

export const DA_AUTHORIZE_URL = 'https://www.donationalerts.com/oauth/authorize'
export const DA_TOKEN_URL = 'https://www.donationalerts.com/oauth/token'
/** Имя ведущего и подписка на донаты в реальном времени. */
export const DA_SCOPES = 'oauth-user-show oauth-donation-subscribe'

/** Те же поля, что у приложения VK: адрес возврата совпадает до символа с указанным в кабинете. */
export type DaAppConfig = VkAppConfig

/** Обращения к DonationAlerts. В тестах — подделка, на проде — fetch. */
export interface DaGateway {
  exchange(app: DaAppConfig, code: string): Promise<VkTokens>
  refresh(app: DaAppConfig, refreshToken: string): Promise<VkTokens>
}

async function post(form: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(DA_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new VkError('network', 'DonationAlerts не ответил')
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (response.ok) return body ?? {}
  // Текст ответа наружу не отдаём: в нём бывают токены.
  const code = typeof body?.['error'] === 'string' ? body['error'] : ''
  if (code === 'invalid_grant' || response.status === 401) throw new VkError('revoked', 'Вход в DonationAlerts не действует')
  throw new VkError('rejected', `DonationAlerts отказал (${response.status}${code ? `, ${code}` : ''})`)
}

function tokensFrom(body: unknown): VkTokens {
  const data = (body ?? {}) as Record<string, unknown>
  const accessToken = typeof data['access_token'] === 'string' ? data['access_token'] : ''
  if (!accessToken) throw new VkError('rejected', 'DonationAlerts не выдал токен')
  return {
    accessToken,
    refreshToken: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : null,
    expiresIn: typeof data['expires_in'] === 'number' ? data['expires_in'] : null,
  }
}

export const liveDaGateway: DaGateway = {
  async exchange(app, code) {
    return tokensFrom(await post({
      grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, code,
    }))
  },
  async refresh(app, refreshToken) {
    return tokensFrom(await post({
      grant_type: 'refresh_token', client_id: app.clientId, client_secret: app.clientSecret, refresh_token: refreshToken, scope: DA_SCOPES,
    }))
  },
}

export function daAuthorizeUrl(app: DaAppConfig, state: string): string {
  const query = new URLSearchParams({ client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', scope: DA_SCOPES, state })
  return `${DA_AUTHORIZE_URL}?${query.toString()}`
}
