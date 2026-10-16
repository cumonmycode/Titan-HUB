import { SignJWT, jwtVerify } from 'jose'

// Никаких небезопасных фолбэков: секрет обязателен и должен быть стойким.
// Вычисляем лениво, чтобы простой импорт модуля не падал в окружениях,
// где токены не используются, но при первом sign/verify без секрета — ошибка.
function getSecret(): Uint8Array {
  const value = process.env['JWT_SECRET']
  if (!value || value.length < 32) {
    throw new Error('JWT_SECRET must be set to a strong value (at least 32 characters)')
  }
  return new TextEncoder().encode(value)
}

export interface JwtPayload {
  sub: string
  role: string
  nickname: string
  // Клуб-арендатор, на чьём поддомене выпущен токен (database-per-club). null —
  // основной/служебный домен (одно-клубный режим). Опционально для ОБРАТНОЙ
  // СОВМЕСТИМОСТИ: легаси-токены, выпущенные до привязки к клубу, поля не несут —
  // requireAuth трактует их по grace-правилу (см. middleware/auth.ts).
  clubId?: string | null
  iat?: number
  exp?: number
}

export async function signToken(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  expiresIn?: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn ?? process.env['JWT_EXPIRES_IN'] ?? '7d')
    .sign(getSecret())
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as unknown as JwtPayload
}

/**
 * Низкоуровневая подпись JWT с ПРОИЗВОЛЬНЫМИ клеймами — для отдельных контуров
 * авторизации (напр. суперадмин со scope). Тот же секрет/алгоритм (HS256), что и
 * клубные токены: разделение контуров обеспечивает клейм (scope), а не отдельный ключ.
 */
export async function signJwt(claims: Record<string, unknown>, expiresIn: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret())
}

/**
 * Низкоуровневая проверка JWT — возвращает сырые клеймы. Вызывающий сам валидирует
 * нужные поля (scope и т.п.). Бросает при неверной подписи/сроке.
 */
export async function verifyJwt(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, getSecret())
  return payload as Record<string, unknown>
}

/** Контур со СВОИМ ключом: токены одного контура не проходят проверку другого. */
export interface ScopedJwtOptions {
  secret: Uint8Array
  issuer: string
  audience: string
}

/**
 * Подпись JWT отдельным секретом (напр. MafBoard — приложение для ведущих любых клубов).
 * В отличие от signJwt, ключ НЕ JWT_SECRET: такой токен не пройдёт requireAuth Titan HUB.
 */
export async function signScopedJwt(
  claims: Record<string, unknown>,
  expiresIn: string,
  options: ScopedJwtOptions,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setExpirationTime(expiresIn)
    .sign(options.secret)
}

/** Проверка токена отдельного контура: подпись, срок, issuer и audience. Бросает при несовпадении. */
export async function verifyScopedJwt(token: string, options: ScopedJwtOptions): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, options.secret, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: ['HS256'],
  })
  return payload as Record<string, unknown>
}
