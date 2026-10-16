import * as gm from '../../lib/gomafia.js'
import { toClubJSON, toPlayerJSON } from './serialize.js'
import type { GoMafiaClubJSON, GoMafiaPlayerJSON } from './types.js'

// GoMafia для MafBoard поверх общего lib/gomafia.ts: привязка аккаунта ведущего
// (владение подтверждается входом в GoMafia, пароль не хранится), подбор игроков
// «сначала свой клуб», состав клуба. Публичного API у GoMafia нет — всё на сервере.

export interface GoMafiaGateway {
  login(login: string, password: string): Promise<gm.GomafiaLoginResult>
  player(id: string): Promise<gm.GomafiaPlayer | null>
  club(clubId: string, page: number): ReturnType<typeof gm.clubResidents>
  search(query: string, limit: number): Promise<gm.GomafiaPlayer[]>
}

export const liveGoMafia: GoMafiaGateway = {
  login: (login, password) => gm.gomafiaLogin(login, password),
  player: (id) => gm.playerDetail(id),
  club: (clubId, page) => gm.clubResidents(clubId, { page }),
  search: async (query, limit) => (await gm.searchPlayers(query, { limit })).players,
}

const ROSTER_TTL_MS = 5 * 60_000
const ROSTER_MAX_PAGES = 12
export const SEARCH_LIMIT = 30
export const MIN_QUERY_LENGTH = 2

/** Состав клуба целиком (до 12 страниц) с кэшем на 5 минут — для поиска «сначала свои». */
export class RosterCache {
  private readonly entries = new Map<string, { at: number; players: gm.GomafiaPlayer[] }>()

  constructor(
    private readonly gateway: GoMafiaGateway,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = ROSTER_TTL_MS,
  ) {}

  async roster(clubId: number): Promise<gm.GomafiaPlayer[]> {
    const key = String(clubId)
    const cached = this.entries.get(key)
    if (cached && this.now() - cached.at < this.ttlMs) return cached.players

    const players: gm.GomafiaPlayer[] = []
    for (let page = 1; page <= ROSTER_MAX_PAGES; page++) {
      const { residents, total } = await this.gateway.club(key, page)
      if (residents.length === 0) break
      players.push(...residents)
      if (players.length >= total) break
    }
    this.entries.set(key, { at: this.now(), players })
    return players
  }
}

function matches(player: gm.GomafiaPlayer, needle: string): boolean {
  return [player.login, player.fullName].some((field) => field?.toLowerCase().includes(needle))
}

/** Поиск для ведущего: сначала совпадения в его клубе, затем общий поиск GoMafia, без повторов. */
export async function searchForHost(
  gateway: GoMafiaGateway,
  roster: RosterCache,
  query: string,
  hostClubId: number | null,
): Promise<GoMafiaPlayerJSON[]> {
  const needle = query.trim().toLowerCase()
  const own = hostClubId == null ? [] : (await roster.roster(hostClubId).catch(() => [])).filter((p) => matches(p, needle))
  const global = await gateway.search(query.trim(), 20).catch(() => [])

  const seen = new Set<number>()
  const result: GoMafiaPlayerJSON[] = []
  for (const [players, inClub] of [[own, true], [global, false]] as const) {
    for (const raw of players) {
      const player = toPlayerJSON(raw, inClub || (hostClubId != null && String(hostClubId) === raw.clubId))
      if (!player || seen.has(player.id)) continue
      seen.add(player.id)
      result.push(player)
      if (result.length >= SEARCH_LIMIT) return result
    }
  }
  return result
}

/** Обновить привязанный профиль: тот же клуб — оставляем, вышел — null, сменил — подтягиваем новый. */
export async function refreshLink(
  gateway: GoMafiaGateway,
  current: { player: GoMafiaPlayerJSON; club: GoMafiaClubJSON | null },
): Promise<{ player: GoMafiaPlayerJSON; club: GoMafiaClubJSON | null } | null> {
  const detail = await gateway.player(String(current.player.id)).catch(() => null)
  const player = detail ? toPlayerJSON(detail, false) : null
  if (!detail || !player) return null
  if (!detail.clubId) return { player, club: null }
  if (current.club && String(current.club.id) === detail.clubId) return { player, club: current.club }
  const info = await gateway.club(detail.clubId, 1).catch(() => null)
  return { player, club: toClubJSON(info?.club ?? { id: detail.clubId, title: detail.clubTitle, city: null }) }
}

/** Вход по нику (а не по почте или телефону) — тогда ник профиля можно сверить. */
function isNickname(login: string): boolean {
  const value = login.trim()
  return !value.includes('@') && !/^\+?\d[\d\s()-]*$/.test(value)
}

export type LinkResolution =
  | { ok: true; player: GoMafiaPlayerJSON; club: GoMafiaClubJSON | null }
  | { ok: false; reason: 'bad_credentials' | 'unavailable'; message: string }

/** Проверить логин и пароль GoMafia и собрать профиль с клубом. Пароль дальше этой функции не уходит. */
export async function resolveLink(gateway: GoMafiaGateway, login: string, password: string): Promise<LinkResolution> {
  let auth: gm.GomafiaLoginResult
  try {
    auth = await gateway.login(login, password)
  } catch {
    return { ok: false, reason: 'unavailable', message: 'GoMafia не отвечает, попробуйте позже' }
  }
  if (!auth.ok || !auth.userId) {
    return { ok: false, reason: 'bad_credentials', message: 'Неверный логин или пароль GoMafia' }
  }

  const detail = await gateway.player(auth.userId).catch(() => null)
  // id игрока берём из ответа входа, форма которого известна не полностью. Если вошли по нику,
  // профиль обязан быть с тем же ником — иначе мы бы привязали чужой аккаунт.
  if (detail && isNickname(login) && detail.login.trim().toLowerCase() !== login.trim().toLowerCase()) {
    return { ok: false, reason: 'unavailable', message: 'GoMafia вернула профиль другого игрока — привязка отменена' }
  }
  const clubId = detail?.clubId ?? auth.clubId ?? null
  const base: gm.GomafiaPlayer = detail ?? {
    gomafiaId: auth.userId, login, fullName: null, firstName: null, lastName: null,
    elo: null, avatar: null, clubId, clubTitle: null, city: null, tournaments: null,
  }
  const player = toPlayerJSON(base, false)
  if (!player) return { ok: false, reason: 'unavailable', message: 'GoMafia вернула неожиданный профиль' }

  let club: GoMafiaClubJSON | null = null
  if (clubId) {
    const info = await gateway.club(clubId, 1).catch(() => null)
    club = toClubJSON(info?.club ?? { id: clubId, title: base.clubTitle, city: null })
  }
  return { ok: true, player, club }
}
