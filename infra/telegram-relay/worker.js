// ─────────────────────────────────────────────────────────────────────────────
// Шлюз Telegram для сервера в РФ (Cloudflare Worker на tg.titanpos.ru).
//
// Сервер в РФ не достаёт api.telegram.org, а Telegram может не достучаться до
// сервера в РФ. Cloudflare доступен обоим, поэтому Worker работает посредником:
//
//  1) Исходящие вызовы Bot API (API, боты grammY, long polling):
//       /<RELAY_KEY>/bot<token>/<method>       → https://api.telegram.org/bot<token>/<method>
//       /<RELAY_KEY>/file/bot<token>/<path>    → https://api.telegram.org/file/bot<token>/<path>
//     RELAY_KEY — секрет Worker'а: без него шлюз не открытый прокси.
//
//  2) Входящий вебхук бота опросов (Telegram → нам):
//       POST /api/tg/poll-webhook/<clubId>     → https://<ORIGIN_HOST>/api/tg/poll-webhook/<clubId>
//     Подлинность проверяет API по заголовку X-Telegram-Bot-Api-Secret-Token.
// ─────────────────────────────────────────────────────────────────────────────

const TELEGRAM = 'https://api.telegram.org'
const BOT_PATH = /^\/(file\/)?bot\d+:[A-Za-z0-9_-]+\//
// 3) Публичные страницы для аналитики СММ (только чтение, только эти хосты):
//      GET /<RELAY_KEY>/web/t.me/s/<канал>  → https://t.me/s/<канал>
//      GET /<RELAY_KEY>/web/i.instagram.com/api/v1/users/web_profile_info/?username=…
//      GET|POST /<RELAY_KEY>/web/graph.instagram.com/v25.0/…  → Instagram API (данные и публикация)
const WEB_PATH = /^\/web\/(t\.me|www\.instagram\.com|i\.instagram\.com|graph\.instagram\.com)(\/[^?#]*)$/
const WEB_HEADERS = ['user-agent', 'accept', 'accept-language', 'x-ig-app-id', 'content-type']
// 4) Файлы СММ для серверов Meta (публикация в Instagram берёт картинку по ссылке):
//      GET /media/smm-<файл> → https://<ORIGIN_HOST>/media/smm-<файл>. Только наши файлы СММ.
const MEDIA_PATH = /^\/media\/smm-[\w.-]+$/
const WEBHOOK_PATH = /^\/api\/tg\/poll-webhook\/[A-Za-z0-9-]+$/
const FORWARD_HEADERS = ['content-type', 'accept', 'x-telegram-bot-api-secret-token']

function pickHeaders(src) {
  const out = new Headers()
  for (const name of FORWARD_HEADERS) {
    const v = src.get(name)
    if (v) out.set(name, v)
  }
  return out
}

async function forward(request, target) {
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const res = await fetch(target, {
    method: request.method,
    headers: pickHeaders(request.headers),
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  })
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
  })
}

const notFound = () => new Response('Not found', { status: 404 })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const key = env.RELAY_KEY

    if (key && url.pathname.startsWith(`/${key}/`)) {
      const rest = url.pathname.slice(key.length + 1)
      const web = WEB_PATH.exec(rest)
      // POST — только Instagram API (публикация); страницы — только чтение.
      const allowed = web && (request.method === 'GET' || (request.method === 'POST' && web[1] === 'graph.instagram.com'))
      if (allowed) {
        const headers = new Headers()
        for (const name of WEB_HEADERS) {
          const v = request.headers.get(name)
          if (v) headers.set(name, v)
        }
        const res = await fetch(`https://${web[1]}${web[2]}${url.search}`, {
          method: request.method,
          headers,
          body: request.method === 'POST' ? request.body : undefined,
          redirect: 'manual',
        })
        return new Response(res.body, {
          status: res.status,
          headers: { 'content-type': res.headers.get('content-type') || 'text/html' },
        })
      }
      if (!BOT_PATH.test(rest)) return notFound()
      return forward(request, `${TELEGRAM}${rest}${url.search}`)
    }

    if (request.method === 'POST' && WEBHOOK_PATH.test(url.pathname) && env.ORIGIN_HOST) {
      return forward(request, `https://${env.ORIGIN_HOST}${url.pathname}`)
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && MEDIA_PATH.test(url.pathname) && env.ORIGIN_HOST) {
      const res = await fetch(`https://${env.ORIGIN_HOST}${url.pathname}`, { method: request.method })
      if (!res.ok) return notFound()
      const headers = { 'content-type': res.headers.get('content-type') || 'application/octet-stream' }
      const length = res.headers.get('content-length')
      return new Response(res.body, { status: 200, headers: length ? { ...headers, 'content-length': length } : headers })
    }

    return notFound()
  },
}
