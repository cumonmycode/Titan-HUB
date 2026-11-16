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
  /** Игрок вошёл в MafBoard через бота и привязал этот аккаунт GoMafia. Старые клиенты поле не читают. */
  isVerified: boolean
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
  /** Клуб в Titan HUB, подключённый через Titan Connect: его клиенты — игроки для подбора. */
  titan: TitanLinkState | null
}

/**
 * Подключение Titan Connect ведущего. Ключ клуба хранится только шифротекстом (studio.ts) и
 * наружу не уходит. `apiBase` — адрес API клуба, он же ключ клуба для сопоставлений.
 */
export interface TitanLinkState {
  apiBase: string
  clubName: string | null
  connectionId: string
  scopes: string[]
  tokenSealed: string
  linkedAt: Date
}

/** Клиент клуба Titan в формате приложения (`TitanPlayer`). */
export interface TitanPlayerJSON {
  /** id клиента в Titan HUB. */
  id: string
  /**
   * PlayerID в играх: с GoMafia — тот же, что у игрока GoMafia (PlayerID.goMafia), без — свой,
   * постоянный для клиента этого клуба (префикс «mafbtc»).
   */
  playerID: string
  nickname: string
  fullName: string | null
  avatarURL: string | null
  statusLabel: string | null
  isResident: boolean
  goMafiaID: number | null
  /** Откуда номер GoMafia: из профиля в HUB или сопоставлен ведущим вручную. */
  goMafiaSource: 'hub' | 'manual' | null
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
  /** Платформа сессии: от неё зависит, что отзывать при позднем повторе токена. */
  sessionPlatform: string | null
}

export type QrTicketStatus = 'pending' | 'confirmed' | 'rejected' | 'claimed'

/**
 * Билет входа в MBS по QR-коду. Настоящий код виден только на экране ноутбука, на телефоне —
 * он же среди ложных. Варианты хранятся в билете: выданные заново, они выдали бы настоящий код.
 */
export interface QrTicket {
  id: string
  /** Часть QR-кода. По нему телефон находит билет, без входа в аккаунт он бесполезен. */
  scanCode: string
  confirmCode: string
  choiceCodes: number[]
  deviceSecretHash: string
  deviceName: string
  platform: string
  status: QrTicketStatus
  /** Кто подтвердил вход. Задан только у подтверждённого билета. */
  userId: string | null
  expiresAt: Date
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
/** Настройки MafBoard Studio ведущего: документ профилей и зашифрованные секреты. */
export interface StoredStudioSettings {
  userId: string
  /** Растёт с каждой записью: запись от устаревшей ревизии отклоняется. */
  revision: number
  updatedAt: Date
  document: Record<string, unknown>
  /** `sealSecrets` из studio.ts. null — секретов нет. */
  secrets: string | null
}

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
  /** null — ведущий удалил аккаунт, игра осталась в истории клуба без него. */
  hostUserId: string | null
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
