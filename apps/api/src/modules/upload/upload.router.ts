import type { AppEnv } from '../../types.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { requireAuth } from '../../middleware/auth.js'
import { MAX_UPLOAD_BODY_BYTES, storeImage } from '../../lib/imageStore.js'

export const uploadRouter = new Hono<AppEnv>()
// Любой авторизованный пользователь (в т.ч. клиент в My Titan — загрузка
// аватара). Жёстко ограничено: только изображения ≤8 МБ, тип сверяется по байтам.
uploadRouter.use('*', requireAuth)
uploadRouter.use('*', bodyLimit({ maxSize: MAX_UPLOAD_BODY_BYTES }))

uploadRouter.post('/image', async (c) => {
  const formData = await c.req.formData()
  const stored = await storeImage(formData.get('file'))
  if (!stored.ok) return c.json({ error: stored.error }, stored.status)
  return c.json({ url: stored.url })
})
