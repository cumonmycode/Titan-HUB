import type { Context, Hono, MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { freshAccess, type MafboardEnv } from './router.js'
import { GoMafiaLoginRequired } from './gomafiaSessions.js'
import { membershipOf } from './clubs.js'
import { errorBody } from './serialize.js'
import { openSecrets, sealSecrets } from './studio.js'
import { TitanConnectError, toTitanPlayerJSON, trustedApiBase, type TitanClient } from './titan.js'
import type { MafboardUser, StoredClub, TitanLinkState } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Ручки Titan Connect приложения MafBoard (контракт — docs/MAFBOARD.md, раздел «Titan Connect»):
//   GET         /v1/clubs/:id/titan/players                    — клиенты клуба как игроки для подбора;
//   PUT/DELETE  /v1/clubs/:id/titan/players/:clientId/gomafia  — ручное сопоставление с GoMafia.
// Подключают и отключают клуб ручки клуба `PUT/DELETE /v1/clubs/:id/titan` (clubs.ts) — здесь их общие
// части: обмен кода, отзыв ключа, стирание копий. Подключение принадлежит клубу MafBoard
// (`mb_clubs.titan_link`) и переживает смену президента. Личные записи `mb_users.titan_link` остались
// от прежних сборок (`/v1/me/titan`, с 4в отвечает 426, legacy.ts): их стирают отключение клуба и удаление аккаунта.
// ─────────────────────────────────────────────────────────────────────────────

const LINK_LIMIT = { count: 10, windowSec: 600 }
const ROSTER_LIMIT_PER_MIN = 60
const MATCH_LIMIT_PER_HOUR = 300
const matchSchema = z.object({ goMafiaID: z.number().int().positive().max(2 ** 48 - 1).nullable() })
const CLIENT_ID = /^[0-9a-f-]{8,64}$/i
const STREAM_LIMIT_PER_HOUR = 120
const streamSchema = z.object({
  id: z.string().trim().min(1).max(80),
  status: z.enum(['live', 'ended']),
  title: z.string().trim().max(120).optional(),
  source: z.enum(['mafboard', 'studio']).default('mafboard'),
  links: z.array(z.object({ kind: z.enum(['watch', 'donate']), label: z.string().trim().max(40).default(''), url: z.string().trim().url().max(500) })).max(6).default([]),
}).refine((s) => s.status === 'ended' || s.links.some((l) => l.kind === 'watch' && l.url.startsWith('https://')), 'Для эфира нужна https-ссылка на трансляцию')

type Status = 404 | 409 | 422 | 429 | 502
const fail = (c: Context, status: Status, code: string, message: string) => c.json(errorBody(code, message), status)

function body<T extends z.ZodTypeAny>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json(errorBody('validation', 'Некорректные данные запроса'), 422)
  })
}

/** Ошибка Titan → ответ приложению. Отозванный ключ — отдельный код: приложение предложит переподключить клуб. */
function titanFailure(c: Context, error: unknown) {
  if (error instanceof TitanConnectError) {
    if (error.code === 'invalid_token') {
      return fail(c, 409, 'titan_revoked', 'Клуб отключил MafBoard в Titan HUB. Получите новый код и подключите клуб заново')
    }
    if (error.code === 'invalid_code') return fail(c, 422, 'invalid_code', error.message)
    if (error.code === 'too_many_attempts') return fail(c, 429, 'rate_limited', error.message)
    if (error.code === 'scope_required') return fail(c, 409, 'titan_scope_required', 'В Titan HUB у подключения MafBoard не включены «Стримы» (Интеграции → Titan Connect)')
  }
  return fail(c, 502, 'titan_unavailable', 'Titan HUB не отвечает, попробуйте позже')
}

export function tokenOf(c: Context<MafboardEnv>, link: TitanLinkState): string | null {
  const secret = openSecrets(c.get('deps').config.studioSecretsKey, link.tokenSealed)
  return typeof secret?.['token'] === 'string' ? secret['token'] : null
}

/**
 * Одноразовый код Titan Connect → подключение (ключ — шифротекстом). Лимит попыток — на пользователя.
 * Ошибку уже превратили в ответ — вернётся Response.
 */
export async function exchangeTitanCode(c: Context<MafboardEnv>, code: string): Promise<TitanLinkState | Response> {
  const deps = c.get('deps')
  const allowed = await deps.limiter.hit(`mb:titan:link:${c.get('user').id}`, LINK_LIMIT.count, LINK_LIMIT.windowSec, { failClosed: true })
  if (!allowed) return fail(c, 429, 'rate_limited', 'Слишком много попыток, попробуйте позже')
  let exchange
  try {
    exchange = await deps.titan.exchange(code)
  } catch (error) {
    return titanFailure(c, error)
  }
  const apiBase = trustedApiBase(exchange.apiBase, deps.config.titanConnectUrl)
  if (!apiBase) return fail(c, 502, 'titan_unavailable', 'Titan HUB вернул адрес клуба вне домена Titan — подключение отменено')
  const clubName = await deps.titan.clubName(apiBase, exchange.accessToken).catch(() => null)
  return {
    apiBase,
    clubName,
    connectionId: exchange.connectionId,
    scopes: exchange.scopes,
    tokenSealed: sealSecrets(deps.config.studioSecretsKey, { token: exchange.accessToken }),
    linkedAt: deps.now(),
  }
}

/**
 * Клиенты клуба Titan и ручные сопоставления по его подключению. Права на клуб проверяет вызывающий
 * (член клуба из адреса). Ошибку уже превратили в ответ — вернётся Response.
 */
export async function clubRoster(c: Context<MafboardEnv>, link: TitanLinkState) {
  const deps = c.get('deps')
  const token = tokenOf(c, link)
  if (!token) return fail(c, 409, 'titan_revoked', 'Ключ клуба не читается. Подключите клуб заново')
  try {
    const [clients, matches] = await Promise.all([deps.titanRoster.roster(link.apiBase, token), deps.repo.titanMatches(link.apiBase)])
    return { link, clients, matches }
  } catch (error) {
    return titanFailure(c, error)
  }
}

/** Сначала резиденты, затем по нику — так ведущему проще найти своих. */
export function byClubOrder(a: TitanClient, b: TitanClient): number {
  return Number(b.isResident) - Number(a.isResident) || a.nickname.localeCompare(b.nickname, 'ru')
}

export function registerTitanRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  /**
   * Эфир клуба: MafBoard или MafBoard Studio сообщают ссылки на трансляцию и донаты, сервер
   * молча передаёт их в HUB клуба. Публиковать ли их через Tai, решают в HUB.
   */
  router.post('/v1/clubs/:id/stream', requireUser, body(streamSchema), async (c) => {
    const link = clubTitanLink(c)
    if (link instanceof Response) return link
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:titan:stream:${c.get('user').id}`, STREAM_LIMIT_PER_HOUR, 3600))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов')
    }
    const token = tokenOf(c, link)
    if (!token) return fail(c, 409, 'titan_revoked', 'Ключ клуба не читается. Подключите клуб заново')
    try {
      const result = await deps.titan.publishStream(link.apiBase, token, c.req.valid('json'))
      return c.json({ ok: true, published: result.published })
    } catch (error) {
      return titanFailure(c, error)
    }
  })
  /** Клиенты клуба целиком (без удалённых): приложение ищет по ним само. Клуб — любой клуб пользователя. */
  router.get('/v1/clubs/:id/titan/players', requireUser, async (c) => {
    const link = clubTitanLink(c)
    return link instanceof Response ? link : respondRoster(c, link)
  })
  /** Сопоставить клиента с игроком GoMafia (`goMafiaID: null` — у клиента нет GoMafia, номер из HUB неверный). */
  router.put('/v1/clubs/:id/titan/players/:clientId/gomafia', requireUser, body(matchSchema), async (c) => {
    const link = clubTitanLink(c)
    return link instanceof Response ? link : matchGoMafia(c, link, c.req.param('clientId') ?? '', c.req.valid('json').goMafiaID)
  })
  /** Снять ручное сопоставление: снова действует номер GoMafia из профиля в HUB. */
  router.delete('/v1/clubs/:id/titan/players/:clientId/gomafia', requireUser, async (c) => {
    const link = clubTitanLink(c)
    return link instanceof Response ? link : saveMatch(c, link, c.req.param('clientId') ?? '', null)
  })
}

/** Подключение Titan клуба из адреса: член клуба, и к клубу подключён Titan HUB. */
function clubTitanLink(c: Context<MafboardEnv>): TitanLinkState | Response {
  const membership = membershipOf(c)
  if (membership instanceof Response) return membership
  return membership.titan ?? fail(c, 409, 'titan_not_linked', 'К клубу не подключён Titan HUB')
}

async function respondRoster(c: Context<MafboardEnv>, link: TitanLinkState): Promise<Response> {
  const deps = c.get('deps')
  if (!(await deps.limiter.hit(`mb:titan:roster:${c.get('user').id}`, ROSTER_LIMIT_PER_MIN, 60))) {
    return fail(c, 429, 'rate_limited', 'Слишком много запросов')
  }
  const roster = await clubRoster(c, link)
  if (roster instanceof Response) return roster
  const players = [...roster.clients].sort(byClubOrder).map((client) => toTitanPlayerJSON(roster.link.apiBase, client, roster.matches))
  return c.json({ club: { name: roster.link.clubName }, players })
}

async function matchGoMafia(c: Context<MafboardEnv>, link: TitanLinkState, clientId: string, goMafiaID: number | null): Promise<Response> {
  const deps = c.get('deps')
  // lib/gomafia отвечает null и на «нет игрока», и на сбой GoMafia — различить их нельзя.
  // С 2026-11-17 GoMafia показывает профили только вошедшим: без входа ведущего номер не проверить —
  // принимаем его как есть; с входом — проверяем, что игрок существует.
  const exists = goMafiaID == null
    ? true
    : await deps.gomafiaSessions
        .run(c.get('user').id, (auth) => deps.gomafia.player(String(goMafiaID), auth))
        .then((player) => player != null)
        .catch((error: unknown) => error instanceof GoMafiaLoginRequired)
  if (!exists) {
    return fail(c, 404, 'not_found', 'Игрок не найден в GoMafia или GoMafia не отвечает')
  }
  return saveMatch(c, link, clientId, { goMafiaId: goMafiaID })
}

async function saveMatch(c: Context<MafboardEnv>, link: TitanLinkState, clientId: string, match: { goMafiaId: number | null } | null) {
  const deps = c.get('deps')
  const user = c.get('user')
  if (!CLIENT_ID.test(clientId)) return fail(c, 422, 'validation', 'Некорректный клиент')
  if (!(await deps.limiter.hit(`mb:titan:match:${user.id}`, MATCH_LIMIT_PER_HOUR, 3600))) {
    return fail(c, 429, 'rate_limited', 'Слишком много изменений, попробуйте позже')
  }
  const roster = await clubRoster(c, link)
  if (roster instanceof Response) return roster
  const client = roster.clients.find((item) => item.id === clientId)
  if (!client) return fail(c, 404, 'not_found', 'Клиент не найден в клубе')

  const apiBase = roster.link.apiBase
  await deps.repo.setTitanMatch(apiBase, clientId, match ? { ...match, userId: user.id, at: deps.now() } : null)
  const matches = new Map(roster.matches)
  if (match) matches.set(clientId, match.goMafiaId)
  else matches.delete(clientId)
  return c.json(toTitanPlayerJSON(apiBase, client, matches))
}

/** Снять подключение Titan с клуба: отозвать ключ в HUB и стереть его копии в личных записях. */
export async function disconnectClub(c: Context<MafboardEnv>, club: StoredClub): Promise<TitanLinkState | null> {
  const removed = await c.get('deps').repo.setClubTitanLink(club.id, null, null)
  if (!removed) return null
  releaseLink(c, removed)
  await clearMirrors(c, removed.connectionId)
  return removed
}

/**
 * Стереть копии снятого подключения. Ключ к этому моменту уже отзывается, поэтому сбой здесь только
 * пишется в лог: копия отозванного ключа ни на что не влияет — действует подключение клуба.
 */
export async function clearMirrors(c: Context<MafboardEnv>, connectionId: string): Promise<void> {
  try {
    await c.get('deps').repo.clearTitanMirrors(connectionId)
  } catch (error) {
    console.warn(`[mafboard] копии подключения Titan ${connectionId} не стёрты:`, error)
  }
}

/**
 * Стереть личную запись пользователя о Titan. Если это не копия только что снятого подключения
 * (`removed`) и ею не пользуется ни один клуб, то это ключ прежних времён, когда клуб Titan
 * подключал любой ведущий: он отзывается в HUB.
 */
async function dropPersonalLink(c: Context<MafboardEnv>, user: MafboardUser, removed: string[]): Promise<MafboardUser> {
  const personal = user.titan
  if (!personal) return user
  const repo = c.get('deps').repo
  const updated = await repo.setTitanLink(user.id, null)
  const isCopy = removed.includes(personal.connectionId) || (await repo.clubByTitanConnection(personal.connectionId)) != null
  if (!isCopy) releaseLink(c, personal)
  return updated ?? { ...user, titan: null }
}

/**
 * Перед удалением аккаунта. Удаляется действующий президент, который сам подключал клуб, — подключение
 * снимается и ключ отзывается, как было до клубов. Подключение, сделанное другим, и подключение
 * бывшего президента клуб сохраняет: им пользуются действующий президент и судьи. Удаление аккаунта
 * от этого не зависит: сбой только пишется в лог.
 */
export async function releaseTitanOnAccountDeletion(c: Context<MafboardEnv>): Promise<void> {
  const user = c.get('user')
  try {
    const { access } = await freshAccess(c)
    const own = access.club === 'president' ? access.mafboardClub : null
    const club = own?.titanLinkedBy === user.id ? own : null
    const removed: string[] = []
    if (club?.titan) {
      const link = await disconnectClub(c, club)
      if (link) removed.push(link.connectionId)
    }
    // Клуб без GoMafia, который он создал: владельца больше нет — ключ отзывается, и клуб HUB можно
    // подключить заново (один клуб HUB — один клуб MafBoard).
    for (const entry of access.clubs) {
      if (entry.role !== 'owner' || entry.club.gomafiaClubId != null || !entry.club.titan) continue
      const link = await disconnectClub(c, entry.club)
      if (link) removed.push(link.connectionId)
    }
    await dropPersonalLink(c, user, removed)
  } catch (error) {
    console.warn(`[mafboard] Titan не отключён при удалении аккаунта ${user.id}:`, error)
  }
}

/** Отозвать ключ в Titan в фоне: отключение у нас не должно зависеть от доступности HUB. */
export function releaseLink(c: Context<MafboardEnv>, link: TitanLinkState): void {
  const deps = c.get('deps')
  deps.titanRoster.forget(link.apiBase)
  const token = tokenOf(c, link)
  if (!token) return
  deps.background(`mb:titan:release:${link.connectionId}`, async () => {
    await deps.titan.disconnect(link.apiBase, token).catch(() => undefined)
  })
}
