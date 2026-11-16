import { hkdfSync } from 'node:crypto'
import { tournamentServerData } from '../../lib/gomafia.js'
import { AimClient, AimError, type AimSession } from '../../lib/gomafiaAim.js'
import type { AimGame, AimProtocol, AimTournament } from '../../lib/gomafiaAimParse.js'
import { parseTournamentSeating, type TournamentSeating } from '../../lib/gomafiaTournament.js'
import type { MafboardRepo } from './repo.js'
import { openSecrets, sealSecrets } from './studio.js'

// ─────────────────────────────────────────────────────────────────────────────
// Вход в АИМ для режима «Турнир GoMafia» (ios/docs/GOMAFIA-TOURNAMENT.md в MafBoardStudio).
//
// Протоколы в АИМ вносит сервер, поэтому он хранит логин и пароль АИМ пользователя —
// шифротекстом (AES-256-GCM) отдельного ключа, выведенного из ключа секретов сервера.
// Пароль не уходит в ответы и логи; стирается при отвязке GoMafia и вместе с аккаунтом.
// Сессия АИМ (cookie) живёт только в памяти; истекла — сервер входит заново.
// ─────────────────────────────────────────────────────────────────────────────

export interface AimGateway {
  login(login: string, password: string): Promise<AimSession>
  tournaments(session: AimSession): Promise<AimTournament[]>
  gameData(session: AimSession, tournamentId: number): Promise<AimGame[]>
  saveProtocol(session: AimSession, tournamentId: number, aimTableId: number, protocol: AimProtocol): Promise<void>
}

/** Публичная рассадка турнира с gomafia.pro. */
export interface TournamentSource {
  seating(tournamentId: number): Promise<TournamentSeating | null>
}

export const liveAim: AimGateway = new AimClient()

export const liveTournaments: TournamentSource = {
  async seating(tournamentId) {
    return parseTournamentSeating(await tournamentServerData(tournamentId))
  },
}

const KEY_BYTES = 32

/** Свой ключ для входа в АИМ: утечка одного вида секретов не раскрывает другой. */
export function aimCredentialsKey(secretsKey: Uint8Array): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secretsKey, 'mafboard-aim', 'aim-credentials-v1', KEY_BYTES))
}

/** У пользователя нет сохранённого входа в АИМ (или он не расшифровывается). */
export class AimNotConnectedError extends Error {
  constructor() {
    super('aim_not_connected')
  }
}

interface Credentials {
  login: string
  password: string
}

/** Вход в АИМ всех пользователей сервера: шифрованное хранение и кэш сессий. */
export class AimAccounts {
  private readonly sessions = new Map<string, AimSession>()
  private readonly key: Uint8Array

  constructor(
    private readonly repo: MafboardRepo,
    private readonly gateway: AimGateway,
    secretsKey: Uint8Array,
    private readonly now: () => Date,
  ) {
    this.key = aimCredentialsKey(secretsKey)
  }

  /** Проверить вход в АИМ и сохранить его. Бросает AimError (`bad_credentials`, `unavailable`). */
  async connect(userId: string, login: string, password: string): Promise<void> {
    const session = await this.gateway.login(login, password)
    await this.repo.setAimCredentials(userId, sealSecrets(this.key, { login, password }), this.now())
    this.sessions.set(userId, session)
  }

  async disconnect(userId: string): Promise<void> {
    this.sessions.delete(userId)
    await this.repo.setAimCredentials(userId, null, this.now())
  }

  async connected(userId: string): Promise<boolean> {
    return (await this.credentials(userId)) !== null
  }

  /** Логин подключённого АИМ (без пароля) — чтобы в профиле было видно, какой аккаунт. */
  async connectedLogin(userId: string): Promise<string | null> {
    return (await this.credentials(userId))?.login ?? null
  }

  /**
   * Выполнить запрос к АИМ от имени пользователя. Сессии нет или она истекла — один раз
   * входит заново сохранённым паролем. Сменил пароль в АИМ — AimError `bad_credentials`.
   */
  async run<T>(userId: string, job: (session: AimSession) => Promise<T>): Promise<T> {
    const cached = this.sessions.get(userId)
    if (cached) {
      try {
        return await job(cached)
      } catch (error) {
        if (!(error instanceof AimError && error.code === 'session_expired')) throw error
        this.sessions.delete(userId)
      }
    }
    return job(await this.freshSession(userId))
  }

  /** Турниры пользователя в АИМ (раздел «Турниры»), включая завершённые. */
  tournaments(userId: string): Promise<AimTournament[]> {
    return this.run(userId, (session) => this.gateway.tournaments(session))
  }

  /** Протокол турнира. Не редактору АИМ отказывает — AimError `access_denied`. */
  gameData(userId: string, tournamentId: number): Promise<AimGame[]> {
    return this.run(userId, (session) => this.gateway.gameData(session, tournamentId))
  }

  /** Внести протокол стола от имени пользователя (редактора турнира). */
  saveProtocol(userId: string, tournamentId: number, aimTableId: number, protocol: AimProtocol): Promise<void> {
    return this.run(userId, (session) => this.gateway.saveProtocol(session, tournamentId, aimTableId, protocol))
  }

  private async credentials(userId: string): Promise<Credentials | null> {
    const sealed = await this.repo.aimCredentials(userId)
    if (!sealed) return null
    const value = openSecrets(this.key, sealed)
    const login = value?.['login']
    const password = value?.['password']
    return typeof login === 'string' && typeof password === 'string' ? { login, password } : null
  }

  private async freshSession(userId: string): Promise<AimSession> {
    const credentials = await this.credentials(userId)
    if (!credentials) throw new AimNotConnectedError()
    const session = await this.gateway.login(credentials.login, credentials.password)
    this.sessions.set(userId, session)
    return session
  }
}
