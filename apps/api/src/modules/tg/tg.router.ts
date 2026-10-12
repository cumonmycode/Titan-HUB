import { Hono } from 'hono'
import { tgWebhookSecretValid } from '../../lib/tgWebhook.js'
import { upsertRosterUser } from '../../lib/roster.js'
import { recordVote } from '../../lib/pollState.js'
import { recordChat } from '../../lib/tgChats.js'
import { getSharedRedis } from '../../lib/redis.js'
import { clubById, type TgClub } from './club.js'
import type { TgUpdate } from './types.js'
import { onPrivateMessage } from './private.js'
import { onGroupMessage, onBotMembership } from './group.js'
import { onCallback } from './callbacks.js'
import { updateContact } from './dialog/memory.js'

// ─────────────────────────────────────────────────────────────────────────────
// Приёмник вебхука бота Tai — единого Telegram-бота клуба: группы (опросы,
// команды-отметки, рабочий чат), личка (вход в приложения, разговор с клиентами
// и сотрудниками), кнопки. НЕ для браузера. Защита — secret_token Telegram.
//
// Отвечаем 200 сразу (кроме неверного секрета → 403), а апдейт обрабатываем в
// фоне: ответ ИИ занимает секунды, и Telegram не должен ждать и повторять доставку.
// Апдейты одного чата идут строго по очереди — ответы не перепутаются.
// ─────────────────────────────────────────────────────────────────────────────
export const tgRouter = new Hono()

const DEDUP_TTL_SEC = 3600
const chains = new Map<string, Promise<void>>()

/** Выполнить задачу после предыдущих задач того же чата. */
function enqueue(key: string, job: () => Promise<void>): void {
  const prev = chains.get(key) ?? Promise.resolve()
  const next = prev
    .then(job)
    .catch((e) => console.error('[tai] обработка апдейта не удалась', e))
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key)
    })
  chains.set(key, next)
}

/** Telegram повторяет доставку при сбоях — один апдейт обрабатываем один раз. */
async function firstDelivery(clubId: string, updateId: number): Promise<boolean> {
  const ok = await getSharedRedis().set(`tg:upd:${clubId}:${updateId}`, '1', 'EX', DEDUP_TTL_SEC, 'NX').catch(() => 'OK')
  return ok === 'OK'
}

function chatKeyOf(update: TgUpdate): string {
  const chat = update.message?.chat ?? update.edited_message?.chat ?? update.callback_query?.message?.chat ?? update.my_chat_member?.chat ?? update.chat_member?.chat
  if (chat) return String(chat.id)
  return update.poll_answer ? 'poll' : 'other'
}

async function processUpdate(club: TgClub, update: TgUpdate): Promise<void> {
  const msg = update.message ?? update.edited_message
  if (msg) {
    if (msg.chat.type === 'private') {
      if (update.message) await onPrivateMessage(club, msg)
    } else {
      await onGroupMessage(club, msg, !update.message)
    }
  }
  if (update.callback_query) await onCallback(club, update.callback_query)

  const member = update.my_chat_member ?? update.chat_member
  if (member) {
    if (member.chat.type === 'private' && update.my_chat_member) {
      // Человек заблокировал или снова запустил бота — можно ли писать ему первым.
      const status = member.new_chat_member?.status
      await updateContact(club.db, String(member.from.id), { dmOpen: status !== 'kicked' })
    } else if (member.chat.type !== 'private') {
      await recordChat(club.db, member.chat)
      if (member.new_chat_member?.user) await upsertRosterUser(club.db, member.new_chat_member.user, member.chat.id)
      if (update.my_chat_member) await onBotMembership(club, member)
    }
  }

  const pa = update.poll_answer
  if (pa?.user) {
    await upsertRosterUser(club.db, pa.user, pa.voter_chat?.id ?? null)
    // Голос для @tvari и записи на сегодня (option_ids пустой = отозвал голос).
    if (pa.poll_id) await recordVote(club.db, String(pa.poll_id), String(pa.user.id), pa.option_ids)
  }
}

tgRouter.post('/poll-webhook/:clubId', async (c) => {
  const clubId = c.req.param('clubId')
  if (!tgWebhookSecretValid(c.req.header('x-telegram-bot-api-secret-token'), clubId)) {
    return c.json({ ok: false }, 403)
  }
  const update = (await c.req.json().catch(() => null)) as TgUpdate | null
  if (!update || typeof update.update_id !== 'number') return c.json({ ok: true })

  let club: TgClub | null = null
  try {
    club = await clubById(clubId)
  } catch (e) {
    console.error('[tai] резолв клуба не удался', e)
  }
  // Неизвестный клуб или нет бота — подтверждаем, чтобы Telegram не повторял.
  if (!club) return c.json({ ok: true })
  if (!(await firstDelivery(clubId, update.update_id))) return c.json({ ok: true })

  const target = club
  enqueue(`${clubId}:${chatKeyOf(update)}`, () => processUpdate(target, update))
  return c.json({ ok: true })
})
