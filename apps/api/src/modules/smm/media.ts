/**
 * Визуал публикаций: картинки нейросети (Nano Banana 2.1 с фото клуба как
 * референсами), фото из архива клуба (как есть — кадр под формат; поправить; новое
 * по мотивам), видео (Veo 3.1 Fast — задача на минуты, доводит крон) и свои фото и
 * видео с телефона. Всё хранится у нас в MinIO: ссылка нейросети живёт 7 дней.
 */
import { sql, type Database } from '@titan/database'
import { readStoredMedia, storeMediaBuffer, storeRemoteMedia } from '../../lib/imageStore.js'
import { generateImage, pollVideo, startVideo } from './ai.js'
import { insertMedia, loadPost, nextSort, pendingMedia, rows, setPostProgress, unselectSlot, updateMedia, updatePost } from './db.js'
import { cropUrl, libraryOfKind, libraryPhotos, markUsed, photoUrl, type LibraryPhoto } from './library.js'
import { aspectFor, SmmError, step, type SmmPost } from './types.js'

const VIDEO_GIVE_UP_MS = 40 * 60_000
/** Примерно столько рисуется одна картинка — для шкалы готовности. */
const IMAGE_ETA_SEC = 30
const STYLE_REFS = 2

export interface ClubPhoto {
  index: number
  id: string
  title: string
  kind: string
  url: string
}

/** Фото клуба (интерьер, логотип) и логотипы из архива — нумерованный список для промпта. */
export async function clubPhotos(db: Database): Promise<ClubPhoto[]> {
  const own = rows<Record<string, unknown>>(await db.execute(sql`SELECT id, url, title, kind FROM smm_assets ORDER BY created_at LIMIT 24`))
  const logos = await libraryOfKind(db, 'logo', 2).catch(() => [])
  const list = [
    ...own.map((r) => ({ id: String(r['id']), url: String(r['url']), title: String(r['title'] || 'фото клуба'), kind: String(r['kind'] ?? 'photo') })),
    ...logos.map((l) => ({ id: l.id, url: photoUrl(l.id, 1200), title: l.description || 'логотип клуба', kind: 'logo' })),
  ]
  return list.map((p, i) => ({ ...p, index: i + 1 }))
}

export const photosLine = (photos: ClubPhoto[]): string =>
  photos.length ? `Фото клуба (можно взять как опору для картинки — укажи номера в refs): ${photos.map((p) => `${p.index}) ${p.kind === 'logo' ? 'логотип' : p.title}`).join('; ')}.` : ''

export type ArchiveMode = 'as_is' | 'edit' | 'inspire'

export interface ImageJob {
  prompt: string
  sort: number
  refs?: number[]
  /** Фото из архива: как есть, поправить или новое по мотивам. */
  photo?: LibraryPhoto
  mode?: ArchiveMode
}

const EDIT_PREFIX = 'Отредактируй настоящее фото клуба (первое изображение). Сохрани людей, лица, позы и обстановку такими, как есть, ничего не выдумывай вместо них. Правки: '
const INSPIRE_PREFIX = 'Новая картинка по мотивам настоящего фото клуба (первое изображение): те же люди, место и настроение, новая сцена и композиция. '

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
async function imageInto(db: Database, post: Pick<SmmPost, 'id' | 'format'>, job: ImageJob, photos: ClubPhoto[], styleRefs: string[]): Promise<void> {
  if (job.photo && job.mode === 'as_is') return archiveInto(db, post, job.photo, job.sort)
  const aspect = aspectFor(post.format)
  const own = (job.refs ?? []).map((n) => photos.find((p) => p.index === n)?.url).filter((u): u is string => !!u)
  const references = [...(job.photo ? [photoUrl(job.photo.id, 1600)] : []), ...own, ...styleRefs].slice(0, 6)
  const prompt = job.photo ? `${job.mode === 'edit' ? EDIT_PREFIX : INSPIRE_PREFIX}${job.prompt}` : job.prompt
  const mediaId = await insertMedia(db, { postId: post.id, kind: 'image', source: 'ai', status: 'pending', aspect, prompt, sort: job.sort })
  try {
    const generated = await generateImage(db, { prompt, aspect, references, note: `пост ${post.id}` })
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
 * Сторис рисуются в стиле фирменных шаблонов из архива. Хоть одна получилась — успех;
 * иначе бросаем последнюю ошибку.
 */
export async function generateImages(db: Database, post: Pick<SmmPost, 'id' | 'format'>, jobs: ImageJob[], range: { from: number; to: number } = { from: 5, to: 95 }): Promise<void> {
  const photos = await clubPhotos(db)
  const templates = post.format === 'story' ? await libraryOfKind(db, 'template', STYLE_REFS).catch(() => []) : []
  const styleRefs = templates.map((t) => photoUrl(t.id, 1200))
  const styled = styleRefs.length ? jobs.map((j) => (j.photo && j.mode === 'as_is' ? j : { ...j, prompt: `${j.prompt}\nФирменный стиль сторис клуба — как на последних референсах-шаблонах (цвета, шрифты, расположение), но свежее и современнее.` })) : jobs
  let lastError: unknown = null
  let done = 0
  let finished = 0
  const label = (n: number) => (jobs.length > 1 ? `Рисую картинки: ${n} из ${jobs.length}` : 'Рисую картинку')
  const span = range.to - range.from
  for (let i = 0; i < styled.length; i += IMAGE_CONCURRENCY) {
    const chunk = styled.slice(i, i + IMAGE_CONCURRENCY)
    const at = range.from + Math.round((span * finished) / jobs.length)
    const next = range.from + Math.round((span * (finished + chunk.length)) / jobs.length)
    await setPostProgress(db, post.id, step(label(finished), at, next, IMAGE_ETA_SEC))
    const results = await Promise.allSettled(chunk.map((job) => imageInto(db, post, job, photos, styleRefs)))
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

/** Запустить видео (сторис/рилс/пост). Готовое подхватит крон — pollVideos. */
export async function startPostVideo(db: Database, post: SmmPost, prompt: string): Promise<void> {
  // Veo умеет только 16:9 и 9:16; соцсети клуба смотрят с телефона — всегда вертикаль.
  const aspect = '9:16' as const
  const photo = post.media.find((m) => m.kind === 'image' && m.status === 'done' && m.url)
  const { polzaId, model } = await startVideo(db, { prompt, aspect, references: photo?.url ? [photo.url] : [] })
  await insertMedia(db, { postId: post.id, kind: 'video', source: 'ai', status: 'pending', aspect, prompt, model, polzaId, sort: await nextSort(db, post.id) })
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
  await insertMedia(db, {
    postId,
    kind: stored.mime?.startsWith('video/') ? 'video' : 'image',
    source: 'upload',
    status: 'done',
    url: stored.url,
    sort: await nextSort(db, postId),
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
