/**
 * Фотоархив клуба — публичная папка Google Диска («у кого есть ссылка — читатель»).
 *
 * Архив не скачивается. Tai обходит папку по названиям (альбомы и файлы), у каждого
 * фото хранит описание и ссылку, а при работе ищет нужное по описаниям и берёт только
 * найденное: превью для выбора, кадрированное фото — в публикацию. Google сам отдаёт
 * кадр под формат (4:5, 9:16) по ссылке, без сервера картинок у нас.
 *
 * Описания первого архива сделаны заранее; новые фото Tai описывает сам по превью
 * дешёвой моделью, понемногу в день.
 */
import { appSettings, sql, type Database } from '@titan/database'
import { z } from 'zod'
import { getStringSetting } from '../../lib/appSettings.js'
import { chatJson, type ChatPart } from './ai.js'
import { rows } from './db.js'
import { DIRECTIONS } from './prompts.js'
import { SmmError, step, type SmmFormat, type SmmProgress } from './types.js'

const STATE_KEY = 'smm_library'
const MAX_DEPTH = 8
const MAX_FOLDERS = 400
const LIST_TIMEOUT_MS = 20_000
const PHOTO_MIME = /^image\/(jpeg|png|heic|heif|webp)$/
const VIDEO_MIME = /^video\/(mp4|quicktime)$/
/** Сколько новых фото Tai описывает за один заход и пачкой в одном запросе. */
const DESCRIBE_PER_RUN = 60
const DESCRIBE_BATCH = 6

export type LibraryKind = 'photo' | 'video' | 'template' | 'logo' | 'design'

export interface LibraryState {
  folderId: string
  url: string
  title: string
  connectedAt: string
  syncedAt: string | null
  error: string | null
  progress: SmmProgress | null
}

export interface LibraryPhoto {
  id: string
  path: string
  name: string
  kind: LibraryKind
  description: string
  tags: string
  people: number | null
  quality: number | null
  orientation: string | null
  usedCount: number
  thumb: string
}

export interface LibraryAlbum {
  id: string
  path: string
  title: string
  kind: string
  about: string
  files: number
  described: number
  cover: string | null
}

// ─── Ссылки Google ───────────────────────────────────────────────────────────

/** Превью файла Диска: длинная сторона `size` пикселей (JPEG, в том числе из HEIC). */
export const photoUrl = (id: string, size = 1600): string => `https://lh3.googleusercontent.com/d/${id}=s${size}`

/** Кадр под формат публикации: Google режет «умно» по центру интереса. */
export function cropUrl(id: string, aspect: '4:5' | '9:16'): string {
  return `https://lh3.googleusercontent.com/d/${id}=${aspect === '9:16' ? 'w1080-h1920' : 'w1080-h1350'}-p`
}

/** id папки из ссылки «drive.google.com/drive/folders/<id>?usp=…» (или сам id). */
export function folderIdFrom(input: string): string | null {
  const raw = input.trim()
  const m = /folders\/([\w-]{10,})/.exec(raw) ?? /[?&]id=([\w-]{10,})/.exec(raw) ?? /^([\w-]{20,})$/.exec(raw)
  return m?.[1] ?? null
}

// ─── Состояние ───────────────────────────────────────────────────────────────

export async function libraryState(db: Database): Promise<LibraryState | null> {
  try {
    const raw = JSON.parse(await getStringSetting(STATE_KEY, '', db)) as LibraryState
    return raw?.folderId ? raw : null
  } catch {
    return null
  }
}

async function saveState(db: Database, state: LibraryState | null): Promise<void> {
  const value = state ? JSON.stringify(state) : ''
  await db.insert(appSettings).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

async function patchState(db: Database, patch: Partial<LibraryState>): Promise<void> {
  const state = await libraryState(db)
  if (state) await saveState(db, { ...state, ...patch })
}

// ─── Обход папки ─────────────────────────────────────────────────────────────

interface DriveEntry {
  id: string
  folder: boolean
  title: string
  mime: string
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()

/** Содержимое публичной папки (страница встраивания Диска отдаёт все файлы без ключа). */
async function listFolder(id: string): Promise<{ title: string; entries: DriveEntry[] } | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
      if (res.status === 404) return null
      if (res.ok) {
        const html = await res.text()
        const entries = html.split('class="flip-entry" id="entry-').slice(1).map((b) => ({
          id: b.slice(0, b.indexOf('"')),
          folder: /drive\/folders\//.test(b),
          title: decode(/flip-entry-title">([^<]*)/.exec(b)?.[1] ?? ''),
          mime: /type\/([^"]+)"/.exec(b)?.[1] ?? '',
        }))
        return { title: decode(/<title>([^<]*)/.exec(html)?.[1] ?? ''), entries }
      }
    } catch {
      // сеть — пробуем ещё
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new SmmError('Google Диск не ответил — попробуйте позже', 502)
}

const kindOf = (mime: string): LibraryKind | null => (PHOTO_MIME.test(mime) ? 'photo' : VIDEO_MIME.test(mime) ? 'video' : null)

const syncing = new WeakSet<Database>()

/**
 * Обойти архив по названиям и обновить список альбомов и файлов. Описания и отметки
 * «использовано» у известных фото сохраняются; пропавшие с Диска — убираются, только
 * если обход прошёл целиком.
 */
export async function syncLibrary(db: Database): Promise<void> {
  const state = await libraryState(db)
  if (!state || syncing.has(db)) return
  syncing.add(db)
  const started = new Date().toISOString()
  let folders = 0
  let complete = true
  try {
    await patchState(db, { progress: step('Смотрю альбомы архива', 2, 95, 90), error: null })
    const queue: { id: string; parent: string | null; path: string; depth: number }[] = [{ id: state.folderId, parent: null, path: '', depth: 0 }]
    while (queue.length && folders < MAX_FOLDERS) {
      const item = queue.shift()!
      const listed = await listFolder(item.id).catch(() => null)
      if (!listed) {
        complete = false
        continue
      }
      folders += 1
      const own = listed.entries.filter((e) => !e.folder && kindOf(e.mime))
      const title = item.depth === 0 ? listed.title : (item.path.split(' / ').pop() ?? '')
      await db.execute(sql`
        INSERT INTO smm_library_folders (drive_id, parent_id, path, title, files, seen_at)
        VALUES (${item.id}, ${item.parent}, ${item.path}, ${title}, ${own.length}, now())
        ON CONFLICT (drive_id) DO UPDATE SET parent_id = EXCLUDED.parent_id, path = EXCLUDED.path, title = EXCLUDED.title, files = EXCLUDED.files, seen_at = now()
      `)
      if (own.length) {
        const values = sql.join(own.map((e) => sql`(${e.id}, ${item.id}, ${item.path}, ${e.title}, ${e.mime}, ${kindOf(e.mime)}, now())`), sql`, `)
        // Известные фото: описание и «вид» (шаблон, логотип) не трогаем.
        await db.execute(sql`
          INSERT INTO smm_library (drive_id, folder_id, path, name, mime, kind, seen_at) VALUES ${values}
          ON CONFLICT (drive_id) DO UPDATE SET folder_id = EXCLUDED.folder_id, path = EXCLUDED.path, name = EXCLUDED.name, mime = EXCLUDED.mime, seen_at = now()
        `)
      }
      if (item.depth < MAX_DEPTH) {
        for (const sub of listed.entries.filter((e) => e.folder)) {
          queue.push({ id: sub.id, parent: item.id, path: item.path ? `${item.path} / ${sub.title}` : sub.title, depth: item.depth + 1 })
        }
      }
      if (folders % 5 === 0) await patchState(db, { progress: step(`Смотрю альбомы архива: ${folders}`, Math.min(90, 2 + folders), 95, 60) })
    }
    if (complete && folders < MAX_FOLDERS) {
      await db.execute(sql`DELETE FROM smm_library WHERE seen_at < ${started}::timestamptz`)
      await db.execute(sql`DELETE FROM smm_library_folders WHERE seen_at < ${started}::timestamptz`)
    }
    await patchState(db, { syncedAt: new Date().toISOString(), progress: null, error: complete ? null : 'Часть альбомов не открылась — проверю завтра ещё раз' })
  } catch (error) {
    await patchState(db, { progress: null, error: error instanceof Error ? error.message.slice(0, 200) : 'Архив не обновился' })
  } finally {
    syncing.delete(db)
  }
}

/** Подключить архив по ссылке: папка должна открываться всем, у кого есть ссылка. */
export async function connectLibrary(db: Database, link: string): Promise<LibraryState> {
  const folderId = folderIdFrom(link)
  if (!folderId) throw new SmmError('Это не ссылка на папку Google Диска — скопируйте её через «Поделиться» → «Копировать ссылку»', 400)
  const listed = await listFolder(folderId)
  if (!listed || (!listed.entries.length && !listed.title)) {
    throw new SmmError('Папка не открылась. В Google Диске: «Поделиться» → «Все, у кого есть ссылка» → «Читатель», затем вставьте ссылку ещё раз', 400)
  }
  const state: LibraryState = {
    folderId,
    url: `https://drive.google.com/drive/folders/${folderId}`,
    title: listed.title || 'Фотоархив',
    connectedAt: new Date().toISOString(),
    syncedAt: null,
    error: null,
    progress: step('Смотрю альбомы архива', 2, 95, 90),
  }
  await saveState(db, state)
  void syncLibrary(db).catch((error) => console.error('[smm] архив', error))
  return state
}

/** Отключить: Tai перестаёт брать фото из архива. Описания остаются — вернётся без повторной работы. */
export async function disconnectLibrary(db: Database): Promise<void> {
  await saveState(db, null)
}

// ─── Поиск и выдача ──────────────────────────────────────────────────────────

const mapPhoto = (r: Record<string, unknown>): LibraryPhoto => ({
  id: String(r['drive_id']),
  path: String(r['path'] ?? ''),
  name: String(r['name'] ?? ''),
  kind: (r['kind'] as LibraryKind) ?? 'photo',
  description: String(r['description'] ?? ''),
  tags: String(r['tags'] ?? ''),
  people: r['people'] == null ? null : Number(r['people']),
  quality: r['quality'] == null ? null : Number(r['quality']),
  orientation: r['orientation'] == null ? null : String(r['orientation']),
  usedCount: Number(r['used_count'] ?? 0),
  thumb: photoUrl(String(r['drive_id']), 400),
})

/** Слова запроса для полнотекстового поиска: «турнир | игрок | ведущий …». */
function orQuery(text: string): string {
  const words = [...new Set((text.toLowerCase().match(/[a-zа-яё0-9]{3,}/gi) ?? []).map((w) => w.replace(/ё/g, 'е')))]
  return words.slice(0, 40).join(' | ')
}

/**
 * Найти фото по смыслу: по описанию, тегам и названию альбома. Сначала лучшие по
 * совпадению и качеству, реже использованные; не больше `perAlbum` из одного альбома.
 */
export async function searchLibrary(db: Database, text: string, opts: { limit?: number; kinds?: LibraryKind[]; perAlbum?: number; minQuality?: number } = {}): Promise<LibraryPhoto[]> {
  const limit = opts.limit ?? 18
  const kinds = opts.kinds ?? ['photo']
  const query = orQuery(text)
  if (!query) return []
  const found = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM (
      SELECT *, ts_rank(search, to_tsquery('russian', ${query})) AS rank FROM smm_library
      WHERE kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        AND description <> '' AND coalesce(quality, 3) >= ${opts.minQuality ?? 3}
        AND search @@ to_tsquery('russian', ${query})
    ) found
    ORDER BY rank * (1 + coalesce(quality, 3) * 0.15) / (1 + used_count * 0.5) DESC
    LIMIT ${limit * 6}
  `).catch((error) => {
    console.warn('[smm] поиск по архиву', error instanceof Error ? error.message : error)
    return []
  }))
  const perAlbum = opts.perAlbum ?? 3
  const byAlbum = new Map<string, number>()
  const out: LibraryPhoto[] = []
  for (const r of found) {
    const album = String(r['folder_id'] ?? '')
    if ((byAlbum.get(album) ?? 0) >= perAlbum) continue
    byAlbum.set(album, (byAlbum.get(album) ?? 0) + 1)
    out.push(mapPhoto(r))
    if (out.length >= limit) break
  }
  return out
}

/** Фото архива по id (для выбора Tai и добавления вручную). */
export async function libraryPhotos(db: Database, ids: string[]): Promise<LibraryPhoto[]> {
  if (!ids.length) return []
  return rows<Record<string, unknown>>(await db.execute(sql`SELECT * FROM smm_library WHERE drive_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)).map(mapPhoto)
}

/** Несколько файлов вида (шаблоны сторис, логотипы) — опора для фирменного стиля. */
export async function libraryOfKind(db: Database, kind: LibraryKind, limit: number): Promise<LibraryPhoto[]> {
  if (!(await libraryState(db))) return []
  return rows<Record<string, unknown>>(await db.execute(sql`
    SELECT * FROM smm_library WHERE kind = ${kind} ORDER BY coalesce(quality, 3) DESC, random() LIMIT ${limit}
  `)).map(mapPhoto)
}

export async function markUsed(db: Database, ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.execute(sql`UPDATE smm_library SET used_count = used_count + 1, last_used_at = now() WHERE drive_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
}

export async function libraryAlbums(db: Database): Promise<LibraryAlbum[]> {
  return rows<Record<string, unknown>>(await db.execute(sql`
    SELECT f.drive_id, f.path, f.title, f.kind, f.about, f.files,
      (SELECT count(*) FROM smm_library l WHERE l.folder_id = f.drive_id AND l.description <> '')::int AS described,
      (SELECT l.drive_id FROM smm_library l WHERE l.folder_id = f.drive_id AND l.kind <> 'video' ORDER BY coalesce(l.quality, 0) DESC, l.name LIMIT 1) AS cover
    FROM smm_library_folders f WHERE f.files > 0 ORDER BY f.path
  `)).map((r) => ({
    id: String(r['drive_id']),
    path: String(r['path'] ?? ''),
    title: String(r['title'] ?? ''),
    kind: String(r['kind'] ?? 'photos'),
    about: String(r['about'] ?? ''),
    files: Number(r['files'] ?? 0),
    described: Number(r['described'] ?? 0),
    cover: r['cover'] ? photoUrl(String(r['cover']), 400) : null,
  }))
}

export async function albumPhotos(db: Database, folderId: string): Promise<LibraryPhoto[]> {
  return rows<Record<string, unknown>>(await db.execute(sql`SELECT * FROM smm_library WHERE folder_id = ${folderId} ORDER BY name LIMIT 2000`)).map(mapPhoto)
}

export async function libraryCounts(db: Database): Promise<{ albums: number; files: number; described: number }> {
  const [r] = rows<Record<string, number>>(await db.execute(sql`
    SELECT (SELECT count(*) FROM smm_library_folders WHERE files > 0)::int AS albums,
      count(*)::int AS files, count(*) FILTER (WHERE description <> '')::int AS described
    FROM smm_library
  `))
  return { albums: Number(r?.albums ?? 0), files: Number(r?.files ?? 0), described: Number(r?.described ?? 0) }
}

/** Строка для промпта: найденные фото архива под кодами Ф1, Ф2… */
export function archiveLine(photos: LibraryPhoto[]): string {
  if (!photos.length) return ''
  return [
    'Фотоархив клуба — настоящие фото (код: альбом — что на фото):',
    ...photos.map((p, i) => `Ф${i + 1}: ${p.path.split(' / ').slice(-2).join(' / ')} — ${p.description}${p.people ? ` (людей: ${p.people})` : ''}`),
  ].join('\n')
}

/** Кандидаты из архива под публикацию: тема, идея, визуал, направление и формат. */
export async function archiveCandidates(db: Database, post: { topic: string; brief: string; visual: string; direction: string | null; format: SmmFormat }, limit = 16): Promise<LibraryPhoto[]> {
  if (!(await libraryState(db))) return []
  const direction = DIRECTIONS.find((d) => d.key === post.direction)
  const text = [post.topic, post.brief, post.visual, direction?.key ?? '', direction?.label ?? ''].join(' ')
  return searchLibrary(db, text, { limit })
}

// ─── Описание новых фото ─────────────────────────────────────────────────────

const DescribeSchema = z.object({
  items: z.array(z.object({
    n: z.number().int(),
    description: z.string().min(3).max(300),
    tags: z.string().max(200).optional(),
    people: z.number().int().min(0).max(200).nullable().optional(),
    quality: z.number().int().min(1).max(5).nullable().optional(),
    orientation: z.enum(['portrait', 'landscape', 'square']).nullable().optional(),
  })),
})

async function thumbPart(id: string): Promise<ChatPart | null> {
  try {
    const res = await fetch(photoUrl(id, 512), { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}` } }
  } catch {
    return null
  }
}

/** Описать новые фото архива (по превью, пачками). Возвращает, сколько описано. */
export async function describePending(db: Database, limit = DESCRIBE_PER_RUN): Promise<number> {
  if (!(await libraryState(db))) return 0
  const pending = rows<{ drive_id: string; path: string }>(await db.execute(sql`
    SELECT drive_id, path FROM smm_library WHERE description = '' AND kind IN ('photo', 'template', 'logo', 'design')
    ORDER BY seen_at DESC LIMIT ${limit}
  `))
  let described = 0
  for (let i = 0; i < pending.length; i += DESCRIBE_BATCH) {
    const batch = pending.slice(i, i + DESCRIBE_BATCH)
    const parts = await Promise.all(batch.map((p) => thumbPart(p.drive_id)))
    const content: ChatPart[] = [{
      type: 'text',
      text: [
        'Это фото из архива клуба спортивной мафии (игры, турниры, вечеринки, фотосессии). Опиши каждое для поиска — по-русски, конкретно: кто и что в кадре, эмоция, обстановка.',
        `Альбомы: ${[...new Set(batch.map((p) => p.path))].join('; ')}.`,
        `Теги — ключи направлений (${DIRECTIONS.map((d) => d.key).join(', ')}) и сцены словами: турнир, игроки, ведущий, стол, маски, карты, награждение, кубок, портрет, группа, смех, эмоции, интерьер, бар, вечеринка, костюмы, новый год, хэллоуин, дети, улица.`,
        'Качество 1–5: годится ли кадр в соцсети (резкость, свет, композиция, лица). Ответ — JSON: {"items": [{"n": номер фото, "description": "1–2 фразы", "tags": "через пробел", "people": число, "quality": 1–5, "orientation": "portrait|landscape|square"}]}',
      ].join('\n'),
    }]
    batch.forEach((_, k) => {
      const part = parts[k]
      if (!part) return
      content.push({ type: 'text', text: `Фото ${k + 1}:` }, part)
    })
    if (content.length === 1) continue
    try {
      const r = await chatJson(db, { kind: 'vision', note: 'описание архива', maxTokens: 1500, temperature: 0.2, schema: DescribeSchema, system: 'Ты описываешь фото для поиска по архиву. Только то, что видно. Ответ — один JSON.', user: content })
      for (const item of r.items) {
        const photo = batch[item.n - 1]
        if (!photo) continue
        await db.execute(sql`
          UPDATE smm_library SET description = ${item.description}, tags = ${item.tags ?? ''}, people = ${item.people ?? null}, quality = ${item.quality ?? null},
            orientation = ${item.orientation ?? null}, described_at = now()
          WHERE drive_id = ${photo.drive_id}
        `)
        described += 1
      }
    } catch (error) {
      console.warn('[smm] описание архива', error instanceof Error ? error.message : error)
      break
    }
  }
  return described
}
