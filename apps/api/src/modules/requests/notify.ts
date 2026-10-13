/**
 * Уведомления по онлайн-заявкам (сайт клуба).
 *
 * Персоналу: push владельцам и сотруднику на открытой смене + сообщение в чат
 * персонала в Telegram (бот групп клуба) с контактами гостя и кнопками; итог
 * (подтверждено / отклонено) бот дописывает в то же сообщение.
 * Гостю: статус и напоминание через клиентского бота, если он нажал «Получать
 * статус в Telegram». Ничего не бросает наружу: заявка уже сохранена.
 */
import { sql, appSettings, profiles, eq, and, inArray, isNull, type Database } from '@titan/database'
import { notify } from '../notifications/push.js'
import { getCurrentShift } from '../shifts/shifts.service.js'
import { getClubIntegration } from '../../lib/secrets.js'
import { editTelegramMessage, sendTelegramMessage, type TgUrlButton } from '../../lib/telegram.js'
import { readRequestsChat, readSiteContacts } from '../site/settings.js'
import { getClientBot } from './clientBot.js'

export type RequestKind = 'event' | 'game' | 'message'

export interface RequestRow {
  id: string
  kind: RequestKind
  title: string | null
  name: string
  phone: string | null
  guests: number | null
  location: string | null
  address: string | null
  zone_name: string | null
  tariff_hours: number | string | null
  comment: string | null
  meta: Record<string, unknown> | null
  status: string
  /** Актуальное начало: после подтверждения — время мероприятия (его могли перенести). */
  starts_at: string | Date
  guest_tg_chat: string | null
  staff_tg_chat: string | null
  staff_tg_message_id: string | number | null
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

export async function loadRequest(db: Database, id: string): Promise<RequestRow | null> {
  const res = await db.execute(sql`
    SELECT b.id, b.kind, b.title, b.name, b.phone, b.guests, b.location, b.address,
           COALESCE(es.name, s.name) AS zone_name, COALESCE(ev.planned_hours, b.tariff_hours) AS tariff_hours,
           b.comment, b.meta, b.status, b.guest_tg_chat, b.staff_tg_chat, b.staff_tg_message_id,
           CASE WHEN ev.id IS NOT NULL THEN ((ev.date || ' ' || ev.start_time)::timestamp AT TIME ZONE 'Europe/Moscow')
                ELSE b.starts_at END AS starts_at
    FROM bookings b
    LEFT JOIN spaces s ON s.id = b.space_id
    LEFT JOIN events ev ON ev.id = b.event_id
    LEFT JOIN spaces es ON es.id = ev.space_id
    WHERE b.id = ${id}
    LIMIT 1
  `)
  return rows<RequestRow>(res)[0] ?? null
}

// ─── Текст заявки ────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const KIND_ICON: Record<RequestKind, string> = { game: '🎲', event: '🎉', message: '✉️' }
const PUSH_TITLE: Record<RequestKind, string> = { game: '🎲 Запись на игру', event: '🎉 Заявка на мероприятие', message: '✉️ Сообщение с сайта' }
const CONFIRMED: Record<RequestKind, string> = { game: 'Ждём гостя', event: 'Подтверждена', message: 'Обработано' }

export function whenOf(r: RequestRow): string | null {
  if (r.kind === 'message') return null
  return new Date(r.starts_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}
export function timeOf(r: RequestRow): string {
  return new Date(r.starts_at).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
}
export function whereOf(r: RequestRow): string | null {
  if (r.kind === 'message') return null
  if (r.location === 'exit') return r.address ? `Выезд: ${r.address}` : 'Выезд'
  return r.zone_name ? `В клубе · ${r.zone_name}` : 'В клубе'
}
const hoursOf = (r: RequestRow) => (r.tariff_hours ? ` · ${Number(r.tariff_hours)} ч` : '')
const titleOf = (r: RequestRow) => r.title || 'Заявка с сайта'

function telegramOf(r: RequestRow): string | null {
  const t = r.meta?.['telegram']
  return typeof t === 'string' && t.trim() ? t.trim() : null
}
function tgUsername(raw: string): string | null {
  const m = raw.match(/^(?:@|https?:\/\/t\.me\/)?([A-Za-z0-9_]{5,32})$/)
  return m?.[1] ?? null
}
function whatsappLink(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  const n = d.length === 10 ? `7${d}` : d.length === 11 && d.startsWith('8') ? `7${d.slice(1)}` : d
  return `https://wa.me/${n}`
}

function staffText(r: RequestRow, outcome?: string): string {
  const tg = telegramOf(r)
  const when = whenOf(r)
  const where = whereOf(r)
  const lines = [`${KIND_ICON[r.kind]} <b>${esc(titleOf(r))}</b>`]
  if (when) lines.push(`📅 ${esc(when)}${hoursOf(r)}`)
  if (where) lines.push(`📍 ${esc(where)}`)
  if (r.guests) lines.push(`👥 ${r.guests}`)
  lines.push(`👤 ${esc(r.name)}${r.phone ? ` · ${esc(r.phone)}` : ''}${tg ? ` · ${esc(tg)}` : ''}`)
  if (r.comment) lines.push(`💬 ${esc(r.comment.slice(0, 700))}`)
  if (outcome) lines.push('', outcome)
  return lines.join('\n')
}

function staffButtons(r: RequestRow, hubOrigin: string | null): TgUrlButton[][] {
  const contact: TgUrlButton[] = []
  const wa = whatsappLink(r.phone)
  if (wa) contact.push({ text: 'WhatsApp', url: wa })
  const tg = telegramOf(r)
  const tgName = tg ? tgUsername(tg) : null
  if (tgName) contact.push({ text: 'Telegram', url: `https://t.me/${tgName}` })
  const out: TgUrlButton[][] = contact.length ? [contact] : []
  if (hubOrigin) out.push([{ text: 'Открыть в HUB', url: `${hubOrigin}/events` }])
  return out
}

// ─── Новая заявка ────────────────────────────────────────────────────────────
async function pushStaff(db: Database, clubId: string | null | undefined, r: RequestRow): Promise<void> {
  const owners = await db.select({ id: profiles.id }).from(profiles)
    .where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))
  const ids = new Set(owners.map((o) => o.id))
  // Администратор на открытой смене — чтобы перезвонил сразу.
  const shift = await getCurrentShift(db)
  if (shift?.openedBy) ids.add(shift.openedBy)
  const body = [titleOf(r), r.name, whenOf(r), r.phone].filter(Boolean).join(' · ')
  for (const userId of ids) {
    await notify({ type: 'site_request', title: PUSH_TITLE[r.kind], body, meta: { bookingId: r.id, url: '/events' }, userId }, db, clubId)
  }
}

/**
 * Рабочий чат для заявок: выбранный в «Сайт → Уведомления», иначе первый рабочий чат Tai
 * (группа персонала, режим work).
 */
export async function workChat(db: Database): Promise<{ chatId: string; threadId: number | null } | null> {
  const chosen = await readRequestsChat(db)
  if (chosen) return chosen
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'tai_chat_settings'))
  try {
    const prefs = JSON.parse(row?.value ?? '{}') as Record<string, { mode?: string }>
    const id = Object.keys(prefs).find((k) => prefs[k]?.mode === 'work')
    return id ? { chatId: id, threadId: null } : null
  } catch {
    return null
  }
}

/** Сообщение в рабочий чат (HTML); replyTo — сообщение заявки. Возвращает id сообщения. */
export async function postToWorkChat(db: Database, html: string, replyTo?: number | null): Promise<{ chatId: string; messageId: number } | null> {
  const chat = await workChat(db)
  if (!chat) return null
  const token = await getClubIntegration(db, 'poll_bot_token').catch(() => null)
  if (!token) return null
  const sent = await sendTelegramMessage(token, chat.chatId, html, { messageThreadId: chat.threadId, parseMode: 'HTML', replyToMessageId: replyTo ?? null })
  if (!sent.ok || !sent.messageId) {
    console.error('[requests] рабочий чат не принял сообщение:', sent.error)
    return null
  }
  return { chatId: chat.chatId, messageId: sent.messageId }
}

export { staffText as requestStaffText }

async function postStaffChat(db: Database, r: RequestRow, hubOrigin: string | null): Promise<void> {
  const chat = await workChat(db)
  if (!chat) return
  const token = await getClubIntegration(db, 'poll_bot_token').catch(() => null)
  if (!token) return
  const sent = await sendTelegramMessage(token, chat.chatId, staffText(r), {
    messageThreadId: chat.threadId, parseMode: 'HTML', buttons: staffButtons(r, hubOrigin),
  })
  if (!sent.ok) {
    console.error('[requests] чат персонала не принял заявку:', sent.error)
    return
  }
  if (sent.messageId) {
    await db.execute(sql`UPDATE bookings SET staff_tg_chat = ${chat.chatId}, staff_tg_message_id = ${sent.messageId} WHERE id = ${r.id}`)
  }
}

/** Push владельцам и администратору смены + сообщение в чат персонала. */
export async function notifyNewRequest(db: Database, clubId: string | null | undefined, id: string, hubOrigin: string | null): Promise<void> {
  try {
    const r = await loadRequest(db, id)
    if (!r) return
    await pushStaff(db, clubId, r)
    await postStaffChat(db, r, hubOrigin)
  } catch (e) {
    console.error('[requests] уведомление о новой заявке не ушло:', e)
  }
}

// ─── Решение по заявке ───────────────────────────────────────────────────────
interface Venue { address: string; phone: string }

async function readVenue(db: Database): Promise<Venue> {
  const settings = await db.select().from(appSettings).where(inArray(appSettings.key, ['venue_address']))
  const contacts = await readSiteContacts(db)
  return { address: settings.find((s) => s.key === 'venue_address')?.value ?? '', phone: contacts.phone }
}

function guestStatusText(r: RequestRow, status: 'confirmed' | 'cancelled', venue: Venue): string {
  const when = whenOf(r)
  if (status === 'cancelled') {
    return [`Заявка «${titleOf(r)}»${when ? ` на ${when}` : ''} отклонена.`, venue.phone ? `Если это ошибка — позвоните нам: ${venue.phone}` : null]
      .filter(Boolean).join('\n')
  }
  if (r.kind === 'message') return '✅ Ваше обращение обработано. Спасибо, что написали нам!'
  if (r.kind === 'game') {
    return [`✅ Вы записаны: ${titleOf(r).replace(/^Запись на игру · /, '')}`, when, venue.address ? `Ждём вас: ${venue.address}` : 'Ждём вас в клубе!']
      .filter(Boolean).join('\n')
  }
  return [`✅ Заявка подтверждена: ${titleOf(r)}`, when ? `${when}${hoursOf(r)}` : null, whereOf(r), 'Администратор свяжется, чтобы обсудить детали.']
    .filter(Boolean).join('\n')
}

/** Сообщение гостю через клиентского бота. Возвращает true, если Telegram принял. */
export async function messageGuest(db: Database, chatId: string, text: string): Promise<boolean> {
  const bot = await getClientBot(db)
  if (!bot) return false
  const sent = await sendTelegramMessage(bot.token, chatId, text)
  if (!sent.ok) console.error('[requests] сообщение гостю не ушло:', sent.error)
  return sent.ok
}

/** Итог в чат персонала и статус гостю после «Подтвердить» / «Отклонить». */
export async function notifyRequestStatus(
  db: Database, id: string, status: 'confirmed' | 'cancelled', actor: string, hubOrigin: string | null,
  opts: { guest?: boolean } = {},
): Promise<void> {
  try {
    const r = await loadRequest(db, id)
    if (!r) return
    if (r.staff_tg_chat && r.staff_tg_message_id) {
      const token = await getClubIntegration(db, 'poll_bot_token').catch(() => null)
      const outcome = status === 'confirmed' ? `✅ ${CONFIRMED[r.kind]} — ${esc(actor)}` : `❌ Отклонена — ${esc(actor)}`
      if (token) {
        await editTelegramMessage(token, r.staff_tg_chat, Number(r.staff_tg_message_id), staffText(r, outcome), {
          parseMode: 'HTML', buttons: staffButtons(r, hubOrigin),
        })
      }
    }
    // Решил сам Tai в разговоре с гостем — он уже всё сказал, дубль статуса не шлём.
    if (r.guest_tg_chat && opts.guest !== false) await messageGuest(db, r.guest_tg_chat, guestStatusText(r, status, await readVenue(db)))
  } catch (e) {
    console.error('[requests] уведомление о решении по заявке не ушло:', e)
  }
}

/** Напоминание гостю в день визита (крон). */
export async function remindGuest(db: Database, r: RequestRow): Promise<boolean> {
  if (!r.guest_tg_chat) return false
  const venue = await readVenue(db)
  const text = r.kind === 'game'
    ? [`⏰ Сегодня игра: ${titleOf(r).replace(/^Запись на игру · /, '')}, начало в ${timeOf(r)}.`, venue.address ? `Адрес: ${venue.address}` : null, 'Ждём вас!']
    : [`⏰ Напоминаем: сегодня в ${timeOf(r)} — ${titleOf(r)}.`, whereOf(r), 'Ждём вас!']
  return messageGuest(db, r.guest_tg_chat, text.filter(Boolean).join('\n'))
}
