/**
 * Клиентский бот клуба (бот My Titan): через него гость получает статус своей
 * заявки. Токен — интеграция клуба wallet_bot_token; у основного клуба (БД из
 * DATABASE_URL) — фолбэк на env WALLET_BOT_TOKEN, как в bot-wallet.
 */
import { sql, type Database } from '@titan/database'
import { getClubIntegration } from '../../lib/secrets.js'
import { getTelegramBotUsername } from '../../lib/telegram.js'

const ENV_TOKEN = process.env['WALLET_BOT_TOKEN'] || null
const ENV_USERNAME = (process.env['WALLET_BOT_USERNAME'] || '').replace(/^@/, '') || null
const DEFAULT_DB = (() => {
  try { return new URL(process.env['DATABASE_URL'] ?? '').pathname.replace(/^\//, '') } catch { return '' }
})()

// Имена ботов по токену: getMe — сетевой вызов, кэшируем только удачные ответы.
const usernames = new Map<string, string>()
const defaultDbOf = new WeakMap<Database, boolean>()

async function isDefaultDb(db: Database): Promise<boolean> {
  const known = defaultDbOf.get(db)
  if (known !== undefined) return known
  const res = await db.execute(sql`SELECT current_database() AS name`)
  const rows = ((res as { rows?: { name: string }[] }).rows ?? (res as unknown as { name: string }[]))
  const value = rows[0]?.name === DEFAULT_DB
  defaultDbOf.set(db, value)
  return value
}

export interface ClientBot { token: string; username: string | null }

export async function getClientBot(db: Database): Promise<ClientBot | null> {
  const own = await getClubIntegration(db, 'wallet_bot_token').catch(() => null)
  const token = own || (ENV_TOKEN && (await isDefaultDb(db)) ? ENV_TOKEN : null)
  if (!token) return null
  if (token === ENV_TOKEN && ENV_USERNAME) return { token, username: ENV_USERNAME }
  let username = usernames.get(token) ?? null
  if (!username) {
    username = await getTelegramBotUsername(token)
    if (username) usernames.set(token, username)
  }
  return { token, username }
}

/** Ссылка «Получать статус в Telegram»: бот привязывает чат гостя к заявке по claim_token. */
export function guestBotLink(bot: ClientBot | null, claimToken: string): string | null {
  return bot?.username ? `https://t.me/${bot.username}?start=r_${claimToken}` : null
}
