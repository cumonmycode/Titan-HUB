import type { Context } from 'grammy'
import { sql, type Database } from '@titan/database'

// ─────────────────────────────────────────────────────────────────────────────
// Статус заявки с сайта клуба в Telegram. После отправки формы сайт показывает
// кнопку «Получать статус в Telegram» → t.me/<бот>?start=r_<claim_token>. Здесь
// бот привязывает чат гостя к заявке; подтверждение, отказ и напоминание в день
// визита присылает API (modules/requests/notify.ts) от имени этого же бота.
// ─────────────────────────────────────────────────────────────────────────────

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

/** /start r_<token>: привязать чат гостя к заявке и рассказать, что будет дальше. */
export async function bindRequestChat(ctx: Context, db: Database, token: string): Promise<void> {
  if (!TOKEN_RE.test(token) || !ctx.chat || !ctx.from) {
    await ctx.reply('Ссылка недействительна. Если вы оставляли заявку на сайте — администратор свяжется с вами по телефону.')
    return
  }
  const res = await db.execute(sql`
    UPDATE bookings SET guest_tg_chat = ${String(ctx.chat.id)}, guest_tg_id = ${String(ctx.from.id)}, updated_at = now()
    WHERE claim_token = ${token} AND created_at > now() - make_interval(days => ${LINK_TTL_DAYS}::int)
    RETURNING id, title, kind, status, starts_at
  `)
  const r = rows<Row>(res)[0]
  if (!r) {
    await ctx.reply('Ссылка устарела или заявка не найдена. Если вопрос остался — позвоните в клуб.')
    return
  }
  const what = [r.title || 'Заявка', whenOf(r)].filter(Boolean).join(' · ')
  if (r.status === 'confirmed') {
    await ctx.reply(`✅ Заявка уже подтверждена: ${what}\nВ день визита пришлю напоминание.`)
  } else if (r.status === 'cancelled') {
    await ctx.reply(`Заявка «${r.title || 'Заявка'}» отклонена. Если это ошибка — позвоните в клуб.`)
  } else {
    await ctx.reply(`Готово! Заявка получена: ${what}\nКак только администратор её подтвердит, напишу сюда. В день визита пришлю напоминание.`)
  }
}
