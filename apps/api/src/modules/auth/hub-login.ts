/**
 * Вход сотрудника в Titan HUB через Tai — первый вход на устройстве.
 *
 * 1) POST /start → строка wallet_login_codes (mode 'hub') и ссылка
 *    t.me/<Tai>?start=hub_<код>. Сотрудник подтверждает в Telegram
 *    (modules/tg/login/hub.ts).
 * 2) GET /status?ticket — приложение опрашивает и получает токен.
 * 3) Дальше устройство открывается по Face ID или PIN; POST /refresh продлевает
 *    токен после разблокировки, чтобы снова идти в Telegram не пришлось.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { profiles, walletLoginCodes, eq, and, lt, isNull, type Profile } from '@titan/database'
import { signToken } from '@titan/auth'
import { clientIp } from '../../lib/clientIp.js'
import { getSharedRedis } from '../../lib/redis.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { taiUsername } from '../tg/club.js'
import { isStaffRole } from '../tg/identity.js'
import type { AppEnv } from '../../types.js'

export const hubLoginRouter = new Hono<AppEnv>()

const HUB_LOGIN_TTL_MS = 10 * 60 * 1000
// Токен устройства: продлевается при каждой разблокировке (POST /refresh).
const STAFF_DEVICE_TTL = '30d'
const START_MAX = 20
const START_WINDOW_SECONDS = 10 * 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const StartSchema = z.object({
  deviceName: z.string().max(60).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
})

function userOf(p: Profile) {
  return { id: p.id, nickname: p.nickname, role: p.role, photoUrl: p.photoUrl }
}

async function staffToken(p: Profile, clubId: string | null): Promise<string> {
  return signToken({ sub: p.id, role: p.role, nickname: p.nickname, clubId }, STAFF_DEVICE_TTL)
}

hubLoginRouter.post('/start', zValidator('json', StartSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const redis = getSharedRedis()
  const key = `${c.var.club?.id ?? 'main'}:hublogin:start:${clientIp(c)}`
  const n = await redis.incr(key).catch(() => 0)
  if (n === 1) await redis.expire(key, START_WINDOW_SECONDS).catch(() => {})
  if (n > START_MAX) return c.json({ error: 'Слишком много попыток. Попробуйте через несколько минут.' }, 429)

  const botUsername = await taiUsername(db)
  if (!botUsername) return c.json({ error: 'Бот Tai клуба не настроен — войти через Telegram пока нельзя' }, 503)

  await db.delete(walletLoginCodes).where(lt(walletLoginCodes.expiresAt, new Date())).catch(() => {})
  const deepCode = randomBytes(18).toString('base64url')
  const expiresAt = new Date(Date.now() + HUB_LOGIN_TTL_MS)
  const [row] = await db.insert(walletLoginCodes).values({
    code: 'hub',
    mode: 'hub',
    expiresAt,
    deepCode,
    deviceName: body.deviceName?.trim() || null,
    platform: body.platform ?? null,
  }).returning({ ticket: walletLoginCodes.ticket })

  const deepLink = `https://t.me/${botUsername}?start=hub_${deepCode}`
  // QR — для входа с компьютера: навести камеру телефона и подтвердить в Telegram.
  const QRCode = await import('qrcode')
  const qrSvg = await QRCode.toString(deepLink, { type: 'svg', margin: 1, width: 220 })
  return c.json({
    ticket: row?.ticket ?? null,
    botUsername,
    deepLink,
    qr: `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`,
    expiresAt: expiresAt.toISOString(),
  })
})

hubLoginRouter.get('/status', async (c) => {
  const db = c.var.db
  const ticket = c.req.query('ticket') ?? ''
  if (!UUID_RE.test(ticket)) return c.json({ status: 'expired' as const })
  const [row] = await db.select().from(walletLoginCodes)
    .where(and(eq(walletLoginCodes.ticket, ticket), eq(walletLoginCodes.mode, 'hub'))).limit(1)
  if (!row) return c.json({ status: 'expired' as const })

  const drop = () => db.delete(walletLoginCodes).where(eq(walletLoginCodes.id, row.id)).catch(() => {})
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await drop()
    return c.json({ status: 'expired' as const })
  }
  if (row.status === 'rejected') {
    await drop()
    return c.json({ status: 'rejected' as const, note: row.note })
  }
  // opened — ссылку уже открыли в Telegram: приложение подскажет нажать «Войти».
  if (row.status !== 'claimed' || !row.profileId) return c.json({ status: 'pending' as const, opened: !!row.tgId })

  const [profile] = await db.select().from(profiles).where(and(eq(profiles.id, row.profileId), isNull(profiles.deletedAt))).limit(1)
  await drop()
  if (!profile || !isStaffRole(profile.role)) return c.json({ status: 'rejected' as const, note: 'Профиль не найден среди сотрудников' })
  return c.json({
    status: 'ok' as const,
    token: await staffToken(profile, c.var.club?.id ?? null),
    user: userOf(profile),
    hasPin: !!profile.pin,
  })
})

// Продление токена устройства после Face ID / PIN: уволенного не пустит requireAuth.
hubLoginRouter.post('/refresh', requireAuth, requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [profile] = await db.select().from(profiles).where(and(eq(profiles.id, c.get('user').sub), isNull(profiles.deletedAt))).limit(1)
  if (!profile || !isStaffRole(profile.role)) return c.json({ error: 'Unauthorized' }, 401)
  return c.json({ token: await staffToken(profile, c.var.club?.id ?? null), user: userOf(profile), hasPin: !!profile.pin })
})
