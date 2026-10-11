import { createHmac, timingSafeEqual } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────────
// Секрет и URL вебхука бота опросов. Секрет детерминирован от JWT_SECRET+clubId
// (Telegram шлёт его в заголовке X-Telegram-Bot-Api-Secret-Token; приёмник
// пересчитывает и сверяет). URL включает clubId — по нему приёмник находит БД клуба.
// ─────────────────────────────────────────────────────────────────────────────

export function tgWebhookSecret(clubId: string): string {
  const key = process.env['JWT_SECRET'] ?? ''
  // hex от HMAC (только [0-9a-f], валидный secret_token Telegram: 1..256, A-Za-z0-9_-).
  return createHmac('sha256', key).update(`tgwh:${clubId}`).digest('hex')
}

export function tgWebhookSecretValid(provided: string | undefined | null, clubId: string): boolean {
  if (!provided) return false
  const expected = tgWebhookSecret(clubId)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Публичный URL приёмника вебхука. Основной домен платформы достаёт API через nginx;
// clubId в пути резолвит клуба независимо от того, с какого домена настраивали.
// TELEGRAM_WEBHOOK_HOST — хост шлюза (infra/telegram-relay): сервер в РФ Telegram
// напрямую не достаёт, шлюз пересылает тот же путь на основной домен.
export function tgWebhookUrl(clubId: string): string {
  const root = (process.env['TELEGRAM_WEBHOOK_HOST'] || process.env['ROOT_DOMAIN'] || 'titanpos.ru').toLowerCase()
  return `https://${root}/api/tg/poll-webhook/${clubId}`
}
