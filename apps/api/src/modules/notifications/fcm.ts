/**
 * Прямая отправка push на Android (Firebase Cloud Messaging, HTTP v1) — для приложения
 * My Titan без посредника Expo, как apns.ts для iPhone. Приложение регистрирует нативный
 * FCM-токен устройства (getDevicePushTokenAsync), сервер шлёт в Google от имени
 * сервисного аккаунта Firebase.
 *
 * Переменные окружения:
 *   FCM_SERVICE_ACCOUNT — JSON-ключ сервисного аккаунта Firebase («Настройки проекта →
 *                         Сервисные аккаунты → Создать закрытый ключ»): как есть одной
 *                         строкой или base64 от всего файла.
 * Без него sendFcm — no-op: лента в приложении и Telegram-бот работают и так.
 *
 * Формат сообщения — тот, что читает expo-notifications на Android: заголовок и текст в
 * блоке notification (система сама покажет уведомление, если приложение закрыто), данные
 * перехода — JSON-строкой в data.body (NotificationData.body → content.data).
 */
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto'

interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token'
/** Токен доступа живёт час; обновляем заранее, чтобы не поймать истечение в пачке. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000
/** Сколько сообщений отправляем одновременно (у FCM v1 — по одному на запрос). */
const PARALLEL = 10

function loadAccount(): { account: ServiceAccount; key: KeyObject } | null {
  const raw = process.env['FCM_SERVICE_ACCOUNT']?.trim()
  if (!raw) return null
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
    const account = JSON.parse(json) as ServiceAccount
    if (!account.project_id || !account.client_email || !account.private_key) {
      console.warn('[fcm] FCM_SERVICE_ACCOUNT без project_id / client_email / private_key')
      return null
    }
    return { account, key: createPrivateKey(account.private_key.replace(/\\n/g, '\n')) }
  } catch (err) {
    console.warn('[fcm] FCM_SERVICE_ACCOUNT не читается как ключ сервисного аккаунта:', err)
    return null
  }
}

const SA = loadAccount()
export const fcmEnabled = Boolean(SA)

if (!fcmEnabled) {
  console.warn('[fcm] FCM_SERVICE_ACCOUNT не задан — push на Android отключены (no-op).')
}

/**
 * Нативный FCM-токен Android: «<id>:APA91b…» (длинная строка из букв, цифр, «-», «_»
 * и одного двоеточия). Не путать с ExponentPushToken[…] и hex-токеном APNs.
 */
export function isFcmToken(token: string): boolean {
  return /^[\w-]{10,}:[\w-]{100,}$/.test(token)
}

// ── Токен доступа OAuth2 (JWT сервисного аккаунта → access_token) ─────────────
let access: { token: string; expiresAt: number } | null = null

function signedAssertion(account: ServiceAccount, key: KeyObject): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: account.client_email,
    scope: SCOPE,
    aud: account.token_uri ?? DEFAULT_TOKEN_URI,
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign('RSA-SHA256').update(body).sign(key).toString('base64url')
  return `${body}.${signature}`
}

async function accessToken(): Promise<string | null> {
  if (!SA) return null
  if (access && Date.now() < access.expiresAt - TOKEN_REFRESH_MARGIN_MS) return access.token
  const r = await fetch(SA.account.token_uri ?? DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedAssertion(SA.account, SA.key),
    }),
  })
  if (!r.ok) {
    console.warn('[fcm] oauth http', r.status, (await r.text().catch(() => '')).slice(0, 200))
    return null
  }
  const j = (await r.json()) as { access_token: string; expires_in: number }
  access = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
  return access.token
}

// ── Отправка ──────────────────────────────────────────────────────────────────
export interface FcmMessage {
  token: string
  title: string
  body: string
  data?: Record<string, unknown>
  /** Канал уведомлений Android (wallet / news) — их создаёт приложение. */
  channelId?: string
  badge?: number
}

interface FcmError {
  error?: { status?: string; details?: Array<{ '@type'?: string; errorCode?: string }> }
}

/** Токен больше не действителен: приложение удалено или токен сменился. */
function isDeadToken(status: number, err: FcmError): boolean {
  const codes = (err.error?.details ?? []).map((d) => d.errorCode)
  return codes.includes('UNREGISTERED') || (status === 404 && err.error?.status === 'NOT_FOUND')
}

async function sendOne(m: FcmMessage, token: string, projectId: string): Promise<'ok' | 'dead' | 'fail'> {
  const message = {
    token: m.token,
    notification: { title: m.title, body: m.body },
    data: { title: m.title, message: m.body, body: JSON.stringify(m.data ?? {}) },
    android: {
      priority: 'HIGH',
      notification: {
        channel_id: m.channelId ?? 'wallet',
        sound: 'default',
        ...(m.badge != null ? { notification_count: m.badge } : {}),
      },
    },
  }
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (r.ok) return 'ok'
    const err = (await r.json().catch(() => ({}))) as FcmError
    if (isDeadToken(r.status, err)) return 'dead'
    console.warn('[fcm] send http', r.status, JSON.stringify(err).slice(0, 200))
    return 'fail'
  } catch (err) {
    console.warn('[fcm] send error:', err)
    return 'fail'
  }
}

/** Пачка push в FCM. Возвращает число принятых Google сообщений и мёртвые токены. */
export async function sendFcm(messages: FcmMessage[]): Promise<{ accepted: number; dead: string[] }> {
  if (!SA || !messages.length) return { accepted: 0, dead: [] }
  const token = await accessToken()
  if (!token) return { accepted: 0, dead: [] }
  let accepted = 0
  const dead: string[] = []
  for (let i = 0; i < messages.length; i += PARALLEL) {
    const chunk = messages.slice(i, i + PARALLEL)
    const results = await Promise.all(chunk.map((m) => sendOne(m, token, SA.account.project_id)))
    results.forEach((res, idx) => {
      if (res === 'ok') accepted++
      else if (res === 'dead') dead.push(chunk[idx]!.token)
    })
  }
  return { accepted, dead }
}
