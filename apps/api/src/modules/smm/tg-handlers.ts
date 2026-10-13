/**
 * СММ в Telegram: кнопки под превью («Одобрить», «Поправить», «Не выпускать»,
 * «Выложил») и личка Tai — замечание к посту текстом или голосом, ссылка на
 * вышедшую публикацию, скриншот статистики. Работает только с сотрудниками.
 */
import { sql } from '@titan/database'
import { escapeHtml } from '../../lib/tgBot.js'
import type { TgClub } from '../tg/club.js'
import { whoIs, type TgPerson } from '../tg/identity.js'
import type { TgCallbackQuery, TgMessage } from '../tg/types.js'
import { loadPost, rows } from './db.js'
import { applyScreenshot } from './stats.js'
import {
  approvers, awaitedLinkPost, awaitedRemarkPost, awaitedStats, sendReviewTo, setAwaitedLink, setAwaitedRemark, setAwaitedStats, whenText,
} from './telegram.js'
import { SmmError } from './types.js'
import { approvePost, canAutoPublish, markPublished, skipPost, type SmmEnv } from './workflow.js'
import { reviseInBackground } from './writer.js'

const UUID_RE = /^[0-9a-f-]{36}$/i
const LINK_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am|t\.me|vk\.com|vk\.ru)\/[^\s<>"]+/i
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

const envOf = (club: TgClub): SmmEnv => ({ db: club.db, clubId: club.id })

async function canApprove(club: TgClub, person: TgPerson): Promise<boolean> {
  if (!person.profile) return false
  return (await approvers(club.db)).some((p) => p.id === person.profile!.id)
}

/** Нажатие кнопки `sm:<действие>:<id публикации>`. */
export async function onSmmCallback(club: TgClub, cq: TgCallbackQuery, action: string, postId: string): Promise<void> {
  const person = await whoIs(club.db, cq.from)
  if (!person.staff || !UUID_RE.test(postId)) {
    await club.bot.answerCallback(cq.id, 'Только для сотрудников клуба')
    return
  }
  const msg = cq.message
  const post = await loadPost(club.db, postId)
  if (!post) {
    await club.bot.answerCallback(cq.id, 'Публикация не найдена')
    return
  }
  const name = person.profile?.nickname ?? person.user.first_name ?? 'сотрудник'
  const closeButtons = async (note: string) => {
    if (msg) await club.bot.call('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
    await club.bot.send(cq.from.id, note, { html: true })
  }

  if (action !== 'd' && !(await canApprove(club, person))) {
    await club.bot.answerCallback(cq.id, 'Одобряет владелец или сотрудник с доступом к СММ')
    return
  }
  try {
    switch (action) {
      case 'a': {
        const approved = await approvePost(envOf(club), postId, { id: person.profile!.id, name })
        await club.bot.answerCallback(cq.id, 'Одобрено')
        const next = (await canAutoPublish(club.db, approved)) ?`опубликую сам ${whenText(approved.publishAt)}` : `${whenText(approved.publishAt)} пришлю файлы и текст тому, кто выкладывает`
        await closeButtons(`✅ «${escapeHtml(approved.topic)}» одобрено — ${next}.`)
        return
      }
      case 'e':
        await setAwaitedRemark(club.key, String(cq.from.id), postId)
        await club.bot.answerCallback(cq.id)
        await club.bot.send(cq.from.id, `✏️ Что поправить в «${escapeHtml(post.topic)}»? Напиши или наговори голосом — текст, картинку, время.`, { html: true })
        return
      case 'x':
        await skipPost(envOf(club), postId)
        await club.bot.answerCallback(cq.id, 'Не выпускаем')
        await closeButtons(`🚫 «${escapeHtml(post.topic)}» не выйдет. Вернуть можно в HUB → СММ.`)
        return
      case 'd':
        await setAwaitedLink(club.key, String(cq.from.id), postId)
        await club.bot.answerCallback(cq.id)
        await club.bot.send(cq.from.id, `Супер! Пришли ссылку на «${escapeHtml(post.topic)}» — скопируй её в приложении (⋯ → «Ссылка»).`, { html: true })
        return
      default:
        await club.bot.answerCallback(cq.id)
    }
  } catch (error) {
    await club.bot.answerCallback(cq.id, error instanceof SmmError ? error.message.slice(0, 190) : 'Не получилось')
  }
}

/** Последняя переданная человеку публикация без ссылки — если он прислал ссылку без кнопки. */
async function pendingHandoff(club: TgClub, profileId: string | null): Promise<string | null> {
  const [row] = rows<{ id: string }>(await club.db.execute(sql`
    SELECT id FROM smm_posts
    WHERE status = 'approved' AND handoff_at IS NOT NULL AND published_url IS NULL
    ORDER BY (assignee_id = ${profileId}::uuid) DESC NULLS LAST, handoff_at DESC LIMIT 1
  `))
  return row?.id ?? null
}

async function onRemark(club: TgClub, person: TgPerson, chatId: number, postId: string, text: string): Promise<void> {
  await setAwaitedRemark(club.key, person.tgId, null)
  const name = person.profile?.nickname ?? person.user.first_name ?? 'сотрудник'
  const started = await reviseInBackground(
    club.db,
    postId,
    text,
    { id: person.profile?.id ?? null, name },
    async ({ post, reply }) => {
      await club.bot.send(chatId, `✍️ ${escapeHtml(reply)}`, { html: true })
      if (post.status !== 'published') await sendReviewTo(club.db, post, String(chatId), '🔁 Новая версия')
    },
    async (message) => {
      await club.bot.send(chatId, `😕 ${escapeHtml(message)}`, { html: true })
    },
  )
  await club.bot.send(chatId, started ? 'Принял, переделываю — пришлю новую версию через минуту 👌' : 'Я ещё работаю над этой публикацией — пришли замечание чуть позже.')
}

async function onLink(club: TgClub, person: TgPerson, chatId: number, url: string): Promise<boolean> {
  const postId = (await awaitedLinkPost(club.key, person.tgId)) ?? (await pendingHandoff(club, person.profile?.id ?? null))
  if (!postId) return false
  const post = await markPublished({ db: club.db, clubId: club.id }, postId, url.replace(/[).,!?]+$/, ''))
  await setAwaitedLink(club.key, person.tgId, null)
  await club.bot.send(chatId, `✅ Записал: «${escapeHtml(post.topic)}» вышла. Ссылка уже в HUB, цифры подтяну в аналитику.`, { html: true })
  return true
}

async function onScreenshot(club: TgClub, person: TgPerson, chatId: number, fileId: string, target: string | null): Promise<void> {
  await club.bot.chatAction(chatId, 'typing')
  const file = await club.bot.download(fileId)
  if (!file || file.data.length > MAX_SCREENSHOT_BYTES) {
    await club.bot.send(chatId, 'Не смог скачать скриншот 🙈 Пришли ещё раз.')
    return
  }
  const mime = file.path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  const [kind, id] = (target ?? '').split(':')
  try {
    const result = await applyScreenshot(club.db, file.data, mime, kind === 'post' ? { postId: id } : kind === 'account' ? { accountId: id } : {})
    if (result.applied) await setAwaitedStats(club.key, person.tgId, null)
    await club.bot.send(chatId, `📊 ${escapeHtml(result.summary)}`, { html: true })
  } catch (error) {
    await club.bot.send(chatId, `😕 ${escapeHtml(error instanceof SmmError ? error.message : 'Не получилось разобрать скриншот')}`, { html: true })
  }
}

/**
 * Личное сообщение сотрудника, которое касается СММ. true — обработано здесь,
 * Tai-собеседнику дальше не передаём.
 */
export async function onSmmPrivate(club: TgClub, person: TgPerson, msg: TgMessage, text: string): Promise<boolean> {
  if (!person.staff) return false
  const chatId = msg.chat.id
  const remarkPost = await awaitedRemarkPost(club.key, person.tgId)
  if (remarkPost && text && !LINK_RE.test(text)) {
    await onRemark(club, person, chatId, remarkPost, text)
    return true
  }
  const link = LINK_RE.exec(text)?.[0]
  if (link && (await onLink(club, person, chatId, link))) return true

  const photo = msg.photo?.[msg.photo.length - 1] ?? (msg.document?.mime_type?.startsWith('image/') ? msg.document : undefined)
  if (photo) {
    const target = await awaitedStats(club.key, person.tgId)
    if (target || /стат|охват|инсайт|insight/i.test(msg.caption ?? '')) {
      await onScreenshot(club, person, chatId, photo.file_id, target)
      return true
    }
  }
  return false
}
