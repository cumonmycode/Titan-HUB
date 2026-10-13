import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { profiles, shifts, shiftStaff, clientTiers, eq, and, isNull, desc, sql, or, ilike, inArray } from '@titan/database'
import type { Database } from '@titan/database'
// @ts-ignore
import { passkeys } from '@titan/database'
import { requireAuth, requireRole, invalidateProfileAuthCache } from '../../middleware/auth.js'
import { hashPassword, hashPin } from '@titan/auth'
import { isPinTaken, PIN_TAKEN_ERROR } from '../auth/staff-pin.js'
import { createHmac } from 'node:crypto'
import { taiUsername } from '../tg/club.js'


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
  salarySchemeId: z.string().uuid().nullable().optional(),
})

// Сотрудник = клиент клуба с правами: выбираем человека из клиентов и выдаём роль.
const PromoteSchema = z.object({
  profileId: z.string().uuid(),
  role: z.enum(['owner', 'staff']).default('staff'),
  permissions: z.record(z.boolean()).optional(),
})

const photoSql = sql<string | null>`coalesce(${profiles.photoUrl}, ${profiles.tgPhotoUrl}, ${profiles.gomafiaPhotoUrl})`

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
  const [open] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.status, 'open')).limit(1)
  const onShift = open
    ? new Set((await db.select({ id: shiftStaff.profileId }).from(shiftStaff).where(eq(shiftStaff.shiftId, open.id))).map((r) => r.id))
    : new Set<string>()
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      fullName: profiles.fullName,
      phone: profiles.phone,
      role: profiles.role,
      permissions: profiles.permissions,
      tgId: profiles.tgId,
      tgUsername: profiles.tgUsername,
      photoUrl: photoSql,
      clientTier: profiles.clientTier,
      salarySchemeId: profiles.salarySchemeId,
      hasPin: sql<boolean>`${profiles.pin} is not null`,
      createdAt: profiles.createdAt,
    })
    .from(profiles)
    .where(and(isNull(profiles.deletedAt), inArray(profiles.role, ['owner', 'staff'])))
    .orderBy(sql`${profiles.role} = 'owner' desc`, profiles.nickname)

  return c.json({ staff: rows.map((r) => ({ ...r, onShift: onShift.has(r.id) })) })
})

// Кандидаты в сотрудники — клиенты клуба (поиск по нику, имени, телефону).
staffRouter.get('/candidates', async (c) => {
  const db = c.var.db
  const q = (c.req.query('q') ?? '').trim().slice(0, 60)
  const digits = q.replace(/\D/g, '')
  const match = q
    ? or(
        ilike(profiles.nickname, `%${q}%`),
        ilike(profiles.fullName, `%${q}%`),
        ...(digits.length >= 3 ? [sql`regexp_replace(coalesce(${profiles.phone}, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`] : []),
      )
    : undefined
  const rows = await db
    .select({
      id: profiles.id,
      nickname: profiles.nickname,
      fullName: profiles.fullName,
      phone: profiles.phone,
      photoUrl: photoSql,
      clientTier: profiles.clientTier,
      tierLabel: clientTiers.label,
      tierColor: clientTiers.color,
      tgLinked: sql<boolean>`${profiles.tgId} is not null`,
    })
    .from(profiles)
    .leftJoin(clientTiers, eq(clientTiers.key, profiles.clientTier))
    .where(and(isNull(profiles.deletedAt), eq(profiles.role, 'client'), match))
    .orderBy(profiles.nickname)
    .limit(q ? 30 : 60)
  return c.json({ candidates: rows })
})

// Клиент → сотрудник (или владелец). Тот же профиль: история, баланс и Telegram остаются.
staffRouter.post('/promote', zValidator('json', PromoteSchema), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const [p] = await db.select({ role: profiles.role, deletedAt: profiles.deletedAt }).from(profiles).where(eq(profiles.id, body.profileId))
  if (!p || p.deletedAt) return c.json({ error: 'Клиент не найден' }, 404)
  if (p.role === 'owner' || p.role === 'staff') return c.json({ error: 'Он уже в команде' }, 409)
  if (p.role !== 'client') return c.json({ error: 'Этот профиль нельзя сделать сотрудником' }, 400)
  const [updated] = await db.update(profiles)
    .set({ role: body.role, permissions: body.permissions ?? {} })
    .where(eq(profiles.id, body.profileId))
    .returning({ id: profiles.id, nickname: profiles.nickname, role: profiles.role, permissions: profiles.permissions })
  await invalidateProfileAuthCache(c.var.club?.id ?? null, body.profileId)
  return c.json({ staff: updated }, 201)
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

// Подписанный диплинк + QR для привязки Telegram сотрудника через бота Tai клуба.
// Формат токена — HMAC JWT_SECRET, проверяет modules/tg/login/link.ts.
staffRouter.post('/:id/telegram-link', async (c) => {
  const db = c.var.db
  const [profile] = await db.select().from(profiles).where(and(eq(profiles.id, c.req.param('id')), isNull(profiles.deletedAt)))
  if (!profile) return c.json({ error: 'Not found' }, 404)
  const jwtSecret = process.env['JWT_SECRET']
  if (!jwtSecret) return c.json({ error: 'JWT_SECRET is not configured' }, 500)
  const username = await taiUsername(db)
  if (!username) return c.json({ error: 'Бот Tai клуба не настроен (Интеграции)' }, 503)

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

  // Сотрудник = клиент с правами: «убрать из команды» возвращает его в клиенты — история,
  // баланс, бонусы и Telegram остаются. Вход в HUB, PIN, права и формула зарплаты — снимаются.
  const id = c.req.param('id')
  await db.transaction(async (tx) => {
    await tx.update(profiles)
      .set({ role: 'client', permissions: {}, pin: null, passwordHash: null, needsPinSetup: false, salarySchemeId: null })
      .where(and(eq(profiles.id, id), inArray(profiles.role, ['owner', 'staff'])))
    const [open] = await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.status, 'open')).limit(1)
    if (open) await tx.delete(shiftStaff).where(and(eq(shiftStaff.shiftId, open.id), eq(shiftStaff.profileId, id)))
  })
  // Бывший сотрудник не должен входить по passkey — удаляем его ключи.
  await db.delete(passkeys).where(eq(passkeys.userId, id))
  // Его ещё живые JWT отбиваются requireAuth (роль из БД) — сразу, без ожидания кэша.
  await invalidateProfileAuthCache(c.var.club?.id ?? null, id)

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
