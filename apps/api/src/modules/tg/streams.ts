/**
 * Стримы клуба в Telegram. MafBoard и MafBoard Studio молча передают ссылки на эфир и
 * донаты в HUB (сервер MafBoard → Titan Connect, право streams:publish) — HUB их
 * просто запоминает. Отдавать ли их Tai, решает владелец в HUB (Telegram → Стримы):
 *  • «Публиковать стримы» включено — Tai выкладывает пост с кнопками в чаты с категорией
 *    «Стримы» (каждый в свою тему) и отвечает ссылкой на /stream;
 *  • выключено — эфир виден только в HUB, его можно опубликовать вручную.
 * Конец эфира — опубликованный пост правится на «стрим завершён».
 *
 * Опубликованный эфир видят и клиенты My Titan: экран «Трансляции» и push «Мы в эфире»
 * (notifications/streamPush.ts). Push, его текст и постоянные площадки клуба (каналы и
 * донат, видны и между эфирами) настраиваются в HUB: «Маркетинг → Трансляции».
 *
 * Хранение — app_settings.tg_streams: { active, last, autoPublish, appPush, appPushTitle,
 * appPushBody, channels } (одна запись на клуб).
 */
import { randomBytes } from 'node:crypto'
import { appSettings, sql, type Database } from '@titan/database'
import { getStringSetting } from '../../lib/appSettings.js'
import { escapeHtml, type InlineButton, type TgBot } from '../../lib/tgBot.js'
import { chatsForCategory } from '../../lib/tgChatConfig.js'
import { taiBot } from './club.js'
import { notifyStreamStarted } from '../notifications/streamPush.js'

export const STREAMS_KEY = 'tg_streams'
import { normalizeLinks, type StreamLink, type StreamLinkKind } from './streamLinks.js'

export { normalizeLinks, safeUrl, type StreamLink, type StreamLinkKind } from './streamLinks.js'
export type StreamSource = 'mafboard' | 'studio' | 'hub'

export interface Stream {
  /** Свой id эфира у приложения — повтор с тем же id обновляет пост, а не шлёт новый. */
  id: string
  title: string
  links: StreamLink[]
  source: StreamSource
  startedAt: string
  endedAt: string | null
  /** Отдан Tai: опубликован в чатах и доступен по /stream. */
  published: boolean
  posts: { chatId: string; messageId: number }[]
}

export interface StreamStore {
  active: Stream | null
  last: Stream | null
  autoPublish: boolean
  /** Push «Мы в эфире» клиентам My Titan при публикации эфира. */
  appPush: boolean
  /** Заголовок и текст push; пусто — стандартные. В тексте {название} — название эфира. */
  appPushTitle: string
  appPushBody: string
  /** Постоянные площадки клуба: каналы (watch) и донат (donate) — видны и без эфира. */
  channels: StreamLink[]
}
type Store = StreamStore

export interface StreamInput {
  id?: string
  title?: string
  links: StreamLink[]
  source: StreamSource
}

const DEFAULT_TITLE = 'Стрим клуба'

type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

async function readStore(db: DbLike): Promise<Store> {
  try {
    const raw = await getStringSetting(STREAMS_KEY, '', db)
    const parsed = raw ? (JSON.parse(raw) as Partial<Store>) : {}
    return {
      active: parsed.active ?? null,
      last: parsed.last ?? null,
      autoPublish: parsed.autoPublish === true,
      appPush: parsed.appPush !== false,
      appPushTitle: typeof parsed.appPushTitle === 'string' ? parsed.appPushTitle : '',
      appPushBody: typeof parsed.appPushBody === 'string' ? parsed.appPushBody : '',
      channels: Array.isArray(parsed.channels) ? normalizeLinks(parsed.channels) : [],
    }
  } catch {
    return { active: null, last: null, autoPublish: false, appPush: true, appPushTitle: '', appPushBody: '', channels: [] }
  }
}

async function mutateStore(db: Database, change: (s: Store) => Store): Promise<Store> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${STREAMS_KEY}, 0))`)
    const next = change(await readStore(tx))
    const value = JSON.stringify(next)
    await tx.insert(appSettings).values({ key: STREAMS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } })
    return next
  })
}

export const activeStream = async (db: Database): Promise<Stream | null> => (await readStore(db)).active
/** Эфир, который Tai может показывать: только опубликованный. */
export const publishedStream = async (db: Database): Promise<Stream | null> => {
  const s = (await readStore(db)).active
  return s?.published ? s : null
}

const SOURCE_LABEL: Record<StreamSource, string> = { mafboard: 'MafBoard', studio: 'MafBoard Studio', hub: 'Titan HUB' }

function postText(s: Stream, live: boolean): string {
  const head = live ? `🔴 <b>Мы в эфире!</b> ${escapeHtml(s.title)}` : `⚫️ <b>Стрим завершён</b> · ${escapeHtml(s.title)}`
  const body = live ? 'Заходите смотреть, болеть за своих и поддержать донатом 👇' : 'Спасибо, что были с нами! Следующий эфир — по команде /stream.'
  return `${head}\n${body}`
}

function buttons(s: Stream): { inline_keyboard: InlineButton[][] } {
  const watch = s.links.filter((l) => l.kind === 'watch').map((l) => ({ text: `▶️ ${l.label}`, url: l.url }))
  const donate = s.links.filter((l) => l.kind === 'donate').map((l) => ({ text: `💸 ${l.label}`, url: l.url }))
  return { inline_keyboard: [...watch.map((b) => [b]), ...(donate.length ? [donate] : [])] }
}

/** Ответ команды /stream. */
export function streamCommandReply(s: Stream | null): { text: string; markup?: { inline_keyboard: InlineButton[][] } } {
  if (!s) return { text: 'Сейчас эфира нет. Как только стрим начнётся — я пришлю ссылку 📺' }
  return { text: `🔴 Сейчас в эфире: ${escapeHtml(s.title)}`, markup: buttons(s) }
}

async function postEverywhere(db: Database, bot: TgBot, s: Stream): Promise<Stream['posts']> {
  const targets = await chatsForCategory(db, 'streams')
  const sent = await Promise.all(targets.map(async (t) => ({ chatId: t.chatId, r: await bot.send(t.chatId, postText(s, true), { html: true, threadId: t.threadId, markup: buttons(s) }) })))
  return sent.flatMap(({ chatId, r }) => (r.ok ? [{ chatId, messageId: r.messageId }] : []))
}

async function editPosts(bot: TgBot, s: Stream, live: boolean): Promise<void> {
  await Promise.all(s.posts.map((p) => bot.edit(p.chatId, p.messageId, postText(s, live), { html: true, ...(live ? { markup: buttons(s) } : {}) })))
}

export class StreamError extends Error {}

/**
 * Эфир начался или обновились ссылки. Тот же id, что у активного, — обновляем (и правим
 * посты, если он опубликован); новый id — прошлый эфир закрываем. Публикуем, если
 * `publish` (вручную из HUB) или у клуба включено «Публиковать стримы».
 */
export async function startStream(db: Database, input: StreamInput, opts: { publish?: boolean } = {}): Promise<Stream> {
  const links = normalizeLinks(input.links)
  if (!links.some((l) => l.kind === 'watch')) throw new StreamError('Нужна ссылка на эфир (https)')
  const store = await readStore(db)
  const publish = opts.publish ?? store.autoPublish
  const bot = await taiBot(db)
  if (publish && !bot && !store.appPush) throw new StreamError('Бот Tai не подключён')
  const current = store.active
  const id = input.id?.trim().slice(0, 80) || randomBytes(6).toString('hex')
  const title = input.title?.trim().slice(0, 120) || DEFAULT_TITLE

  if (current && current.id === id) {
    const updated: Stream = { ...current, title, links }
    if (updated.published && bot) await editPosts(bot, updated, true)
    await mutateStore(db, (s) => ({ ...s, active: updated }))
    return updated.published || !publish ? updated : publishStream(db)
  }
  if (current) await finishStream(db, bot, current)
  const fresh: Stream = { id, title, links, source: input.source, startedAt: new Date().toISOString(), endedAt: null, published: false, posts: [] }
  await mutateStore(db, (s) => ({ ...s, active: fresh }))
  console.info(`[streams] эфир «${title}» от ${SOURCE_LABEL[input.source]}${publish ? ', публикуем' : ', без публикации'}`)
  return publish ? publishStream(db) : fresh
}

/**
 * Отдать активный эфир клиентам: пост Tai в чаты со «Стримами», ссылка по /stream, экран
 * «Трансляции» в My Titan и push «Мы в эфире» (один раз за эфир — повтор уже опубликованного
 * ничего не шлёт). Без бота Tai публикуем только в приложение, если там включён push.
 */
export async function publishStream(db: Database): Promise<Stream> {
  const store = await readStore(db)
  const current = store.active
  if (!current) throw new StreamError('Сейчас эфира нет')
  if (current.published) return current
  const bot = await taiBot(db)
  if (!bot && !store.appPush) throw new StreamError('Бот Tai не подключён')
  const posted: Stream = { ...current, published: true, posts: bot ? await postEverywhere(db, bot, current) : [] }
  await mutateStore(db, (s) => ({ ...s, active: s.active?.id === posted.id ? posted : s.active }))
  if (store.appPush) void notifyStreamStarted(db, posted, { title: store.appPushTitle, body: store.appPushBody })
  return posted
}

export interface StreamSettingsPatch {
  autoPublish?: boolean
  appPush?: boolean
  appPushTitle?: string
  appPushBody?: string
  channels?: StreamLink[]
}

export async function setStreamSettings(db: Database, patch: StreamSettingsPatch): Promise<StreamStore> {
  return mutateStore(db, (s) => ({
    ...s,
    ...(patch.autoPublish !== undefined ? { autoPublish: patch.autoPublish } : {}),
    ...(patch.appPush !== undefined ? { appPush: patch.appPush } : {}),
    ...(patch.appPushTitle !== undefined ? { appPushTitle: patch.appPushTitle.trim() } : {}),
    ...(patch.appPushBody !== undefined ? { appPushBody: patch.appPushBody.trim() } : {}),
    ...(patch.channels !== undefined ? { channels: normalizeLinks(patch.channels) } : {}),
  }))
}

async function finishStream(db: Database, bot: TgBot | null, s: Stream): Promise<Stream> {
  const ended: Stream = { ...s, endedAt: new Date().toISOString() }
  if (bot && s.published) await editPosts(bot, ended, false)
  await mutateStore(db, (st) => ({ ...st, active: st.active?.id === s.id ? null : st.active, last: ended }))
  return ended
}

/** Эфир закончился. id не указан — закрываем активный. null — активного эфира нет. */
export async function endStream(db: Database, id?: string): Promise<Stream | null> {
  const current = await activeStream(db)
  if (!current || (id && current.id !== id)) return null
  return finishStream(db, await taiBot(db), current)
}

export async function streamState(db: Database): Promise<Store> {
  return readStore(db)
}

/** Что видит клиент My Titan: опубликованный эфир и постоянные площадки клуба. */
export interface ClientStreamView {
  live: { id: string; title: string; startedAt: string; watch: StreamLink[]; donate: StreamLink[] } | null
  channels: StreamLink[]
  donate: StreamLink[]
  lastEndedAt: string | null
}

export async function clientStreamView(db: Database): Promise<ClientStreamView> {
  const s = await readStore(db)
  const live = s.active?.published ? s.active : null
  const own = (kind: StreamLinkKind) => s.channels.filter((l) => l.kind === kind)
  return {
    live: live ? {
      id: live.id,
      title: live.title,
      startedAt: live.startedAt,
      watch: live.links.filter((l) => l.kind === 'watch'),
      donate: live.links.filter((l) => l.kind === 'donate'),
    } : null,
    channels: own('watch'),
    // Донат эфира важнее постоянного: показываем его, а постоянный — если в эфире нет своего.
    donate: own('donate'),
    lastEndedAt: s.last?.published ? s.last.endedAt : null,
  }
}
