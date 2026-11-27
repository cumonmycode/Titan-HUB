/**
 * Стримы в HUB (раздел «Telegram → Стримы»): что прислал MafBoard, отдавать ли эфиры
 * Tai для публикации и ручные действия.
 *   GET    /api/telegram/streams           — активный и последний эфир, настройка публикации;
 *   PUT    /api/telegram/streams/settings  — {autoPublish?, appPush?, appPushTitle?, appPushBody?, channels?}
 *                                            (push и площадки для My Titan — экран HUB «Маркетинг → Трансляции»);
 *   POST   /api/telegram/streams           — эфир вручную (сразу публикуется);
 *   POST   /api/telegram/streams/publish   — опубликовать полученный эфир;
 *   DELETE /api/telegram/streams/active    — завершить эфир.
 */
import type { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { chatsForCategory } from '../../lib/tgChatConfig.js'
import { endStream, publishStream, setStreamSettings, startStream, streamState, StreamError } from './streams.js'

export const StreamLinkSchema = z.object({
  kind: z.enum(['watch', 'donate']),
  label: z.string().trim().max(40).default(''),
  url: z.string().trim().url().max(500),
})

export function registerStreamRoutes(router: Hono<AppEnv>): void {
  router.get('/streams', async (c) => {
    const db = c.var.db
    const [state, targets, sourcesRes] = await Promise.all([
      streamState(db),
      chatsForCategory(db, 'streams'),
      // Кто может прислать эфир: подключения Titan Connect (MafBoard) и есть ли у них право «Стримы».
      db.execute(sql`
        SELECT id, name, ('streams:publish' = ANY(scopes)) AS can_stream
        FROM connect_connections WHERE revoked_at IS NULL AND connected_at IS NOT NULL
        ORDER BY created_at
      `),
    ])
    const sources = ((sourcesRes as { rows?: unknown[] }).rows ?? (sourcesRes as unknown as unknown[])) as { id: string; name: string; can_stream: boolean }[]
    return c.json({ ...state, targets: targets.length, sources: sources.map((r) => ({ id: r.id, name: r.name, canStream: !!r.can_stream })) })
  })

  router.put('/streams/settings', zValidator('json', z.object({
    autoPublish: z.boolean().optional(),
    appPush: z.boolean().optional(),
    appPushTitle: z.string().max(80).optional(),
    appPushBody: z.string().max(200).optional(),
    channels: z.array(StreamLinkSchema).max(6).optional(),
  })), async (c) => {
    const next = await setStreamSettings(c.var.db, c.req.valid('json'))
    const { active: _active, last: _last, ...settings } = next
    return c.json({ ok: true, ...settings })
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
