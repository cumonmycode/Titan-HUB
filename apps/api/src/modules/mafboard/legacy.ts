import type { Context, Hono } from 'hono'
import type { MafboardEnv } from './router.js'
import { errorBody } from './serialize.js'

// ─────────────────────────────────────────────────────────────────────────────
// Старые ручки клуба GoMafia и Titan (сборки MafBoard до 1.0 (22)), сняты в выпуске 4в
// (docs/MAFBOARD.md). Путь не пропадает бесследно: старое приложение получает 426 `update_required`
// и показывает текст ошибки — «обновите приложение». Вход не проверяется: ответ один для всех.
// Замена каждого пути — ручки клуба `/v1/clubs/:id/...` (clubs.ts, titanRoutes.ts, router.ts).
// ─────────────────────────────────────────────────────────────────────────────

const UPDATE_REQUIRED_MESSAGE = 'Эта версия MafBoard устарела — обновите приложение в TestFlight'

/** Ответ снятой ручки: приложение слишком старое для этого сервера. */
export function updateRequired(c: Context): Response {
  return c.json(errorBody('update_required', UPDATE_REQUIRED_MESSAGE), 426)
}

/** Снятые пути. Регистрируются раньше ручек клуба, чтобы числовой `:id` не дошёл до них. */
const LEGACY_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string }> = [
  { method: 'GET', path: '/v1/club/players' },
  { method: 'POST', path: '/v1/me/titan' },
  { method: 'DELETE', path: '/v1/me/titan' },
  { method: 'GET', path: '/v1/titan/players' },
  { method: 'PUT', path: '/v1/titan/players/:id/gomafia' },
  { method: 'DELETE', path: '/v1/titan/players/:id/gomafia' },
  // История клуба по номеру клуба GoMafia; по id клуба MafBoard (uuid) — действующая ручка в router.ts.
  { method: 'GET', path: '/v1/clubs/:id{[0-9]+}/games' },
]

export function registerLegacyRoutes(router: Hono<MafboardEnv>): void {
  for (const { method, path } of LEGACY_ROUTES) router.on(method, path, updateRequired)
}
