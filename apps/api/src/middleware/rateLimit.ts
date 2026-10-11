/**
 * Глобальный rate limit через Redis.
 * - Anonymous (без auth): 120 запросов / минута / IP
 * - Authenticated: 600 запросов / минута / userId
 *
 * Использует Sliding Window (key с TTL).
 */
import { createMiddleware } from 'hono/factory'
import { Redis } from 'ioredis'
import { verifyToken } from '@titan/auth'
import { clientIp } from '../lib/clientIp.js'

const ANON_LIMIT = parseInt(process.env['RATELIMIT_ANON'] ?? '120')
const AUTH_LIMIT = parseInt(process.env['RATELIMIT_AUTH'] ?? '600')
const WINDOW_SECONDS = 60

// Один shared Redis для middleware (lazy)
let redisInstance: Redis | null = null
function getRedis() {
  if (!redisInstance) {
    redisInstance = new Redis(process.env['REDIS_URL'] ?? 'redis://redis:6379', {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })
    redisInstance.on('error', () => {})  // не падать при недоступности Redis
  }
  return redisInstance
}

// SSE-стримы (долгие connections, не должны попадать в лимит) — строго известные
// пути. Не по заголовку Accept: его ставит клиент, и им обходился бы любой лимит.
const SSE_PATHS = new Set(['/api/system/update', '/api/notifications/stream', '/api/tablet/stream'])
const CHECK_EVENTS_PATH = /^\/api\/pos\/checks\/[^/]+\/events$/
const isSsePath = (path: string): boolean => SSE_PATHS.has(path) || CHECK_EVENTS_PATH.test(path)

export const rateLimit = createMiddleware(async (c, next) => {
  // Пропускаем SSE-стримы (долгие connections, не должны попадать в лимит)
  if (c.req.method === 'GET' && isSsePath(c.req.path)) return next()
  // Пропускаем health-check (liveness + readiness)
  if (c.req.path === '/health' || c.req.path === '/api/health' || c.req.path === '/api/health/ready') return next()
  // Вебхук Platega: внешние ретраи провайдера НЕ должны попадать под лимит, иначе
  // подтверждение оплаты могло бы отброситься как 429. Доступ гейтит секрет в
  // самом обработчике (X-MerchantId/X-Secret) — без него ответ 401 без работы.
  if (c.req.path === '/api/platega/webhook') return next()

  let key: string
  let limit: number

  // Определяем identifier: userId или IP.
  // Токен берём из Authorization: Bearer ИЛИ из ?token= (requireAuth тоже
  // принимает query-token для EventSource/wallet-ссылок). Без этого token-in-query
  // запросы валятся в общий per-IP bucket и фактически не лимитируются по аккаунту.
  const auth = c.req.header('Authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.query('token')
  let userId: string | null = null
  if (token) {
    try {
      const payload = await verifyToken(token)
      userId = payload.sub
    } catch {}
  }

  if (userId) {
    key = `rl:user:${userId}`
    limit = AUTH_LIMIT
  } else {
    // Доверенный IP (X-Real-IP от nginx), а не спуфабельный первый XFF.
    const ip = clientIp(c)
    key = `rl:ip:${ip}`
    limit = ANON_LIMIT
  }

  try {
    const redis = getRedis()
    const current = await redis.incr(key)
    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS)
    }
    if (current > limit) {
      const ttl = await redis.ttl(key)
      c.header('Retry-After', String(ttl))
      return c.json({
        error: 'Too many requests',
        retryAfter: ttl,
      }, 429)
    }
  } catch {
    // Если Redis недоступен — пропускаем (fail-open)
  }

  await next()
})
