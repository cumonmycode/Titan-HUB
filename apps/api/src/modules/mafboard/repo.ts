import type {
  DeviceSession, GoMafiaClubJSON, GoMafiaPlayerJSON, LoginTicket, MafboardUser, RefreshTokenRow, StoredActiveGame, StoredGame, TelegramProfile, TicketGuard,
  TicketPatch, TicketStep,
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
  /** Удалить билеты, сессии и refresh-токены, истёкшие раньше `before`. */
  purgeExpired(before: Date): Promise<{ tickets: number; sessions: number; refreshTokens: number }>

  // ─── Сессии устройств ──────────────────────────────────────────────────────
  /** Атомарно: новая сессия (вход на устройстве) вместе с её первым refresh-токеном. */
  createSession(input: {
    userId: string
    deviceName: string | null
    platform: string | null
    refreshTokenHash: string
    at: Date
    expiresAt: Date
  }): Promise<DeviceSession>
  sessionById(id: string): Promise<DeviceSession | null>
  /** Не отозванные и не истёкшие сессии пользователя, сначала недавние. */
  sessionsByUser(userId: string, now: Date, limit: number): Promise<DeviceSession[]>
  /**
   * Атомарно: новый refresh-токен для сессии и продление её срока. false — сессию
   * уже отозвали (выход или отзыв с другого устройства), токен не выдан.
   */
  extendSession(input: { sessionId: string; refreshTokenHash: string; at: Date; expiresAt: Date }): Promise<boolean>
  /** Отметить, что сессией пользуются (время не уходит назад). */
  touchSession(id: string, at: Date): Promise<void>
  /** Отозвать сессию этого пользователя и её refresh-токены. false — нет такой активной сессии. */
  revokeSession(userId: string, sessionId: string, at: Date): Promise<boolean>
  /** Отозвать все сессии пользователя (признак кражи refresh-токена). */
  revokeAllSessions(userId: string, at: Date): Promise<void>

  // ─── Refresh-токены ────────────────────────────────────────────────────────
  refreshToken(tokenHash: string): Promise<RefreshTokenRow | null>
  /** Атомарно отозвать активный токен. false — уже отозван (повторное использование). */
  revokeRefreshToken(tokenHash: string, at: Date, replacedBy: string | null): Promise<boolean>

  // ─── Игры ──────────────────────────────────────────────────────────────────
  /** Идемпотентно: та же игра того же ведущего — 'exists', чужая с тем же id — 'conflict'. */
  insertGame(game: StoredGame): Promise<'inserted' | 'exists' | 'conflict'>
  gamesByHost(userId: string, since: Date | null, limit: number): Promise<StoredGame[]>
  gamesByClub(clubId: number, since: Date | null, limit: number): Promise<StoredGame[]>

  // ─── Идущие игры ───────────────────────────────────────────────────────────
  /**
   * Сохранить снимок идущей игры. 'saved' — записан; 'stale' — на сервере снимок новее
   * или игра уже закончена; 'conflict' — игра с этим id принадлежит другому ведущему.
   */
  saveActiveGame(game: StoredActiveGame): Promise<'saved' | 'stale' | 'conflict'>
  activeGamesByHost(userId: string, limit: number): Promise<StoredActiveGame[]>
  deleteActiveGame(userId: string, id: string): Promise<void>
}
