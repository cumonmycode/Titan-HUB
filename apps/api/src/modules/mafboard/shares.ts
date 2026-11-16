import { randomBytes } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { errorBody } from './serialize.js'
import { body, fail, type Env } from './router.js'

// ─────────────────────────────────────────────────────────────────────────────
// Открытая ссылка на итоги игры: ведущий делится результатом в мессенджере, а судья турнира
// GoMafia — протоколом, если у ГС нет MafBoard. Приложение присылает готовый снимок итогов
// (баллы уже посчитаны на телефоне), сервер хранит его под случайным токеном и отдаёт
// страницей без входа. Повторная выдача для той же игры обновляет снимок, адрес не меняется.
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_BODY_LIMIT_BYTES = 64 * 1024
const SHARES_PER_HOUR = 60
const TOKEN_BYTES = 12

const short = (max: number) => z.string().trim().max(max)
const snapshotSchema = z.object({
  title: short(120).min(1),
  subtitle: short(200).nullish(),
  winner: z.enum(['red', 'black', 'draw']),
  winnerText: short(80),
  reason: short(200).nullish(),
  finishedAt: z.string().max(40),
  seats: z
    .array(
      z.object({
        place: z.number().int().min(1).max(30),
        nickname: short(60),
        role: short(30),
        team: z.enum(['red', 'black']),
        points: z.number().min(-100).max(100).nullish(),
        /** Строка протокола: «ПУ 2-ка · доп +0.4 · штраф 0.2». */
        details: short(160).nullish(),
      }),
    )
    .min(1)
    .max(30),
})
const shareSchema = z.object({ gameID: z.string().uuid(), snapshot: snapshotSchema })
type Snapshot = z.infer<typeof snapshotSchema>

/** Адрес сервера, как его видит клиент (за прокси — по X-Forwarded-*). */
function publicBase(c: Context): string {
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'api.mafboard.com'
  const proto = c.req.header('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}/api/mafboard`
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

const COLORS = { red: '#e5484d', black: '#1f2328', draw: '#8b8d98' }

export function sharePage(snapshot: Snapshot): string {
  const rows = snapshot.seats
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((seat) => `<tr class="${seat.team}">
      <td class="place">${seat.place}</td>
      <td><div class="nick">${escape(seat.nickname)}</div>${seat.details ? `<div class="details">${escape(seat.details)}</div>` : ''}</td>
      <td class="role">${escape(seat.role)}</td>
      <td class="points">${seat.points == null ? '' : escape(seat.points.toFixed(2).replace(/\.?0+$/, ''))}</td>
    </tr>`)
    .join('')
  const title = escape(snapshot.title)
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} — MafBoard</title>
<meta property="og:title" content="${title}"><meta property="og:description" content="${escape(snapshot.winnerText)}">
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1c2024;--muted:#60646c;--line:#e0e1e6}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1c1c1f;--text:#edeef0;--muted:#a0a3ab;--line:#2e2e33}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 -apple-system,system-ui,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px}
.card{background:var(--card);border-radius:20px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 16px}
.winner{display:inline-block;color:#fff;border-radius:999px;padding:6px 14px;font-weight:600;background:${COLORS[snapshot.winner]}}
.reason{color:var(--muted);margin:8px 0 16px}
table{width:100%;border-collapse:collapse}td{padding:10px 6px;border-top:1px solid var(--line);vertical-align:top}
.place{width:28px;color:var(--muted);font-variant-numeric:tabular-nums}.nick{font-weight:600}
.details{color:var(--muted);font-size:13px}.role{color:var(--muted);white-space:nowrap}
.points{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
tr.black .nick{color:${COLORS.red}}
footer{color:var(--muted);font-size:13px;text-align:center;margin-top:16px}
</style></head><body><main><div class="card">
<h1>${title}</h1>${snapshot.subtitle ? `<p class="sub">${escape(snapshot.subtitle)}</p>` : ''}
<span class="winner">${escape(snapshot.winnerText)}</span>
${snapshot.reason ? `<p class="reason">${escape(snapshot.reason)}</p>` : '<p class="reason"></p>'}
<table>${rows}</table></div>
<footer>${escape(snapshot.finishedAt)} · MafBoard</footer></main></body></html>`
}

const missingPage = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>MafBoard</title></head>
<body style="font:16px -apple-system,system-ui,sans-serif;text-align:center;padding:48px 16px">Ссылка устарела или не существует.</body></html>`

export function registerShareRoutes(router: Hono<Env>, requireUser: MiddlewareHandler<Env>): void {
  const limit = bodyLimit({
    maxSize: SHARE_BODY_LIMIT_BYTES,
    onError: (c) => c.json(errorBody('too_large', 'Итоги игры слишком большие'), 413),
  })

  /** Ссылка на итоги игры. Повторно для той же игры — тот же адрес с обновлёнными итогами. */
  router.post('/v1/shares', limit, requireUser, body(shareSchema), async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:shares:${user.id}`, SHARES_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много ссылок, попробуйте позже')
    }
    const { gameID, snapshot } = c.req.valid('json')
    const saved = await deps.repo.saveShare({
      token: randomBytes(TOKEN_BYTES).toString('base64url'),
      userId: user.id,
      gameId: gameID.toLowerCase(),
      snapshot,
      createdAt: deps.now(),
    })
    return c.json({ url: `${publicBase(c)}/s/${saved.token}` })
  })

  /** Страница итогов для всех, у кого есть ссылка. */
  router.get('/s/:token', async (c) => {
    const token = c.req.param('token')
    const share = /^[A-Za-z0-9_-]{8,64}$/.test(token) ? await c.get('deps').repo.shareByToken(token) : null
    c.header('X-Robots-Tag', 'noindex')
    c.header('Cache-Control', 'public, max-age=60')
    const parsed = share ? snapshotSchema.safeParse(share.snapshot) : null
    if (!parsed?.success) return c.html(missingPage, 404)
    return c.html(sharePage(parsed.data))
  })
}
