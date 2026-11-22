import { randomUUID } from 'node:crypto'
import type { Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { applicationMarkup } from './clubBot.js'
import { telegramName } from './clubs.js'
import type { MafboardEnv } from './router.js'
import { body, fail } from './router.js'
import type { StoredClubApplication } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Заявка на клуб без подключений (docs/MAFBOARD.md, «Клуб без подключений»):
//   POST /v1/clubs/applications {name, city} — заявка уходит владельцу платформы в бота;
//   GET  /v1/me/club-application             — последняя заявка (приложение показывает её статус).
// Решение — кнопками в боте (clubBot.ts): одобрено — клуб без GoMafia и Titan, заявитель — владелец.
// ─────────────────────────────────────────────────────────────────────────────

const APPLICATIONS_PER_DAY = 3

const applicationSchema = z.object({
  name: z.string().trim().min(2).max(60),
  city: z.string().trim().max(60).nullish(),
})

export function toApplicationJSON(application: StoredClubApplication) {
  return {
    id: application.id,
    name: application.name,
    city: application.city,
    status: application.status,
    createdAt: application.createdAt.toISOString(),
    decidedAt: application.decidedAt?.toISOString() ?? null,
    clubId: application.clubId,
  }
}

export function registerClubApplicationRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  router.post('/v1/clubs/applications', requireUser, body(applicationSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const adminTgId = deps.config.adminTgId ?? null
    const messenger = deps.messenger
    if (adminTgId == null || !messenger) return fail(c, 503, 'applications_unavailable', 'Заявки на клубы сейчас не принимаются')
    if (!(await deps.limiter.hit(`mb:club:apply:${user.id}`, APPLICATIONS_PER_DAY, 24 * 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много заявок, попробуйте завтра')
    }
    const input = c.req.valid('json')
    const created = await deps.repo.createClubApplication({
      id: randomUUID(),
      userId: user.id,
      name: input.name,
      city: input.city || null,
      status: 'pending',
      createdAt: deps.now(),
      decidedAt: null,
      clubId: null,
    })
    if (created === 'pending_exists') return fail(c, 409, 'application_pending', 'Ваша заявка на клуб уже на рассмотрении')

    const place = created.city ? `, ${created.city}` : ''
    const text = `🆕 Заявка на клуб «${created.name}»${place}\nОт: ${telegramName(user) || 'без имени'}`
    deps.background(`mb:notify:${adminTgId}`, () => messenger.send(adminTgId, text, applicationMarkup(created.id)))
    return c.json({ application: toApplicationJSON(created) }, 201)
  })

  router.get('/v1/me/club-application', requireUser, async (c) => {
    const application = await c.get('deps').repo.latestClubApplication(c.get('user').id)
    return c.json({ application: application ? toApplicationJSON(application) : null })
  })
}
