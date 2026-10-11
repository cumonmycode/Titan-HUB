import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { certificates, eq, desc } from '@titan/database'
import { requireAuth, requireRole, requirePermission } from '../../middleware/auth.js'
import { randomInt } from 'crypto'

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  // crypto.randomInt — криптостойкий выбор символов (коды нельзя предсказать).
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('')
}

const CertSchema = z.object({
  // Верхняя граница: защищает numeric(10,2) от переполнения и блокирует абуз.
  nominal: z.number().positive().max(1_000_000),
})

export const certificatesRouter = new Hono<AppEnv>()
certificatesRouter.use('*', requireAuth)

certificatesRouter.get('/', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const rows = await db.select().from(certificates).orderBy(desc(certificates.createdAt))
  // Нормализуем под фронт: amount(=nominal), числа, производный статус.
  const out = rows.map(r => ({
    id: r.id,
    code: r.code,
    amount: Number(r.nominal),
    balance: Number(r.balance),
    status: (r.isUsed || Number(r.balance) <= 0 ? 'used' : 'active') as 'used' | 'active',
    createdAt: r.createdAt,
  }))
  return c.json({ certificates: out })
})

// Выпуск сертификата — раздел «Лояльность», право «Скидки».
certificatesRouter.post('/', requireRole('owner', 'staff'), requirePermission('discounts'), zValidator('json', CertSchema), async (c) => {
  const db = c.var.db
  const user = c.get('user')
  const { nominal } = c.req.valid('json')
  const code = generateCode()
  const [cert] = await db.insert(certificates).values({
    code,
    nominal: String(nominal),
    balance: String(nominal),
    createdBy: user.sub,
  }).returning()
  return c.json({ certificate: cert }, 201)
})

// validate используется на кассе персоналом — оставляем staff-доступ, но
// закрываем от клиентов/планшетов (иначе можно перебирать коды/балансы).
certificatesRouter.get('/validate/:code', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [cert] = await db.select().from(certificates).where(eq(certificates.code, c.req.param('code')))
  if (!cert) return c.json({ error: 'Not found' }, 404)
  if (cert.isUsed) return c.json({ error: 'Already used' }, 400)
  // Исчерпанный сертификат (баланс <= 0) тоже отклоняем — иначе на кассе можно
  // применить «нулевой» сертификат и получить 0-скидку с видимостью успеха.
  const remaining = Number(cert.balance)
  if (remaining <= 0) return c.json({ error: 'Depleted' }, 400)
  return c.json({ certificate: cert, remaining })
})

certificatesRouter.get('/:id', requireRole('owner', 'staff'), async (c) => {
  const db = c.var.db
  const [cert] = await db.select().from(certificates).where(eq(certificates.id, c.req.param('id')))
  if (!cert) return c.json({ error: 'Not found' }, 404)
  return c.json({ certificate: cert })
})

certificatesRouter.put('/:id/deactivate', requireRole('owner'), async (c) => {
  const db = c.var.db
  const [cert] = await db.update(certificates).set({ isUsed: true }).where(eq(certificates.id, c.req.param('id'))).returning()
  if (!cert) return c.json({ error: 'Not found' }, 404)
  return c.json({ certificate: cert })
})
