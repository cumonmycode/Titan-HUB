import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { getClubDb } from '@titan/database'
// Control-БД: относительный путь к собранному dist (тот же приём, что в
// clubResolver / superadmin clubs.router — закрытый exports-map @titan/database).
import {
  getControlDb,
  clubs,
  eq,
} from '../../../../../packages/database/dist/control/index.js'
import { buildClubConnString } from '../../lib/clubResolver.js'
import { getClubIntegration } from '../../lib/secrets.js'
import type { AppEnv } from '../../types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Внутренний контур для бот-менеджера. НЕ для браузера/клиента: отдаёт
// РАСШИФРОВАННЫЕ токены ботов клубов, поэтому защищён общим секретом
// (заголовок x-internal-secret = JWT_SECRET; есть и у API, и у бот-контейнеров
// через env_file). Без секрета — 403. Боты дёргают это на старте, чтобы поднять
// по инстансу Bot на каждый активный клуб с его токеном/БД/поддоменом.
// ─────────────────────────────────────────────────────────────────────────────

function defaultDbName(): string {
  try {
    return new URL(process.env['DATABASE_URL'] ?? '').pathname.replace(/^\//, '')
  } catch {
    return ''
  }
}

function checkSecret(provided: string | undefined): boolean {
  const secret = process.env['JWT_SECRET'] ?? ''
  if (!secret || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const internalRouter = new Hono<AppEnv>()

// GET /api/internal/bot-clubs — конфиги ботов всех активных клубов.
internalRouter.get('/bot-clubs', async (c) => {
  if (!checkSecret(c.req.header('x-internal-secret'))) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const def = defaultDbName()
  const control = getControlDb()
  const rows = await control
    .select({ id: clubs.id, slug: clubs.slug, subdomain: clubs.subdomain, dbName: clubs.dbName })
    .from(clubs)
    .where(eq(clubs.status, 'active'))

  const out: Array<{
    id: string
    slug: string
    subdomain: string | null
    dbName: string
    isDefault: boolean
    adminToken: string | null
    walletToken: string | null
  }> = []

  for (const r of rows) {
    try {
      const cdb = getClubDb(buildClubConnString(r.dbName))
      const adminToken = await getClubIntegration(cdb, 'admin_bot_token')
      const walletToken = await getClubIntegration(cdb, 'wallet_bot_token')
      out.push({
        id: r.id,
        slug: r.slug,
        subdomain: r.subdomain,
        dbName: r.dbName,
        isDefault: r.dbName === def,
        adminToken,
        walletToken,
      })
    } catch (e) {
      console.error(`[internal] конфиг ботов клуба «${r.slug}» не прочитан`, e)
    }
  }

  return c.json({ clubs: out, defaultDbName: def })
})
