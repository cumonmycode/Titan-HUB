// ─────────────────────────────────────────────────────────────────────────────
// Настройки модуля MafBoard — сервера отдельного iOS/Android-приложения для ведущих
// мафии (вход через бота MafBoard, привязка GoMafia, история игр клуба).
//
// Читаются лениво: без MAFBOARD_DATABASE_URL модуль выключен (ручки → 503), а остальной
// API Titan HUB работает как раньше. Данные MafBoard живут в ОТДЕЛЬНОЙ БД: ведущие —
// из любых клубов GoMafia, а не арендаторы Titan HUB.
// ─────────────────────────────────────────────────────────────────────────────

export interface MafboardConfig {
  databaseUrl: string
  /** Ключ токенов приложения. Свой, не JWT_SECRET: токен MafBoard не пройдёт requireAuth Titan HUB. */
  jwtSecret: Uint8Array
  botToken: string | null
  /** Без «@». Если не задан — берётся из getMe бота. */
  botUsername: string | null
  /** Домен Universal Link возврата из бота: <appLinkBase>/auth/return?ticket=… */
  appLinkBase: string
  termsUrl: string
  /** Версия соглашения: при смене бот попросит принять его заново. */
  termsVersion: string
}

export const JWT_ISSUER = 'mafboard'
export const JWT_AUDIENCE = 'mafboard-app'
export const ACCESS_TOKEN_TTL_SEC = 60 * 60
export const REFRESH_TOKEN_TTL_DAYS = 90
export const LOGIN_TICKET_TTL_MIN = 10
/** Профиль GoMafia обновляется при входе, если с прошлой синхронизации прошло больше суток. */
export const GOMAFIA_RESYNC_AFTER_MS = 24 * 60 * 60_000
export const SUPPORTED_GAME_SCHEMA_VERSION = 1

export type ConfigResult = { ok: true; config: MafboardConfig } | { ok: false; error: string }

/** Имя БД из строки подключения — только безопасные символы (оно уходит в CREATE DATABASE). */
export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`[mafboard] некорректное имя БД в MAFBOARD_DATABASE_URL: «${name}»`)
  }
  return name
}

export function readMafboardConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const databaseUrl = env['MAFBOARD_DATABASE_URL']?.trim()
  if (!databaseUrl) return { ok: false, error: 'MAFBOARD_DATABASE_URL не задан' }

  const secret = env['MAFBOARD_JWT_SECRET'] ?? ''
  if (secret.length < 32) return { ok: false, error: 'MAFBOARD_JWT_SECRET должен быть не короче 32 символов' }
  // Общий ключ стёр бы границу контуров: verifyToken Titan HUB не проверяет issuer/audience.
  if (secret === env['JWT_SECRET']) return { ok: false, error: 'MAFBOARD_JWT_SECRET должен отличаться от JWT_SECRET' }

  const appLinkBase = (env['MAFBOARD_APP_LINK_BASE'] ?? '').trim().replace(/\/+$/, '')
  if (!appLinkBase.startsWith('https://')) {
    return { ok: false, error: 'MAFBOARD_APP_LINK_BASE должен начинаться с https:// (домен Universal Link)' }
  }

  return {
    ok: true,
    config: {
      databaseUrl,
      jwtSecret: new TextEncoder().encode(secret),
      botToken: env['MAFBOARD_BOT_TOKEN']?.trim() || null,
      botUsername: env['MAFBOARD_BOT_USERNAME']?.trim().replace(/^@/, '') || null,
      appLinkBase,
      termsUrl: env['MAFBOARD_TERMS_URL']?.trim() || `${appLinkBase}/terms`,
      termsVersion: env['MAFBOARD_TERMS_VERSION']?.trim() || '1',
    },
  }
}
