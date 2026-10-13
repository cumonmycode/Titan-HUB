/**
 * Telegram для раздела «СММ»: канал клуба (Tai — администратор и публикует сам),
 * превью на одобрение с кнопками и передача готовых материалов человеку, который
 * выкладывает Instagram и сторис. Всё — от бота Tai клуба.
 */
import { sql, type Database } from '@titan/database'
import { getSharedRedis } from '../../lib/redis.js'
import { readStoredMedia } from '../../lib/imageStore.js'
import { escapeHtml, type InlineButton, type TgBot } from '../../lib/tgBot.js'
import { taiBot } from '../tg/club.js'
import { publishChannel, rows } from './db.js'
import { FORMAT_LABEL, PLATFORM_LABEL } from './prompts.js'
import type { SmmSettings } from './settings.js'
import { SmmError, autoPublishes, type SmmMedia, type SmmPost } from './types.js'

const CAPTION_LIMIT = 1024
const ALBUM_LIMIT = 10
export const LINK_WAIT_SEC = 3 * 86_400
export const REMARK_WAIT_SEC = 30 * 60

// ─── Люди ────────────────────────────────────────────────────────────────────

export interface SmmPerson {
  id: string
  nickname: string
  tgId: string | null
  role: string
}

/** Кто одобряет: владелец и сотрудники с правом «СММ». */
export async function approvers(db: Database): Promise<SmmPerson[]> {
  return rows<Record<string, unknown>>(await db.execute(sql`
    SELECT id, nickname, tg_id, role FROM profiles
    WHERE deleted_at IS NULL AND (role = 'owner' OR (role = 'staff' AND coalesce((permissions->>'smm')::boolean, false)))
    ORDER BY (role = 'owner') DESC, nickname
  `)).map((r) => ({ id: String(r['id']), nickname: String(r['nickname'] ?? ''), tgId: r['tg_id'] ? String(r['tg_id']) : null, role: String(r['role']) }))
}

export async function personById(db: Database, id: string | null): Promise<SmmPerson | null> {
  if (!id) return null
  const [r] = rows<Record<string, unknown>>(await db.execute(sql`SELECT id, nickname, tg_id, role FROM profiles WHERE id = ${id}::uuid AND deleted_at IS NULL`))
  return r ? { id: String(r['id']), nickname: String(r['nickname'] ?? ''), tgId: r['tg_id'] ? String(r['tg_id']) : null, role: String(r['role']) } : null
}

/** Кто выкладывает публикацию вручную: назначенный на пост, из настроек, иначе владелец. */
export async function publisherFor(db: Database, settings: SmmSettings, post: Pick<SmmPost, 'assigneeId'>): Promise<SmmPerson | null> {
  return (await personById(db, post.assigneeId)) ?? (await personById(db, settings.publisherId)) ?? (await approvers(db)).find((p) => p.role === 'owner') ?? null
}

// ─── Текст ───────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'tg-spoiler'])
const TAG_RE = /<\/?([a-z][a-z-]*)(\s[^<>]*)?>/gi

function escapeText(s: string): string {
  return s.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Разметка Telegram: только разрешённые теги, ссылки — только http(s); markdown ** → <b>. */
export function telegramHtml(body: string): string {
  const text = body.replace(/<br\s*\/?>/gi, '\n').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  let out = ''
  let last = 0
  for (const match of text.matchAll(TAG_RE)) {
    out += escapeText(text.slice(last, match.index))
    last = (match.index ?? 0) + match[0].length
    const tag = match[1]!.toLowerCase()
    const closing = match[0].startsWith('</')
    if (ALLOWED_TAGS.has(tag)) out += closing ? `</${tag}>` : `<${tag}>`
    else if (tag === 'a') {
      if (closing) out += '</a>'
      else {
        const href = /href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(match[2] ?? '')?.[1]
        out += href ? `<a href="${escapeHtml(href)}">` : '<a href="#">'
      }
    }
  }
  return (out + escapeText(text.slice(last))).replace(/<a href="#">([^<]*)<\/a>/g, '$1').trim()
}

/** Простой текст (Instagram, кнопки): без тегов и сущностей. */
export function plainText(body: string): string {
  return body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s[^>]*href=["']?([^"'\s>]+)[^>]*>([^<]*)<\/a>/gi, '$2')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .trim()
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function whenText(iso: string | null): string {
  if (!iso) return 'без даты'
  const d = new Date(Date.parse(iso) + 3 * 3600_000)
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${d.toISOString().slice(11, 16)}`
}

const kindLine = (post: SmmPost) => `${PLATFORM_LABEL[post.platform]} · ${FORMAT_LABEL[post.format]}`

// ─── Отправка медиа ──────────────────────────────────────────────────────────

const doneMedia = (post: SmmPost): SmmMedia[] =>
  post.media.filter((m) => m.status === 'done' && m.selected && m.url).sort((a, b) => a.sort - b.sort).slice(0, ALBUM_LIMIT)

type Sent = { ok: true; messageId: number } | { ok: false; error: string }

/**
 * Картинки/видео с подписью: одно — фото/видео, несколько — альбом. asDocuments —
 * файлами без сжатия (для выкладки в Instagram). Подпись с разметкой не прошла —
 * повтор простым текстом.
 */
async function sendMedia(bot: TgBot, chatId: string, media: SmmMedia[], caption: string, opts: { html: boolean; asDocuments?: boolean }): Promise<Sent> {
  const files = await Promise.all(media.map((m) => readStoredMedia(m.url!)))
  if (files.some((f) => !f)) return { ok: false, error: 'файл не прочитался' }
  const attempt = async (html: boolean): Promise<Sent> => {
    const text = html ? caption : plainText(caption)
    const form = new FormData()
    form.set('chat_id', chatId)
    if (media.length === 1) {
      const file = files[0]!
      const isVideo = media[0]!.kind === 'video'
      const method = opts.asDocuments ? 'sendDocument' : isVideo ? 'sendVideo' : 'sendPhoto'
      const field = opts.asDocuments ? 'document' : isVideo ? 'video' : 'photo'
      form.set(field, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name)
      if (text) form.set('caption', text)
      if (text && html) form.set('parse_mode', 'HTML')
      if (isVideo && !opts.asDocuments) form.set('supports_streaming', 'true')
      const r = await bot.upload<{ message_id: number }>(method, form)
      return r.ok ? { ok: true, messageId: r.result.message_id } : { ok: false, error: r.error }
    }
    const items = media.map((m, i) => ({
      type: opts.asDocuments ? 'document' : m.kind === 'video' ? 'video' : 'photo',
      media: `attach://f${i}`,
      ...(i === 0 && text ? { caption: text, ...(html ? { parse_mode: 'HTML' } : {}) } : {}),
    }))
    form.set('media', JSON.stringify(items))
    files.forEach((file, i) => form.set(`f${i}`, new Blob([new Uint8Array(file!.data)], { type: file!.mime }), file!.name))
    const r = await bot.upload<{ message_id: number }[]>('sendMediaGroup', form, 240_000)
    return r.ok ? { ok: true, messageId: r.result[0]?.message_id ?? 0 } : { ok: false, error: r.error }
  }
  const first = await attempt(opts.html)
  if (!first.ok && opts.html && /parse entities|can't find end/i.test(first.error)) return attempt(false)
  return first
}

/** Текст поста отдельным сообщением (когда не влез в подпись). */
async function sendText(bot: TgBot, chatId: string, text: string, html: boolean, buttons?: InlineButton[][]): Promise<Sent> {
  const r = await bot.send(chatId, text, { html, markup: buttons ? { inline_keyboard: buttons } : undefined })
  return r.ok ? { ok: true, messageId: r.messageId } : { ok: false, error: r.error }
}

// ─── Канал ───────────────────────────────────────────────────────────────────

export interface ChannelCheck {
  chatId: string
  title: string
  handle: string | null
  canPublish: boolean
  problem: string | null
}

/** Ссылка, @имя или id канала → проверка, что Tai в нём администратор с правом публикации. */
export async function checkChannel(db: Database, input: string): Promise<ChannelCheck> {
  const bot = await taiBot(db)
  if (!bot) throw new SmmError('Бот Tai не подключён — добавьте токен в «Интеграциях»', 400)
  const raw = input.trim()
  const handle = /(?:t\.me\/|@)([A-Za-z0-9_]{4,})/.exec(raw)?.[1] ?? (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(raw) ? raw : null)
  const id = /^-?\d{5,}$/.test(raw) ? raw : null
  if (!handle && !id) throw new SmmError('Укажите ссылку на канал (t.me/имя) или @имя', 400)
  const chat = await bot.call<{ id: number; title?: string; username?: string; type?: string }>('getChat', { chat_id: id ?? `@${handle}` })
  if (!chat) throw new SmmError('Канал не найден. Сначала добавьте бота Tai в администраторы канала', 400)
  if (chat.type !== 'channel') throw new SmmError('Это не канал — нужен Telegram-канал клуба', 400)
  const me = await bot.call<{ id: number }>('getMe', {})
  const member = me ? await bot.call<{ status?: string; can_post_messages?: boolean }>('getChatMember', { chat_id: chat.id, user_id: me.id }) : null
  const isAdmin = member?.status === 'administrator' || member?.status === 'creator'
  const canPublish = member?.status === 'creator' || (isAdmin && member?.can_post_messages !== false)
  return {
    chatId: String(chat.id),
    title: chat.title ?? handle ?? 'Канал',
    handle: chat.username ?? handle,
    canPublish,
    problem: canPublish ? null : isAdmin ? 'У бота Tai нет права публиковать сообщения в канале' : 'Бот Tai не администратор канала — добавьте его в администраторы с правом публикации',
  }
}

export async function channelMembers(db: Database, chatId: string): Promise<number | null> {
  const bot = await taiBot(db)
  const n = bot ? await bot.call<number>('getChatMemberCount', { chat_id: chatId }) : null
  return typeof n === 'number' ? n : null
}

/** Опубликовать в канал клуба. Текст длиннее подписи — отдельным сообщением после медиа. */
export async function publishToChannel(db: Database, post: SmmPost): Promise<{ messageId: number; url: string }> {
  const channel = await publishChannel(db)
  if (!channel?.tgChatId) throw new SmmError('Канал Telegram не подключён — подключите его в настройках СММ', 400)
  const bot = await taiBot(db)
  if (!bot) throw new SmmError('Бот Tai не подключён', 400)
  const html = telegramHtml(post.body)
  if (!html) throw new SmmError('Нет текста публикации', 400)
  const media = doneMedia(post)
  let sent: Sent
  if (!media.length) sent = await sendText(bot, channel.tgChatId, html, true)
  else if (html.length <= CAPTION_LIMIT) sent = await sendMedia(bot, channel.tgChatId, media, html, { html: true })
  else {
    sent = await sendMedia(bot, channel.tgChatId, media, '', { html: false })
    if (sent.ok) {
      const text = await sendText(bot, channel.tgChatId, html, true)
      if (!text.ok) throw new SmmError(`Картинка вышла, а текст нет: ${text.error}`, 502)
    }
  }
  if (!sent.ok) throw new SmmError(`Telegram не принял публикацию: ${sent.error}`, 502)
  const url = channel.handle ? `https://t.me/${channel.handle}/${sent.messageId}` : `https://t.me/c/${channel.tgChatId.replace(/^-100/, '')}/${sent.messageId}`
  return { messageId: sent.messageId, url }
}

// ─── Превью на одобрение ─────────────────────────────────────────────────────

export const reviewButtons = (postId: string): InlineButton[][] => [
  [{ text: '✅ Одобрить', callback_data: `sm:a:${postId}` }, { text: '✏️ Поправить', callback_data: `sm:e:${postId}` }],
  [{ text: '🚫 Не выкладывать', callback_data: `sm:x:${postId}` }],
]

function reviewHeader(post: SmmPost, intro: string): string {
  const action = (post.autoPublish ?? autoPublishes(post)) ? 'Tai опубликует сам' : 'выложит человек — Tai пришлёт файлы'
  return `${intro}\n<b>${escapeHtml(post.topic)}</b>\n${kindLine(post)} · ${whenText(post.publishAt)} · ${action}`
}

/** Кадры сценария: что снять, текст на экране, стикер. */
function shotLines(post: SmmPost): string {
  return (post.script?.shots ?? [])
    .map((s, i) => `${i + 1}. ${escapeHtml(s.text)}${s.overlay ? ` — текст «${escapeHtml(s.overlay)}»` : ''}${s.sticker ? ` · стикер: ${escapeHtml(s.sticker)}` : ''}`)
    .join('\n')
}

function reviewBody(post: SmmPost): string {
  const body = post.platform === 'telegram' ? telegramHtml(post.body) : escapeHtml(plainText(post.body))
  const script = post.script ? `\n\n🎬 <b>${post.format === 'story' ? 'Кадры' : 'Сценарий'}</b>\n${escapeHtml(post.script.hook)}\n${shotLines(post)}` : ''
  return body + script
}

/** Прислать превью одному человеку: медиа, затем текст с кнопками. */
export async function sendReviewTo(db: Database, post: SmmPost, tgId: string, intro = '📝 На одобрение'): Promise<boolean> {
  const bot = await taiBot(db)
  if (!bot) return false
  const media = doneMedia(post)
  if (media.length) await sendMedia(bot, tgId, media, '', { html: false })
  const r = await sendText(bot, tgId, `${reviewHeader(post, intro)}\n\n${reviewBody(post)}`, true, reviewButtons(post.id))
  return r.ok
}

// ─── Передача для выкладки (Instagram, сторис, рилс) ─────────────────────────

const doneButtons = (postId: string): InlineButton[][] => [[{ text: '✅ Выложил — пришлю ссылку', callback_data: `sm:d:${postId}` }]]

function handoffText(post: SmmPost, kind: 'now' | 'remind'): string {
  const where = post.format === 'story' ? `сторис в ${PLATFORM_LABEL[post.platform]}` : post.format === 'reel' ? 'рилс в Instagram' : `${FORMAT_LABEL[post.format]} в ${PLATFORM_LABEL[post.platform]}`
  const head = kind === 'now' ? `📲 Пора выложить ${where}` : `⏰ Напоминаю: ${where} ещё не выложен`
  const lines = [`${head}\n<b>${escapeHtml(post.topic)}</b> · ${whenText(post.publishAt)}`]
  if (post.format === 'story') lines.push(`Текст на сторис:\n<pre>${escapeHtml(plainText(post.body))}</pre>`)
  else lines.push(`Подпись — нажми, чтобы скопировать:\n<pre>${escapeHtml(plainText(post.body))}</pre>`)
  if (post.script) {
    lines.push(`🎬 <b>${post.format === 'story' ? 'Кадры' : 'Как снять'}</b>\n${post.format === 'story' ? '' : 'Зацепка: '}${escapeHtml(post.script.hook)}\n${shotLines(post)}${post.script.audio ? `\nЗвук: ${escapeHtml(post.script.audio)}` : ''}${post.script.cast ? `\nКто: ${escapeHtml(post.script.cast)}` : ''}`)
  }
  lines.push('Когда выложишь — пришли сюда ссылку на публикацию (или нажми кнопку).')
  return lines.join('\n\n')
}

const linkKey = (clubKey: string, tgId: string) => `smm:link:${clubKey}:${tgId}`

/** Отдать человеку файлы без сжатия и текст; ждать от него ссылку. */
export async function sendHandoff(db: Database, clubKey: string, post: SmmPost, to: SmmPerson, kind: 'now' | 'remind' = 'now'): Promise<boolean> {
  if (!to.tgId) return false
  const bot = await taiBot(db)
  if (!bot) return false
  const media = doneMedia(post)
  if (media.length && kind === 'now') {
    const r = await sendMedia(bot, to.tgId, media, '', { html: false, asDocuments: true })
    if (!r.ok) console.warn('[smm] файлы для выкладки не отправились', r.error)
  }
  const r = await sendText(bot, to.tgId, handoffText(post, kind), true, doneButtons(post.id))
  if (r.ok) await getSharedRedis().set(linkKey(clubKey, to.tgId), post.id, 'EX', LINK_WAIT_SEC).catch(() => undefined)
  return r.ok
}

export async function awaitedLinkPost(clubKey: string, tgId: string): Promise<string | null> {
  return getSharedRedis().get(linkKey(clubKey, tgId)).catch(() => null)
}

export async function setAwaitedLink(clubKey: string, tgId: string, postId: string | null): Promise<void> {
  const redis = getSharedRedis()
  if (postId) await redis.set(linkKey(clubKey, tgId), postId, 'EX', LINK_WAIT_SEC).catch(() => undefined)
  else await redis.del(linkKey(clubKey, tgId)).catch(() => undefined)
}

const remarkKey = (clubKey: string, tgId: string) => `smm:remark:${clubKey}:${tgId}`

export async function setAwaitedRemark(clubKey: string, tgId: string, postId: string | null): Promise<void> {
  const redis = getSharedRedis()
  if (postId) await redis.set(remarkKey(clubKey, tgId), postId, 'EX', REMARK_WAIT_SEC).catch(() => undefined)
  else await redis.del(remarkKey(clubKey, tgId)).catch(() => undefined)
}

export async function awaitedRemarkPost(clubKey: string, tgId: string): Promise<string | null> {
  return getSharedRedis().get(remarkKey(clubKey, tgId)).catch(() => null)
}

/** Личное сообщение от Tai (без кнопок). */
export async function tell(db: Database, tgId: string | null, html: string): Promise<boolean> {
  if (!tgId) return false
  const bot = await taiBot(db)
  if (!bot) return false
  return (await bot.send(tgId, html, { html: true })).ok
}
