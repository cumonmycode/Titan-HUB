/**
 * Уведомления персонала → групповые чаты Telegram. Каждый чат в разделе HUB
 * «Telegram» подписывается на категории событий (и, при желании, на свой топик);
 * общее уведомление (notify без адресата) уходит во все подписанные чаты.
 * Заявки с сайта сюда не входят — у них своё сообщение с кнопками (requests/notify.ts).
 */
import type { Database } from '@titan/database'
import { escapeHtml } from './tgBot.js'
import { chatsForCategory, type BroadcastCategory } from './tgChatConfig.js'
import { taiBot } from '../modules/tg/club.js'

/** Тип уведомления → категория чата. Не перечисленные типы в чаты не идут. */
const CATEGORY_OF_TYPE: Record<string, BroadcastCategory> = {
  shift_open: 'shifts',
  shift_close: 'shifts',
  cash_discrepancy: 'shifts',
  new_client: 'clients',
  client_registration: 'clients',
  birthday: 'clients',
  guest_feedback: 'clients',
  deposit_topup: 'money',
  debt_created: 'money',
  sbp_second_payment: 'money',
  balance_audit: 'money',
  low_stock: 'stock',
  supply_received: 'stock',
  event_created: 'events',
  event_completed: 'events',
  rental_started: 'events',
}

export const categoryOfType = (type: string): BroadcastCategory | null => CATEGORY_OF_TYPE[type] ?? null

/** Разослать уведомление в подписанные чаты. Никогда не бросает. */
export async function postNotificationToChats(db: Database, n: { type: string; title: string; body: string }): Promise<number> {
  const cat = categoryOfType(n.type)
  if (!cat) return 0
  try {
    const targets = await chatsForCategory(db, cat)
    if (!targets.length) return 0
    const bot = await taiBot(db)
    if (!bot) return 0
    const text = `🔔 <b>${escapeHtml(n.title)}</b>\n${escapeHtml(n.body)}`
    const sent = await Promise.all(targets.map((t) => bot.send(t.chatId, text, { html: true, threadId: t.threadId })))
    return sent.filter((r) => r.ok).length
  } catch (err) {
    console.warn('[tg-chats] уведомление в чаты не ушло:', err)
    return 0
  }
}
