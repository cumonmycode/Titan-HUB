/**
 * Стримы клуба в Telegram. MafBoard и MafBoard Studio молча передают ссылки на эфир и
 * донаты в HUB (сервер MafBoard → Titan Connect, право streams:publish) — HUB их
 * просто запоминает. Отдавать ли их Tai, решает владелец в HUB (Telegram → Стримы):
 *  • «Публиковать стримы» включено — Tai выкладывает пост с кнопками в чаты с категорией
 *    «Стримы» (каждый в свою тему) и отвечает ссылкой на /stream;
 *  • выключено — эфир виден только в HUB, его можно опубликовать вручную.
 * Конец эфира — опубликованный пост правится на «стрим завершён».
 *
 * Хранение — app_settings.tg_streams: { active, last, autoPublish } (одна запись на клуб).
 */
import { randomBytes } from 'node:crypto'
import { appSettings, sql, type Database } from '@titan/database'
import { getStringSetting } from '../../lib/appSettings.js'
import { escapeHtml, type InlineButton, type TgBot } from '../../lib/tgBot.js'
import { chatsForCategory } from '../../lib/tgChatConfig.js'
import { taiBot } from './club.js'

export const STREAMS_KEY = 'tg_streams'
export type StreamLinkKind = 'watch' | 'donate'
export interface StreamLink { kind: StreamLinkKind; label: string; url: string }
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

interface Store { active: Stream | null; last: Stream | null; autoPublish: boolean }

export interface StreamInput {
  id?: string
  title?: string
  links: StreamLink[]
  source: StreamSource
}

const MAX_LINKS = 6
const DEFAULT_TITLE = 'Стрим клуба'
const URL_MAX = 500

/** Только https — кнопки Telegram и так принимают лишь http(s)/tg. */
export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' || url.username || url.password || raw.length > URL_MAX) return null
    return url.toString()
  } catch {
    return null
  }
}

type DbLike = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

async function readStore(db: DbLike): Promise<Store> {
  try {
    const raw = await getStringSetting(STREAMS_KEY, '', db)
    const parsed = raw ? (JSON.parse(raw) as Partial<Store>) : {}
    return { active: parsed.active ?? null, last: parsed.last ?? null, autoPublish: parsed.autoPublish === true }
  } catch {
    return { active: null, last: null, autoPublish: false }
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

function normalizeLinks(links: StreamLink[]): StreamLink[] {
  const seen = new Set<string>()
  const out: StreamLink[] = []
  for (const l of links) {
    const url = safeUrl(l.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ kind: l.kind, label: l.label.trim().slice(0, 40) || (l.kind === 'donate' ? 'Донат' : 'Смотреть'), url })
  }
  return out.slice(0, MAX_LINKS)
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
  if (publish && !bot) throw new StreamError('Бот Tai не подключён')
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

/** Отдать активный эфир Tai: пост в чаты со «Стримами» и ссылка по /stream. */
export async function publishStream(db: Database): Promise<Stream> {
  const current = await activeStream(db)
  if (!current) throw new StreamError('Сейчас эфира нет')
  if (current.published) return current
  const bot = await taiBot(db)
  if (!bot) throw new StreamError('Бот Tai не подключён')
  const posted: Stream = { ...current, published: true, posts: await postEverywhere(db, bot, current) }
  await mutateStore(db, (s) => ({ ...s, active: s.active?.id === posted.id ? posted : s.active }))
  return posted
}

export async function setAutoPublish(db: Database, on: boolean): Promise<void> {
  await mutateStore(db, (s) => ({ ...s, autoPublish: on }))
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
