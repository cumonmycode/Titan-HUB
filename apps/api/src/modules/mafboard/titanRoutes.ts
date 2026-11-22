import type { Context, Hono, MiddlewareHandler } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { withFreshClub, type MafboardEnv } from './router.js'
import { GoMafiaLoginRequired } from './gomafiaSessions.js'
import { hostAccess } from './clubHosts.js'
import { errorBody, toAccountJSON } from './serialize.js'
import { openSecrets, sealSecrets } from './studio.js'
import { TitanConnectError, toTitanPlayerJSON, trustedApiBase, type TitanClient } from './titan.js'
import type { HostAccess, MafboardUser, StoredClub, TitanLinkState } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Ручки Titan Connect приложения MafBoard (контракт — docs/MAFBOARD.md, раздел «Titan Connect»):
//   POST/DELETE /v1/me/titan                — подключить клуб кодом из HUB (президент клуба) / отключить
//                                             (президент или тот, кто подключал);
//   GET         /v1/titan/players           — клиенты клуба как игроки для подбора;
//   PUT/DELETE  /v1/titan/players/:id/gomafia — ручное сопоставление с GoMafia.
// Подключение принадлежит клубу MafBoard (`mb_clubs.titan_link`) и переживает смену президента.
// Его копия пишется в личную запись подключившего (`mb_users.titan_link`) — для отката на код,
// который читал Titan оттуда.
// ─────────────────────────────────────────────────────────────────────────────

const LINK_LIMIT = { count: 10, windowSec: 600 }
const ROSTER_LIMIT_PER_MIN = 60
const MATCH_LIMIT_PER_HOUR = 300
/** Код вида K7QM-3XPA; регистр, пробелы и дефис Titan не важны — проверяет он сам. */
const codeSchema = z.object({ code: z.string().trim().min(6).max(20) })
const matchSchema = z.object({ goMafiaID: z.number().int().positive().max(2 ** 48 - 1).nullable() })
const CLIENT_ID = /^[0-9a-f-]{8,64}$/i

type Status = 400 | 403 | 404 | 409 | 422 | 429 | 502
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
  }
  return fail(c, 502, 'titan_unavailable', 'Titan HUB не отвечает, попробуйте позже')
}

export function tokenOf(c: Context<MafboardEnv>, link: TitanLinkState): string | null {
  const secret = openSecrets(c.get('deps').config.studioSecretsKey, link.tokenSealed)
  return typeof secret?.['token'] === 'string' ? secret['token'] : null
}

/**
 * Права на общее подключение клуба — по свежему клубу: `requireUser` снимок GoMafia не освежает, и
 * бывший президент с устаревшим снимком распоряжался бы подключением клуба.
 */
async function freshAccess(c: Context<MafboardEnv>): Promise<{ user: MafboardUser; access: HostAccess }> {
  const deps = c.get('deps')
  const user = c.get('user')
  const fresh = await withFreshClub(deps, user)
  return fresh === user ? { user, access: c.get('access') } : { user: fresh, access: await hostAccess(deps.repo, fresh) }
}

/**
 * Клиенты клуба ведущего и его ручные сопоставления. Клуб — действующий (`access.titan`): подключение
 * клуба MafBoard у президента и судей пула. Ошибку уже превратили в ответ — вернётся Response.
 * Права здесь — из `requireUser`, без освежения клуба: чтение клиентов ведёт себя как раньше, снимок
 * GoMafia освежается раз в сутки. Освежается только то, что меняет общее подключение (`freshAccess`).
 */
export async function clubRoster(c: Context<MafboardEnv>) {
  const deps = c.get('deps')
  const link = c.get('access').titan
  if (!link) return fail(c, 409, 'titan_not_linked', 'Клуб Titan HUB подключает президент клуба')
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
   * Подключить клуб: одноразовый код из Titan HUB меняется на постоянный ключ, ключ — шифротекстом в БД.
   * Подключает президент клуба GoMafia — судьям его пула клиенты клуба достаются без кода.
   */
  router.post('/v1/me/titan', requireUser, body(codeSchema), async (c) => {
    const deps = c.get('deps')
    const { user, access } = await freshAccess(c)
    if (access.club !== 'president') {
      return fail(c, 403, 'president_only', 'Клуб Titan HUB подключает президент клуба GoMafia. Судьям клуба его клиенты доступны без кода')
    }
    const allowed = await deps.limiter.hit(`mb:titan:link:${user.id}`, LINK_LIMIT.count, LINK_LIMIT.windowSec, { failClosed: true })
    if (!allowed) return fail(c, 429, 'rate_limited', 'Слишком много попыток, попробуйте позже')

    let exchange
    try {
      exchange = await deps.titan.exchange(c.req.valid('json').code)
    } catch (error) {
      return titanFailure(c, error)
    }
    const apiBase = trustedApiBase(exchange.apiBase, deps.config.titanConnectUrl)
    if (!apiBase) return fail(c, 502, 'titan_unavailable', 'Titan HUB вернул адрес клуба вне домена Titan — подключение отменено')
    const clubName = await deps.titan.clubName(apiBase, exchange.accessToken).catch(() => null)

    const link: TitanLinkState = {
      apiBase,
      clubName,
      connectionId: exchange.connectionId,
      scopes: exchange.scopes,
      tokenSealed: sealSecrets(deps.config.studioSecretsKey, { token: exchange.accessToken }),
      linkedAt: deps.now(),
    }
    const club = access.mafboardClub
    // Запись клуба не прочиталась — подключение действует по копии в записи президента (`hostAccess`).
    if (!club) console.warn(`[mafboard] Titan записан только президенту ${user.id}: у его клуба нет записи клуба`)
    const replaced = club ? await deps.repo.setClubTitanLink(club.id, link, user.id) : null
    // Заменённое подключение клуба отзывается сразу, до остальных записей: их сбой не оставит ключ в HUB.
    const isReplaced = replaced != null && replaced.connectionId !== link.connectionId
    if (isReplaced) releaseLink(c, replaced)
    const updated = await deps.repo.setTitanLink(user.id, link)
    if (isReplaced) await clearMirrors(c, replaced.connectionId)

    // Прежняя личная запись самого президента — только если ею не пользуется другой клуб.
    const stale = user.titan
    const isStale = stale != null && stale.connectionId !== link.connectionId && stale.connectionId !== replaced?.connectionId
    if (isStale && !(await deps.repo.clubByTitanConnection(stale.connectionId))) releaseLink(c, stale)

    deps.titanRoster.forget(apiBase)
    const linked = updated ?? user
    return c.json(toAccountJSON(linked, await hostAccess(deps.repo, linked)))
  })

  /**
   * Отключить клуб: подключение снимается с клуба, ключ (по возможности) отзывается в Titan HUB.
   * Отключают президент клуба и тот, кто подключал. У остальных стирается только своя личная запись
   * прежних времён; судье пула клуб достался от клуба — ему отключать нечего.
   */
  router.delete('/v1/me/titan', requireUser, async (c) => {
    const deps = c.get('deps')
    const { user, access } = await freshAccess(c)
    const presided = access.club === 'president' && access.mafboardClub?.titan ? [access.mafboardClub] : []
    // Судья пула общий клуб не отключает, даже если сам подключал его, когда был президентом.
    const linked = access.club === 'host' ? [] : await deps.repo.clubsLinkedBy(user.id)
    const clubs = presided.length > 0 ? presided : linked
    if (clubs.length === 0 && !user.titan && access.titanShared) {
      return fail(c, 403, 'president_only', 'Клуб Titan HUB отключает президент клуба или тот, кто его подключал')
    }
    const removed: string[] = []
    for (const club of clubs) {
      const link = await disconnectClub(c, club)
      if (link) removed.push(link.connectionId)
    }
    const unlinked = await dropPersonalLink(c, user, removed)
    return c.json(toAccountJSON(unlinked, await hostAccess(deps.repo, unlinked)))
  })

  /** Клиенты клуба целиком (без удалённых): приложение ищет по ним само. */
  router.get('/v1/titan/players', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    if (!(await deps.limiter.hit(`mb:titan:roster:${user.id}`, ROSTER_LIMIT_PER_MIN, 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов')
    }
    const roster = await clubRoster(c)
    if (roster instanceof Response) return roster
    const players = [...roster.clients].sort(byClubOrder).map((client) => toTitanPlayerJSON(roster.link.apiBase, client, roster.matches))
    return c.json({ club: { name: roster.link.clubName }, players })
  })

  /** Сопоставить клиента с игроком GoMafia (`goMafiaID: null` — у клиента нет GoMafia, номер из HUB неверный). */
  router.put('/v1/titan/players/:id/gomafia', requireUser, body(matchSchema), async (c) => {
    const deps = c.get('deps')
    const { goMafiaID } = c.req.valid('json')
    // lib/gomafia отвечает null и на «нет игрока», и на сбой GoMafia — различить их нельзя.
    const userId = c.get('user').id
    // С 2026-11-17 GoMafia показывает профили только вошедшим: без входа ведущего номер не проверить —
    // принимаем его как есть; с входом — проверяем, что игрок существует.
    const exists = goMafiaID == null
      ? true
      : await deps.gomafiaSessions
          .run(userId, (auth) => deps.gomafia.player(String(goMafiaID), auth))
          .then((player) => player != null)
          .catch((error: unknown) => error instanceof GoMafiaLoginRequired)
    if (!exists) {
      return fail(c, 404, 'not_found', 'Игрок не найден в GoMafia или GoMafia не отвечает')
    }
    return saveMatch(c, { goMafiaId: goMafiaID })
  })

  /** Снять ручное сопоставление: снова действует номер GoMafia из профиля в HUB. */
  router.delete('/v1/titan/players/:id/gomafia', requireUser, async (c) => saveMatch(c, null))
}

async function saveMatch(c: Context<MafboardEnv>, match: { goMafiaId: number | null } | null) {
  const deps = c.get('deps')
  const user = c.get('user')
  const clientId = c.req.param('id') ?? ''
  if (!CLIENT_ID.test(clientId)) return fail(c, 422, 'validation', 'Некорректный клиент')
  if (!(await deps.limiter.hit(`mb:titan:match:${user.id}`, MATCH_LIMIT_PER_HOUR, 3600))) {
    return fail(c, 429, 'rate_limited', 'Слишком много изменений, попробуйте позже')
  }
  const roster = await clubRoster(c)
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
async function disconnectClub(c: Context<MafboardEnv>, club: StoredClub): Promise<TitanLinkState | null> {
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
async function clearMirrors(c: Context<MafboardEnv>, connectionId: string): Promise<void> {
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
    await dropPersonalLink(c, user, removed)
  } catch (error) {
    console.warn(`[mafboard] Titan не отключён при удалении аккаунта ${user.id}:`, error)
  }
}

/** Отозвать ключ в Titan в фоне: отключение у нас не должно зависеть от доступности HUB. */
function releaseLink(c: Context<MafboardEnv>, link: TitanLinkState): void {
  const deps = c.get('deps')
  deps.titanRoster.forget(link.apiBase)
  const token = tokenOf(c, link)
  if (!token) return
  deps.background(`mb:titan:release:${link.connectionId}`, async () => {
    await deps.titan.disconnect(link.apiBase, token).catch(() => undefined)
  })
}
