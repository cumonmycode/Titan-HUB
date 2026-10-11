/**
 * Вход в приложение My Titan по номеру телефона (и регистрация нового клиента).
 *
 * 1) POST /start {phone}: номер есть в клубе → строка входа (mode 'login');
 *    номера нет → { status: 'register' }, приложение показывает анкету и шлёт
 *    POST /start {phone, register} → строка регистрации (mode 'register').
 * 2) POST /photo (multipart: ticket + file) — фото из анкеты.
 * 3) Клиент открывает бота t.me/<bot>?start=app_<deepCode> и подтверждает
 *    (apps/bot-wallet/src/bot.ts): бот помечает строку claimed + profile_id,
 *    при регистрации — сначала создаёт профиль.
 * 4) GET /status?ticket — приложение опрашивает и получает токен.
 *
 * Строки живут в wallet_login_codes (общая БД API и бота). Прежний вход по
 * 4-значному коду (/wallet-code/*, mode NULL) остаётся для веб-кошелька и
 * старых сборок приложения.
 */
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes } from 'node:crypto'
import { profiles, walletLoginCodes, eq, and, gt, lt, isNotNull, sql, type AppRegistration, type Database } from '@titan/database'
import { signToken } from '@titan/auth'
import { clientIp } from '../../lib/clientIp.js'
import { getSharedRedis } from '../../lib/redis.js'
import { findProfilesByPhone, normalizePhone } from '../../lib/phone.js'
import { MAX_UPLOAD_BODY_BYTES, storeImage } from '../../lib/imageStore.js'
import { notify } from '../notifications/push.js'
import { getWalletBotUsername } from './auth.router.js'
import type { AppEnv } from '../../types.js'

export const appLoginRouter = new Hono<AppEnv>()

// На подтверждение в Telegram (с анкетой и первым запуском бота) — 15 минут.
const APP_LOGIN_TTL_MS = 15 * 60 * 1000
// «Входим один раз»: токен на год, приложение продлевает его само
// (/resident/session/refresh выдаёт такой же).
const APP_TOKEN_TTL = '365d'
// Код для строк входа по телефону: не 4 цифры — бот не примет его как код входа.
const APP_ROW_CODE = 'app'
// С одного IP (в клубе все на одном Wi-Fi) — до 30 попыток за 10 минут.
const START_MAX = 30
const START_WINDOW_SECONDS = 10 * 60
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_BIRTH_YEAR = 1920
const MIN_AGE_YEARS = 3

/** Ответ 400 с первой понятной ошибкой схемы (приложение показывает её как есть). */
function invalid(result: { success: boolean; error?: z.ZodError }, c: Context) {
  if (!result.success) return c.json({ error: result.error?.issues[0]?.message ?? 'Проверьте данные' }, 400)
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ')

function isValidBirthday(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false
  const latest = new Date()
  latest.setUTCFullYear(latest.getUTCFullYear() - MIN_AGE_YEARS)
  return y >= MIN_BIRTH_YEAR && date <= latest
}

const StartSchema = z.object({
  phone: z.string().max(32),
  deviceName: z.string().max(60).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  register: z.object({
    nickname: z.string().transform(squash)
      .pipe(z.string().min(2, 'Никнейм — от 2 символов').max(32, 'Никнейм — до 32 символов')),
    fullName: z.string().transform(squash)
      .pipe(z.string().min(2, 'Введите имя').max(80, 'Имя слишком длинное')),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Проверьте дату рождения')
      .refine(isValidBirthday, 'Проверьте дату рождения'),
  }).optional(),
})

/** Секунд до снятия ограничения или 0. Без Redis не ограничиваем (fail-open). */
async function throttled(key: string, max: number, windowSeconds: number): Promise<number> {
  const redis = getSharedRedis()
  const n = await redis.incr(key).catch(() => 0)
  if (n === 1) await redis.expire(key, windowSeconds).catch(() => {})
  if (n <= max) return 0
  const ttl = await redis.ttl(key).catch(() => windowSeconds)
  return Math.max(ttl, 1)
}

async function nicknameTaken(db: Database, nickname: string): Promise<boolean> {
  // Удалённые профили тоже держат никнейм (уникальный индекс), регистр не различаем.
  const [hit] = await db.select({ id: profiles.id }).from(profiles)
    .where(sql`lower(${profiles.nickname}) = lower(${nickname})`).limit(1)
  return !!hit
}

appLoginRouter.post('/start', zValidator('json', StartSchema, invalid), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  // Ответ «есть ли такой номер» — подсказка для перебора, поэтому троттлим по IP.
  const wait = await throttled(`${c.var.club?.id ?? 'main'}:applogin:start:${clientIp(c)}`, START_MAX, START_WINDOW_SECONDS)
  if (wait) return c.json({ error: `Слишком много попыток. Попробуйте через ${Math.ceil(wait / 60)} мин.` }, 429)

  const phone = normalizePhone(body.phone)
  if (!phone) return c.json({ error: 'Введите номер телефона полностью' }, 400)

  const existing = await findProfilesByPhone(db, phone)
  if (!existing.length && !body.register) return c.json({ status: 'register' as const })

  // Номер нашёлся, хотя прислали анкету (его успели добавить) — это обычный вход.
  const mode = existing.length ? 'login' as const : 'register' as const
  let regData: AppRegistration | null = null
  if (mode === 'register' && body.register) {
    const { nickname, fullName, birthday } = body.register
    if (await nicknameTaken(db, nickname)) {
      return c.json({ error: `Никнейм «${nickname}» уже занят — придумайте другой` }, 409)
    }
    regData = { nickname, fullName, birthday }
  }

  const botUsername = await getWalletBotUsername()
  if (!botUsername) return c.json({ error: 'Telegram-бот клуба сейчас недоступен. Попробуйте позже.' }, 503)

  // Чистим истёкшие строки (оппортунистически, как /wallet-code/start).
  await db.delete(walletLoginCodes).where(lt(walletLoginCodes.expiresAt, new Date())).catch(() => {})

  // Длинный неугадываемый код для диплинка t.me/<bot>?start=app_<deepCode>.
  const deepCode = randomBytes(18).toString('base64url')
  const expiresAt = new Date(Date.now() + APP_LOGIN_TTL_MS)
  const [row] = await db.insert(walletLoginCodes).values({
    code: APP_ROW_CODE,
    expiresAt,
    deepCode,
    deviceName: body.deviceName?.trim() || null,
    platform: body.platform ?? null,
    phone,
    mode,
    regData,
  }).returning({ ticket: walletLoginCodes.ticket })

  return c.json({
    status: 'pending' as const,
    mode,
    ticket: row?.ticket ?? null,
    botUsername,
    deepLink: `https://t.me/${botUsername}?start=app_${deepCode}`,
    expiresAt: expiresAt.toISOString(),
  })
})

// Фото из анкеты. Тикет в теле (не в адресе — адреса пишутся в журнал nginx).
appLoginRouter.post('/photo', bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES }), async (c) => {
  const db = c.var.db
  const form = await c.req.formData().catch(() => null)
  const ticket = String(form?.get('ticket') ?? '')
  if (!form || !UUID_RE.test(ticket)) return c.json({ error: 'Анкета устарела — начните заново' }, 404)
  const [row] = await db.select().from(walletLoginCodes)
    .where(and(
      eq(walletLoginCodes.ticket, ticket),
      eq(walletLoginCodes.mode, 'register'),
      eq(walletLoginCodes.status, 'pending'),
      gt(walletLoginCodes.expiresAt, new Date()),
    )).limit(1)
  if (!row?.regData) return c.json({ error: 'Анкета устарела — начните заново' }, 404)

  const stored = await storeImage(form.get('file'))
  if (!stored.ok) return c.json({ error: stored.error }, stored.status)
  await db.update(walletLoginCodes)
    .set({ regData: { ...row.regData, photoUrl: stored.url } })
    .where(eq(walletLoginCodes.id, row.id))
  return c.json({ url: stored.url })
})

appLoginRouter.get('/status', async (c) => {
  const db = c.var.db
  const ticket = c.req.query('ticket') ?? ''
  if (!UUID_RE.test(ticket)) return c.json({ status: 'expired' as const })
  const [row] = await db.select().from(walletLoginCodes)
    .where(and(eq(walletLoginCodes.ticket, ticket), isNotNull(walletLoginCodes.mode))).limit(1)
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
  // opened — бот уже открыт по ссылке: приложение подскажет нажать «Да».
  if (row.status !== 'claimed' || !row.profileId) return c.json({ status: 'pending' as const, opened: !!row.tgId })

  // Подтверждено в боте → токен. Тикет одноразовый.
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, row.profileId))
  await drop()
  if (!profile || profile.deletedAt) return c.json({ status: 'expired' as const })

  // Профиль создан этой регистрацией (а не найден готовым) — сообщаем персоналу.
  if (row.mode === 'register' && profile.createdAt >= row.createdAt) {
    void notify({
      type: 'new_client',
      title: 'Новый клиент',
      body: `${profile.nickname} · регистрация в My Titan`,
      meta: { clientId: profile.id },
    }, db, c.var.club?.id ?? null).catch(() => {})
  }

  const token = await signToken({ sub: profile.id, role: profile.role, nickname: profile.nickname, clubId: c.var.club?.id ?? null }, APP_TOKEN_TTL)
  return c.json({
    status: 'ok' as const,
    token,
    user: { id: profile.id, nickname: profile.nickname, role: profile.role, photoUrl: profile.photoUrl },
  })
})
