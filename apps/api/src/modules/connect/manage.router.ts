import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'
import { formatCode, saveCodeRoute } from './codes.js'
import { cancelCode, createConnection, deleteConnection, issueCode, listConnections, updateConnection, type IssuedCode } from './repo.js'
import { API_VERSION, requestHost, requestOrigin } from './public.router.js'
import { CONNECT_SCOPES } from './scopes.js'

/**
 * Titan Connect в HUB (/api/connect/manage) — только владелец: подключения сторонних
 * сервисов, их права, одноразовые коды и отключение.
 */
export const connectManageRouter = new Hono<AppEnv>()
connectManageRouter.use('*', requireAuth, requireRole('owner'))

const ScopeKey = z.enum(CONNECT_SCOPES.map((s) => s.key) as [string, ...string[]])
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(ScopeKey).max(CONNECT_SCOPES.length).default(['clients:read']),
})
const PatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  scopes: z.array(ScopeKey).max(CONNECT_SCOPES.length).optional(),
})

const NOT_FOUND = { error: 'Подключение не найдено' }
const uuidOk = (id: string): boolean => /^[0-9a-f-]{36}$/i.test(id)

/** Код для показа владельцу + маршрут в Redis, чтобы его можно было ввести на любом домене Titan. */
async function publishCode(c: Context<AppEnv>, code: IssuedCode): Promise<{ code: string; expiresAt: string }> {
  await saveCodeRoute(code.codeHash, { clubId: c.var.club?.id ?? null, host: requestHost(c) })
  return { code: formatCode(code.code), expiresAt: code.expiresAt }
}

/** Всё, что нужно экрану: права, адрес API клуба и подключения. */
connectManageRouter.get('/', async (c) => {
  const items = await listConnections(c.var.db)
  return c.json({ apiBase: `${requestOrigin(c)}/api/connect/${API_VERSION}`, scopes: CONNECT_SCOPES, items })
})

connectManageRouter.post('/connections', zValidator('json', CreateSchema), async (c) => {
  const body = c.req.valid('json')
  const { connection, code } = await createConnection(c.var.db, { name: body.name, scopes: body.scopes, createdBy: c.var.user.sub })
  return c.json({ connection, ...(await publishCode(c, code)) }, 201)
})

connectManageRouter.patch('/connections/:id', zValidator('json', PatchSchema), async (c) => {
  const id = c.req.param('id')
  if (!uuidOk(id)) return c.json(NOT_FOUND, 404)
  const connection = await updateConnection(c.var.db, id, c.req.valid('json'))
  return connection ? c.json({ connection }) : c.json(NOT_FOUND, 404)
})

/**
 * Новый одноразовый код: для первого подключения, если прошлый истёк, или чтобы
 * переподключить сервис, потерявший ключ (прежний ключ перестанет работать при обмене).
 */
connectManageRouter.post('/connections/:id/code', async (c) => {
  const id = c.req.param('id')
  if (!uuidOk(id)) return c.json(NOT_FOUND, 404)
  const code = await issueCode(c.var.db, id)
  return code ? c.json(await publishCode(c, code)) : c.json(NOT_FOUND, 404)
})

connectManageRouter.delete('/connections/:id/code', async (c) => {
  const id = c.req.param('id')
  if (!uuidOk(id)) return c.json(NOT_FOUND, 404)
  await cancelCode(c.var.db, id)
  return c.json({ ok: true })
})

/** Отключить сервис: ключ перестаёт работать сразу. */
connectManageRouter.delete('/connections/:id', async (c) => {
  const id = c.req.param('id')
  if (!uuidOk(id)) return c.json(NOT_FOUND, 404)
  return (await deleteConnection(c.var.db, id)) ? c.json({ ok: true }) : c.json(NOT_FOUND, 404)
})
