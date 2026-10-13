/**
 * СММ в Telegram: кнопки под превью («Одобрить», «Поправить», «Не выкладывать»,
 * «Выложил») и личка Tai — замечание к посту текстом или голосом, ссылка на
 * вышедшую публикацию. Цифры Tai берёт по API площадок. Работает только с сотрудниками.
 */
import { sql } from '@titan/database'
import { escapeHtml } from '../../lib/tgBot.js'
import type { TgClub } from '../tg/club.js'
import { whoIs, type TgPerson } from '../tg/identity.js'
import type { TgCallbackQuery, TgMessage } from '../tg/types.js'
import { loadPost, rows } from './db.js'
import {
  approvers, awaitedLinkPost, awaitedRemarkPost, sendReviewTo, setAwaitedLink, setAwaitedRemark, whenText,
} from './telegram.js'
import { SmmError } from './types.js'
import { approvePost, canAutoPublish, markPublished, skipPost, type SmmEnv } from './workflow.js'
import { reviseInBackground } from './writer.js'

const UUID_RE = /^[0-9a-f-]{36}$/i
const LINK_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am|t\.me|vk\.com|vk\.ru)\/[^\s<>"]+/i

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
        await club.bot.answerCallback(cq.id, 'Не выкладываем')
        await closeButtons(`🚫 «${escapeHtml(post.topic)}» не выкладываем — осталась в плане серой. Вернуть можно в HUB → СММ.`)
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
  return !!link && (await onLink(club, person, chatId, link))
}
