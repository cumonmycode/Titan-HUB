/**
 * Бот Tai клуба: токен (интеграция poll_bot_token), БД, публичный хост и вебхук.
 *
 * Раньше у клуба было три бота (Tai в чатах, HUB для персонала, Wallet для
 * клиентов). Теперь один — Tai: группы, личка, вход в приложения и уведомления.
 * Токен по-прежнему хранится под ключом poll_bot_token, чтобы не трогать уже
 * настроенные клубы.
 */
import { getClubDb, type Database } from '@titan/database'
import { getControlDb, clubs, eq } from '../../../../../packages/database/dist/control/index.js'
import { buildClubConnString } from '../../lib/clubResolver.js'
import { getClubIntegration } from '../../lib/secrets.js'
import { getStringSetting } from '../../lib/appSettings.js'
import { TgBot } from '../../lib/tgBot.js'
import { tgWebhookSecret, tgWebhookUrl } from '../../lib/tgWebhook.js'

export const TAI_TOKEN_KEY = 'poll_bot_token'

/** Какие апдейты нужны Tai: сообщения, кнопки, опросы, вход/выход из групп. */
export const TAI_ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query', 'poll_answer', 'my_chat_member', 'chat_member']

export interface TgClub {
  /** id клуба в control-БД (null — основная БД без регистрации). */
  id: string | null
  /** Пространство ключей Redis клуба (как c.var.club?.id ?? 'main'). */
  key: string
  /** Публичный хост клуба: kbr.titanpos.ru — для внутренних вызовов API и ссылок. */
  host: string
  name: string
  db: Database
  bot: TgBot
}

const TOKEN_TTL_MS = 60_000
const CLUB_TTL_MS = 5 * 60_000
const ROOT_DOMAIN = () => (process.env['ROOT_DOMAIN'] || 'titanpos.ru').toLowerCase()

const tokens = new WeakMap<Database, { token: string | null; at: number }>()

/** Токен Tai клуба (кэш на минуту: владелец мог сменить токен в «Интеграциях»). */
export async function taiToken(db: Database): Promise<string | null> {
  const hit = tokens.get(db)
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token
  const token = await getClubIntegration(db, TAI_TOKEN_KEY).catch(() => null)
  tokens.set(db, { token, at: Date.now() })
  return token
}

export async function taiBot(db: Database): Promise<TgBot | null> {
  const token = await taiToken(db)
  return token ? new TgBot(token) : null
}

/** @username бота Tai для ссылок t.me/<bot>?start=… (без «@»). */
export async function taiUsername(db: Database): Promise<string | null> {
  return (await taiBot(db))?.username() ?? null
}

type ClubRow = { id: string; name: string; subdomain: string | null; dbName: string }
const clubRows = new Map<string, { row: ClubRow | null; at: number }>()

async function clubRow(clubId: string): Promise<ClubRow | null> {
  const hit = clubRows.get(clubId)
  if (hit && Date.now() - hit.at < CLUB_TTL_MS) return hit.row
  const [row] = await getControlDb()
    .select({ id: clubs.id, name: clubs.name, subdomain: clubs.subdomain, dbName: clubs.dbName })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1)
  clubRows.set(clubId, { row: row ?? null, at: Date.now() })
  return row ?? null
}

async function displayName(db: Database, fallback: string): Promise<string> {
  return (await getStringSetting('venue_name', '', db).catch(() => '')) || fallback
}

/** Клуб по id из пути вебхука. null — клуб не найден или у него нет бота. */
export async function clubById(clubId: string): Promise<TgClub | null> {
  const row = await clubRow(clubId)
  if (!row) return null
  const db = getClubDb(buildClubConnString(row.dbName))
  const bot = await taiBot(db)
  if (!bot) return null
  return { id: row.id, key: row.id, host: row.subdomain || ROOT_DOMAIN(), name: await displayName(db, row.name), db, bot }
}

/** Клуб для фоновых задач и уведомлений: БД уже есть, нужен бот и хост. */
export async function clubForDb(db: Database, clubId: string | null): Promise<TgClub | null> {
  const bot = await taiBot(db)
  if (!bot) return null
  const row = clubId ? await clubRow(clubId).catch(() => null) : null
  return {
    id: clubId,
    key: clubId ?? 'main',
    host: row?.subdomain || ROOT_DOMAIN(),
    name: await displayName(db, row?.name ?? 'Титан'),
    db,
    bot,
  }
}

/**
 * Вебхук Tai должен смотреть на нас и получать нажатия кнопок и личку. Старые
 * клубы включали его в «Опросах» без callback_query — поправляем сами.
 */
export async function ensureTaiWebhook(db: Database, clubId: string | null): Promise<void> {
  if (!clubId) return
  const bot = await taiBot(db)
  if (!bot) return
  const info = await bot.call<{ url?: string; allowed_updates?: string[] }>('getWebhookInfo', {})
  if (!info) return
  const url = tgWebhookUrl(clubId)
  const allowed = new Set(info.allowed_updates ?? [])
  if (info.url === url && TAI_ALLOWED_UPDATES.every((u) => allowed.has(u))) return
  const ok = await bot.call<boolean>('setWebhook', {
    url,
    secret_token: tgWebhookSecret(clubId),
    allowed_updates: TAI_ALLOWED_UPDATES,
    drop_pending_updates: false,
  })
  console.log(`[tai] вебхук клуба ${clubId}: ${ok ? 'настроен' : 'не удалось настроить'}`)
}
