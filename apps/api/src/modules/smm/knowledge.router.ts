/**
 * «База знаний» Tai в приложении: портрет клуба (слова владельца + собранное Tai),
 * что было в соцсетях, интерьер по зонам (фото, описание владельца, описание Tai),
 * справка по мафии и календарь праздников со своими датами клуба.
 * Подключается внутрь smmRouter — проверки входа и права «СММ» уже стоят там.
 */
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from '@titan/database'
import type { AppEnv } from '../../types.js'
import { requireRole } from '../../middleware/auth.js'
import { MAX_MEDIA_BODY_BYTES, storeMediaBuffer } from '../../lib/imageStore.js'
import { mskDate } from './context.js'
import { rows } from './db.js'
import { datesBetween, listOwnDates } from './holidays.js'
import { describeZoneInBackground } from './interior.js'
import { addZone, addZonePhoto, getDoc, listZones, removeZone, removeZonePhoto, saveOwnerText, updateZone, zoneOr404 } from './knowledge.js'
import { MAFIA_SECTIONS, RULES_SOURCE } from './mafia.js'
import { studyInBackground } from './study.js'
import { SmmError } from './types.js'

export const knowledgeRouter = new Hono<AppEnv>()
const ownerOnly = requireRole('owner')
const uploadLimit = bodyLimit({ maxSize: MAX_MEDIA_BODY_BYTES, onError: (c) => c.json({ error: 'Файл больше 60 МБ' }, 413) })
const UUID = /^[0-9a-f-]{36}$/i
/** Календарь в приложении — на три месяца вперёд. */
const DATES_AHEAD_DAYS = 92

function fail(c: Context<AppEnv>, error: unknown) {
  if (error instanceof SmmError) return c.json({ error: error.message }, error.status)
  console.error('[smm] база знаний', error)
  return c.json({ error: 'Не получилось — попробуйте ещё раз' }, 500)
}

async function payload(c: Context<AppEnv>) {
  const db = c.var.db
  const [club, socials, zones, upcoming, own, counts] = await Promise.all([
    getDoc(db, 'club'),
    getDoc(db, 'socials'),
    listZones(db),
    datesBetween(db, mskDate(), mskDate(Date.now() + DATES_AHEAD_DAYS * 86_400_000)),
    listOwnDates(db),
    db.execute(sql`SELECT platform, count(*)::int AS n FROM smm_platform_posts GROUP BY platform`).then((r) => rows<{ platform: string; n: number }>(r)),
  ])
  return {
    club,
    socials: { ...socials, posts: Object.fromEntries(counts.map((r) => [r.platform, Number(r.n)])) },
    zones,
    mafia: { source: RULES_SOURCE, sections: MAFIA_SECTIONS },
    dates: { upcoming, own },
  }
}

const respond = async (c: Context<AppEnv>) => c.json(await payload(c))

knowledgeRouter.get('/knowledge', respond)

/** Слова владельца о клубе — главный источник портрета. */
knowledgeRouter.put('/knowledge/club', ownerOnly, zValidator('json', z.object({ ownerText: z.string().max(8000) })), async (c) => {
  await saveOwnerText(c.var.db, 'club', c.req.valid('json').ownerText.trim())
  return respond(c)
})

/** Tai заново собирает портрет клуба или изучает соцсети (а за ними — и портрет). */
knowledgeRouter.post('/knowledge/:key/refresh', async (c) => {
  try {
    const key = c.req.param('key')
    if (key !== 'club' && key !== 'socials') return c.json({ error: 'Не найдено' }, 404)
    if (!(await studyInBackground(c.var.db, key))) return c.json({ error: 'Tai уже над этим работает' }, 409)
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

// ─── Интерьер ────────────────────────────────────────────────────────────────

const TitleSchema = z.object({ title: z.string().trim().min(2).max(60) })

knowledgeRouter.post('/zones', ownerOnly, zValidator('json', TitleSchema), async (c) => {
  await addZone(c.var.db, c.req.valid('json').title)
  return respond(c)
})

knowledgeRouter.patch('/zones/:zoneId', zValidator('json', z.object({ title: z.string().trim().min(2).max(60).optional(), ownerText: z.string().max(3000).optional() })), async (c) => {
  try {
    const zone = await zoneOr404(c.var.db, c.req.param('zoneId'))
    const body = c.req.valid('json')
    await updateZone(c.var.db, zone.id, { title: body.title, ownerText: body.ownerText?.trim() })
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

knowledgeRouter.delete('/zones/:zoneId', ownerOnly, async (c) => {
  try {
    const zone = await zoneOr404(c.var.db, c.req.param('zoneId'))
    await removeZone(c.var.db, zone.id)
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

/** Фото зоны с телефона (приложение уменьшает его до 2048 px). */
knowledgeRouter.post('/zones/:zoneId/photos', uploadLimit, async (c) => {
  try {
    const zone = await zoneOr404(c.var.db, c.req.param('zoneId'))
    const file = (await c.req.formData()).get('file')
    if (!(file instanceof File)) return c.json({ error: 'Нет файла' }, 400)
    const stored = await storeMediaBuffer(Buffer.from(await file.arrayBuffer()))
    if (!stored.ok) return c.json({ error: stored.error }, 400)
    if (!stored.mime?.startsWith('image/')) return c.json({ error: 'Нужна фотография, не видео' }, 400)
    await addZonePhoto(c.var.db, zone.id, stored.url)
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

knowledgeRouter.delete('/zones/:zoneId/photos/:photoId', async (c) => {
  try {
    const zone = await zoneOr404(c.var.db, c.req.param('zoneId'))
    const photoId = c.req.param('photoId')
    if (!UUID.test(photoId)) return c.json({ error: 'Не найдено' }, 404)
    await removeZonePhoto(c.var.db, zone.id, photoId)
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

/** Tai смотрит фото зоны и дописывает описание. */
knowledgeRouter.post('/zones/:zoneId/describe', async (c) => {
  try {
    if (!(await describeZoneInBackground(c.var.db, c.req.param('zoneId')))) return c.json({ error: 'Tai уже смотрит эту зону' }, 409)
    return respond(c)
  } catch (error) {
    return fail(c, error)
  }
})

// ─── Свои даты клуба ─────────────────────────────────────────────────────────

const DateSchema = z.object({
  day: z.string().regex(/^(\d{4}-)?\d{2}-\d{2}$/),
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(300).optional(),
})

knowledgeRouter.post('/dates', zValidator('json', DateSchema), async (c) => {
  const { day, title, note } = c.req.valid('json')
  const [month, date] = day.slice(-5).split('-').map(Number) as [number, number]
  if (month < 1 || month > 12 || date < 1 || date > 31) return c.json({ error: 'Такой даты нет' }, 400)
  await c.var.db.execute(sql`INSERT INTO smm_dates (day, title, note) VALUES (${day}, ${title}, ${note ?? ''})`)
  return respond(c)
})

knowledgeRouter.delete('/dates/:dateId', async (c) => {
  const id = c.req.param('dateId')
  if (!UUID.test(id)) return c.json({ error: 'Не найдено' }, 404)
  await c.var.db.execute(sql`DELETE FROM smm_dates WHERE id = ${id}::uuid`)
  return respond(c)
})
