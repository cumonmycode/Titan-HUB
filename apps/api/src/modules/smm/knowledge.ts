/**
 * База знаний Tai: портрет клуба, интерьер по зонам, что было в соцсетях, справка по
 * мафии и календарь дат. Хранение (smm_knowledge, smm_zones, smm_zone_photos) и сборка
 * блока «что Tai знает» для промптов плана, постов, идей и видео.
 *
 * Текст владельца важнее текста Tai: он идёт первым и с пометкой «от владельца».
 */
import { sql, type Database } from '@titan/database'
import { rows } from './db.js'
import { mafiaKnowledge } from './mafia.js'
import { SmmError, type SmmProgress } from './types.js'

export type KnowledgeKey = 'club' | 'socials'

export interface KnowledgeDoc {
  key: KnowledgeKey
  ownerText: string
  aiText: string
  meta: Record<string, unknown>
  progress: SmmProgress | null
  error: string | null
  aiAt: string | null
}

export interface ZonePhoto {
  id: string
  url: string
}

export interface Zone {
  id: string
  /** Код для промптов: «З1», «З2»… — по порядку зон. */
  code: string
  title: string
  sort: number
  ownerText: string
  aiText: string
  /** То же коротко по-английски — опора для видеомодели. */
  anchor: string
  photos: ZonePhoto[]
  progress: SmmProgress | null
  error: string | null
  aiAt: string | null
}

type Row = Record<string, unknown>
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))

// ─── Разделы ─────────────────────────────────────────────────────────────────

function mapDoc(key: KnowledgeKey, r: Row | undefined): KnowledgeDoc {
  return {
    key,
    ownerText: String(r?.['owner_text'] ?? ''),
    aiText: String(r?.['ai_text'] ?? ''),
    meta: (r?.['meta'] as Record<string, unknown>) ?? {},
    progress: (r?.['progress'] as SmmProgress | null) ?? null,
    error: (r?.['error'] as string | null) ?? null,
    aiAt: iso(r?.['ai_at']),
  }
}

export async function getDoc(db: Database, key: KnowledgeKey): Promise<KnowledgeDoc> {
  const [r] = rows<Row>(await db.execute(sql`SELECT * FROM smm_knowledge WHERE key = ${key}`))
  return mapDoc(key, r)
}

export async function saveOwnerText(db: Database, key: KnowledgeKey, text: string): Promise<KnowledgeDoc> {
  await db.execute(sql`
    INSERT INTO smm_knowledge (key, owner_text) VALUES (${key}, ${text})
    ON CONFLICT (key) DO UPDATE SET owner_text = EXCLUDED.owner_text, updated_at = now()
  `)
  return getDoc(db, key)
}

export async function setDocProgress(db: Database, key: KnowledgeKey, progress: SmmProgress | null, error: string | null = null): Promise<void> {
  await db.execute(sql`
    INSERT INTO smm_knowledge (key, progress, error) VALUES (${key}, ${progress ? JSON.stringify(progress) : null}::jsonb, ${error})
    ON CONFLICT (key) DO UPDATE SET progress = EXCLUDED.progress, error = EXCLUDED.error, updated_at = now()
  `)
}

/** Занять раздел под работу: false — Tai уже над ним работает (и работа свежая). */
export async function claimDoc(db: Database, key: KnowledgeKey, progress: SmmProgress): Promise<boolean> {
  await db.execute(sql`INSERT INTO smm_knowledge (key) VALUES (${key}) ON CONFLICT (key) DO NOTHING`)
  const claimed = rows<Row>(await db.execute(sql`
    UPDATE smm_knowledge SET progress = ${JSON.stringify(progress)}::jsonb, error = NULL, updated_at = now()
    WHERE key = ${key} AND (progress IS NULL OR updated_at < now() - interval '15 minutes')
    RETURNING key
  `))
  return claimed.length > 0
}

export async function saveAiText(db: Database, key: KnowledgeKey, text: string, meta: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    UPDATE smm_knowledge SET ai_text = ${text}, meta = ${JSON.stringify(meta)}::jsonb, ai_at = now(), progress = NULL, error = NULL, updated_at = now()
    WHERE key = ${key}
  `)
}

// ─── Интерьер ────────────────────────────────────────────────────────────────

export async function listZones(db: Database): Promise<Zone[]> {
  const [zoneRows, photoRows] = await Promise.all([
    db.execute(sql`SELECT * FROM smm_zones ORDER BY sort, created_at`).then((r) => rows<Row>(r)),
    db.execute(sql`SELECT id, zone_id, url FROM smm_zone_photos ORDER BY sort, created_at`).then((r) => rows<Row>(r)),
  ])
  return zoneRows.map((z, i) => ({
    id: String(z['id']),
    code: `З${i + 1}`,
    title: String(z['title']),
    sort: Number(z['sort'] ?? 0),
    ownerText: String(z['owner_text'] ?? ''),
    aiText: String(z['ai_text'] ?? ''),
    anchor: String(z['anchor'] ?? ''),
    photos: photoRows.filter((p) => String(p['zone_id']) === String(z['id'])).map((p) => ({ id: String(p['id']), url: String(p['url']) })),
    progress: (z['progress'] as SmmProgress | null) ?? null,
    error: (z['error'] as string | null) ?? null,
    aiAt: iso(z['ai_at']),
  }))
}

export async function zoneOr404(db: Database, id: string): Promise<Zone> {
  const zone = (await listZones(db)).find((z) => z.id === id)
  if (!zone) throw new SmmError('Зона не найдена', 404)
  return zone
}

export async function addZone(db: Database, title: string): Promise<void> {
  await db.execute(sql`INSERT INTO smm_zones (title, sort) SELECT ${title}, coalesce(max(sort), 0) + 1 FROM smm_zones`)
}

export async function updateZone(db: Database, id: string, patch: { title?: string; ownerText?: string }): Promise<void> {
  await db.execute(sql`
    UPDATE smm_zones SET title = coalesce(${patch.title ?? null}, title), owner_text = coalesce(${patch.ownerText ?? null}, owner_text), updated_at = now()
    WHERE id = ${id}::uuid
  `)
}

export async function removeZone(db: Database, id: string): Promise<void> {
  await db.execute(sql`DELETE FROM smm_zones WHERE id = ${id}::uuid`)
}

export async function addZonePhoto(db: Database, zoneId: string, url: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO smm_zone_photos (zone_id, url, sort)
    SELECT ${zoneId}::uuid, ${url}, coalesce(max(sort), 0) + 1 FROM smm_zone_photos WHERE zone_id = ${zoneId}::uuid
  `)
}

export async function removeZonePhoto(db: Database, zoneId: string, photoId: string): Promise<void> {
  await db.execute(sql`DELETE FROM smm_zone_photos WHERE id = ${photoId}::uuid AND zone_id = ${zoneId}::uuid`)
}

export async function setZoneProgress(db: Database, id: string, progress: SmmProgress | null, error: string | null = null): Promise<void> {
  await db.execute(sql`UPDATE smm_zones SET progress = ${progress ? JSON.stringify(progress) : null}::jsonb, error = ${error}, updated_at = now() WHERE id = ${id}::uuid`)
}

export async function saveZoneAiText(db: Database, id: string, text: string, anchor: string): Promise<void> {
  await db.execute(sql`UPDATE smm_zones SET ai_text = ${text}, anchor = ${anchor}, ai_at = now(), progress = NULL, error = NULL, updated_at = now() WHERE id = ${id}::uuid`)
}

/** Описание зоны для промпта: слова владельца, потом — что Tai увидел на фото. */
export const zoneDescription = (z: Zone): string => [z.ownerText.trim() && `от владельца: ${z.ownerText.trim()}`, z.aiText.trim()].filter(Boolean).join(' ')

/** Зоны с фото или описанием — только их можно предлагать как место для картинки. */
export const usableZones = (zones: Zone[]): Zone[] => zones.filter((z) => z.photos.length || z.ownerText.trim() || z.aiText.trim())

export function zonesText(zones: Zone[]): string {
  const usable = usableZones(zones)
  if (!usable.length) return ''
  return [
    'Интерьер клуба — как выглядят помещения (код зоны ставь в "zone", только когда сцена по сюжету у нас в клубе — тогда картинка будет в нашем помещении):',
    ...usable.map((z) => `${z.code} ${z.title}${z.photos.length ? ` (${z.photos.length} фото)` : ''}: ${zoneDescription(z) || 'описания пока нет — опирайся на фото'}`),
  ].join('\n')
}

/** Зона по коду из ответа модели: «З2», «з2», «2». */
export function zoneByCode(zones: Zone[], code: string | undefined): Zone | undefined {
  if (!code) return undefined
  const n = Number(code.replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? zones[n - 1] : undefined
}

// ─── Прошлые посты площадок ──────────────────────────────────────────────────

/** Похожие прошлые посты клуба (по словам темы) — чтобы держать голос и не повторяться. */
export async function similarPastPosts(db: Database, text: string, limit = 4): Promise<string> {
  const words = [...new Set(text.toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, ' ').split(/\s+/).filter((w) => w.length >= 4))].slice(0, 12)
  if (!words.length) return ''
  const query = words.join(' | ')
  try {
    const found = rows<Row>(await db.execute(sql`
      SELECT platform, published_at, caption, views, coalesce(likes, reactions) AS likes
      FROM smm_platform_posts
      WHERE format <> 'story' AND length(caption) > 60 AND search @@ to_tsquery('russian', ${query})
      ORDER BY ts_rank(search, to_tsquery('russian', ${query})) DESC, published_at DESC
      LIMIT ${limit}
    `))
    if (!found.length) return ''
    return [
      'Как клуб уже писал на похожие темы (держи голос, но не повторяй заходы и фразы):',
      ...found.map((p) => `- ${String(iso(p['published_at']) ?? '').slice(0, 10)} ${p['platform']}${p['views'] != null ? `, 👁 ${p['views']}` : ''}${p['likes'] != null ? `, ❤ ${p['likes']}` : ''}: ${String(p['caption']).replace(/\s+/g, ' ').slice(0, 500)}`),
    ].join('\n')
  } catch (error) {
    console.warn('[smm] похожие посты', error instanceof Error ? error.message : error)
    return ''
  }
}

// ─── Блок для промптов ───────────────────────────────────────────────────────

export interface KnowledgeOpts {
  /** full — справка по мафии целиком (тексты постов), brief — коротко (план, идеи). */
  mafia: 'brief' | 'full'
  /** Интерьер по зонам — там, где Tai ставит задачи на картинки и видео. */
  zones?: Zone[]
}

/** «Что Tai знает»: портрет клуба, что было в соцсетях, интерьер, справка по мафии. */
export async function knowledgeText(db: Database, opts: KnowledgeOpts): Promise<string> {
  const [club, socials] = await Promise.all([getDoc(db, 'club'), getDoc(db, 'socials')])
  const portrait = [club.ownerText.trim() && `От владельца (главное, соблюдай):\n${club.ownerText.trim()}`, club.aiText.trim()].filter(Boolean).join('\n\n')
  return [
    portrait && `Портрет клуба:\n${portrait}`,
    socials.aiText.trim() && `Что уже было в наших соцсетях:\n${socials.aiText.trim()}`,
    opts.zones ? zonesText(opts.zones) : '',
    `Справка по мафии:\n${mafiaKnowledge(opts.mafia)}`,
  ].filter(Boolean).join('\n\n')
}
