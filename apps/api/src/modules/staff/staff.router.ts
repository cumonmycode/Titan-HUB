import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, eq, and, isNull, desc, sql } from '@titan/database'
import type { Database } from '@titan/database'
// @ts-ignore
import { passkeys } from '@titan/database'
import { requireAuth, requireRole, invalidateProfileAuthCache } from '../../middleware/auth.js'
import { hashPassword, hashPin } from '@titan/auth'
import { isPinTaken, PIN_TAKEN_ERROR } from '../auth/staff-pin.js'
import { createHmac } from 'node:crypto'
import { TG_API } from '../../lib/telegram.js'

// Username админ-бота для диплинка привязки. Если не задан в env — берём через
// getMe (кэшируем). Токен админ-бота доступен API через env_file (.env).
let adminBotUsername: string | null = process.env['ADMIN_BOT_USERNAME']?.replace(/^@/, '') ?? null
async function getAdminBotUsername(): Promise<string | null> {
  if (adminBotUsername) return adminBotUsername
  const token = process.env['ADMIN_BOT_TOKEN']
  if (!token) return null
  try {
    const r = await fetch(`${TG_API}/bot${token}/getMe`)
    const j: any = await r.json()
    adminBotUsername = j?.result?.username ?? null
  } catch { /* ignore */ }
  return adminBotUsername
}

const CreateStaffSchema = z.object({
  nickname: z.string().min(2),
  password: z.string().min(4),
  pin: z.string().length(4).regex(/^\d{4}$/).optional(),
  phone: z.string().optional(),
  role: z.enum(['owner', 'staff']).default('staff'),
})

const UpdateStaffSchema = z.object({
  nickname: z.string().min(2).optional(),
  phone: z.string().optional(),
  role: z.enum(['owner', 'staff']).optional(),
  password: z.string().min(4).optional(),
  permissions: z.record(z.boolean()).optional(),
})

// Последнего активного владельца нельзя понизить или уволить — иначе клуб
// остаётся без управления (назначить владельца из приложения уже некому).
const LAST_OWNER_ERROR = 'Нельзя убрать последнего владельца клуба'
async function isLastActiveOwner(db: Database, id: string): Promise<boolean> {
  const [target] = await db.select({ role: profiles.role, deletedAt: profiles.deletedAt })
    .from(profiles).where(eq(profiles.id, id))
  if (!target || target.role !== 'owner' || target.deletedAt) return false
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(profiles).where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))
  return (row?.n ?? 0) <= 1
}

export const staffRouter = new Hono<AppEnv>()
staffRouter.use('*', requireAuth, requireRole('owner'))

staffRouter.get('/', async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      phone: profiles.phone,
      role: profiles.role,
      permissions: profiles.permissions,
      tgId: profiles.tgId,
      tgUsername: profiles.tgUsername,
      photoUrl: sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(and(
      isNull(profiles.deletedAt),
    ))
    .orderBy(desc(profiles.createdAt))

  const staff = rows.filter(r => r.role === 'owner' || r.role === 'staff')
  return c.json({ staff })
})

staffRouter.get('/:id', async (c) => {
  const db = c.var.db
  const [profile] = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      phone: profiles.phone,
      role: profiles.role,
      permissions: profiles.permissions,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(eq(profiles.id, c.req.param('id')))

  if (!profile) return c.json({ error: 'Not found' }, 404)
  return c.json({ staff: profile })
})

// Подписанный диплинк + QR для привязки Telegram сотрудника через АДМИН-бота.
// Формат токена совпадает с wallet-привязкой (HMAC JWT_SECRET), бот его проверяет.
staffRouter.post('/:id/telegram-link', async (c) => {
  const db = c.var.db
  const [profile] = await db.select().from(profiles).where(and(eq(profiles.id, c.req.param('id')), isNull(profiles.deletedAt)))
  if (!profile) return c.json({ error: 'Not found' }, 404)
  const jwtSecret = process.env['JWT_SECRET']
  if (!jwtSecret) return c.json({ error: 'JWT_SECRET is not configured' }, 500)
  const username = await getAdminBotUsername()
  if (!username) return c.json({ error: 'Админ-бот недоступен' }, 503)

  const idB64 = Buffer.from(profile.id.replace(/-/g, ''), 'hex').toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 15 * 60
  const expB36 = exp.toString(36)
  const sig = createHmac('sha256', jwtSecret).update(`${idB64}_${expB36}`).digest().subarray(0, 12).toString('base64url')
  const deepLink = `https://t.me/${username}?start=link_${idB64}_${expB36}_${sig}`

  const QRCode = await import('qrcode')
  const qrDataUrl = await QRCode.toDataURL(deepLink, { margin: 1, width: 320 })
  return c.json({ deepLink, qrDataUrl, expiresIn: 900, linked: !!profile.tgId, tgUsername: profile.tgUsername })
})

staffRouter.post('/', zValidator('json', CreateStaffSchema), async (c) => {
  const db = c.var.db
  const data = c.req.valid('json')
  // PIN уникален среди активного персонала (вход по PIN ищет профиль перебором).
  if (data.pin && await isPinTaken(db, data.pin)) return c.json({ error: PIN_TAKEN_ERROR }, 409)
  const hashedPassword = await hashPassword(data.password)

  try {
    const [created] = await db
      .insert(profiles)
      .values({
        nickname: data.nickname,
        passwordHash: hashedPassword,
        pin: data.pin ? await hashPin(data.pin) : undefined,
        phone: data.phone,
        role: data.role,
      })
      .returning({
        id: profiles.id,
        nickname: profiles.nickname,
        phone: profiles.phone,
        role: profiles.role,
        createdAt: profiles.createdAt,
      })

    return c.json({ staff: created }, 201)
  } catch (err: any) {
    if (err?.code === '23505') {
      return c.json({ error: 'Сотрудник с таким никнеймом уже существует' }, 409)
    }
    throw err
  }
})

staffRouter.patch('/:id', zValidator('json', UpdateStaffSchema), async (c) => {
  const db = c.var.db
  const { password, ...rest } = c.req.valid('json')
  const setData: Record<string, unknown> = { ...rest }
  if (password) {
    setData.passwordHash = await hashPassword(password)
  }
  if (rest.role && rest.role !== 'owner' && await isLastActiveOwner(db, c.req.param('id'))) {
    return c.json({ error: LAST_OWNER_ERROR }, 409)
  }

  try {
    const [updated] = await db
      .update(profiles)
      .set(setData)
      .where(eq(profiles.id, c.req.param('id')))
      .returning({
        id: profiles.id,
        nickname: profiles.nickname,
        phone: profiles.phone,
        role: profiles.role,
        permissions: profiles.permissions,
        createdAt: profiles.createdAt,
      })

    if (!updated) return c.json({ error: 'Not found' }, 404)
    // Новая роль и права действуют сразу, а не после перелогина/истечения кэша
    // (requireAuth берёт их из БД).
    if (rest.role || rest.permissions) await invalidateProfileAuthCache(c.var.club?.id ?? null, updated.id)
    return c.json({ staff: updated })
  } catch (err: any) {
    if (err?.code === '23505') {
      return c.json({ error: 'Сотрудник с таким никнеймом уже существует' }, 409)
    }
    throw err
  }
})

staffRouter.delete('/:id', async (c) => {
  const db = c.var.db
  const user = c.get('user')
  if (user.sub === c.req.param('id')) {
    return c.json({ error: 'Cannot delete yourself' }, 400)
  }
  if (await isLastActiveOwner(db, c.req.param('id'))) {
    return c.json({ error: LAST_OWNER_ERROR }, 409)
  }

  await db
    .update(profiles)
    .set({ deletedAt: new Date() })
    .where(eq(profiles.id, c.req.param('id')))

  // Уволенный сотрудник не должен входить по passkey — удаляем его ключи.
  // (Дополнительно auth-verify проверяет deletedAt, см. auth.router.ts.)
  await db.delete(passkeys).where(eq(passkeys.userId, c.req.param('id')))
  // Его ещё живые JWT отбиваются requireAuth (deletedAt) — сразу, без ожидания кэша.
  await invalidateProfileAuthCache(c.var.club?.id ?? null, c.req.param('id'))

  return c.json({ ok: true })
})

staffRouter.post('/:id/reset-pin', zValidator('json', z.object({ pin: z.string().length(4).regex(/^\d{4}$/) })), async (c) => {
  const db = c.var.db
  const { pin } = c.req.valid('json')
  if (await isPinTaken(db, pin, c.req.param('id'))) return c.json({ error: PIN_TAKEN_ERROR }, 409)
  const hashedPin = await hashPin(pin)
  await db
    .update(profiles)
    .set({ pin: hashedPin })
    .where(eq(profiles.id, c.req.param('id')))

  return c.json({ ok: true })
})

// GET /staff/:id/passkeys — list passkeys for a staff member (owner only)
staffRouter.get('/:id/passkeys', async (c) => {
  const db = c.var.db
  const rows = await db
    .select({
      id: passkeys.id,
      deviceType: passkeys.deviceType,
      backedUp: passkeys.backedUp,
      createdAt: passkeys.createdAt,
    })
    .from(passkeys)
    .where(eq(passkeys.userId, c.req.param('id')))
  return c.json({ passkeys: rows })
})

// DELETE /staff/:id/passkeys/:passkeyId — delete a passkey (owner only)
staffRouter.delete('/:id/passkeys/:passkeyId', async (c) => {
  const db = c.var.db
  await db
    .delete(passkeys)
    .where(and(eq(passkeys.id, c.req.param('passkeyId')), eq(passkeys.userId, c.req.param('id'))))
  return c.json({ ok: true })
})
