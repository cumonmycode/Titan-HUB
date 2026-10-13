/**
 * Выход во внешний интернет для СММ. С сервера в РФ t.me и Instagram закрыты —
 * запросы идут через Cloudflare Worker (тот же шлюз, что у Telegram Bot API):
 * `${TELEGRAM_API_ROOT}/web/<хост><путь>`. Без шлюза (локально) — напрямую.
 */
import { TG_API } from '../../lib/telegram.js'

const RELAY = /^https:\/\/[^/]+\/[A-Za-z0-9]{16,}$/.test(TG_API)

export function relayUrl(url: string): string {
  return RELAY ? `${TG_API}/web/${url.replace(/^https:\/\//, '')}` : url
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

export function webFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<Response> {
  return fetch(relayUrl(url), {
    method: init.method ?? 'GET',
    headers: { 'user-agent': BROWSER_UA, ...(init.headers ?? {}) },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  })
}

/**
 * Публичная ссылка на наш файл для серверов Meta: тоже через Worker (`/media/…`),
 * чтобы не зависеть от того, пускает ли сервер в РФ запросы из-за рубежа.
 */
export function publicMediaUrl(url: string): string {
  const base = (process.env['MINIO_PUBLIC_URL'] ?? '').replace(/\/+$/, '')
  const host = process.env['TELEGRAM_WEBHOOK_HOST']
  const name = base && url.startsWith(`${base}/`) ? url.slice(base.length + 1) : null
  if (!host || !name || !/^smm-[\w.-]+$/.test(name)) return url
  return `https://${host}/media/${name}`
}
