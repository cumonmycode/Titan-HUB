// Типы модуля MafBoard. JSON-формы повторяют Codable-модели приложения
// (MafBoardCore: UserAccount, GoMafiaPlayer, LoginTicket, AuthSession, GameRecord).

/** Игрок GoMafia в формате приложения (`GoMafiaPlayer`). */
export interface GoMafiaPlayerJSON {
  id: number
  nickname: string
  fullName: string | null
  avatarURL: string | null
  elo: number | null
  clubID: number | null
  clubTitle: string | null
  city: string | null
  tournamentsPlayed: number | null
  /** Обязательное поле: приложение декодирует его без значения по умолчанию. */
  isInHostClub: boolean
}

export interface GoMafiaClubJSON {
  id: number
  title: string
  city: string | null
}

export interface GoMafiaLinkState {
  player: GoMafiaPlayerJSON
  club: GoMafiaClubJSON | null
  linkedAt: Date
  syncedAt: Date
}

/** Пользователь приложения (ведущий). */
export interface MafboardUser {
  id: string
  tgId: number
  tgUsername: string | null
  tgFirstName: string
  tgLastName: string | null
  /** E.164, только на сервере; наружу — в маске. */
  phone: string | null
  termsVersion: string | null
  gomafia: GoMafiaLinkState | null
}

export interface TelegramProfile {
  tgId: number
  tgUsername: string | null
  tgFirstName: string
  tgLastName: string | null
}

export type TicketStatus = 'pending' | 'confirmed' | 'rejected' | 'claimed'
/** Шаг в боте: соглашение → номер → подтверждение. */
export type TicketStep = 'created' | 'terms' | 'contact' | 'confirm' | 'done'

export interface LoginTicket {
  id: string
  deepCode: string
  /** Двузначный код сверки: показан в приложении, в боте нужно нажать тот же (защита от фишинга ссылкой). */
  confirmCode: string
  deviceSecretHash: string
  deviceName: string
  platform: string
  status: TicketStatus
  step: TicketStep
  tgId: number | null
  tgUsername: string | null
  tgFirstName: string | null
  tgLastName: string | null
  phone: string | null
  termsVersion: string | null
  userId: string | null
  openedAt: Date | null
  note: string | null
  createdAt: Date
  expiresAt: Date
}

export type TicketPatch = Partial<
  Pick<
    LoginTicket,
    'status' | 'step' | 'tgId' | 'tgUsername' | 'tgFirstName' | 'tgLastName' | 'phone' | 'termsVersion' | 'userId' | 'openedAt' | 'note'
  >
>

/**
 * Условие обновления билета (защита от гонок): билет ещё pending и принадлежит этому
 * Telegram — или, если `allowUnbound`, пока ни к кому не привязан.
 */
export interface TicketGuard {
  tgId: number
  allowUnbound: boolean
}

export interface RefreshTokenRow {
  tokenHash: string
  userId: string
  sessionId: string
  expiresAt: Date
  revokedAt: Date | null
  /** Сессия завершена (выход, отзыв с другого устройства) — токен больше не годится, но это не кража. */
  sessionRevokedAt: Date | null
}

/**
 * Сессия — вход на одном устройстве. Живёт, пока её продлевают refresh-токены
 * (каждое обновление выдаёт новый токен той же сессии), до выхода или отзыва.
 */
export interface DeviceSession {
  id: string
  userId: string
  deviceName: string | null
  platform: string | null
  createdAt: Date
  lastUsedAt: Date
  /** Срок последнего выданного refresh-токена. */
  expiresAt: Date
  revokedAt: Date | null
}

/** Завершённая игра в истории. `record` — GameRecord приложения как есть. */
/** Идущая игра ведущего: снимок журнала, чтобы продолжить после переустановки или на другом устройстве. */
export interface StoredActiveGame {
  id: string
  hostUserId: string
  /** Растёт с каждым изменением на телефоне: старый снимок не затирает новый. */
  revision: number
  updatedAt: Date
  snapshot: unknown
}

export interface StoredGame {
  id: string
  hostUserId: string
  /** Клуб GoMafia; null — личная история ведущего. */
  clubId: number | null
  format: string
  variant: string
  startedAt: Date
  finishedAt: Date
  schemaVersion: number
  record: unknown
}

/** Ответ об ошибке в формате приложения: `{"error": {"code", "message"}}`. */
export interface ErrorBody {
  error: { code: string; message: string }
}
