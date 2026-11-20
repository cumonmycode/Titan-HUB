import type { Context, Hono, MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { GomafiaPlayer } from '../../lib/gomafia.js'
import { GoMafiaLoginRequired, GoMafiaUnavailable } from './gomafiaSessions.js'
import { GomafiaTakenError, type MafboardRepo } from './repo.js'
import type { MafboardDeps, MafboardEnv } from './router.js'
import { errorBody, toAccountJSON, toPlayerJSON } from './serialize.js'
import type { GoMafiaClubJSON, GoMafiaPlayerJSON, HostAccess, MafboardUser } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Пул судей клуба GoMafia (контракт — docs/MAFBOARD.md, раздел «Судьи клуба»).
// Рейтинговые игры клуба ведут его президент (GoMafia: club.president_id) и резиденты, которых
// он добавил в пул. Клуб Titan HUB подключает только президент — судьям пула он достаётся сам.
// Судья без пароля GoMafia оставляет заявку с ником; президент подтверждает её, и аккаунт
// привязывается к игроку без входа в GoMafia. В GoMafia за такого судью сервер ходит входом
// президента.
//   GET    /v1/club/hosts              — пул и заявки (президент);
//   PUT    /v1/club/hosts/:gomafiaId   — дать доступ резиденту, с `requestID` — подтвердить заявку;
//   DELETE /v1/club/hosts/:gomafiaId   — забрать доступ;
//   DELETE /v1/club/requests/:id       — отклонить заявку;
//   PUT/DELETE /v1/me/club-request     — заявка судьи без пароля GoMafia.
// ─────────────────────────────────────────────────────────────────────────────

const LIST_LIMIT_PER_MIN = 60
const CHANGES_PER_HOUR = 120
const REQUESTS_PER_HOUR = 5
/** Скольким президентам сообщаем о новой заявке: ник ищется в составе клуба каждого. */
const PRESIDENTS_TO_ASK = 50

const requestSchema = z.object({ nickname: z.string().trim().min(2).max(40) })
const grantSchema = z.object({ requestID: z.string().uuid().optional() })

type Status = 403 | 404 | 409 | 422 | 429 | 502
const fail = (c: Context, status: Status, code: string, message: string) => c.json(errorBody(code, message), status)
const sameNickname = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// ─── Права ───────────────────────────────────────────────────────────────────

/** Президент клуба — по данным GoMafia. Привязка по заявке (без пароля) президентом не делает. */
export function isClubPresident(user: MafboardUser): boolean {
  const link = user.gomafia
  return link != null && link.source === 'password' && link.club?.presidentID != null && link.club.presidentID === link.player.id
}

/** Права пользователя в клубе и действующий клуб Titan HUB — с учётом пула судей. */
export async function hostAccess(repo: MafboardRepo, user: MafboardUser): Promise<HostAccess> {
  const link = user.gomafia
  if (!link) return { club: 'none', titan: null, titanShared: false, request: await repo.clubRequest(user.id) }
  const none: HostAccess = { club: 'none', titan: null, titanShared: false, request: null }
  const club = link.club
  if (!club) return none
  if (isClubPresident(user)) return { club: 'president', titan: user.titan, titanShared: false, request: null }
  if (!(await repo.isClubHost(club.id, link.player.id))) return none
  const president = await clubPresident(repo, club)
  const titan = president?.titan ?? null
  return { club: 'host', titan, titanShared: titan != null, request: null }
}

/** Пользователь MafBoard — действующий президент этого клуба. Сменился в GoMafia — прежний уже не он. */
async function clubPresident(repo: MafboardRepo, club: GoMafiaClubJSON): Promise<MafboardUser | null> {
  if (club.presidentID == null) return null
  const president = await repo.userByGomafiaId(club.presidentID)
  return president && isClubPresident(president) && president.gomafia?.club?.id === club.id ? president : null
}

/**
 * Чьим входом в GoMafia ходить за пользователя без своего пароля: у судьи пула — входом президента
 * клуба. null — такого входа нет.
 */
export async function sessionDelegate(repo: MafboardRepo, userId: string): Promise<string | null> {
  const user = await repo.userById(userId)
  const link = user?.gomafia
  const club = link?.club
  if (!user || !link || !club || isClubPresident(user)) return null
  if (!(await repo.isClubHost(club.id, link.player.id))) return null
  return (await clubPresident(repo, club))?.id ?? null
}

// ─── Ответы ──────────────────────────────────────────────────────────────────

function telegramJSON(user: MafboardUser) {
  return { name: [user.tgFirstName, user.tgLastName].filter(Boolean).join(' '), username: user.tgUsername }
}

/** Судья, которого уже нет в составе клуба: показываем по нику из пула. */
function formerResident(gomafiaId: number, nickname: string): GoMafiaPlayerJSON {
  return {
    id: gomafiaId, nickname, fullName: null, avatarURL: null, elo: null, clubID: null, clubTitle: null,
    city: null, tournamentsPlayed: null, isInHostClub: false, isVerified: false,
  }
}

async function hostsJSON(deps: MafboardDeps, club: GoMafiaClubJSON, roster: GomafiaPlayer[]) {
  const residents = new Map(roster.flatMap((raw) => {
    const player = toPlayerJSON(raw, true)
    return player ? [[player.id, player] as const] : []
  }))
  const [hosts, requests] = await Promise.all([
    deps.repo.clubHosts(club.id),
    deps.repo.clubRequestsByNicknames(roster.map((player) => player.login)),
  ])
  const [accounts, requesters] = await Promise.all([
    deps.repo.usersByGomafiaIds(hosts.map((host) => host.gomafiaId)),
    Promise.all(requests.map((request) => deps.repo.userById(request.userId))),
  ])
  const accountOf = new Map(accounts.flatMap((user) => (user.gomafia ? [[user.gomafia.player.id, user] as const] : [])))
  const residentByNickname = (nickname: string) => [...residents.values()].find((player) => sameNickname(player.nickname, nickname))

  return {
    club,
    hosts: hosts.map((host) => {
      const account = accountOf.get(host.gomafiaId)
      return {
        player: { ...(residents.get(host.gomafiaId) ?? formerResident(host.gomafiaId, host.nickname)), isVerified: account != null },
        isResident: residents.has(host.gomafiaId),
        grantedAt: host.grantedAt.toISOString(),
        account: account ? { ...telegramJSON(account), source: account.gomafia?.source ?? 'password' } : null,
      }
    }),
    requests: requests.flatMap((request, index) => {
      const requester = requesters[index]
      const player = residentByNickname(request.nickname)
      // Заявитель успел привязать GoMafia паролем — заявка ему уже не нужна.
      if (!requester || requester.gomafia || !player) return []
      return [{ id: request.userId, player, account: telegramJSON(requester), createdAt: request.createdAt.toISOString() }]
    }),
  }
}

function notify(deps: MafboardDeps, user: MafboardUser | null, text: string): void {
  const messenger = deps.messenger
  if (!messenger || !user || user.tgId <= 0) return
  deps.background(`mb:notify:${user.id}`, () => messenger.send(user.tgId, text))
}

/** Сообщить о заявке президенту клуба, в составе которого есть такой ник. Клуб заявителя неизвестен — ищем. */
async function notifyPresident(deps: MafboardDeps, requester: MafboardUser, nickname: string): Promise<void> {
  for (const president of await deps.repo.clubPresidents(PRESIDENTS_TO_ASK)) {
    const club = president.gomafia?.club
    if (!club || !isClubPresident(president)) continue
    const roster = await deps.gomafiaSessions.run(president.id, (auth) => deps.roster.roster(club.id, auth)).catch(() => [])
    const resident = roster.find((player) => sameNickname(player.login, nickname))
    if (!resident) continue
    const who = [telegramJSON(requester).name, requester.tgUsername ? `@${requester.tgUsername}` : null].filter(Boolean).join(', ')
    notify(deps, president,
      `🙋 ${who} просит доступ судьи клуба «${club.title}» как ${resident.login} — без пароля GoMafia.\n` +
        'Проверьте, что это он, и подтвердите: MafBoard → Профиль → Мой клуб → Судьи клуба.')
    return
  }
}

// ─── Ручки ───────────────────────────────────────────────────────────────────

/** Клуб, которым управляет пользователь, и его состав. Не президент или GoMafia не ответила — готовый ответ. */
async function presidentRoster(c: Context<MafboardEnv>) {
  const deps = c.get('deps')
  const user = c.get('user')
  const club = user.gomafia?.club
  if (!club || c.get('access').club !== 'president') {
    return fail(c, 403, 'president_only', 'Судей клуба назначает президент клуба в GoMafia')
  }
  try {
    const roster = await deps.gomafiaSessions.run(user.id, (auth) => deps.roster.roster(club.id, auth))
    return { user, club, roster }
  } catch (error) {
    if (error instanceof GoMafiaLoginRequired) {
      return fail(c, 409, 'gomafia_relogin_required', 'GoMafia теперь пускает только после входа — войдите в GoMafia ещё раз в профиле')
    }
    if (!(error instanceof GoMafiaUnavailable)) console.warn('[mafboard] состав клуба не прочитан:', error)
    return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отвечает, попробуйте позже')
  }
}

function gomafiaIdParam(c: Context<MafboardEnv>): number | null {
  const raw = c.req.param('gomafiaId') ?? ''
  const id = /^[1-9]\d{0,14}$/.test(raw) ? Number(raw) : NaN
  return Number.isSafeInteger(id) ? id : null
}

async function changeAllowed(c: Context<MafboardEnv>): Promise<boolean> {
  return c.get('deps').limiter.hit(`mb:club:hosts:${c.get('user').id}`, CHANGES_PER_HOUR, 3600)
}

const TOO_MANY = 'Слишком много изменений, попробуйте позже'

export function registerClubHostRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  /** Пул судей клуба и заявки судей без пароля GoMafia — президенту. */
  router.get('/v1/club/hosts', requireUser, async (c) => {
    const deps = c.get('deps')
    if (!(await deps.limiter.hit(`mb:club:list:${c.get('user').id}`, LIST_LIMIT_PER_MIN, 60))) {
      return fail(c, 429, 'rate_limited', 'Слишком много запросов')
    }
    const scope = await presidentRoster(c)
    if (scope instanceof Response) return scope
    return c.json(await hostsJSON(deps, scope.club, scope.roster))
  })

  /**
   * Дать резиденту клуба вести игры. С `requestID` — подтвердить заявку судьи без пароля GoMafia:
   * его аккаунт MafBoard привязывается к этому игроку (президент ручается, что это он).
   */
  router.put('/v1/club/hosts/:gomafiaId', requireUser, async (c) => {
    const deps = c.get('deps')
    const gomafiaId = gomafiaIdParam(c)
    const body = grantSchema.safeParse(await c.req.json().catch(() => ({})))
    if (gomafiaId == null || !body.success) return fail(c, 422, 'validation', 'Некорректные данные запроса')
    if (!(await changeAllowed(c))) return fail(c, 429, 'rate_limited', TOO_MANY)
    const scope = await presidentRoster(c)
    if (scope instanceof Response) return scope
    const { user, club, roster } = scope

    const resident = roster.find((player) => Number(player.gomafiaId) === gomafiaId)
    const player = resident ? toPlayerJSON(resident, true) : null
    if (!resident || !player) return fail(c, 404, 'not_resident', 'Доступ можно дать только резиденту вашего клуба в GoMafia')
    if (gomafiaId === user.gomafia?.player.id) return fail(c, 422, 'validation', 'Президенту клуба доступ не нужен')

    const now = deps.now()
    const requestId = body.data.requestID
    if (requestId) {
      const request = await deps.repo.clubRequest(requestId)
      const target = request && sameNickname(request.nickname, resident.login) ? await deps.repo.userById(request.userId) : null
      if (!target) return fail(c, 404, 'request_not_found', 'Заявка не найдена — возможно, судья её отозвал')
      const taken = () => fail(c, 409, 'gomafia_taken', 'Этот игрок уже вошёл в MafBoard со своим паролем GoMafia')
      const owner = await deps.repo.userByGomafiaId(gomafiaId)
      if (target.gomafia || (owner && owner.id !== target.id)) return taken()
      try {
        await deps.repo.setGomafiaLink(target.id, { player: { ...player, isInHostClub: false }, club, source: 'club' }, now)
      } catch (error) {
        if (error instanceof GomafiaTakenError) return taken()
        throw error
      }
      await deps.repo.setClubRequest(target.id, null)
      notify(deps, target, `✅ Президент клуба «${club.title}» подтвердил, что вы — ${resident.login}. Рейтинговые игры клуба доступны в MafBoard.`)
    } else {
      notify(deps, await deps.repo.userByGomafiaId(gomafiaId), `✅ Президент клуба «${club.title}» дал вам доступ к рейтинговым играм клуба в MafBoard.`)
    }
    await deps.repo.addClubHost({ clubId: club.id, gomafiaId, nickname: resident.login, grantedBy: user.id, grantedAt: now })
    return c.json(await hostsJSON(deps, club, roster))
  })

  /** Забрать доступ. Привязка по заявке держалась на пуле — она снимается вместе с ним. */
  router.delete('/v1/club/hosts/:gomafiaId', requireUser, async (c) => {
    const deps = c.get('deps')
    const gomafiaId = gomafiaIdParam(c)
    if (gomafiaId == null) return fail(c, 422, 'validation', 'Некорректный игрок')
    if (!(await changeAllowed(c))) return fail(c, 429, 'rate_limited', TOO_MANY)
    const scope = await presidentRoster(c)
    if (scope instanceof Response) return scope
    const { club, roster } = scope

    const removed = await deps.repo.removeClubHost(club.id, gomafiaId)
    const account = removed ? await deps.repo.userByGomafiaId(gomafiaId) : null
    if (account?.gomafia?.source === 'club' && account.gomafia.club?.id === club.id) {
      await deps.repo.setGomafiaLink(account.id, null, deps.now())
    }
    if (removed) notify(deps, account, `Президент клуба «${club.title}» закрыл вам доступ к рейтинговым играм клуба в MafBoard.`)
    return c.json(await hostsJSON(deps, club, roster))
  })

  /** Отклонить заявку. Чужую (ника нет в составе клуба) президент не видит и снять не может. */
  router.delete('/v1/club/requests/:id', requireUser, async (c) => {
    const deps = c.get('deps')
    if (!(await changeAllowed(c))) return fail(c, 429, 'rate_limited', TOO_MANY)
    const scope = await presidentRoster(c)
    if (scope instanceof Response) return scope
    const { club, roster } = scope

    const request = await deps.repo.clubRequest(c.req.param('id') ?? '')
    if (request && roster.some((player) => sameNickname(player.login, request.nickname))) {
      await deps.repo.setClubRequest(request.userId, null)
      notify(deps, await deps.repo.userById(request.userId),
        `Президент клуба «${club.title}» отклонил заявку на доступ судьи как ${request.nickname}.`)
    }
    return c.json(await hostsJSON(deps, club, roster))
  })

  /** Заявка судьи, который не помнит пароль GoMafia: ник, под которым он играет в клубе. */
  router.put('/v1/me/club-request', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const body = requestSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return fail(c, 422, 'validation', 'Введите ник в GoMafia')
    if (user.gomafia) return fail(c, 409, 'gomafia_linked', 'GoMafia уже привязана — доступ к играм клуба даёт президент клуба')
    if (!(await deps.limiter.hit(`mb:club:request:${user.id}`, REQUESTS_PER_HOUR, 3600, { failClosed: true }))) {
      return fail(c, 429, 'rate_limited', 'Слишком много заявок, попробуйте позже')
    }
    const { nickname } = body.data
    await deps.repo.setClubRequest(user.id, { nickname, at: deps.now() })
    deps.background(`mb:club:request:${user.id}`, () => notifyPresident(deps, user, nickname))
    return c.json(toAccountJSON(user, await hostAccess(deps.repo, user)))
  })

  router.delete('/v1/me/club-request', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    await deps.repo.setClubRequest(user.id, null)
    return c.json(toAccountJSON(user, await hostAccess(deps.repo, user)))
  })
}
