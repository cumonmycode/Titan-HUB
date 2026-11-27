/**
 * Личка Tai, когда диалог ведёт сотрудник (tai_contacts.ai_paused): Tai не отвечает,
 * сообщение клиента сохраняется в истории, диалог помечается «ждёт ответа», персоналу —
 * push «Клиент ждёт ответа» (один раз, пока сотрудник не ответит или не прочитает).
 */
import { taiContacts, eq, and, lte, isNotNull, type Database, type TaiContact } from '@titan/database'
import { storeImageBuffer } from '../../lib/imageStore.js'
import { publishEvent } from '../../lib/realtime.js'
import { notify } from '../notifications/push.js'
import type { TgClub } from './club.js'
import { displayName, type TgPerson } from './identity.js'
import type { TgMessage } from './types.js'
import { appendMessage } from './dialog/memory.js'
import { aiEnabled, voiceToText } from './private.js'
import { clubForDb } from './club.js'
import { whoIs } from './identity.js'
import { converse } from './dialog/converse.js'
import { INBOX_EVENT } from './inbox.router.js'

const PREVIEW_MAX = 140

/** Фото клиента — копия в хранилище клуба, чтобы его было видно в переписке HUB. */
async function keepPhoto(club: TgClub, msg: TgMessage): Promise<string | null> {
  const largest = msg.photo?.[msg.photo.length - 1]
  if (!largest) return null
  const file = await club.bot.download(largest.file_id).catch(() => null)
  if (!file) return null
  const stored = await storeImageBuffer(file.data, 'tai')
  return stored.ok ? stored.url : null
}

/** Что написал клиент, текстом: голос распознаём, вложения подписываем. */
async function inboundText(club: TgClub, msg: TgMessage, text: string): Promise<{ content: string; voice: boolean }> {
  const file = msg.voice ?? msg.audio ?? msg.video_note
  if (file) {
    const heard = await voiceToText(club, file).catch(() => null)
    return { content: heard ? `🎤 ${heard}` : '🎤 Голосовое сообщение', voice: true }
  }
  const caption = (msg.caption ?? '').trim()
  if (msg.photo?.length) return { content: caption ? `[Фото] ${caption}` : '[Фото]', voice: false }
  if (msg.document) return { content: `[Файл «${msg.document.file_name ?? 'без имени'}»]${caption ? ` ${caption}` : ''}`, voice: false }
  if (msg.contact) return { content: `[Контакт] ${msg.contact.phone_number}`, voice: false }
  return { content: text || caption || '[Сообщение]', voice: false }
}

export async function holdForStaff(club: TgClub, person: TgPerson, msg: TgMessage, text: string): Promise<void> {
  const { content, voice } = await inboundText(club, msg, text)
  const photoUrl = await keepPhoto(club, msg)
  await appendMessage(club.db, { chatId: person.tgId, tgId: person.tgId, role: 'user', content, voice, photoUrl })
  const [before] = await club.db.select({ needsAttention: taiContacts.needsAttention }).from(taiContacts)
    .where(eq(taiContacts.tgId, person.tgId)).limit(1)
  await club.db.update(taiContacts).set({ needsAttention: true, updatedAt: new Date() }).where(eq(taiContacts.tgId, person.tgId))
  publishEvent(club.id, INBOX_EVENT, { tgId: person.tgId })
  if (before?.needsAttention) return
  void notify({
    type: 'tai_dialog',
    title: '💬 Клиент ждёт ответа',
    body: `${displayName(person)}: ${content.slice(0, PREVIEW_MAX)}`,
    meta: { tgId: person.tgId },
  }, club.db, club.id).catch(() => {})
}

/** Вернуть Tai в чат (кнопка в HUB или час без ответа сотрудника). */
export async function resumeTai(club: Pick<TgClub, 'db' | 'id'>, tgId: string): Promise<void> {
  await club.db.update(taiContacts).set({ aiPaused: false, aiResumeAt: null, needsAttention: false, updatedAt: new Date() }).where(eq(taiContacts.tgId, tgId))
  publishEvent(club.id, INBOX_EVENT, { tgId })
}

const RESUME_BATCH = 20

/**
 * Крон раз в минуту: чаты, где сотрудник молчит час, возвращаются Tai. Если человек
 * ждёт ответа — Tai сразу отвечает на его последние сообщения, не дожидаясь нового.
 */
export async function resumeIdleChats(db: Database, clubId: string | null): Promise<void> {
  const due = await db.select().from(taiContacts)
    .where(and(eq(taiContacts.aiPaused, true), isNotNull(taiContacts.aiResumeAt), lte(taiContacts.aiResumeAt, new Date())))
    .limit(RESUME_BATCH)
  for (const contact of due) {
    await resumeTai({ db, id: clubId }, contact.tgId)
    if (contact.needsAttention) await answerAfterPause(db, clubId, contact)
  }
}

/** Tai вернулся в чат, а человек ждёт ответа — отвечает на его последние сообщения. */
export async function answerAfterPause(db: Database, clubId: string | null, contact: TaiContact): Promise<void> {
  const club = await clubForDb(db, clubId)
  if (!club || !contact.dmOpen || !(await aiEnabled(club))) return
  const person = await whoIs(db, { id: Number(contact.tgId), is_bot: false, first_name: contact.firstName ?? undefined, username: contact.username ?? undefined })
  if (person.staff) return
  await converse(club, person, { ...contact, aiPaused: false }, { chatId: contact.tgId, threadId: null, replyTo: null, groupTitle: null }, '', false, { replay: true })
    .catch((error: unknown) => console.warn('[tai-resume] ответ после паузы не ушёл:', error instanceof Error ? error.message : error))
}
