/**
 * Бот клуба для гостей — Tai: через него гость получает статус своей заявки
 * (t.me/<Tai>?start=r_<claim_token>, modules/tg/login/request.ts) и напоминание
 * в день визита. Токен — интеграция клуба poll_bot_token (modules/tg/club.ts).
 */
import type { Database } from '@titan/database'
import { taiBot } from '../tg/club.js'

export interface ClientBot { token: string; username: string | null }

export async function getClientBot(db: Database): Promise<ClientBot | null> {
  const bot = await taiBot(db)
  if (!bot) return null
  return { token: bot.token, username: await bot.username() }
}

/** Ссылка «Получать статус в Telegram»: Tai привязывает чат гостя к заявке по claim_token. */
export function guestBotLink(bot: ClientBot | null, claimToken: string): string | null {
  return bot?.username ? `https://t.me/${bot.username}?start=r_${claimToken}` : null
}
