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
  /**
   * Игрок GoMafia — президент клуба; null — у клуба его нет. Поля нет (привязка сохранена до
   * пула судей или страница клуба не открылась) — президент неизвестен, клуб нужно перечитать.
   */
  presidentID?: number | null
}

/**
 * Как подтверждён аккаунт GoMafia: `password` — входом в GoMafia, `club` — президент клуба
 * подтвердил заявку судьи по нику (судья не помнит пароль). Привязка `club` держится на пуле судей.
 */
export type GoMafiaLinkSource = 'password' | 'club'

export interface GoMafiaLinkState {
  player: GoMafiaPlayerJSON
  club: GoMafiaClubJSON | null
  source: GoMafiaLinkSource
  linkedAt: Date
  syncedAt: Date
}

/**
 * Права ведущего в клубе GoMafia: `president` — президент клуба, `host` — судья из пула,
 * куда его добавил президент, `none` — рейтинговые игры клуба вести нельзя (только фанки).
 */
export type ClubAccess = 'president' | 'host' | 'none'

/** Права пользователя на время запроса: считаются из привязки GoMafia и пула судей (clubHosts.ts). */
export interface HostAccess {
  club: ClubAccess
  /** Действующий клуб Titan HUB — подключение клуба MafBoard, общее для президента и судей пула. */
  titan: TitanLinkState | null
  /** Пользователь — судья пула: клуб Titan ему достался от клуба, и отключить его он не может. */
  titanShared: boolean
  /** Заявка судьи без пароля GoMafia, которая ждёт президента клуба. */
  request: StoredClubRequest | null
  /** Запись клуба MafBoard у президента и судьи пула. null — доступа к клубу нет или запись не прочиталась. */
  mafboardClub: StoredClub | null
  /** Все клубы пользователя с ролью: клуб GoMafia первым, затем клубы по записям членства (clubAccess.ts). */
  clubs: { club: StoredClub; role: ClubRole; titan: TitanLinkState | null }[]
}

/**
 * Клуб MafBoard: своя запись, на которую ссылаются игры и подключение Titan HUB. Клуб GoMafia —
 * одно из его подключений; клубы без GoMafia появятся позже.
 */
export interface StoredClub {
  id: string
  name: string
  city: string | null
  /** Клуб GoMafia, подключённый к этому клубу. null — клуб без GoMafia. */
  gomafiaClubId: number | null
  /** Подключение Titan Connect клуба: действует у президента и судей пула, смену президента переживает. */
  titan: TitanLinkState | null
  /** Кто подключил Titan. null — подключения нет или подключивший удалил аккаунт. */
  titanLinkedBy: string | null
  /** Владелец клуба без GoMafia (создал его кодом Titan Connect). У клуба GoMafia владелец — его президент. */
  ownerUserId?: string | null
}

/** Роль в клубе MafBoard: владелец управляет клубом и приглашает судей, судья ведёт игры клуба. */
export type ClubRole = 'owner' | 'judge'

/** Запись членства в клубе: владелец клуба без GoMafia или судья, вступивший по приглашению. */
export interface StoredClubMember {
  clubId: string
  userId: string
  role: ClubRole
  addedBy: string | null
  addedAt: Date
}

/** Ссылка-приглашение в клуб. Хранится только хэш токена: сама ссылка есть только у владельца. */
export interface StoredClubInvite {
  id: string
  clubId: string
  tokenHash: string
  createdBy: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
}

/** Судья в пуле клуба GoMafia: резидент, которому президент дал вести игры клуба в MafBoard. */
export interface StoredClubHost {
  clubId: number
  gomafiaId: number
  /** Ник на момент выдачи: список судей показывается, даже если GoMafia не отвечает. */
  nickname: string
  /** null — президент, выдавший доступ, удалил аккаунт. */
  grantedBy: string | null
  grantedAt: Date
}

/** Заявка судьи, который не помнит пароль GoMafia: ник, под которым он играет. Одна на пользователя. */
export interface StoredClubRequest {
  userId: string
  nickname: string
  createdAt: Date
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
  /**
   * Личная запись о клубе Titan HUB. Действует подключение клуба (`StoredClub.titan`, см.
   * `HostAccess`), а здесь лежит его копия у подключившего президента — на случай отката к коду,
   * который читал Titan отсюда, и если запись клуба не прочиталась. У не-президента это может быть
   * ключ прежних времён, когда клуб Titan подключал любой ведущий: он ни на что не влияет.
   */
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
  /** Клуб MafBoard этой игры. Заполняет хранилище по `clubId`; null — личная история. */
  clubRef?: string | null
  format: string
  variant: string
  startedAt: Date
  finishedAt: Date
  schemaVersion: number
  record: unknown
}

/** Протокол судьи турнира GoMafia, ждущий подтверждения ГС. */
export interface StoredProtocolSubmission {
  id: string
  tournamentId: number
  tournamentTitle: string
  gameNumber: number
  tableNumber: number
  refereeUserId: string
  /** Ник судьи в GoMafia — для списка ГС. */
  refereeName: string
  /** GoMafia id ГС турнира (кто должен подтвердить). */
  reviewerGomafiaId: number | null
  /** Протокол в полях АИМ (ProtocolInput в tournaments.ts). */
  protocol: unknown
  status: 'pending' | 'saved' | 'rejected'
  reason: string | null
  decidedBy: string | null
  createdAt: Date
  updatedAt: Date
}

/** Открытая ссылка на итоги игры: снимок итогов, который прислало приложение. */
export interface StoredShare {
  token: string
  userId: string
  gameId: string
  snapshot: unknown
  createdAt: Date
}

/** Ответ об ошибке в формате приложения: `{"error": {"code", "message"}}`. */
export interface ErrorBody {
  error: { code: string; message: string }
}
