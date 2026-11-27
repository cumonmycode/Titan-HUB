/**
 * Личка Tai, когда диалог ведёт сотрудник (tai_contacts.ai_paused): Tai не отвечает,
 * сообщение клиента сохраняется в истории, диалог помечается «ждёт ответа», персоналу —
 * push «Клиент ждёт ответа» (один раз, пока сотрудник не ответит или не прочитает).
 */
import { taiContacts, eq } from '@titan/database'
import { publishEvent } from '../../lib/realtime.js'
import { notify } from '../notifications/push.js'
import type { TgClub } from './club.js'
import { displayName, type TgPerson } from './identity.js'
import type { TgMessage } from './types.js'
import { appendMessage } from './dialog/memory.js'
import { voiceToText } from './private.js'
import { INBOX_EVENT } from './inbox.router.js'

const PREVIEW_MAX = 140

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
  await appendMessage(club.db, { chatId: person.tgId, tgId: person.tgId, role: 'user', content, voice })
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
