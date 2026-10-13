import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { certificates, checks, profiles, eq, desc, and, sql, inArray } from '@titan/database'
import { requireAuth, requireRole, requirePermission } from '../../middleware/auth.js'
import { randomInt } from 'crypto'
import { certificateStatus, eligibleAmount, normalizeCode, STATUS_ERROR } from '../../lib/certificates.js'

const BATCH_MAX = 1000

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // crypto.randomInt — криптостойкий выбор символов (коды нельзя предсказать).
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('')
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
// Что выпускаем: номинал, название, на что тратится, срок и получатель.
const TermsShape = z.object({
  // Верхняя граница: защищает numeric(10,2) от переполнения и блокирует абуз.
  nominal: z.number().positive().max(1_000_000),
  title: z.string().trim().max(80).nullable().optional(),
  scope: z.enum(['all', 'categories', 'items', 'events']).default('all'),
  categoryIds: z.array(z.string().uuid()).max(100).default([]),
  itemIds: z.array(z.string().uuid()).max(300).default([]),
  validUntil: DATE.nullable().optional(),
  recipient: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})
type Terms = z.infer<typeof TermsShape>
const scopeFilled = (t: Terms) => (t.scope !== 'categories' || t.categoryIds.length > 0) && (t.scope !== 'items' || t.itemIds.length > 0)
const SCOPE_EMPTY = { message: 'Выберите категории или позиции, на которые действует сертификат', path: ['scope'] }

const SingleSchema = TermsShape.extend({ code: z.string().max(60).optional() }).refine(scopeFilled, SCOPE_EMPTY)
// Серия: префикс + номера с ведущими нулями, «TK-0001…TK-0100».
const BatchSchema = TermsShape.extend({
  prefix: z.string().trim().max(20).regex(/^[A-Za-zА-Яа-яЁё0-9-]*$/, 'Префикс — буквы, цифры и дефис'),
  from: z.number().int().min(0).max(99_999_999),
  to: z.number().int().min(0).max(99_999_999),
  pad: z.number().int().min(1).max(8).default(4),
  skipExisting: z.boolean().default(false),
}).refine(scopeFilled, SCOPE_EMPTY)
  .refine((b) => b.to >= b.from && b.to - b.from < BATCH_MAX, { message: `Диапазон — до ${BATCH_MAX} номеров`, path: ['to'] })

const terms = (t: Terms) => ({
  nominal: String(t.nominal),
  balance: String(t.nominal),
  title: t.title || null,
  scope: t.scope,
  categoryIds: t.scope === 'categories' ? t.categoryIds : [],
  itemIds: t.scope === 'items' ? t.itemIds : [],
  validUntil: t.validUntil || null,
  recipient: t.recipient || null,
  note: t.note || null,
})

type CertRow = typeof certificates.$inferSelect
const view = (r: CertRow) => ({
  id: r.id,
  code: r.code,
  title: r.title,
  amount: Number(r.nominal),
  balance: Number(r.balance),
  status: certificateStatus(r),
  scope: r.scope,
  categoryIds: r.categoryIds,
  itemIds: r.itemIds,
  validUntil: r.validUntil,
  series: r.series,
  recipient: r.recipient,
  note: r.note,
  usedAt: r.usedAt,
  createdAt: r.createdAt,
})

export const certificatesRouter = new Hono<AppEnv>()
certificatesRouter.use('*', requireAuth)

certificatesRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const series = c.req.query('series')
  const q = (c.req.query('q') ?? '').trim().toUpperCase()
  const rows = await db.select().from(certificates)
    .where(and(
      series ? eq(certificates.series, series) : undefined,
      q ? sql`(${certificates.code} like ${'%' + q + '%'} or upper(coalesce(${certificates.recipient}, '')) like ${'%' + q + '%'} or upper(coalesce(${certificates.title}, '')) like ${'%' + q + '%'})` : undefined,
    ))
    .orderBy(desc(certificates.createdAt), certificates.code)
    .limit(1000)
  return c.json({ certificates: rows.map(view) })
})

// Серии: сколько выпущено, сколько ещё действует.
certificatesRouter.get('/series', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const rows = await db.select().from(certificates).where(sql`${certificates.series} is not null`)
  const map = new Map<string, { series: string; title: string | null; total: number; active: number; nominal: number; first: string; last: string; createdAt: Date }>()
  for (const r of rows) {
    const s = map.get(r.series!) ?? { series: r.series!, title: r.title, total: 0, active: 0, nominal: Number(r.nominal), first: r.code, last: r.code, createdAt: r.createdAt }
    s.total++
    if (certificateStatus(r) === 'active') s.active++
    if (r.code < s.first) s.first = r.code
    if (r.code > s.last) s.last = r.code
    map.set(r.series!, s)
  }
  return c.json({ series: [...map.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) })
})

// Один сертификат: свой номер (например, напечатан на карточке) или сгенерированный.
certificatesRouter.post('/', requireRole('owner', 'staff'), requirePermission('discounts'), zValidator('json', SingleSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  const code = body.code?.trim() ? normalizeCode(body.code) : generateCode()
  if (!code) return c.json({ error: 'Номер — буквы, цифры и дефис, от 3 до 40 знаков' }, 400)
  const [cert] = await db.insert(certificates).values({ code, createdBy: user.sub, ...terms(body) })
    .onConflictDoNothing({ target: certificates.code }).returning()
  if (!cert) return c.json({ error: `Сертификат № ${code} уже есть` }, 409)
  return c.json({ certificate: view(cert) }, 201)
})

// Серия с диапазоном номеров. Занятые номера — отказ со списком, либо пропуск (skipExisting).
certificatesRouter.post('/batch', requireRole('owner', 'staff'), requirePermission('discounts'), zValidator('json', BatchSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const body = c.req.valid('json')
  const prefix = body.prefix.trim().toUpperCase()
  const codes: string[] = []
  for (let n = body.from; n <= body.to; n++) {
    const code = normalizeCode(`${prefix}${String(n).padStart(body.pad, '0')}`)
    if (!code) return c.json({ error: 'Номер выходит слишком коротким или длинным — проверьте префикс и число цифр' }, 400)
    codes.push(code)
  }
  const taken = (await db.select({ code: certificates.code }).from(certificates).where(inArray(certificates.code, codes))).map((r) => r.code)
  if (taken.length && !body.skipExisting) {
    return c.json({ error: `Номера уже заняты: ${taken.slice(0, 5).join(', ')}${taken.length > 5 ? ` и ещё ${taken.length - 5}` : ''}`, taken }, 409)
  }
  const free = codes.filter((code) => !taken.includes(code))
  const series = prefix.replace(/-+$/, '') || `${codes[0]}…`
  const created = free.length
    ? await db.insert(certificates).values(free.map((code) => ({ code, series, createdBy: user.sub, ...terms(body) })))
      .onConflictDoNothing({ target: certificates.code }).returning({ code: certificates.code })
    : []
  return c.json({ created: created.length, skipped: taken, series, first: free[0] ?? null, last: free[free.length - 1] ?? null }, 201)
})

// validate используется на кассе персоналом — оставляем staff-доступ, но
// закрываем от клиентов/планшетов (иначе можно перебирать коды/балансы).
// С checkId — сколько из этого чека можно оплатить сертификатом (его «на что»).
certificatesRouter.get('/validate/:code', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const code = normalizeCode(c.req.param('code'))
  const [cert] = code ? await db.select().from(certificates).where(eq(certificates.code, code)) : []
  if (!cert) return c.json({ error: 'Сертификат не найден' }, 404)
  const status = certificateStatus(cert)
  if (status !== 'active') return c.json({ error: STATUS_ERROR[status] }, 400)
  const balance = Number(cert.balance)
  const checkId = c.req.query('checkId')
  const eligible = checkId ? await eligibleAmount(db, cert, checkId) : balance
  if (checkId && eligible <= 0) {
    return c.json({ error: cert.scope === 'events' ? 'Сертификат — только на мероприятие, а в чеке его нет' : 'Сертификат не распространяется на позиции этого чека' }, 400)
  }
  return c.json({ certificate: view(cert), remaining: Math.min(balance, eligible), balance, eligible })
})

certificatesRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [cert] = await db.select().from(certificates).where(eq(certificates.id, c.req.param('id')))
  if (!cert) return c.json({ error: 'Not found' }, 404)
  const uses = await db.select({
    checkId: checks.id, amount: checks.certificateUsed, closedAt: checks.closedAt, player: profiles.nickname,
  }).from(checks).leftJoin(profiles, eq(profiles.id, checks.playerId))
    .where(eq(checks.certificateId, cert.id)).orderBy(desc(checks.closedAt)).limit(50)
  return c.json({ certificate: view(cert), uses: uses.map((u) => ({ ...u, amount: Number(u.amount) })) })
})

// Правка условий (не номинала): название, срок, получатель, «на что».
certificatesRouter.patch('/:id', requireRole('owner', 'staff'), requirePermission('discounts'), zValidator('json', z.object({
  title: z.string().trim().max(80).nullable().optional(),
  validUntil: DATE.nullable().optional(),
  recipient: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  scope: z.enum(['all', 'categories', 'items', 'events']).optional(),
  categoryIds: z.array(z.string().uuid()).max(100).optional(),
  itemIds: z.array(z.string().uuid()).max(300).optional(),
})), async (c) => {
  const db = c.var.db
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) if (v !== undefined) patch[k] = v === '' ? null : v
  if (!Object.keys(patch).length) return c.json({ error: 'Нечего менять' }, 400)
  const [cert] = await db.update(certificates).set(patch).where(eq(certificates.id, c.req.param('id'))).returning()
  if (!cert) return c.json({ error: 'Not found' }, 404)
  return c.json({ certificate: view(cert) })
})

// Погасить (только владелец): сертификат больше не принимается, остаток сгорает.
certificatesRouter.put('/:id/deactivate', requireRole('owner'), async (c) => {
  const db = c.var.db
  const [cert] = await db.update(certificates).set({ isUsed: true, voidedAt: new Date() }).where(eq(certificates.id, c.req.param('id'))).returning()
  if (!cert) return c.json({ error: 'Not found' }, 404)
  return c.json({ certificate: view(cert) })
})
