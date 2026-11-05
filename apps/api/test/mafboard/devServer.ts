import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { attachStudioRelay } from '../../src/modules/mafboard/relay.js'
import { createTestContext, signIn, TG_USER } from './helpers.js'

// Сервер MafBoard на этом компьютере для проверки MBS и пульта без деплоя: настоящий роутер,
// данные в памяти, время настоящее. Запуск: cd apps/api && npx tsx test/mafboard/devServer.ts [порт]
// Страница /dev/phone заменяет телефон: выдаёт токен вошедшего ведущего и данные последнего билета QR.

const port = Number(process.argv[2] ?? 3999)
const ctx = createTestContext({ now: () => new Date(), limiter: { hit: async () => true } })
const phone = await signIn(ctx, TG_USER)

const app = new Hono()
app.get('/dev/phone', (c) => {
  const tickets = [...ctx.repo.qrTickets.values()]
  const last = tickets.at(-1)
  return c.json({
    accessToken: phone.accessToken,
    scanCode: last?.scanCode ?? null,
    confirmCode: last ? Number(last.confirmCode) : null,
    choiceCodes: last?.choiceCodes ?? [],
    status: last?.status ?? null,
    sessions: [...ctx.repo.sessions.values()].map((s) => ({ id: s.id, deviceName: s.deviceName, platform: s.platform, revoked: Boolean(s.revokedAt) })),
  })
})
app.route('/', ctx.app)

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`[dev] сервер MafBoard: http://127.0.0.1:${port}/api/mafboard`)
})
attachStudioRelay(server as unknown as Server, () => ctx.deps)
