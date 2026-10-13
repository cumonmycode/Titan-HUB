/**
 * Статус заявки с сайта клуба в Telegram (раньше — бот Wallet). После отправки
 * формы сайт показывает кнопку «Получать статус в Telegram» →
 * t.me/<Tai>?start=r_<claim_token>. Tai привязывает чат гостя к заявке;
 * подтверждение, отказ и напоминание в день визита присылает API
 * (modules/requests/notify.ts) от его же имени.
 */
import { sql } from '@titan/database'
import type { TgClub } from '../club.js'
import type { TgUser } from '../types.js'

const TOKEN_RE = /^[a-f0-9]{32}$/
const LINK_TTL_DAYS = 60

interface Row { id: string; title: string | null; kind: string; status: string; starts_at: string | Date }

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[]
}

function whenOf(r: Row): string | null {
  if (r.kind === 'message') return null
  return new Date(r.starts_at).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })
}

export type LinkedRequest = Row

/**
 * /start r_<token>: привязать чат гостя к заявке. Возвращает заявку (Tai дальше ведёт
 * разговор сам) или null — ссылка битая или устарела (гостю уже сказали об этом).
 */
export async function linkRequestChat(club: TgClub, from: TgUser, chatId: number, token: string): Promise<LinkedRequest | null> {
  if (!TOKEN_RE.test(token)) {
    await club.bot.send(chatId, 'Ссылка недействительна. Если вы оставляли заявку на сайте — администратор свяжется с вами по телефону.')
    return null
  }
  const res = await club.db.execute(sql`
    UPDATE bookings SET guest_tg_chat = ${String(chatId)}, guest_tg_id = ${String(from.id)}, updated_at = now()
    WHERE claim_token = ${token} AND created_at > now() - make_interval(days => ${LINK_TTL_DAYS}::int)
    RETURNING id, title, kind, status, starts_at
  `)
  const r = rows<Row>(res)[0]
  if (!r) {
    await club.bot.send(chatId, 'Ссылка устарела или заявка не найдена. Если вопрос остался — напишите мне сюда или позвоните в клуб.')
    return null
  }
  return r
}

/** Текст без ИИ (модуль Tai выключен): что будет дальше с заявкой. */
export function requestLinkedText(r: LinkedRequest): string {
  const what = [r.title || 'Заявка', whenOf(r)].filter(Boolean).join(' · ')
  if (r.status === 'confirmed') return `✅ Заявка уже подтверждена: ${what}\nВ день визита пришлю напоминание.`
  if (r.status === 'cancelled') return `Заявка «${r.title || 'Заявка'}» отклонена. Если это ошибка — напишите мне или позвоните в клуб.`
  return `Готово! Заявка получена: ${what}\nКак только администратор её подтвердит, напишу сюда. В день визита пришлю напоминание.`
}
