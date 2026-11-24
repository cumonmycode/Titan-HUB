/**
 * Стримы в HUB (раздел «Telegram → Стримы»): что прислал MafBoard, отдавать ли эфиры
 * Tai для публикации и ручные действия.
 *   GET    /api/telegram/streams           — активный и последний эфир, настройка публикации;
 *   PUT    /api/telegram/streams/settings  — {autoPublish};
 *   POST   /api/telegram/streams           — эфир вручную (сразу публикуется);
 *   POST   /api/telegram/streams/publish   — опубликовать полученный эфир;
 *   DELETE /api/telegram/streams/active    — завершить эфир.
 */
import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../../types.js'
import { chatsForCategory } from '../../lib/tgChatConfig.js'
import { endStream, publishStream, setAutoPublish, startStream, streamState, StreamError } from './streams.js'

export const StreamLinkSchema = z.object({
  kind: z.enum(['watch', 'donate']),
  label: z.string().trim().max(40).default(''),
  url: z.string().trim().url().max(500),
})

export function registerStreamRoutes(router: Hono<AppEnv>): void {
  router.get('/streams', async (c) => {
    const db = c.var.db
    const [state, targets] = await Promise.all([streamState(db), chatsForCategory(db, 'streams')])
    return c.json({ ...state, targets: targets.length })
  })

  router.put('/streams/settings', zValidator('json', z.object({ autoPublish: z.boolean() })), async (c) => {
    await setAutoPublish(c.var.db, c.req.valid('json').autoPublish)
    return c.json({ ok: true })
  })

  router.post('/streams', zValidator('json', z.object({ title: z.string().trim().max(120).optional(), links: z.array(StreamLinkSchema).min(1).max(6) })), async (c) => {
    try {
      const body = c.req.valid('json')
      return c.json({ stream: await startStream(c.var.db, { ...body, source: 'hub' }, { publish: true }) })
    } catch (error) {
      if (error instanceof StreamError) return c.json({ error: error.message }, 400)
      throw error
    }
  })

  router.post('/streams/publish', async (c) => {
    try {
      return c.json({ stream: await publishStream(c.var.db) })
    } catch (error) {
      if (error instanceof StreamError) return c.json({ error: error.message }, 400)
      throw error
    }
  })

  router.delete('/streams/active', async (c) => {
    const ended = await endStream(c.var.db)
    return ended ? c.json({ stream: ended }) : c.json({ error: 'Сейчас эфира нет' }, 404)
  })
}
