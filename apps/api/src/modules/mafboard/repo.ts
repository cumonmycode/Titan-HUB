import type {
  GoMafiaClubJSON, GoMafiaPlayerJSON, LoginTicket, MafboardUser, RefreshTokenRow, StoredGame, TelegramProfile, TicketGuard, TicketPatch, TicketStep,
} from './types.js'

/** Аккаунт GoMafia уже привязан к другому пользователю (уникальность gomafia_id). */
export class GomafiaTakenError extends Error {
  constructor() {
    super('gomafia_taken')
  }
}

/**
 * Хранилище MafBoard. Роутер и бот работают только через этот контракт:
 * в проде — Postgres (pgRepo.ts), в тестах — память (test/mafboard/helpers.ts).
 */
export interface MafboardRepo {
  // ─── Пользователи ──────────────────────────────────────────────────────────
  userById(id: string): Promise<MafboardUser | null>
  userByTgId(tgId: number): Promise<MafboardUser | null>
  userByGomafiaId(gomafiaId: number): Promise<MafboardUser | null>
  /** Создать или обновить пользователя по Telegram (вход подтверждён в боте). */
  upsertUserFromTelegram(profile: TelegramProfile & { phone: string; termsVersion: string }): Promise<MafboardUser>
  /** Привязать (или отвязать — null) аккаунт GoMafia. Бросает GomafiaTakenError при занятом аккаунте. */
  setGomafiaLink(
    userId: string,
    link: { player: GoMafiaPlayerJSON; club: GoMafiaClubJSON | null } | null,
    at: Date,
  ): Promise<MafboardUser | null>

  // ─── Билеты входа ──────────────────────────────────────────────────────────
  createTicket(input: {
    deepCode: string
    confirmCode: string
    deviceSecretHash: string
    deviceName: string
    platform: string
    expiresAt: Date
  }): Promise<LoginTicket>
  ticketById(id: string): Promise<LoginTicket | null>
  ticketByDeepCode(deepCode: string): Promise<LoginTicket | null>
  /** Последний незавершённый и не истёкший билет этого Telegram на данном шаге. */
  openTicketForTg(tgId: number, step: TicketStep, now: Date): Promise<LoginTicket | null>
  /** С `guard` — атомарно: обновит, только если условие выполнено, иначе null. */
  updateTicket(id: string, patch: TicketPatch, guard?: TicketGuard): Promise<LoginTicket | null>
  /** Атомарно: подтверждённый, не истёкший билет с этим секретом → claimed. Иначе null. */
  claimTicket(id: string, deviceSecretHash: string, now: Date): Promise<LoginTicket | null>
  /** Удалить билеты и refresh-токены, истёкшие раньше `before`. */
  purgeExpired(before: Date): Promise<{ tickets: number; refreshTokens: number }>

  // ─── Refresh-токены ────────────────────────────────────────────────────────
  insertRefreshToken(row: { tokenHash: string; userId: string; deviceName: string | null; platform: string | null; expiresAt: Date }): Promise<void>
  refreshToken(tokenHash: string): Promise<RefreshTokenRow | null>
  /** Атомарно отозвать активный токен. false — уже отозван (повторное использование). */
  revokeRefreshToken(tokenHash: string, at: Date, replacedBy: string | null): Promise<boolean>
  revokeAllRefreshTokens(userId: string, at: Date): Promise<void>

  // ─── Игры ──────────────────────────────────────────────────────────────────
  /** Идемпотентно: та же игра того же ведущего — 'exists', чужая с тем же id — 'conflict'. */
  insertGame(game: StoredGame): Promise<'inserted' | 'exists' | 'conflict'>
  gamesByHost(userId: string, since: Date | null, limit: number): Promise<StoredGame[]>
  gamesByClub(clubId: number, since: Date | null, limit: number): Promise<StoredGame[]>
}
