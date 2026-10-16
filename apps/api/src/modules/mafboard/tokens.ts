import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { signScopedJwt, verifyScopedJwt } from '@titan/auth'
import { ACCESS_TOKEN_TTL_SEC, JWT_AUDIENCE, JWT_ISSUER, type MafboardConfig } from './config.js'

// Токены приложения MafBoard: короткий access-JWT (свой ключ, issuer/audience) и
// длинный refresh — случайная строка, в БД хранится только её SHA-256.

const SCOPE = 'mafboard'

function jwtOptions(config: Pick<MafboardConfig, 'jwtSecret'>) {
  return { secret: config.jwtSecret, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
}

/** Владелец access-токена: пользователь и сессия (устройство), к которой токен выдан. */
export interface AccessClaims {
  userId: string
  sessionId: string
}

export async function issueAccessToken(
  claims: AccessClaims,
  config: Pick<MafboardConfig, 'jwtSecret'>,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = await signScopedJwt(
    { sub: claims.userId, sid: claims.sessionId, scope: SCOPE },
    `${ACCESS_TOKEN_TTL_SEC}s`,
    jwtOptions(config),
  )
  return { token, expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SEC * 1000) }
}

/**
 * Пользователь и сессия из действующего access-токена или null. Токен без сессии
 * (выдан до появления сессий) не принимается — приложение просто обновит пару.
 */
export async function verifyAccessToken(token: string, config: Pick<MafboardConfig, 'jwtSecret'>): Promise<AccessClaims | null> {
  try {
    const claims = await verifyScopedJwt(token, jwtOptions(config))
    const { sub, sid } = claims
    return claims['scope'] === SCOPE && typeof sub === 'string' && typeof sid === 'string' ? { userId: sub, sessionId: sid } : null
  } catch {
    return null
  }
}

export function newRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

/** Код для ссылки t.me/<бот>?start=login_<код>: 24 символа base64url (лимит payload — 64). */
export function newDeepCode(): string {
  return randomBytes(18).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Двузначный код сверки входа (10–99). */
export function newConfirmCode(): string {
  return String(randomInt(10, 100))
}

/** Два ложных кода для кнопок бота, не совпадающих с настоящим и друг с другом. */
export function decoyCodes(real: string): string[] {
  const decoys = new Set<string>()
  while (decoys.size < 2) {
    const code = newConfirmCode()
    if (code !== real) decoys.add(code)
  }
  return [...decoys]
}

/**
 * secret_token вебхука бота MafBoard: HMAC от СВОЕГО ключа модуля и токена бота
 * (не от JWT_SECRET Titan HUB). Смена токена бота или ключа меняет секрет — вебхук
 * перерегистрируется при старте и раз в час.
 */
export function webhookSecret(config: Pick<MafboardConfig, 'jwtSecret' | 'botToken'>): string {
  return createHmac('sha256', Buffer.from(config.jwtSecret)).update(`tgwh:mafboard:${config.botToken ?? ''}`).digest('hex')
}

export function webhookSecretValid(provided: string | undefined, config: Pick<MafboardConfig, 'jwtSecret' | 'botToken'>): boolean {
  if (!provided || !config.botToken) return false
  const expected = Buffer.from(webhookSecret(config))
  const actual = Buffer.from(provided)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
