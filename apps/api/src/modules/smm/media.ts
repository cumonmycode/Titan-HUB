/**
 * Визуал публикаций: картинки нейросети (Nano Banana 2.1 с фото клуба как
 * референсами), видео (Veo 3.1 Fast — задача на минуты, доводит крон) и свои фото
 * и видео с телефона. Всё хранится у нас в MinIO: ссылка нейросети живёт 7 дней.
 */
import { sql, type Database } from '@titan/database'
import { readStoredMedia, storeMediaBuffer, storeRemoteMedia } from '../../lib/imageStore.js'
import { generateImage, pollVideo, startVideo } from './ai.js'
import { insertMedia, loadPost, pendingMedia, rows, unselectSlot, updateMedia, updatePost } from './db.js'
import { aspectFor, SmmError, type SmmPost } from './types.js'

const VIDEO_GIVE_UP_MS = 40 * 60_000

export interface ClubPhoto {
  index: number
  id: string
  title: string
  kind: string
  url: string
}

/** Фото клуба (интерьер, логотип) — нумерованный список для промпта. */
export async function clubPhotos(db: Database): Promise<ClubPhoto[]> {
  const list = rows<Record<string, unknown>>(await db.execute(sql`SELECT id, url, title, kind FROM smm_assets ORDER BY created_at LIMIT 24`))
  return list.map((r, i) => ({ index: i + 1, id: String(r['id']), url: String(r['url']), title: String(r['title'] || 'фото клуба'), kind: String(r['kind'] ?? 'photo') }))
}

export const photosLine = (photos: ClubPhoto[]): string =>
  photos.length ? `Фото клуба (можно взять как опору для картинки — укажи номера в refs): ${photos.map((p) => `${p.index}) ${p.kind === 'logo' ? 'логотип' : p.title}`).join('; ')}.` : ''

export interface ImageJob {
  prompt: string
  sort: number
  refs?: number[]
}

/** Сгенерировать картинку в позицию sort (карусель — несколько позиций); прежний вариант позиции снимается. */
async function imageInto(db: Database, post: Pick<SmmPost, 'id' | 'format'>, job: ImageJob, photos: ClubPhoto[]): Promise<void> {
  const aspect = aspectFor(post.format)
  const references = (job.refs ?? []).map((n) => photos.find((p) => p.index === n)?.url).filter((u): u is string => !!u).slice(0, 4)
  const mediaId = await insertMedia(db, { postId: post.id, kind: 'image', source: 'ai', status: 'pending', aspect, prompt: job.prompt, sort: job.sort })
  try {
    const generated = await generateImage(db, { prompt: job.prompt, aspect, references, note: `пост ${post.id}` })
    const stored = await storeRemoteMedia(generated.url)
    if (!stored.ok) throw new SmmError(stored.error, 502)
    await db.execute(sql`UPDATE smm_media SET model = ${generated.model} WHERE id = ${mediaId}::uuid`)
    await updateMedia(db, mediaId, { status: 'done', url: stored.url, costRub: generated.cost, error: null })
    await unselectSlot(db, post.id, 'image', job.sort, mediaId)
  } catch (error) {
    await updateMedia(db, mediaId, { status: 'failed', error: error instanceof Error ? error.message.slice(0, 200) : 'ошибка', selected: false })
    throw error
  }
}

/** Сколько картинок генерировать одновременно (карусель — до 8 слайдов). */
const IMAGE_CONCURRENCY = 3

/** Картинки поста пачками по три. Хоть одна получилась — успех; иначе бросаем последнюю ошибку. */
export async function generateImages(db: Database, post: Pick<SmmPost, 'id' | 'format'>, jobs: ImageJob[]): Promise<void> {
  const photos = await clubPhotos(db)
  let lastError: unknown = null
  let done = 0
  for (let i = 0; i < jobs.length; i += IMAGE_CONCURRENCY) {
    const results = await Promise.allSettled(jobs.slice(i, i + IMAGE_CONCURRENCY).map((job) => imageInto(db, post, job, photos)))
    for (const r of results) {
      if (r.status === 'fulfilled') done += 1
      else lastError = r.reason
    }
    if (lastError instanceof SmmError && lastError.status === 402) break
  }
  if (!done && lastError) throw lastError
}

/** Новый вариант одной картинки (по умолчанию — первой) по её же или новому промпту. */
export async function regenerateImage(db: Database, postId: string, opts: { mediaId?: string; prompt?: string }): Promise<void> {
  const post = await loadPost(db, postId, true)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  const images = post.media.filter((m) => m.kind === 'image')
  const target = opts.mediaId ? images.find((m) => m.id === opts.mediaId) : images.find((m) => m.selected) ?? images[0]
  const prompt = opts.prompt?.trim() || target?.prompt || post.visual
  if (!prompt) throw new SmmError('Нечего рисовать — опишите картинку', 400)
  await generateImages(db, post, [{ prompt, sort: target?.sort ?? 0 }])
}

/** Запустить видео (сторис/рилс/пост). Готовое подхватит крон — pollVideos. */
export async function startPostVideo(db: Database, post: SmmPost, prompt: string): Promise<void> {
  // Veo умеет только 16:9 и 9:16; соцсети клуба смотрят с телефона — всегда вертикаль.
  const aspect = '9:16' as const
  const photo = post.media.find((m) => m.kind === 'image' && m.status === 'done' && m.url)
  const { polzaId, model } = await startVideo(db, { prompt, aspect, references: photo?.url ? [photo.url] : [] })
  const sort = post.media.reduce((max, m) => Math.max(max, m.sort), -1) + 1
  await insertMedia(db, { postId: post.id, kind: 'video', source: 'ai', status: 'pending', aspect, prompt, model, polzaId, sort })
}

/** Довести видео, которые делает нейросеть: готовое — к себе, зависшее — в ошибку. */
export async function pollVideos(db: Database): Promise<string[]> {
  const finished: string[] = []
  for (const job of await pendingMedia(db)) {
    try {
      const state = await pollVideo(db, job.polzaId)
      if (state.status === 'pending') {
        if (Date.now() - Date.parse(job.createdAt) > VIDEO_GIVE_UP_MS) {
          await updateMedia(db, job.id, { status: 'failed', error: 'нейросеть не успела за 40 минут', selected: false })
          finished.push(job.postId)
        }
        continue
      }
      if (state.status === 'failed') {
        await updateMedia(db, job.id, { status: 'failed', error: state.error, selected: false })
      } else {
        const stored = await storeRemoteMedia(state.url, 300_000)
        if (stored.ok) await updateMedia(db, job.id, { status: 'done', url: stored.url, costRub: state.cost, error: null })
        else await updateMedia(db, job.id, { status: 'failed', error: stored.error, selected: false })
      }
      finished.push(job.postId)
      await updatePost(db, job.postId, { busy: null })
    } catch (error) {
      console.warn('[smm] опрос видео', job.polzaId, error instanceof Error ? error.message : error)
    }
  }
  return finished
}

/** Свой файл с телефона: фото или видео, встаёт последним. */
export async function addUpload(db: Database, postId: string, buffer: Buffer): Promise<void> {
  const stored = await storeMediaBuffer(buffer)
  if (!stored.ok) throw new SmmError(stored.error, 400)
  const [row] = rows<{ next: number }>(await db.execute(sql`SELECT coalesce(max(sort), -1) + 1 AS next FROM smm_media WHERE post_id = ${postId}::uuid`))
  await insertMedia(db, {
    postId,
    kind: stored.mime?.startsWith('video/') ? 'video' : 'image',
    source: 'upload',
    status: 'done',
    url: stored.url,
    sort: Number(row?.next ?? 0),
  })
}

/** Фото клуба для референсов: загрузка файла. */
export async function addClubPhoto(db: Database, buffer: Buffer, title: string, kind: 'photo' | 'logo'): Promise<void> {
  const stored = await storeMediaBuffer(buffer)
  if (!stored.ok) throw new SmmError(stored.error, 400)
  if (stored.mime?.startsWith('video/')) throw new SmmError('Нужна картинка, не видео', 400)
  await db.execute(sql`INSERT INTO smm_assets (url, title, kind) VALUES (${stored.url}, ${title.slice(0, 80)}, ${kind})`)
}

export { readStoredMedia }
