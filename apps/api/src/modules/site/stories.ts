/**
 * Публикации сайта клуба (site_stories): турниры, вечеринки, мероприятия.
 * Публичное чтение — в site.router (/api/site/stories), управление — здесь
 * (/api/site-admin/stories, только владелец). Таблица — raw SQL.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, type Database } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireAuth, requireRole } from '../../middleware/auth.js'

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

// Адреса страниц сайта, которые нельзя занять публикацией (/<slug> живёт в корне).
const RESERVED_SLUGS = new Set([
  'games', 'events', 'kidspromo', 'portfolio', 'residents', 'studio', 'contact', 'promoinfo',
  'privacy-policy', 'terms-and-conditions', 'refund-policy', 'accessibility-statement', 'members',
  'preview', 'api', 'media', 'docs', 'sitemap.xml', 'robots.txt', '_next',
])

// Фото: загрузка HUB (https) или файл сайта (/media/…).
const photoUrl = z.string().trim().max(500).refine((v) => /^https:\/\//.test(v) || /^\/media\/[\w.-]+$/.test(v), 'Ссылка на фото')
const httpsUrl = z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//.test(v), 'Нужна ссылка https://')

const StorySchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Адрес: латиница, цифры, дефис')
    .refine((v) => !RESERVED_SLUGS.has(v), 'Этот адрес занят страницей сайта'),
  title: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(160).optional().default(''),
  kind: z.enum(['tournament', 'party', 'event']).default('tournament'),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  body: z.string().max(6000).optional().default(''),
  stats: z.array(z.object({ value: z.string().trim().min(1).max(24), label: z.string().trim().min(1).max(40) })).max(4).default([]),
  coverUrl: photoUrl.nullable().optional(),
  photos: z.array(photoUrl).max(24).default([]),
  resultsUrl: httpsUrl.optional().default(''),
  galleryUrl: httpsUrl.optional().default(''),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
})
type StoryInput = z.infer<typeof StorySchema>

export interface StoryRow {
  id: string; slug: string; title: string; tagline: string | null; kind: string; event_date: string | null
  body: string | null; stats: { value: string; label: string }[]; cover_url: string | null; photos: string[]
  results_url: string | null; gallery_url: string | null; is_published: boolean; sort_order: number; updated_at: string
}

/** Публичный вид публикации (camelCase, без служебных полей). */
export function publicStory(r: StoryRow, full: boolean) {
  const base = {
    slug: r.slug, title: r.title, tagline: r.tagline ?? '', kind: r.kind, eventDate: r.event_date,
    coverUrl: r.cover_url ?? r.photos[0] ?? null, stats: r.stats,
  }
  if (!full) return base
  return {
    ...base,
    body: (r.body ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean),
    photos: r.photos, resultsUrl: r.results_url || null, galleryUrl: r.gallery_url || null,
  }
}

const ORDER = sql`ORDER BY sort_order DESC, event_date DESC NULLS LAST, created_at DESC`

export async function listPublished(db: Database): Promise<StoryRow[]> {
  const res = await db.execute(sql`SELECT * FROM site_stories WHERE is_published ${ORDER} LIMIT 100`)
  return rows<StoryRow>(res)
}

export async function findPublished(db: Database, slug: string): Promise<StoryRow | null> {
  const res = await db.execute(sql`SELECT * FROM site_stories WHERE is_published AND slug = ${slug} LIMIT 1`)
  return rows<StoryRow>(res)[0] ?? null
}

function values(b: StoryInput) {
  return {
    slug: b.slug, title: b.title, tagline: b.tagline || null, kind: b.kind, eventDate: b.eventDate ?? null,
    body: b.body || null, stats: JSON.stringify(b.stats), cover: b.coverUrl ?? null, photos: JSON.stringify(b.photos),
    results: b.resultsUrl || null, gallery: b.galleryUrl || null, published: b.isPublished, sort: b.sortOrder,
  }
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505'
const DUPLICATE_SLUG = 'Публикация с таким адресом уже есть'

export const siteAdminRouter = new Hono<AppEnv>()
siteAdminRouter.use('*', requireAuth, requireRole('owner'))

siteAdminRouter.get('/stories', async (c) => {
  const res = await c.var.db.execute(sql`SELECT * FROM site_stories ${ORDER} LIMIT 300`)
  return c.json({ stories: rows<StoryRow>(res) })
})

siteAdminRouter.post('/stories', zValidator('json', StorySchema), async (c) => {
  const v = values(c.req.valid('json'))
  try {
    const res = await c.var.db.execute(sql`
      INSERT INTO site_stories (slug, title, tagline, kind, event_date, body, stats, cover_url, photos, results_url, gallery_url, is_published, sort_order)
      VALUES (${v.slug}, ${v.title}, ${v.tagline}, ${v.kind}, ${v.eventDate}, ${v.body}, ${v.stats}::jsonb, ${v.cover}, ${v.photos}::jsonb,
              ${v.results}, ${v.gallery}, ${v.published}, ${v.sort})
      RETURNING *
    `)
    return c.json({ story: rows<StoryRow>(res)[0] }, 201)
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: DUPLICATE_SLUG }, 409)
    throw e
  }
})

siteAdminRouter.patch('/stories/:id', zValidator('json', StorySchema), async (c) => {
  const v = values(c.req.valid('json'))
  try {
    const res = await c.var.db.execute(sql`
      UPDATE site_stories SET slug = ${v.slug}, title = ${v.title}, tagline = ${v.tagline}, kind = ${v.kind},
        event_date = ${v.eventDate}, body = ${v.body}, stats = ${v.stats}::jsonb, cover_url = ${v.cover},
        photos = ${v.photos}::jsonb, results_url = ${v.results}, gallery_url = ${v.gallery},
        is_published = ${v.published}, sort_order = ${v.sort}, updated_at = now()
      WHERE id = ${c.req.param('id')}
      RETURNING *
    `)
    const story = rows<StoryRow>(res)[0]
    if (!story) return c.json({ error: 'Публикация не найдена' }, 404)
    return c.json({ story })
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: DUPLICATE_SLUG }, 409)
    throw e
  }
})

siteAdminRouter.delete('/stories/:id', async (c) => {
  const res = await c.var.db.execute(sql`DELETE FROM site_stories WHERE id = ${c.req.param('id')} RETURNING id`)
  if (!rows(res).length) return c.json({ error: 'Публикация не найдена' }, 404)
  return c.json({ ok: true })
})
