import { createHash, randomBytes } from 'node:crypto'
import { getSharedRedis } from '../../lib/redis.js'

/**
 * Одноразовые коды и постоянные ключи Titan Connect.
 *
 * Код — 8 знаков без похожих (0/O, 1/I/L), показывается как «K7QM-3XPA», живёт
 * CODE_TTL_SEC. Ключ — `tcn_` + 32 случайных байта. В БД хранится только sha256 и
 * у ключа его начало (для узнавания в HUB). Код можно ввести на любом домене Titan:
 * в общем Redis лежит маршрут «код → клуб».
 */
export const CODE_TTL_SEC = 10 * 60
export const TOKEN_PREFIX = 'tcn_'
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
// Байты ≥ этого порога отбрасываем — иначе остаток от деления давал бы перекос.
const UNBIASED_LIMIT = 256 - (256 % CODE_ALPHABET.length)

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export function generateCode(): { code: string; display: string } {
  let code = ''
  while (code.length < CODE_LENGTH) {
    for (const b of randomBytes(CODE_LENGTH * 2)) {
      if (b < UNBIASED_LIMIT && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % CODE_ALPHABET.length]
    }
  }
  return { code, display: formatCode(code) }
}

export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`

/** Код как ввёл человек («k7qm 3xpa», «K7QM-3XPA») → канонический вид или null. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== CODE_LENGTH) return null
  return [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null
}

export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: sha256(token), prefix: token.slice(0, TOKEN_PREFIX.length + 6) }
}

export const isConnectToken = (value: string | undefined | null): value is string => !!value && value.startsWith(TOKEN_PREFIX)

// ── Маршрут кода в общем Redis: код, выданный на поддомене клуба, работает и на основном домене ──

export type CodeRoute = { clubId: string | null; host: string }
const routeKey = (codeHash: string): string => `connect:code:${codeHash}`

export async function saveCodeRoute(codeHash: string, route: CodeRoute): Promise<void> {
  try {
    await getSharedRedis().set(routeKey(codeHash), JSON.stringify(route), 'EX', CODE_TTL_SEC)
  } catch (err) {
    // Без Redis код всё равно работает на домене клуба — сервис просто должен звать его адрес.
    console.warn('[connect] Маршрут кода не сохранён в Redis:', err)
  }
}

export async function readCodeRoute(codeHash: string): Promise<CodeRoute | null> {
  try {
    const raw = await getSharedRedis().get(routeKey(codeHash))
    return raw ? (JSON.parse(raw) as CodeRoute) : null
  } catch {
    return null
  }
}

export async function dropCodeRoute(codeHash: string): Promise<void> {
  try {
    await getSharedRedis().del(routeKey(codeHash))
  } catch {
    /* истечёт сам */
  }
}

// ── Защита от перебора кодов: не больше EXCHANGE_FAILS_LIMIT неудач с IP за окно ──

const EXCHANGE_FAILS_LIMIT = 10
const EXCHANGE_FAILS_WINDOW_SEC = 15 * 60
const failsKey = (ip: string): string => `connect:fails:${ip}`

export async function exchangeBlocked(ip: string): Promise<boolean> {
  try {
    const fails = Number((await getSharedRedis().get(failsKey(ip))) ?? 0)
    return fails >= EXCHANGE_FAILS_LIMIT
  } catch {
    return false
  }
}

export async function recordExchangeFail(ip: string): Promise<void> {
  try {
    const redis = getSharedRedis()
    const fails = await redis.incr(failsKey(ip))
    if (fails === 1) await redis.expire(failsKey(ip), EXCHANGE_FAILS_WINDOW_SEC)
  } catch {
    /* без Redis остаётся общий лимит запросов по IP */
  }
}
