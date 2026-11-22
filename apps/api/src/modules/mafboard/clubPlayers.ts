import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { GomafiaPlayer } from '../../lib/gomafia.js'
import { GoMafiaLoginRequired, GoMafiaUnavailable } from './gomafiaSessions.js'
import type { MafboardEnv } from './router.js'
import { errorBody, toPlayerJSON } from './serialize.js'
import { goMafiaNumber, goMafiaPlayerID, toTitanPlayerJSON, type TitanClient } from './titan.js'
import { byClubOrder, clubRoster, tokenOf } from './titanRoutes.js'
import type { GoMafiaPlayerJSON, HostAccess, MafboardUser } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Игроки клуба одним списком (docs/MAFBOARD.md, раздел «Игроки клуба»):
//   GET /v1/club/players — клиенты Titan HUB клуба и резиденты клуба GoMafia без повторов.
// У каждого игрока одно фото: своё фото клиента в HUB, иначе аватар GoMafia (Titan отдаёт `photoUrl`
// уже в порядке HUB → Telegram → GoMafia). Тем же правилом считается фото самого судьи (`photoURL`).
// ─────────────────────────────────────────────────────────────────────────────

const LIST_LIMIT_PER_MIN = 60

/** Игрок клуба в формате приложения (`ClubPlayer`). */
export interface ClubPlayerJSON {
  playerID: string
  nickname: string
  fullName: string | null
  photoURL: string | null
  titanClientID: string | null
  goMafiaID: number | null
  isResident: boolean
  statusLabel: string | null
  isVerified: boolean
  elo: number | null
}

interface TitanSource {
  apiBase: string
  clients: TitanClient[]
  matches: Map<string, number | null>
}

type Status = 403 | 409 | 502
const fail = (c: Context, status: Status, code: string, message: string) => c.json(errorBody(code, message), status)

/** Резиденты клуба GoMafia или ответ-ошибка. Входа в GoMafia нет — как в «Судьях клуба». */
async function goMafiaResidents(c: Context<MafboardEnv>, clubId: number): Promise<GoMafiaPlayerJSON[] | Response> {
  const deps = c.get('deps')
  try {
    const roster: GomafiaPlayer[] = await deps.gomafiaSessions.run(c.get('user').id, (auth) => deps.roster.roster(clubId, auth))
    return roster.flatMap((raw) => {
      const player = toPlayerJSON(raw, true)
      return player ? [player] : []
    })
  } catch (error) {
    if (error instanceof GoMafiaLoginRequired) {
      return fail(c, 409, 'gomafia_relogin_required', 'GoMafia теперь пускает только после входа — войдите в GoMafia ещё раз в профиле')
    }
    if (!(error instanceof GoMafiaUnavailable)) console.warn('[mafboard] состав клуба GoMafia не прочитан:', error)
    return fail(c, 502, 'gomafia_unavailable', 'GoMafia не отвечает, попробуйте позже')
  }
}

function forbidden(c: Context<MafboardEnv>, user: MafboardUser) {
  return user.gomafia?.club
    ? fail(c, 403, 'host_access_required', 'Состав клуба видят президент клуба и судьи, которым он дал доступ в MafBoard')
    : fail(c, 403, 'club_required', 'Состав клуба доступен судьям клуба')
}

/**
 * Склейка: клиенты Titan (по порядку клуба), затем резиденты GoMafia, которых среди клиентов нет (по ELO).
 * Клиент с номером GoMafia — один игрок: фото — своё из HUB, иначе аватар его игрока GoMafia; ELO — из GoMafia.
 */
export function mergeClubPlayers(titan: TitanSource | null, residents: GoMafiaPlayerJSON[], verified: Set<number>): ClubPlayerJSON[] {
  const byGoMafia = new Map(residents.map((player) => [player.id, player]))
  const clients = titan ? [...titan.clients].sort(byClubOrder).map((client) => toTitanPlayerJSON(titan.apiBase, client, titan.matches)) : []
  const taken = new Set(clients.flatMap((client) => (client.goMafiaID == null ? [] : [client.goMafiaID])))

  const fromTitan = clients.map((client): ClubPlayerJSON => {
    const linked = client.goMafiaID == null ? undefined : byGoMafia.get(client.goMafiaID)
    return {
      playerID: client.playerID,
      nickname: client.nickname,
      fullName: client.fullName,
      photoURL: client.avatarURL ?? linked?.avatarURL ?? null,
      titanClientID: client.id,
      goMafiaID: client.goMafiaID,
      isResident: client.isResident,
      statusLabel: client.statusLabel,
      isVerified: client.goMafiaID != null && verified.has(client.goMafiaID),
      elo: linked?.elo ?? null,
    }
  })
  const fromGoMafia = residents
    .filter((player) => !taken.has(player.id))
    .map((player, index) => ({ player, index }))
    .sort((a, b) => (b.player.elo ?? 0) - (a.player.elo ?? 0) || a.index - b.index)
    .map(({ player }): ClubPlayerJSON => ({
      playerID: goMafiaPlayerID(player.id),
      nickname: player.nickname,
      fullName: player.fullName,
      photoURL: player.avatarURL,
      titanClientID: null,
      goMafiaID: player.id,
      isResident: true,
      statusLabel: null,
      isVerified: verified.has(player.id),
      elo: player.elo,
    }))
  return [...fromTitan, ...fromGoMafia]
}

/**
 * Фото самого пользователя: клиент Titan его клуба с его номером GoMafia и своим фото, иначе аватар
 * GoMafia. Состав Titan берётся только из кэша: `/v1/me` зовут часто, ждать Titan незачем. Кэша нет —
 * он читается в фоне, и со следующего запроса фото уже из клуба.
 */
export function accountPhotoURL(c: Context<MafboardEnv>, user: MafboardUser, access: HostAccess): string | null {
  const own = user.gomafia?.player
  const fallback = own?.avatarURL ?? null
  const link = access.titan
  if (!own || !link) return fallback
  const deps = c.get('deps')
  const clients = deps.titanRoster.peek(link.apiBase)
  if (!clients) {
    const token = tokenOf(c, link)
    if (token) {
      deps.background(`mb:titan:warm:${link.apiBase}`, async () => {
        await deps.titanRoster.roster(link.apiBase, token).catch(() => undefined)
      })
    }
    return fallback
  }
  // Ручные сопоставления здесь не учитываются: ради фото в шапке лишний запрос к базе на каждый `/v1/me` не нужен.
  const client = clients.find((item) => goMafiaNumber(item.gomafiaId) === own.id && item.photoUrl)
  return client?.photoUrl ?? fallback
}

export function registerClubPlayerRoutes(router: Hono<MafboardEnv>, requireUser: MiddlewareHandler<MafboardEnv>): void {
  /** Состав клуба одним списком — президенту и судьям пула. Один источник не ответил — второй и `partial`. */
  router.get('/v1/club/players', requireUser, async (c) => {
    const deps = c.get('deps')
    const user = c.get('user')
    const access = c.get('access')
    if (!(await deps.limiter.hit(`mb:club:players:${user.id}`, LIST_LIMIT_PER_MIN, 60))) {
      return c.json(errorBody('rate_limited', 'Слишком много запросов'), 429)
    }
    const club = user.gomafia?.club
    if (access.club === 'none' || !club) return forbidden(c, user)

    const [titan, residents] = await Promise.all([access.titan ? clubRoster(c) : Promise.resolve(null), goMafiaResidents(c, club.id)])
    const titanFailed = titan instanceof Response
    const goMafiaFailed = residents instanceof Response
    // Оба не ответили (или GoMafia — единственный источник) — ошибка первого, как у прежних ручек.
    if (titanFailed && goMafiaFailed) return titan
    if (goMafiaFailed && titan == null) return residents

    const players = goMafiaFailed ? [] : residents
    const source: TitanSource | null = titan && !titanFailed ? { apiBase: titan.link.apiBase, clients: titan.clients, matches: titan.matches } : null
    const clientNumbers = source ? [...source.matches.values(), ...source.clients.map((client) => goMafiaNumber(client.gomafiaId))] : []
    const numbers = [...players.map((player) => player.id), ...clientNumbers].filter((id): id is number => id != null)
    const verified = await deps.repo.verifiedGomafiaIds(numbers).catch(() => new Set<number>())

    return c.json({
      club: { id: access.mafboardClub?.id ?? null, name: access.mafboardClub?.name ?? club.title },
      players: mergeClubPlayers(source, players, verified),
      partial: titanFailed || goMafiaFailed,
    })
  })
}
