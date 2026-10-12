/**
 * Личка Tai: вход в приложения, привязка, коды — и разговор со всеми остальными
 * сообщениями (текст или голос). Кто пишет — сотрудник, клиент или новый
 * человек — Tai определяет сам (identity.ts).
 */
import { resolveClubByHost } from '../../lib/clubResolver.js'
import { aiAllowed } from '../../middleware/module.js'
import { resolveApiKey } from '../ai/tai/llm.js'
import { transcribe } from '../ai/tai/speech.js'
import type { TgClub } from './club.js'
import { whoIs } from './identity.js'
import type { TgFile, TgMessage, TgUser } from './types.js'
import { NO, REMOVE_KEYBOARD, pendingRow } from './login/common.js'
import { handleAppContact, handleAppStart, handleLegacyLogin, handleWebCode, rejectLatest } from './login/app.js'
import { handleHubContact, handleHubStart } from './login/hub.js'
import { handleLinkCode, handleLinkStart } from './login/link.js'
import { converse } from './dialog/converse.js'
import { touchContact, updateContact } from './dialog/memory.js'

const MAX_VOICE_BYTES = 8 * 1024 * 1024
const START_GREETING = 'Привет! (человек только что открыл бота и нажал «Старт» — поздоровайся и коротко скажи, чем можешь помочь)'
// «Ответь голосом», «скажи голосовым» — человек просит голос, даже если писал текстом.
const ASKS_VOICE = /(ответь|скажи|запиши|отправь|пришли|расскажи)\w*\s+(мне\s+)?голос/i

/** Модуль ИИ клуба включён (на основном домене — всегда). */
async function aiEnabled(club: TgClub): Promise<boolean> {
  if (!club.id) return true
  const resolved = await resolveClubByHost(club.host).catch(() => null)
  return aiAllowed(resolved)
}

/** Голосовое → текст. null — не удалось скачать или распознать. */
export async function voiceToText(club: TgClub, file: TgFile): Promise<string | null> {
  if (file.file_size && file.file_size > MAX_VOICE_BYTES) return null
  const downloaded = await club.bot.download(file.file_id)
  if (!downloaded) return null
  const name = downloaded.path.split('/').pop() || 'voice.ogg'
  const type = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/ogg'
  return transcribe(await resolveApiKey(club.db), new Blob([new Uint8Array(downloaded.data)], { type }), name)
}

async function onContact(club: TgClub, from: TgUser, chatId: number, contact: NonNullable<TgMessage['contact']>): Promise<void> {
  const row = await pendingRow(club.db, String(from.id))
  if (!row) {
    await club.bot.send(chatId, 'Нет активного запроса входа. Начни вход в приложении.', { markup: REMOVE_KEYBOARD })
    return
  }
  // Нужен номер именно этого аккаунта, а не пересланный чужой контакт.
  if (String(contact.user_id ?? '') !== String(from.id)) {
    await club.bot.send(chatId, 'Нажми кнопку «Да, это я» внизу — нужен номер твоего аккаунта, а не чужой контакт.')
    return
  }
  if (row.mode === 'hub') await handleHubContact(club, from, chatId, row, contact.phone_number)
  else await handleAppContact(club, from, chatId, row, contact.phone_number)
}

/** /start с параметром: вход и привязка. true — обработано. */
async function onStartPayload(club: TgClub, from: TgUser, chatId: number, payload: string): Promise<boolean> {
  if (payload.startsWith('app_')) await handleAppStart(club, from, chatId, payload.slice(4))
  else if (payload.startsWith('hub_')) await handleHubStart(club, from, chatId, payload.slice(4))
  else if (payload.startsWith('login_')) await handleLegacyLogin(club, from, chatId, payload.slice(6))
  else if (payload.startsWith('link_')) await handleLinkStart(club, from, chatId, payload.slice(5))
  else return false
  return true
}

export async function onPrivateMessage(club: TgClub, msg: TgMessage): Promise<void> {
  const from = msg.from
  if (!from || from.is_bot) return
  const chatId = msg.chat.id
  const text = (msg.text ?? '').trim()

  if (text.startsWith('/start')) {
    const payload = text.slice('/start'.length).trim()
    if (payload && (await onStartPayload(club, from, chatId, payload))) return
  }
  if (msg.contact) {
    await onContact(club, from, chatId, msg.contact)
    return
  }
  if (text === NO) {
    await rejectLatest(club, from, chatId, await pendingRow(club.db, String(from.id)))
    return
  }
  if (/^\d{4}$/.test(text) && (await handleWebCode(club, from, chatId, text))) return
  if (/^\d{6}$/.test(text) && (await handleLinkCode(club, from, chatId, text))) return

  const person = await whoIs(club.db, from)
  const contact = await touchContact(club.db, from, person.profile?.id ?? null)
  if (text === '/stop') {
    await updateContact(club.db, person.tgId, { optedOut: true, remindAt: null, remindKind: null })
    await club.bot.send(chatId, 'Понял, сам больше писать не буду 🤝 Если что — я здесь, пиши в любой момент.')
    return
  }
  if (!(await aiEnabled(club))) {
    await club.bot.send(chatId, 'Я пока умею только подтверждать вход в приложения клуба. С вопросами — к администратору 🙂')
    return
  }

  let input = text === '/start' ? START_GREETING : text || (msg.caption ?? '').trim()
  let voice = false
  const file = msg.voice ?? msg.audio ?? msg.video_note
  if (file) {
    void club.bot.chatAction(chatId, 'typing')
    const heard = await voiceToText(club, file)
    if (!heard) {
      await club.bot.send(chatId, 'Не расслышал 🙈 Запиши ещё раз или напиши текстом.')
      return
    }
    input = heard
    voice = true
  }
  if (!input) {
    await club.bot.send(chatId, 'Я понимаю текст и голосовые — напиши или наговори, что нужно 🙂')
    return
  }
  await converse(club, person, contact, { chatId: String(chatId), threadId: null, replyTo: null, groupTitle: null }, input, voice || ASKS_VOICE.test(input))
}
