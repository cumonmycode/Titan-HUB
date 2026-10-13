/**
 * Визуал публикаций: картинки нейросети (Nano Banana 2.1, 1K), фото из архива клуба
 * (как есть — кадр под формат; поправить; новое по мотивам), видео (video.ts — Veo,
 * задача на минуты, доводит крон) и свои фото и видео с телефона. Всё хранится у нас
 * в MinIO: ссылка нейросети живёт 7 дней.
 *
 * Сцена в нашем клубе — только когда её требует сюжет: тогда в референсы идут настоящие
 * фото зоны (вход, кабинки, зал…). Старые шаблоны сторис из архива Tai не использует.
 */
import { sql, type Database } from '@titan/database'
import { readStoredMedia, storeMediaBuffer, storeRemoteMedia } from '../../lib/imageStore.js'
import { generateImage, pollVideo } from './ai.js'
import { insertMedia, loadPost, nextSort, pendingMedia, setPostProgress, unselectSlot, updateMedia, updatePost } from './db.js'
import { zoneRefs } from './interior.js'
import { zoneDescription, type Zone } from './knowledge.js'
import { cropUrl, libraryOfKind, libraryPhotos, markUsed, photoUrl, type LibraryPhoto } from './library.js'
import { aspectFor, SmmError, step, type SmmPost } from './types.js'

const VIDEO_GIVE_UP_MS = 40 * 60_000
/** Примерно столько рисуется одна картинка — для шкалы готовности. */
const IMAGE_ETA_SEC = 25
const MAX_REFS = 6

/** Логотип клуба из архива — опора, когда на картинке нужен логотип. */
export async function clubLogo(db: Database): Promise<string | null> {
  const [logo] = await libraryOfKind(db, 'logo', 1).catch(() => [])
  return logo ? photoUrl(logo.id, 1200) : null
}

export type ArchiveMode = 'as_is' | 'edit' | 'inspire'

export interface ImageJob {
  prompt: string
  sort: number
  /** Зона клуба, если сцена по сюжету у нас: её фото — в референсы, описание — в промпт. */
  zone?: Zone
  /** Нужен логотип клуба на картинке. */
  logo?: boolean
  /** Фото из архива: как есть, поправить или новое по мотивам. */
  photo?: LibraryPhoto
  mode?: ArchiveMode
}

const EDIT_PREFIX = 'Отредактируй настоящее фото клуба (первое изображение). Сохрани людей, лица, позы и обстановку такими, как есть, ничего не выдумывай вместо них. Правки: '
const INSPIRE_PREFIX = 'Новая картинка по мотивам настоящего фото клуба (первое изображение): те же люди, место и настроение, новая сцена и композиция. '

function zonePrefix(zone: Zone): string {
  const photos = zone.photos.length ? ' (референсы — его фото с разных ракурсов): сохрани планировку, мебель, цвета и свет как на фото, ничего не выдумывай вместо них' : ''
  return `Место — настоящее помещение клуба «${zone.title}»${photos}. ${zoneDescription(zone).slice(0, 600)}\nСцена: `
}

/** Положить фото архива в публикацию как есть: Google отдаёт кадр под формат. */
async function archiveInto(db: Database, post: Pick<SmmPost, 'id' | 'format'>, photo: LibraryPhoto, sort: number): Promise<void> {
  const aspect = aspectFor(post.format)
  const mediaId = await insertMedia(db, { postId: post.id, kind: 'image', source: 'archive', status: 'pending', aspect, prompt: photo.description || photo.name, model: 'google-drive', sort })
  const stored = await storeRemoteMedia(cropUrl(photo.id, aspect), 60_000)
  if (!stored.ok) {
    await updateMedia(db, mediaId, { status: 'failed', error: stored.error, selected: false })
    throw new SmmError(`Фото из архива не скачалось: ${stored.error}`, 502)
  }
  await updateMedia(db, mediaId, { status: 'done', url: stored.url, error: null })
  await unselectSlot(db, post.id, 'image', sort, mediaId)
}

/** Сгенерировать картинку в позицию sort (карусель — несколько позиций); прежний вариант позиции снимается. */
async function imageInto(db: Database, post: Pick<SmmPost, 'id' | 'format'>, job: ImageJob, logo: string | null): Promise<void> {
  if (job.photo && job.mode === 'as_is') return archiveInto(db, post, job.photo, job.sort)
  const aspect = aspectFor(post.format)
  const references = [
    ...(job.photo ? [photoUrl(job.photo.id, 1600)] : []),
    ...zoneRefs(job.zone),
    ...(job.logo && logo ? [logo] : []),
  ].slice(0, MAX_REFS)
  const base = job.zone && !job.photo ? `${zonePrefix(job.zone)}${job.prompt}` : job.prompt
  const prompt = job.photo ? `${job.mode === 'edit' ? EDIT_PREFIX : INSPIRE_PREFIX}${base}` : base
  const withLogo = job.logo && logo ? `${prompt}\nЛоготип клуба — как на последнем референсе, без искажений.` : prompt
  const mediaId = await insertMedia(db, { postId: post.id, kind: 'image', source: 'ai', status: 'pending', aspect, prompt: withLogo, sort: job.sort })
  try {
    const generated = await generateImage(db, { prompt: withLogo, aspect, references, note: `пост ${post.id}` })
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

/**
 * Картинки поста пачками по три; шкала готовности идёт от `from` до `to` процентов.
 * Хоть одна получилась — успех; иначе бросаем последнюю ошибку.
 */
export async function generateImages(db: Database, post: Pick<SmmPost, 'id' | 'format'>, jobs: ImageJob[], range: { from: number; to: number } = { from: 5, to: 95 }): Promise<void> {
  const logo = jobs.some((j) => j.logo) ? await clubLogo(db) : null
  let lastError: unknown = null
  let done = 0
  let finished = 0
  const label = (n: number) => (jobs.length > 1 ? `Рисую картинки: ${n} из ${jobs.length}` : 'Рисую картинку')
  const span = range.to - range.from
  for (let i = 0; i < jobs.length; i += IMAGE_CONCURRENCY) {
    const chunk = jobs.slice(i, i + IMAGE_CONCURRENCY)
    const at = range.from + Math.round((span * finished) / jobs.length)
    const next = range.from + Math.round((span * (finished + chunk.length)) / jobs.length)
    await setPostProgress(db, post.id, step(label(finished), at, next, IMAGE_ETA_SEC))
    const results = await Promise.allSettled(chunk.map((job) => imageInto(db, post, job, logo)))
    for (const r of results) {
      finished += 1
      if (r.status === 'fulfilled') done += 1
      else lastError = r.reason
    }
    if (lastError instanceof SmmError && lastError.status === 402) break
  }
  await markUsed(db, jobs.map((j) => j.photo?.id).filter((id): id is string => !!id)).catch(() => undefined)
  if (!done && lastError) throw lastError
}

/** Новый вариант одной картинки (по умолчанию — первой) по её же или новому промпту. */
export async function regenerateImage(db: Database, postId: string, opts: { mediaId?: string; prompt?: string }): Promise<void> {
  const post = await loadPost(db, postId, true)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  const images = post.media.filter((m) => m.kind === 'image')
  const target = opts.mediaId ? images.find((m) => m.id === opts.mediaId) : images.find((m) => m.selected) ?? images[0]
  const prompt = opts.prompt?.trim() || (target?.source === 'ai' ? target.prompt : null) || post.visual
  if (!prompt) throw new SmmError('Нечего рисовать — опишите картинку', 400)
  await generateImages(db, post, [{ prompt, sort: target?.sort ?? 0 }])
}

/** Фото из архива — в публикацию вручную: встаёт последним (или заменяет позицию). */
export async function addArchivePhoto(db: Database, postId: string, photoId: string, sort?: number): Promise<void> {
  const post = await loadPost(db, postId)
  if (!post) throw new SmmError('Публикация не найдена', 404)
  const [photo] = await libraryPhotos(db, [photoId])
  if (!photo) throw new SmmError('Фото нет в архиве', 404)
  await archiveInto(db, post, photo, sort ?? (await nextSort(db, postId)))
  await markUsed(db, [photo.id])
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
          await updatePost(db, job.postId, { busy: null, error: 'Видео не получилось: нейросеть не успела за 40 минут' })
          finished.push(job.postId)
        }
        continue
      }
      if (state.status === 'failed') {
        await updateMedia(db, job.id, { status: 'failed', error: state.error, selected: false })
        await updatePost(db, job.postId, { busy: null, error: `Видео не получилось: ${state.error}`.slice(0, 300) })
      } else {
        const stored = await storeRemoteMedia(state.url, 300_000)
        if (stored.ok) await updateMedia(db, job.id, { status: 'done', url: stored.url, costRub: state.cost, error: null })
        else await updateMedia(db, job.id, { status: 'failed', error: stored.error, selected: false })
        await updatePost(db, job.postId, { busy: null })
      }
      finished.push(job.postId)
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
  await insertMedia(db, {
    postId,
    kind: stored.mime?.startsWith('video/') ? 'video' : 'image',
    source: 'upload',
    status: 'done',
    url: stored.url,
    sort: await nextSort(db, postId),
  })
}

export { readStoredMedia }
