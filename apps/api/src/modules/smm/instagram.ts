/**
 * Instagram API (вход через Instagram, graph.instagram.com) — официально.
 *
 * Владелец создаёт приложение Meta, добавляет свой профессиональный аккаунт и жмёт
 * «Generate token» в кабинете: ключ живёт 60 дней. Ключ вставляют в HUB — Tai хранит
 * его зашифрованным (integrations.ig_access_token) и сам продлевает заранее.
 *
 * Что даёт: подписчики, вышедшие публикации со ссылками и метриками (views, reach,
 * likes, comments, saved, shares) и публикация поста, карусели, рилс и сторис.
 * Картинки — только JPEG; файлы Meta забирает по публичной ссылке через Worker.
 */
import { appSettings, integrations, sql, type Database } from '@titan/database'
import { getStringSetting } from '../../lib/appSettings.js'
import { readStoredMedia } from '../../lib/imageStore.js'
import { encryptSecret, getClubIntegration } from '../../lib/secrets.js'
import { publicMediaUrl, webFetch } from './relay.js'
import { plainText } from './telegram.js'
import { SmmError, type SmmMedia, type SmmPost } from './types.js'

const GRAPH = 'https://graph.instagram.com/v25.0'
const TOKEN_KEY = 'ig_access_token'
const STATE_KEY = 'smm_instagram'
const TOKEN_TTL_MS = 60 * 86_400_000
/** Продлеваем, когда до конца меньше 20 дней (продлить можно не раньше чем через сутки после выдачи). */
const REFRESH_BEFORE_MS = 20 * 86_400_000
const CAROUSEL_MAX = 10
const POLL_MS = 5_000
const IMAGE_WAIT_MS = 90_000
const VIDEO_WAIT_MS = 300_000

export interface InstagramState {
  userId: string
  username: string
  name: string | null
  accountType: string | null
  tokenSetAt: string
  expiresAt: string
  error: string | null
}

export async function instagramState(db: Database): Promise<InstagramState | null> {
  try {
    const raw = JSON.parse(await getStringSetting(STATE_KEY, '', db)) as InstagramState
    return raw?.userId ? raw : null
  } catch {
    return null
  }
}

async function saveState(db: Database, state: InstagramState | null): Promise<void> {
  const value = state ? JSON.stringify(state) : ''
  await db.insert(appSettings).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
}

async function saveToken(db: Database, token: string, userId: string | null): Promise<void> {
  const valueEnc = encryptSecret(token)
  await db.insert(integrations).values({ key: TOKEN_KEY, valueEnc, updatedBy: userId }).onConflictDoUpdate({ target: integrations.key, set: { valueEnc, updatedAt: new Date(), updatedBy: userId } })
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } }

function graphFailure(status: number, body: GraphError): SmmError {
  const code = body.error?.code
  const message = body.error?.message ?? `HTTP ${status}`
  console.warn('[smm] instagram', status, code, message.slice(0, 200))
  if (code === 190) return new SmmError('Ключ Instagram недействителен или истёк — вставьте новый в настройках СММ', 400)
  if (code === 10 || code === 200) return new SmmError('У ключа Instagram нет нужных прав — выдайте доступ к публикации и статистике', 400)
  if (code === 4 || code === 17 || code === 32 || code === 613) return new SmmError('Instagram просит подождать — слишком много запросов', 502)
  if (code === 9 || /limit/i.test(message)) return new SmmError('Достигнут лимит публикаций Instagram за сутки', 502)
  return new SmmError(`Instagram не принял запрос: ${message.slice(0, 160)}`, 502)
}

async function graph<T>(token: string, path: string, params: Record<string, string | number | boolean | undefined> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v))
  query.set('access_token', token)
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`
  let res: Response
  try {
    res = method === 'GET'
      ? await webFetch(`${url}?${query.toString()}`, { timeoutMs: 30_000 })
      : await webFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: query.toString(), timeoutMs: 60_000 })
  } catch {
    throw new SmmError('Нет связи с Instagram — попробуйте позже', 502)
  }
  const data = (await res.json().catch(() => ({}))) as T & GraphError
  if (!res.ok || data.error) throw graphFailure(res.status, data)
  return data
}

async function token(db: Database): Promise<string> {
  const value = await getClubIntegration(db, TOKEN_KEY).catch(() => null)
  if (!value) throw new SmmError('Instagram не подключён — вставьте ключ в настройках СММ', 400)
  return value
}

type Me = { user_id?: string; id?: string; username: string; name?: string; account_type?: string; followers_count?: number; media_count?: number }

/** Проверить ключ и подключить аккаунт: площадка Instagram в СММ становится «публикует Tai». */
export async function connectInstagram(db: Database, rawToken: string, userId: string | null): Promise<InstagramState> {
  const value = rawToken.trim().replace(/^Bearer\s+/i, '')
  if (value.length < 40 || /\s/.test(value)) throw new SmmError('Это не похоже на ключ доступа — скопируйте его целиком из кабинета Meta', 400)
  const me = await graph<Me>(value, '/me', { fields: 'user_id,username,name,account_type,followers_count,media_count' })
  const igId = me.user_id ?? me.id
  if (!igId) throw new SmmError('Instagram не вернул аккаунт — проверьте ключ', 400)
  await saveToken(db, value, userId)
  const state: InstagramState = {
    userId: igId,
    username: me.username,
    name: me.name ?? null,
    accountType: me.account_type ?? null,
    tokenSetAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    error: null,
  }
  await saveState(db, state)
  // Площадка Instagram: та же строка, если уже была, иначе новая.
  const handle = me.username
  await db.execute(sql`
    UPDATE smm_accounts SET handle = ${handle}, url = ${`https://www.instagram.com/${handle}/`}, title = ${`@${handle}`}, can_publish = true, is_active = true,
      followers = coalesce(${me.followers_count ?? null}::int, followers), stats_error = NULL, updated_at = now()
    WHERE platform = 'instagram'
  `)
  await db.execute(sql`
    INSERT INTO smm_accounts (platform, title, url, handle, can_publish, followers)
    SELECT 'instagram', ${`@${handle}`}, ${`https://www.instagram.com/${handle}/`}, ${handle}, true, ${me.followers_count ?? null}::int
    WHERE NOT EXISTS (SELECT 1 FROM smm_accounts WHERE platform = 'instagram')
  `)
  return state
}

export async function disconnectInstagram(db: Database): Promise<void> {
  await db.execute(sql`DELETE FROM integrations WHERE key = ${TOKEN_KEY}`)
  await saveState(db, null)
  await db.execute(sql`UPDATE smm_accounts SET can_publish = false, updated_at = now() WHERE platform = 'instagram'`)
}

/** Продлить ключ заранее (раз в день из крона). Ошибку записываем — владелец увидит в настройках. */
export async function refreshInstagramToken(db: Database): Promise<void> {
  const state = await instagramState(db)
  if (!state) return
  const left = Date.parse(state.expiresAt) - Date.now()
  const age = Date.now() - Date.parse(state.tokenSetAt)
  if (left > REFRESH_BEFORE_MS || age < 86_400_000) return
  try {
    const r = await graph<{ access_token: string; expires_in?: number }>(await token(db), 'https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token' })
    await saveToken(db, r.access_token, null)
    await saveState(db, { ...state, tokenSetAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (r.expires_in ? r.expires_in * 1000 : TOKEN_TTL_MS)).toISOString(), error: null })
  } catch (error) {
    await saveState(db, { ...state, error: error instanceof Error ? error.message : 'Ключ не продлился' })
  }
}

// ─── Данные ──────────────────────────────────────────────────────────────────

export interface IgMedia {
  id: string
  caption?: string
  permalink?: string
  timestamp?: string
  media_type?: string
  media_product_type?: string
  like_count?: number
  comments_count?: number
}

export async function igProfile(db: Database): Promise<Me & { id: string }> {
  const state = await instagramState(db)
  if (!state) throw new SmmError('Instagram не подключён', 400)
  const me = await graph<Me>(await token(db), '/me', { fields: 'user_id,username,followers_count,media_count' })
  return { ...me, id: me.user_id ?? state.userId }
}

export async function igRecentMedia(db: Database, limit = 25): Promise<IgMedia[]> {
  const state = await instagramState(db)
  if (!state) return []
  const r = await graph<{ data?: IgMedia[] }>(await token(db), `/${state.userId}/media`, {
    fields: 'id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count',
    limit,
  })
  return r.data ?? []
}

/** Метрики публикации; у карусели Instagram их не отдаёт — тогда пусто. */
export async function igInsights(db: Database, media: IgMedia): Promise<Record<string, number>> {
  if (media.media_type === 'CAROUSEL_ALBUM') return {}
  const metric = media.media_product_type === 'STORY' ? 'views,reach,shares' : 'views,reach,likes,comments,saved,shares'
  try {
    const r = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(await token(db), `/${media.id}/insights`, { metric })
    const out: Record<string, number> = {}
    for (const m of r.data ?? []) {
      const v = m.total_value?.value ?? m.values?.[0]?.value
      if (typeof v === 'number') out[m.name === 'saved' ? 'saves' : m.name] = v
    }
    return out
  } catch {
    return {}
  }
}

// ─── Публикация ──────────────────────────────────────────────────────────────

const doneMedia = (post: SmmPost): SmmMedia[] => post.media.filter((m) => m.status === 'done' && m.selected && m.url).sort((a, b) => a.sort - b.sort)

/** Может ли Tai выложить эту публикацию сам (иначе — человеку файлы и текст). */
export async function instagramCanPublish(db: Database, post: Pick<SmmPost, 'platform' | 'format' | 'media'>): Promise<boolean> {
  if (post.platform !== 'instagram' || !(await instagramState(db))) return false
  const media = doneMedia(post as SmmPost)
  if (post.format === 'reel') return media.some((m) => m.kind === 'video')
  return media.length > 0
}

/** Картинки Instagram берёт только в JPEG — проверяем заранее, чтобы ошибка была понятной. */
async function assertJpeg(media: SmmMedia): Promise<void> {
  if (media.kind !== 'image') return
  const file = await readStoredMedia(media.url!)
  if (file && file.mime !== 'image/jpeg') throw new SmmError('Instagram принимает картинки только в JPEG — замените картинку (новый вариант или своё фото)', 400)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitReady(tok: string, containerId: string, video: boolean): Promise<void> {
  const deadline = Date.now() + (video ? VIDEO_WAIT_MS : IMAGE_WAIT_MS)
  while (Date.now() < deadline) {
    const r = await graph<{ status_code?: string }>(tok, `/${containerId}`, { fields: 'status_code' })
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new SmmError('Instagram не смог обработать файл — проверьте формат видео или картинки', 502)
    await sleep(POLL_MS)
  }
  throw new SmmError('Instagram слишком долго обрабатывает видео — попробуйте опубликовать ещё раз через пару минут', 502)
}

async function container(tok: string, igId: string, media: SmmMedia, extra: Record<string, string | boolean | undefined>): Promise<string> {
  const url = publicMediaUrl(media.url!)
  const r = await graph<{ id: string }>(tok, `/${igId}/media`, media.kind === 'video' ? { video_url: url, ...extra } : { image_url: url, ...extra }, 'POST')
  return r.id
}

async function publishContainer(tok: string, igId: string, creationId: string): Promise<string> {
  const r = await graph<{ id: string }>(tok, `/${igId}/media_publish`, { creation_id: creationId }, 'POST')
  return r.id
}

async function permalink(tok: string, mediaId: string, fallback: string): Promise<string> {
  const r = await graph<{ permalink?: string }>(tok, `/${mediaId}`, { fields: 'permalink' }).catch(() => ({ permalink: undefined }))
  return r.permalink ?? fallback
}

/** Выложить в Instagram: пост, карусель (до 10), рилс (нужно видео) или сторис (каждый кадр отдельно). */
export async function publishToInstagram(db: Database, post: SmmPost): Promise<{ mediaId: string; url: string }> {
  const state = await instagramState(db)
  if (!state) throw new SmmError('Instagram не подключён — вставьте ключ в настройках СММ', 400)
  const tok = await token(db)
  const igId = state.userId
  const caption = plainText(post.body).slice(0, 2200)
  const media = doneMedia(post)
  const profileUrl = `https://www.instagram.com/${state.username}/`

  if (post.format === 'reel') {
    const video = media.find((m) => m.kind === 'video')
    if (!video) throw new SmmError('Для рилс нужно видео — загрузите снятое в публикацию', 400)
    const id = await container(tok, igId, video, { media_type: 'REELS', caption })
    await waitReady(tok, id, true)
    const mediaId = await publishContainer(tok, igId, id)
    return { mediaId, url: await permalink(tok, mediaId, profileUrl) }
  }

  if (post.format === 'story') {
    if (!media.length) throw new SmmError('В сторис нет кадров', 400)
    let first: string | null = null
    for (const m of media.slice(0, 10)) {
      await assertJpeg(m)
      const id = await container(tok, igId, m, { media_type: 'STORIES' })
      await waitReady(tok, id, m.kind === 'video')
      const mediaId = await publishContainer(tok, igId, id)
      first ??= mediaId
    }
    return { mediaId: first!, url: `https://www.instagram.com/stories/${state.username}/` }
  }

  if (!media.length) throw new SmmError('Нет картинки — Instagram не публикует пост без фото', 400)
  if (media.length === 1 || post.format === 'post') {
    const m = media[0]!
    await assertJpeg(m)
    const id = await container(tok, igId, m, m.kind === 'video' ? { media_type: 'REELS', caption } : { caption })
    await waitReady(tok, id, m.kind === 'video')
    const mediaId = await publishContainer(tok, igId, id)
    return { mediaId, url: await permalink(tok, mediaId, profileUrl) }
  }

  const items = media.slice(0, CAROUSEL_MAX)
  const children: string[] = []
  for (const m of items) {
    await assertJpeg(m)
    const id = await container(tok, igId, m, { is_carousel_item: true, ...(m.kind === 'video' ? { media_type: 'VIDEO' } : {}) })
    await waitReady(tok, id, m.kind === 'video')
    children.push(id)
  }
  const carousel = await graph<{ id: string }>(tok, `/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption }, 'POST')
  await waitReady(tok, carousel.id, false)
  const mediaId = await publishContainer(tok, igId, carousel.id)
  return { mediaId, url: await permalink(tok, mediaId, profileUrl) }
}
