// ─────────────────────────────────────────────────────────────────────────────
// Настройки модуля MafBoard — сервера отдельного iOS/Android-приложения для ведущих
// мафии (вход через бота MafBoard, привязка GoMafia, история игр клуба).
//
// Читаются лениво: без MAFBOARD_DATABASE_URL модуль выключен (ручки → 503), а остальной
// API Titan HUB работает как раньше. Данные MafBoard живут в ОТДЕЛЬНОЙ БД: ведущие —
// из любых клубов GoMafia, а не арендаторы Titan HUB.
// ─────────────────────────────────────────────────────────────────────────────

import { studioSecretsKey } from './studio.js'
import { titanConnectUrl } from './titan.js'
import type { VkAppConfig } from './vk.js'

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
  /** Пароль входа проверяющего App Store (`POST /v1/auth/review`). null — такой вход выключен. */
  reviewPassword: string | null
  /** Ключ AES-256-GCM для секретов MafBoard Studio (studio.ts). */
  studioSecretsKey: Uint8Array
  /** Приложение VK Видео Live для входа MBS (vk.ts). null — вход VK выключен. */
  vk: VkAppConfig | null
  /** Приложение DonationAlerts для входа MBS (donationalerts.ts). null — донаты выключены. */
  donationAlerts: VkAppConfig | null
  /** Titan Connect для обмена кода клуба (MAFBOARD_TITAN_CONNECT_URL); адреса клубов — только на его домене. */
  titanConnectUrl: string
}

/** Логин проверяющего App Store — пароль к нему только в MAFBOARD_REVIEW_PASSWORD. */
export const REVIEW_LOGIN = 'appreview'
/** Telegram-id аккаунта проверяющего: у настоящих пользователей Telegram id положительные. */
export const REVIEW_TG_ID = -1
const REVIEW_PASSWORD_MIN_LENGTH = 16
/** Ведущий удалённого аккаунта в записях игр клуба: приложению нужен userID, но ничей. */
export const DELETED_HOST_ID = '00000000-0000-0000-0000-000000000000'

export const JWT_ISSUER = 'mafboard'
export const JWT_AUDIENCE = 'mafboard-app'
export const ACCESS_TOKEN_TTL_SEC = 60 * 60
export const REFRESH_TOKEN_TTL_DAYS = 90
export const LOGIN_TICKET_TTL_MIN = 10
/** MafBoard Studio. Такие сессии появляются только через вход по QR. */
export const DESKTOP_PLATFORMS: ReadonlySet<string> = new Set(['macos', 'windows'])
/** QR на экране ноутбука: короткий срок, MBS обновляет его сам. */
export const QR_TICKET_TTL_MIN = 3
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

/**
 * Адрес вебхука бота MafBoard. Свой хост — MAFBOARD_WEBHOOK_HOST (api.mafboard.com): бот MafBoard не зависит
 * от домена клубов. Без него — общий TELEGRAM_WEBHOOK_HOST или ROOT_DOMAIN, как у ботов клубов.
 */
export function mafboardWebhookUrl(env: NodeJS.ProcessEnv = process.env): string {
  const host = (env['MAFBOARD_WEBHOOK_HOST'] || env['TELEGRAM_WEBHOOK_HOST'] || env['ROOT_DOMAIN'] || 'titanpos.ru')
    .trim()
    .toLowerCase()
  return `https://${host}/api/mafboard/tg-webhook`
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

  const jwtSecret = new TextEncoder().encode(secret)
  const studioKey = studioSecretsKey(env, jwtSecret)
  if (typeof studioKey === 'string') return { ok: false, error: studioKey }

  return {
    ok: true,
    config: {
      databaseUrl,
      jwtSecret,
      studioSecretsKey: studioKey,
      botToken: env['MAFBOARD_BOT_TOKEN']?.trim() || null,
      botUsername: env['MAFBOARD_BOT_USERNAME']?.trim().replace(/^@/, '') || null,
      appLinkBase,
      termsUrl: env['MAFBOARD_TERMS_URL']?.trim() || `${appLinkBase}/terms`,
      termsVersion: env['MAFBOARD_TERMS_VERSION']?.trim() || '1',
      // Короткий пароль не включает вход: его можно подобрать.
      reviewPassword: (env['MAFBOARD_REVIEW_PASSWORD']?.trim().length ?? 0) >= REVIEW_PASSWORD_MIN_LENGTH
        ? env['MAFBOARD_REVIEW_PASSWORD']!.trim()
        : null,
      vk: readVk(env, appLinkBase),
      donationAlerts: readDonationAlerts(env, appLinkBase),
      titanConnectUrl: titanConnectUrl(env),
    },
  }
}

/** Приложение VK Видео Live. Адрес возврата — тот, что указан в кабинете VK, до символа. */
function readVk(env: NodeJS.ProcessEnv, appLinkBase: string): VkAppConfig | null {
  const clientId = env['MAFBOARD_VK_CLIENT_ID']?.trim()
  const clientSecret = env['MAFBOARD_VK_CLIENT_SECRET']?.trim()
  if (!clientId || !clientSecret) return null
  const redirectUri = env['MAFBOARD_VK_REDIRECT_URI']?.trim() || `${appLinkBase}/api/mafboard/v1/vk/callback`
  return { clientId, clientSecret, redirectUri }
}

/** Приложение DonationAlerts (donationalerts.com/application/clients). Адрес возврата — как в его настройках. */
function readDonationAlerts(env: NodeJS.ProcessEnv, appLinkBase: string): VkAppConfig | null {
  const clientId = env['MAFBOARD_DA_CLIENT_ID']?.trim()
  const clientSecret = env['MAFBOARD_DA_CLIENT_SECRET']?.trim()
  if (!clientId || !clientSecret) return null
  const redirectUri = env['MAFBOARD_DA_REDIRECT_URI']?.trim() || `${appLinkBase}/api/mafboard/v1/donationalerts/callback`
  return { clientId, clientSecret, redirectUri }
}
