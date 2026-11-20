import { Hono } from 'hono'
import type { ReplyMarkup } from '../../src/lib/tgBot.js'
import { GomafiaAuthRequired, type GomafiaAuth, type GomafiaLoginResult, type GomafiaPlayer } from '../../src/lib/gomafia.js'
import { sessionDelegate } from '../../src/modules/mafboard/clubHosts.js'
import { GoMafiaSessions } from '../../src/modules/mafboard/gomafiaSessions.js'
import type { BotMessenger } from '../../src/modules/mafboard/bot.js'
import type { MafboardConfig } from '../../src/modules/mafboard/config.js'
import { RosterCache, type GoMafiaGateway } from '../../src/modules/mafboard/gomafia.js'
import { noHub } from '../../src/modules/mafboard/hub.js'
import { TitanConnectError, TitanRosterCache, type TitanClient, type TitanConnectGateway } from '../../src/modules/mafboard/titan.js'
import { DELETED_HOST_ID } from '../../src/modules/mafboard/config.js'
import { GomafiaTakenError, type MafboardRepo } from '../../src/modules/mafboard/repo.js'
import { createMafboardRouter, type MafboardDeps } from '../../src/modules/mafboard/router.js'
import type { DeviceSession, LoginTicket, MafboardUser, QrTicket, RefreshTokenRow, StoredActiveGame, StoredClubHost, StoredClubRequest, StoredGame, StoredProtocolSubmission, StoredShare, StoredStudioSettings, TicketGuard, TitanLinkState } from '../../src/modules/mafboard/types.js'
import { VkError, type VkAppConfig, type VkGateway, type VkTokens } from '../../src/modules/mafboard/vk.js'
import type { DaAppConfig, DaGateway } from '../../src/modules/mafboard/donationalerts.js'
import { AimError, AimSession } from '../../src/lib/gomafiaAim.js'
import type { AimGame, AimProtocol, AimTournament } from '../../src/lib/gomafiaAimParse.js'
import type { TournamentSeating } from '../../src/lib/gomafiaTournament.js'
import { AimAccounts, type AimGateway, type TournamentSource } from '../../src/modules/mafboard/aim.js'

// Вебхук бота подписывается от JWT_SECRET Titan HUB (lib/tgWebhook.ts).
process.env['JWT_SECRET'] ??= 'test-titan-jwt-secret-0123456789abcdef'

export const NOW = new Date('2026-10-16T18:00:00.000Z')

export const config: MafboardConfig = {
  databaseUrl: 'postgres://test/mafboard',
  jwtSecret: new TextEncoder().encode('test-mafboard-secret-0123456789abcdef'),
  studioSecretsKey: new Uint8Array(32).fill(7),
  botToken: 'test-bot-token',
  botUsername: 'mafboard_test_bot',
  appLinkBase: 'https://mafboard.test',
  termsUrl: 'https://mafboard.test/terms',
  termsVersion: '1',
  reviewPassword: 'review-password-0123456789',
  vk: { clientId: 'vk-client', clientSecret: 'vk-secret', redirectUri: 'https://mafboard.test/api/mafboard/v1/vk/callback' },
  donationAlerts: { clientId: 'da-client', clientSecret: 'da-secret', redirectUri: 'https://mafboard.test/api/mafboard/v1/donationalerts/callback' },
  titanConnectUrl: 'https://titanpos.test/api/connect/v1',
}

export const TITAN_API_BASE = 'https://club.titanpos.test/api/connect/v1'

export function titanClient(id: string, nickname: string, extra: Partial<TitanClient> = {}): TitanClient {
  return { id, nickname, fullName: null, status: null, isResident: false, gomafiaId: null, deleted: false, photoUrl: null, ...extra }
}

/**
 * Titan Connect без сети: код `GOOD-CODE` меняется на ключ `tcn_live`, клиенты — `clients`
 * (страницами по `pageSize`). `revoked` — ключ отозван в HUB, `down` — HUB не отвечает.
 */
export class FakeTitan implements TitanConnectGateway {
  members: TitanClient[] = []
  pageSize = 200
  revoked = false
  down = false
  apiBase = TITAN_API_BASE
  calls = { clients: 0, disconnect: [] as string[] }

  async exchange(code: string) {
    if (this.down) throw new TitanConnectError('unavailable', 'нет связи')
    if (code.replace(/[\s-]/g, '').toUpperCase() !== 'GOODCODE') throw new TitanConnectError('invalid_code', 'Код неверный, уже использован или истёк.')
    return { accessToken: 'tcn_live', connectionId: 'conn-1', scopes: ['clients:read', 'clients:photos'], apiBase: this.apiBase }
  }

  async clubName() {
    return 'TITAN Нальчик'
  }

  async clients(_apiBase: string, token: string, cursor: string | null) {
    this.calls.clients += 1
    if (this.down) throw new TitanConnectError('unavailable', 'нет связи')
    if (this.revoked || token !== 'tcn_live') throw new TitanConnectError('invalid_token', 'Ключ не действует')
    const start = cursor ? Number(cursor) : 0
    const items = this.members.slice(start, start + this.pageSize)
    const next = start + this.pageSize < this.members.length ? String(start + this.pageSize) : null
    return { items, nextCursor: next }
  }

  async disconnect(_apiBase: string, token: string) {
    this.calls.disconnect.push(token)
  }
}

/** VK без сети: код `good` меняется на токены, токен обновления `dead-token` отозван. */
export class FakeVk implements VkGateway {
  calls: string[] = []
  async exchange(_app: VkAppConfig, code: string): Promise<VkTokens> {
    this.calls.push(`exchange:${code}`)
    if (code !== 'good') throw new VkError('rejected', 'VK отказал (400, invalid_request)')
    return { accessToken: 'vk-access', refreshToken: 'vk-refresh', expiresIn: 3600 }
  }
  async refresh(_app: VkAppConfig, token: string): Promise<VkTokens> {
    this.calls.push(`refresh:${token}`)
    if (token === 'dead-token') throw new VkError('revoked', 'Вход в VK не действует')
    return { accessToken: 'vk-access-2', refreshToken: 'vk-refresh-2', expiresIn: 3600 }
  }
  async revoke(_app: VkAppConfig, token: string): Promise<void> {
    this.calls.push(`revoke:${token}`)
  }
}

/**
 * АИМ без сети. Пароль — `password` (по умолчанию `aim-pass`); у каждого логина свои турниры и протоколы. Протокол
 * открывается только редактору (`editors`), остальным — AimError `access_denied`.
 * `expireNext` — следующий запрос ответит «сессия истекла», как настоящий АИМ.
 */
export class FakeAim implements AimGateway {
  tournamentsByLogin = new Map<string, AimTournament[]>()
  games = new Map<number, AimGame[]>()
  editors = new Map<number, Set<string>>()
  saved: Array<{ login: string; tournamentId: number; aimTableId: number; protocol: AimProtocol }> = []
  logins: string[] = []
  expireNext = false
  down = false
  password = 'aim-pass'

  async login(login: string, password: string): Promise<AimSession> {
    if (this.down) throw new AimError('unavailable', 'АИМ не отвечает')
    this.logins.push(login)
    if (password !== this.password) throw new AimError('bad_credentials', 'Неверный логин или пароль АИМ')
    return new AimSession(`session=${login}`, null)
  }

  private loginOf(session: AimSession): string {
    if (this.expireNext) {
      this.expireNext = false
      throw new AimError('session_expired', 'Сессия АИМ истекла')
    }
    return session.cookie.replace('session=', '')
  }

  async tournaments(session: AimSession): Promise<AimTournament[]> {
    return this.tournamentsByLogin.get(this.loginOf(session)) ?? []
  }

  async gameData(session: AimSession, tournamentId: number): Promise<AimGame[]> {
    const login = this.loginOf(session)
    if (!this.editors.get(tournamentId)?.has(login)) throw new AimError('access_denied', 'Нет доступа')
    return this.games.get(tournamentId) ?? []
  }

  async saveProtocol(session: AimSession, tournamentId: number, aimTableId: number, protocol: AimProtocol): Promise<void> {
    const login = this.loginOf(session)
    if (!this.editors.get(tournamentId)?.has(login)) throw new AimError('access_denied', 'Нет доступа')
    this.saved.push({ login, tournamentId, aimTableId, protocol })
  }
}

export class FakeTournaments implements TournamentSource {
  seatings = new Map<number, TournamentSeating>()
  async seating(id: number) {
    return this.seatings.get(id) ?? null
  }
}

/** DonationAlerts без сети: код `good` меняется на токены, токен обновления `dead-token` отозван. */
export class FakeDa implements DaGateway {
  calls: string[] = []
  async exchange(_app: DaAppConfig, code: string): Promise<VkTokens> {
    this.calls.push(`exchange:${code}`)
    if (code !== 'good') throw new VkError('rejected', 'DonationAlerts отказал (400, invalid_request)')
    return { accessToken: 'da-access', refreshToken: 'da-refresh', expiresIn: 31536000 }
  }
  async refresh(_app: DaAppConfig, token: string): Promise<VkTokens> {
    this.calls.push(`refresh:${token}`)
    if (token === 'dead-token') throw new VkError('revoked', 'Вход в DonationAlerts не действует')
    return { accessToken: 'da-access-2', refreshToken: 'da-refresh-2', expiresIn: 31536000 }
  }
}

/** Хранилище в памяти с той же семантикой, что у Postgres-версии. */
export class MemoryRepo implements MafboardRepo {
  users = new Map<string, MafboardUser>()
  tickets = new Map<string, LoginTicket>()
  qrTickets = new Map<string, QrTicket>()
  sessions = new Map<string, DeviceSession>()
  /** Отзыв и платформа хранятся в самой сессии — `refreshToken()` подставляет их, как JOIN в Postgres. */
  refresh = new Map<string, Omit<RefreshTokenRow, 'sessionRevokedAt' | 'sessionPlatform'>>()
  games = new Map<string, StoredGame>()
  activeGames = new Map<string, StoredActiveGame>()
  studio = new Map<string, StoredStudioSettings>()
  aim = new Map<string, string>()
  gomafiaCreds = new Map<string, string>()
  submissions = new Map<string, StoredProtocolSubmission>()
  shares = new Map<string, StoredShare>()
  titanMatchRows = new Map<string, number | null>()
  hosts: StoredClubHost[] = []
  requests = new Map<string, StoredClubRequest>()
  private seq = 0

  private uuid(): string {
    this.seq += 1
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`
  }

  async userById(id: string) { return this.users.get(id) ?? null }
  async userByTgId(tgId: number) { return [...this.users.values()].find((u) => u.tgId === tgId) ?? null }
  async userByGomafiaId(id: number) { return [...this.users.values()].find((u) => u.gomafia?.player.id === id) ?? null }
  async verifiedGomafiaIds(ids: number[]) {
    const linked = new Set([...this.users.values()].flatMap((u) => (u.gomafia ? [u.gomafia.player.id] : [])))
    return new Set(ids.filter((id) => linked.has(id)))
  }

  async upsertUserFromTelegram(p: Parameters<MafboardRepo['upsertUserFromTelegram']>[0]) {
    const existing = await this.userByTgId(p.tgId)
    const user: MafboardUser = {
      id: existing?.id ?? this.uuid(),
      tgId: p.tgId,
      tgUsername: p.tgUsername,
      tgFirstName: p.tgFirstName,
      tgLastName: p.tgLastName,
      phone: p.phone,
      termsVersion: p.termsVersion,
      gomafia: existing?.gomafia ?? null,
      titan: existing?.titan ?? null,
    }
    this.users.set(user.id, user)
    return user
  }

  async deleteUser(userId: string) {
    if (!this.users.delete(userId)) return false
    for (const [id, game] of this.games) {
      if (game.hostUserId !== userId) continue
      if (game.clubId == null) {
        this.games.delete(id)
      } else {
        const record = structuredClone(game.record) as { setup: { host: Record<string, unknown> } }
        delete record.setup.host['goMafiaPlayerID']
        record.setup.host['userID'] = DELETED_HOST_ID
        this.games.set(id, { ...game, hostUserId: null, record })
      }
    }
    for (const [id, game] of this.activeGames) if (game.hostUserId === userId) this.activeGames.delete(id)
    this.studio.delete(userId)
    this.aim.delete(userId)
    this.gomafiaCreds.delete(userId)
    for (const [id, s] of this.submissions) if (s.refereeUserId === userId) this.submissions.delete(id)
    for (const [token, s] of this.shares) if (s.userId === userId) this.shares.delete(token)
    for (const [id, session] of this.sessions) if (session.userId === userId) this.sessions.delete(id)
    for (const [hash, row] of this.refresh) if (row.userId === userId) this.refresh.delete(hash)
    for (const [id, ticket] of this.tickets) if (ticket.userId === userId) this.tickets.delete(id)
    for (const [id, ticket] of this.qrTickets) if (ticket.userId === userId) this.qrTickets.delete(id)
    this.requests.delete(userId)
    this.hosts = this.hosts.map((host) => (host.grantedBy === userId ? { ...host, grantedBy: null } : host))
    return true
  }

  async setGomafiaLink(userId: string, link: Parameters<MafboardRepo['setGomafiaLink']>[1], at: Date) {
    const user = this.users.get(userId)
    if (!user) return null
    if (link) {
      const owner = await this.userByGomafiaId(link.player.id)
      if (owner && owner.id !== userId) throw new GomafiaTakenError()
    }
    const sameAccount = user.gomafia && link && user.gomafia.player.id === link.player.id
    const source = link?.source ?? (sameAccount ? user.gomafia!.source : 'password')
    const updated: MafboardUser = {
      ...user,
      gomafia: link
        ? { player: link.player, club: link.club, source, linkedAt: sameAccount ? user.gomafia!.linkedAt : at, syncedAt: at }
        : null,
    }
    this.users.set(userId, updated)
    return updated
  }

  async clubHosts(clubId: number) {
    return this.hosts.filter((host) => host.clubId === clubId).sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime() || a.gomafiaId - b.gomafiaId)
  }

  async isClubHost(clubId: number, gomafiaId: number) {
    return this.hosts.some((host) => host.clubId === clubId && host.gomafiaId === gomafiaId)
  }

  async addClubHost(host: StoredClubHost) {
    const existing = this.hosts.find((row) => row.clubId === host.clubId && row.gomafiaId === host.gomafiaId)
    this.hosts = existing
      ? this.hosts.map((row) => (row === existing ? { ...row, nickname: host.nickname } : row))
      : [...this.hosts, host]
  }

  async removeClubHost(clubId: number, gomafiaId: number) {
    const before = this.hosts.length
    this.hosts = this.hosts.filter((host) => !(host.clubId === clubId && host.gomafiaId === gomafiaId))
    return this.hosts.length < before
  }

  async usersByGomafiaIds(ids: number[]) {
    return [...this.users.values()].filter((user) => user.gomafia != null && ids.includes(user.gomafia.player.id))
  }

  async clubPresidents(limit: number) {
    return [...this.users.values()]
      .filter((user) => user.gomafia?.club?.presidentID != null && user.gomafia.club.presidentID === user.gomafia.player.id)
      .slice(0, limit)
  }

  async clubRequest(userId: string) {
    return this.requests.get(userId) ?? null
  }

  async setClubRequest(userId: string, request: { nickname: string; at: Date } | null) {
    if (request) this.requests.set(userId, { userId, nickname: request.nickname, createdAt: request.at })
    else this.requests.delete(userId)
  }

  async clubRequestsByNicknames(nicknames: string[]) {
    const names = new Set(nicknames.map((name) => name.trim().toLowerCase()))
    return [...this.requests.values()]
      .filter((request) => names.has(request.nickname.trim().toLowerCase()))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async createTicket(input: Parameters<MafboardRepo['createTicket']>[0]) {
    const ticket: LoginTicket = {
      id: this.uuid(), ...input, status: 'pending', step: 'created',
      tgId: null, tgUsername: null, tgFirstName: null, tgLastName: null, phone: null, termsVersion: null,
      userId: null, openedAt: null, note: null, createdAt: NOW,
    }
    this.tickets.set(ticket.id, ticket)
    return ticket
  }

  async ticketById(id: string) { return this.tickets.get(id) ?? null }
  async ticketByDeepCode(code: string) { return [...this.tickets.values()].find((t) => t.deepCode === code) ?? null }

  async openTicketForTg(tgId: number, step: LoginTicket['step'], now: Date) {
    return [...this.tickets.values()].reverse()
      .find((t) => t.tgId === tgId && t.status === 'pending' && t.step === step && t.expiresAt > now) ?? null
  }

  async updateTicket(id: string, patch: Parameters<MafboardRepo['updateTicket']>[1], guard?: TicketGuard) {
    const ticket = this.tickets.get(id)
    if (!ticket) return null
    if (guard) {
      const owned = ticket.tgId === guard.tgId || (guard.allowUnbound && ticket.tgId == null)
      if (ticket.status !== 'pending' || !owned) return null
    }
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const updated = { ...ticket, ...definedPatch } as LoginTicket
    this.tickets.set(id, updated)
    return updated
  }

  async claimTicket(id: string, hash: string, now: Date) {
    const ticket = this.tickets.get(id)
    if (!ticket || ticket.status !== 'confirmed' || ticket.expiresAt <= now || ticket.deviceSecretHash !== hash) return null
    const claimed: LoginTicket = { ...ticket, status: 'claimed' }
    this.tickets.set(id, claimed)
    return claimed
  }

  async purgeExpired(before: Date) {
    const expired = [...this.tickets.values()].filter((t) => t.expiresAt < before)
    expired.forEach((t) => this.tickets.delete(t.id))
    const expiredQr = [...this.qrTickets.values()].filter((t) => t.expiresAt < before)
    expiredQr.forEach((t) => this.qrTickets.delete(t.id))
    const sessions = [...this.sessions.values()].filter((s) => s.expiresAt < before)
    sessions.forEach((s) => this.sessions.delete(s.id))
    const tokens = [...this.refresh.values()].filter((r) => r.expiresAt < before || !this.sessions.has(r.sessionId))
    tokens.forEach((r) => this.refresh.delete(r.tokenHash))
    return { tickets: expired.length + expiredQr.length, sessions: sessions.length, refreshTokens: tokens.length }
  }

  async createQrTicket(input: Parameters<MafboardRepo['createQrTicket']>[0]) {
    const ticket: QrTicket = { id: this.uuid(), ...input, status: 'pending', userId: null }
    this.qrTickets.set(ticket.id, ticket)
    return ticket
  }

  async qrTicketById(id: string) { return this.qrTickets.get(id) ?? null }
  async qrTicketByScan(scanCode: string) { return [...this.qrTickets.values()].find((t) => t.scanCode === scanCode) ?? null }

  async decideQrTicket(scanCode: string, code: string, userId: string, now: Date) {
    const ticket = await this.qrTicketByScan(scanCode)
    if (!ticket || ticket.status !== 'pending' || ticket.expiresAt <= now) return null
    const decided: QrTicket = ticket.confirmCode === code
      ? { ...ticket, status: 'confirmed', userId }
      : { ...ticket, status: 'rejected' }
    this.qrTickets.set(ticket.id, decided)
    return decided
  }

  async claimQrTicket(id: string, hash: string, now: Date) {
    const ticket = this.qrTickets.get(id)
    if (!ticket || ticket.status !== 'confirmed' || ticket.expiresAt <= now || ticket.deviceSecretHash !== hash) return null
    const claimed: QrTicket = { ...ticket, status: 'claimed' }
    this.qrTickets.set(id, claimed)
    return claimed
  }

  async createSession(input: Parameters<MafboardRepo['createSession']>[0]) {
    const session: DeviceSession = {
      id: this.uuid(), userId: input.userId, deviceName: input.deviceName, platform: input.platform,
      createdAt: input.at, lastUsedAt: input.at, expiresAt: input.expiresAt, revokedAt: null,
    }
    this.sessions.set(session.id, session)
    this.refresh.set(input.refreshTokenHash, {
      tokenHash: input.refreshTokenHash, userId: input.userId, sessionId: session.id, expiresAt: input.expiresAt, revokedAt: null,
    })
    return session
  }

  async sessionById(id: string) { return this.sessions.get(id) ?? null }

  async sessionsByUser(userId: string, now: Date, limit: number) {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && !s.revokedAt && s.expiresAt > now)
      .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
      .slice(0, limit)
  }

  async extendSession(input: Parameters<MafboardRepo['extendSession']>[0]) {
    const session = this.sessions.get(input.sessionId)
    if (!session || session.revokedAt) return false
    const lastUsedAt = input.at > session.lastUsedAt ? input.at : session.lastUsedAt
    this.sessions.set(session.id, { ...session, lastUsedAt, expiresAt: input.expiresAt })
    this.refresh.set(input.refreshTokenHash, {
      tokenHash: input.refreshTokenHash, userId: session.userId, sessionId: session.id, expiresAt: input.expiresAt, revokedAt: null,
    })
    return true
  }

  async touchSession(id: string, at: Date) {
    const session = this.sessions.get(id)
    if (session && session.lastUsedAt < at) this.sessions.set(id, { ...session, lastUsedAt: at })
  }

  async revokeSession(userId: string, sessionId: string, at: Date) {
    const session = this.sessions.get(sessionId)
    if (!session || session.userId !== userId || session.revokedAt) return false
    this.sessions.set(sessionId, { ...session, revokedAt: at })
    for (const [hash, row] of this.refresh) {
      if (row.sessionId === sessionId && !row.revokedAt) this.refresh.set(hash, { ...row, revokedAt: at })
    }
    return true
  }

  async revokeAllSessions(userId: string, at: Date) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) await this.revokeSession(userId, session.id, at)
    }
  }

  async refreshToken(hash: string): Promise<RefreshTokenRow | null> {
    const row = this.refresh.get(hash)
    if (!row) return null
    const session = this.sessions.get(row.sessionId)
    return { ...row, sessionRevokedAt: session?.revokedAt ?? null, sessionPlatform: session?.platform ?? null }
  }

  async revokeRefreshToken(hash: string, at: Date) {
    const row = this.refresh.get(hash)
    if (!row || row.revokedAt) return false
    this.refresh.set(hash, { ...row, revokedAt: at })
    return true
  }

  async insertGame(game: StoredGame) {
    const existing = this.games.get(game.id)
    if (existing && existing.hostUserId !== game.hostUserId) return 'conflict'
    this.games.set(game.id, game)
    return existing ? 'exists' : 'inserted'
  }

  async gamesByHost(userId: string, since: Date | null, limit: number) {
    return [...this.games.values()].filter((g) => g.hostUserId === userId && (!since || g.finishedAt > since)).slice(0, limit)
  }

  async gamesByClub(clubId: number, since: Date | null, limit: number) {
    return [...this.games.values()].filter((g) => g.clubId === clubId && (!since || g.finishedAt > since)).slice(0, limit)
  }

  async saveActiveGame(game: StoredActiveGame) {
    const finished = this.games.get(game.id)
    if (finished) return finished.hostUserId === game.hostUserId ? 'stale' : 'conflict'
    const existing = this.activeGames.get(game.id)
    if (existing && existing.hostUserId !== game.hostUserId) return 'conflict'
    if (existing && existing.revision > game.revision) return 'stale'
    this.activeGames.set(game.id, game)
    return 'saved'
  }

  async activeGamesByHost(userId: string, limit: number) {
    return [...this.activeGames.values()]
      .filter((g) => g.hostUserId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
  }

  async deleteActiveGame(userId: string, id: string) {
    if (this.activeGames.get(id)?.hostUserId === userId) this.activeGames.delete(id)
  }

  async setTitanLink(userId: string, link: TitanLinkState | null) {
    const user = this.users.get(userId)
    if (!user) return null
    const updated: MafboardUser = { ...user, titan: link }
    this.users.set(userId, updated)
    return updated
  }

  async titanMatches(apiBase: string) {
    const prefix = `${apiBase}|`
    return new Map(
      [...this.titanMatchRows].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value] as const),
    )
  }

  async setTitanMatch(apiBase: string, clientId: string, match: { goMafiaId: number | null } | null) {
    const key = `${apiBase}|${clientId}`
    if (match) this.titanMatchRows.set(key, match.goMafiaId)
    else this.titanMatchRows.delete(key)
  }

  async upsertProtocolSubmission(input: Parameters<MafboardRepo['upsertProtocolSubmission']>[0]) {
    const existing = [...this.submissions.values()].find((s) =>
      s.tournamentId === input.tournamentId && s.gameNumber === input.gameNumber && s.tableNumber === input.tableNumber && s.refereeUserId === input.refereeUserId)
    const { at, ...rest } = input
    const row: StoredProtocolSubmission = {
      ...rest, id: existing?.id ?? input.id, status: 'pending', reason: null, decidedBy: null,
      createdAt: existing?.createdAt ?? at, updatedAt: at,
    }
    this.submissions.set(row.id, row)
    return row
  }

  async protocolSubmissions(tournamentId: number, filter: { status?: StoredProtocolSubmission['status']; refereeUserId?: string }) {
    return [...this.submissions.values()]
      .filter((s) => s.tournamentId === tournamentId && (!filter.status || s.status === filter.status) && (!filter.refereeUserId || s.refereeUserId === filter.refereeUserId))
      .sort((a, b) => a.gameNumber - b.gameNumber || a.tableNumber - b.tableNumber)
  }

  async decideProtocolSubmission(id: string, decision: Parameters<MafboardRepo['decideProtocolSubmission']>[1]) {
    const current = this.submissions.get(id)
    if (!current || current.status !== 'pending') return null
    const row = { ...current, status: decision.status, reason: decision.reason, protocol: decision.protocol, decidedBy: decision.decidedBy, updatedAt: decision.at }
    this.submissions.set(id, row)
    return row
  }

  async protocolSubmissionById(id: string) {
    return this.submissions.get(id) ?? null
  }

  async saveShare(input: StoredShare) {
    const existing = [...this.shares.values()].find((s) => s.userId === input.userId && s.gameId === input.gameId)
    const row = existing ? { ...existing, snapshot: input.snapshot } : input
    this.shares.set(row.token, row)
    return row
  }

  async shareByToken(token: string) {
    return this.shares.get(token) ?? null
  }

  async gomafiaCredentials(userId: string) {
    return this.gomafiaCreds.get(userId) ?? null
  }

  async setGomafiaCredentials(userId: string, sealed: string | null) {
    if (sealed === null) this.gomafiaCreds.delete(userId)
    else this.gomafiaCreds.set(userId, sealed)
  }

  async aimCredentials(userId: string) {
    return this.aim.get(userId) ?? null
  }

  async setAimCredentials(userId: string, sealed: string | null) {
    if (sealed === null) this.aim.delete(userId)
    else this.aim.set(userId, sealed)
  }

  async studioSettings(userId: string) {
    return this.studio.get(userId) ?? null
  }

  async saveStudioSettings(input: Parameters<MafboardRepo['saveStudioSettings']>[0]) {
    const current = this.studio.get(input.userId) ?? null
    // Как в Postgres: записи нет — пишется; есть — только от той же ревизии.
    if (current && current.revision !== input.baseRevision) return { saved: false as const, current }
    const revision = input.baseRevision + 1
    this.studio.set(input.userId, { userId: input.userId, revision, updatedAt: input.updatedAt, document: input.document, secrets: input.secrets })
    return { saved: true as const, revision }
  }
}

export interface SentMessage {
  chatId: number
  text: string
  markup?: ReplyMarkup
}

export class FakeMessenger implements BotMessenger {
  sent: SentMessage[] = []
  answers: { id: string; text?: string }[] = []

  async send(chatId: number, text: string, markup?: ReplyMarkup) {
    this.sent.push(markup ? { chatId, text, markup } : { chatId, text })
  }

  async answerCallback(id: string, text?: string) {
    this.answers.push(text === undefined ? { id } : { id, text })
  }

  async username() { return 'mafboard_test_bot' }

  get last(): SentMessage | undefined { return this.sent.at(-1) }

  /** callback_data кнопки с этим текстом в последнем сообщении с inline-клавиатурой. */
  callbackFor(label: string): string {
    for (const message of [...this.sent].reverse()) {
      if (message.markup && 'inline_keyboard' in message.markup) {
        const button = message.markup.inline_keyboard.flat().find((b) => b.text === label)
        if (button?.callback_data) return button.callback_data
      }
    }
    throw new Error(`кнопка «${label}» не найдена`)
  }

  urlFor(label: string): string {
    for (const message of [...this.sent].reverse()) {
      if (message.markup && 'inline_keyboard' in message.markup) {
        const button = message.markup.inline_keyboard.flat().find((b) => b.text === label)
        if (button?.url) return button.url
      }
    }
    throw new Error(`кнопка-ссылка «${label}» не найдена`)
  }
}

export function gmPlayer(id: number, login: string, clubId: number | null = 77): GomafiaPlayer {
  return {
    gomafiaId: String(id), login, fullName: null, firstName: null, lastName: null, elo: 1500,
    avatar: `/avatars/${id}.jpg`, clubId: clubId == null ? null : String(clubId), clubTitle: clubId ? 'TITAN' : null,
    city: 'Москва', tournaments: 12,
  }
}

/** GoMafia-заглушка: логин «host»/«secret» → игрок 4242, президент клуба 77 (`presidents`). */
export class FakeGoMafia implements GoMafiaGateway {
  players = new Map<string, GomafiaPlayer>([
    ['4242', gmPlayer(4242, 'host')],
    ['5001', gmPlayer(5001, 'Шерлок')],
    ['5002', gmPlayer(5002, 'Шериф Ноттингема', 12)],
  ])
  roster: GomafiaPlayer[] = [gmPlayer(4242, 'host'), gmPlayer(5001, 'Шерлок')]
  /** Президент клуба по его номеру; клуба нет в списке — президента у него нет. */
  presidents = new Map<string, string>([['77', '4242']])
  /** Пароли входа по нику; «host» входит всегда паролем «secret». */
  passwords = new Map<string, { password: string; userId: string; clubId: string | null }>()
  clubCalls = 0
  /** Подменить ответ входа (форма успеха без id, сетевая ошибка). */
  loginOverride: GomafiaLoginResult | null = null
  /** Как GoMafia с 2026-11-17: без cookie входа — GomafiaAuthRequired. */
  requireAuth = false
  logins = 0
  /** Номер сессии: смена «истекает» выданные раньше cookie. */
  sessionEpoch = 1

  private check(auth?: GomafiaAuth) {
    if (this.requireAuth && auth?.cookie !== `gm=${this.sessionEpoch}`) throw new GomafiaAuthRequired()
  }

  async login(login: string, password: string): Promise<GomafiaLoginResult> {
    this.logins += 1
    if (this.loginOverride) return this.loginOverride
    const account = this.passwords.get(login)
    if (account && account.password === password) {
      return { ok: true, userId: account.userId, clubId: account.clubId, cookie: `gm=${this.sessionEpoch}` }
    }
    return login === 'host' && password === 'secret'
      ? { ok: true, userId: '4242', clubId: '77', cookie: `gm=${this.sessionEpoch}` }
      : { ok: false, error: 'Никнейм и пароль введены неверно, проверьте правильность введенных данных' }
  }

  async player(id: string, auth?: GomafiaAuth) {
    this.check(auth)
    return this.players.get(id) ?? null
  }

  async club(clubId: string, page: number, auth?: GomafiaAuth) {
    this.check(auth)
    this.clubCalls += 1
    const residents = clubId === '77' && page === 1 ? this.roster : []
    return {
      club: { id: clubId, title: 'TITAN', city: 'Москва', description: null, rank: null, presidentId: this.presidents.get(clubId) ?? null },
      residents,
      total: this.roster.length,
    }
  }

  async search(query: string, _limit?: number, auth?: GomafiaAuth) {
    this.check(auth)
    return [...this.players.values()].filter((p) => p.login.toLowerCase().includes(query.toLowerCase()))
  }
}

export interface TestContext {
  app: Hono
  deps: MafboardDeps
  repo: MemoryRepo
  messenger: FakeMessenger
  gomafia: FakeGoMafia
  aim: FakeAim
  tournaments: FakeTournaments
  titan: FakeTitan
  /** Дождаться фоновых задач (обработка апдейтов бота). */
  flush(): Promise<void>
  clock: { now: Date }
}

export function createTestContext(overrides: Partial<MafboardDeps> = {}): TestContext {
  const repo = new MemoryRepo()
  const messenger = new FakeMessenger()
  const gomafia = new FakeGoMafia()
  const titan = new FakeTitan()
  const clock = { now: NOW }
  const aim = new FakeAim()
  const aimAccounts = new AimAccounts(repo, aim, config.studioSecretsKey, () => clock.now)
  const tournaments = new FakeTournaments()
  const pending: Promise<void>[] = []
  const seen = new Set<string>()
  const counters = new Map<string, { count: number; until: number }>()

  const deps: MafboardDeps = {
    repo,
    config,
    gomafia,
    roster: new RosterCache(gomafia, () => clock.now.getTime()),
    hub: noHub,
    titan,
    titanRoster: new TitanRosterCache(titan, () => clock.now.getTime()),
    messenger,
    vk: new FakeVk(),
    donationAlerts: new FakeDa(),
    aimAccounts,
    gomafiaSessions: new GoMafiaSessions(repo, gomafia, config.studioSecretsKey, aimAccounts, () => clock.now, (userId) => sessionDelegate(repo, userId)),
    tournaments,
    limiter: {
      async hit(key, limit, windowSec) {
        const now = clock.now.getTime()
        const entry = counters.get(key)
        const current = entry && entry.until > now ? entry : { count: 0, until: now + windowSec * 1000 }
        current.count += 1
        counters.set(key, current)
        return current.count <= limit
      },
    },
    async firstDelivery(key) {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
    now: () => clock.now,
    background: (_key, job) => {
      pending.push(job())
    },
    ...overrides,
  }

  const app = new Hono().route('/api/mafboard', createMafboardRouter(() => deps))
  return {
    app, deps, repo, messenger, gomafia, titan, clock, aim, tournaments,
    async flush() {
      while (pending.length > 0) await pending.shift()
    },
  }
}

export async function call(
  ctx: TestContext,
  method: string,
  path: string,
  options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'x-real-ip': '10.0.0.1', ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers['authorization'] = `Bearer ${options.token}`
  const response = await ctx.app.request(`/api/mafboard${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

export const DEVICE_SECRET = 'device-secret-0123456789abcdefghijklmnopqrstuv'
export const TG_USER = { id: 1001, is_bot: false, first_name: 'Кай', username: 'kai' }

let updateId = 1

export function message(from: typeof TG_USER, extra: Record<string, unknown>) {
  updateId += 1
  return {
    update_id: updateId,
    message: { message_id: updateId, from, chat: { id: from.id, type: 'private' }, date: 0, ...extra },
  }
}

export function callback(from: typeof TG_USER, data: string) {
  updateId += 1
  return { update_id: updateId, callback_query: { id: `cb-${updateId}`, from, data } }
}

/** Прогнать полный вход через бота и вернуть сессию приложения. */
export async function signIn(
  ctx: TestContext,
  user = TG_USER,
  device: { deviceName: string; platform: 'ios' | 'android' } = { deviceName: 'iPhone', platform: 'ios' },
): Promise<{ accessToken: string; refreshToken: string; account: any }> {
  const { handleBotUpdate } = await import('../../src/modules/mafboard/bot.js')
  const bot = { repo: ctx.repo, messenger: ctx.messenger, config, now: () => ctx.clock.now }

  const start = await call(ctx, 'POST', '/v1/auth/telegram/start', {
    body: { ...device, deviceSecret: DEVICE_SECRET },
  })
  const code = new URL(start.json.deepLink).searchParams.get('start') ?? ''
  await handleBotUpdate(message(user, { text: `/start ${code}` }) as any, bot)
  if (ctx.messenger.last?.text.includes('соглашение')) {
    await handleBotUpdate(callback(user, ctx.messenger.callbackFor('Принимаю')) as any, bot)
  }
  if (ctx.messenger.last?.text.includes('номером')) {
    await handleBotUpdate(message(user, { contact: { phone_number: '79161234567', user_id: user.id } }) as any, bot)
  }
  // Сверка кода: нажимаем тот, что «показан в приложении» (пришёл в ответе start).
  await handleBotUpdate(callback(user, ctx.messenger.callbackFor(start.json.confirmationCode)) as any, bot)

  const complete = await call(ctx, 'POST', '/v1/auth/telegram/complete', {
    body: { ticket: start.json.id, deviceSecret: DEVICE_SECRET },
  })
  if (complete.status !== 200) throw new Error(`вход не завершён: ${complete.status} ${JSON.stringify(complete.json)}`)
  return { ...complete.json.tokens, account: complete.json.account }
}
