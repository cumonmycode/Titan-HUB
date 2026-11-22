import type {
  DeviceSession, GoMafiaClubJSON, GoMafiaLinkSource, GoMafiaPlayerJSON, LoginTicket, MafboardUser, QrTicket, RefreshTokenRow, StoredActiveGame, StoredClub, StoredClubApplication, StoredClubHost, StoredClubInvite, StoredClubMember, StoredClubPlayer, StoredClubRequest, StoredGame, StoredPlayerLink, StoredPlayerLinkToken, StoredPlayerPhoto, StoredProtocolSubmission, StoredShare, StoredStudioSettings, TelegramProfile,
  TicketGuard, TicketPatch, TicketStep, TitanLinkState,
} from './types.js'

/**
 * Привязка GoMafia для записи. `source` не задан — прежний способ подтверждения остаётся
 * (обновление профиля), у новой привязки — `password`.
 */
export interface GomafiaLinkInput {
  player: GoMafiaPlayerJSON
  club: GoMafiaClubJSON | null
  source?: GoMafiaLinkSource
}

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
  /** Какие из этих аккаунтов GoMafia привязаны к пользователям MafBoard — подтверждённые профили. */
  verifiedGomafiaIds(gomafiaIds: number[]): Promise<Set<number>>
  /** Создать или обновить пользователя по Telegram (вход подтверждён в боте). */
  upsertUserFromTelegram(profile: TelegramProfile & { phone: string; termsVersion: string }): Promise<MafboardUser>
  /**
   * Привязать (или отвязать — null) аккаунт GoMafia. Бросает GomafiaTakenError при занятом аккаунте.
   * Заодно заводит запись клуба MafBoard для клуба из привязки: полный снимок (с президентом)
   * обновляет название и город, неполный их не трогает. Подключение Titan клуба привязка не меняет.
   */
  setGomafiaLink(userId: string, link: GomafiaLinkInput | null, at: Date): Promise<MafboardUser | null>
  /**
   * Личная запись пользователя о клубе Titan HUB (или её удаление — null). Действует подключение
   * клуба (`setClubTitanLink`); личные записи остались от сборок до 4в (`/v1/me/titan` писал сюда копию)
   * и теперь только стираются — при удалении аккаунта.
   */
  setTitanLink(userId: string, link: TitanLinkState | null): Promise<MafboardUser | null>
  /**
   * Удалить аккаунт: сессии, билеты, идущие и личные игры уходят вместе с ним, игры клуба
   * остаются в его истории без ведущего. false — такого пользователя уже нет.
   */
  deleteUser(userId: string): Promise<boolean>

  // ─── Клубы ─────────────────────────────────────────────────────────────────
  /** Клуб MafBoard, к которому подключён этот клуб GoMafia. Запись заводит `setGomafiaLink`. */
  clubByGomafiaId(gomafiaClubId: number): Promise<StoredClub | null>
  /** Клуб, у которого действует подключение Titan с этим номером. */
  clubByTitanConnection(connectionId: string): Promise<StoredClub | null>
  /**
   * Подключить (или отключить — null) Titan HUB клуба. Возвращает заменённое подключение: отзывать в
   * HUB нужно именно его, а не прочитанное заранее. null — подключения не было или клуба нет.
   */
  setClubTitanLink(clubId: string, link: TitanLinkState | null, linkedBy: string | null): Promise<TitanLinkState | null>
  /** Стереть копии подключения с этим номером в личных записях пользователей. */
  clearTitanMirrors(connectionId: string): Promise<void>
  clubById(id: string): Promise<StoredClub | null>
  /**
   * Клуб без GoMafia по подключению Titan; создатель — его владелец (и запись членства `owner`).
   * `exists` — этот клуб Titan HUB уже подключён к другому клубу MafBoard.
   */
  createTitanClub(input: { name: string; titan: TitanLinkState; ownerUserId: string; at: Date }): Promise<StoredClub | 'exists'>

  // ─── Члены клуба и приглашения ─────────────────────────────────────────────
  clubMembers(clubId: string): Promise<StoredClubMember[]>
  membershipsOf(userId: string): Promise<StoredClubMember[]>
  /** Добавить в клуб. Уже состоит — запись (и роль) не меняется. */
  addClubMember(member: StoredClubMember): Promise<void>
  removeClubMember(clubId: string, userId: string): Promise<boolean>
  createClubInvite(invite: StoredClubInvite): Promise<void>
  /** Действующие (не отозванные и не истёкшие) приглашения клуба, сначала новые. */
  clubInvites(clubId: string, now: Date): Promise<StoredClubInvite[]>
  clubInviteByTokenHash(tokenHash: string): Promise<StoredClubInvite | null>
  revokeClubInvite(clubId: string, inviteId: string, at: Date): Promise<boolean>
  /** История клуба MafBoard (по `club_ref`), по времени окончания. */
  gamesByClubRef(clubRef: string, since: Date | null, limit: number): Promise<StoredGame[]>

  // ─── Заявки на клуб без подключений ───────────────────────────────────────
  /** Новая заявка. 'pending_exists' — у пользователя уже есть заявка на рассмотрении. */
  createClubApplication(application: StoredClubApplication): Promise<StoredClubApplication | 'pending_exists'>
  clubApplicationById(id: string): Promise<StoredClubApplication | null>
  /** Последняя заявка пользователя (любого статуса). */
  latestClubApplication(userId: string): Promise<StoredClubApplication | null>
  /**
   * Одобрить заявку: клуб без подключений, заявитель — владелец (запись `owner`), заявка ссылается на клуб.
   * Одной операцией; null — заявка уже решена или её нет (повторное нажатие, гонка двух решений).
   */
  approveClubApplication(id: string, at: Date): Promise<{ application: StoredClubApplication; club: StoredClub } | null>
  /** Отклонить заявку. null — уже решена или её нет. */
  rejectClubApplication(id: string, at: Date): Promise<StoredClubApplication | null>

  // ─── Свои игроки клуба, фото, игрок в боте ─────────────────────────────────
  /** Свои игроки клуба; `withArchived` — вместе с убранными (для проверки старых игр). */
  clubPlayers(clubId: string, withArchived: boolean): Promise<StoredClubPlayer[]>
  /** 'nickname_taken' — у действующего игрока клуба уже такой ник (без учёта регистра). */
  addClubPlayer(player: StoredClubPlayer): Promise<StoredClubPlayer | 'nickname_taken'>
  /** null — игрока нет или он убран. */
  renameClubPlayer(clubId: string, playerId: string, nickname: string): Promise<StoredClubPlayer | 'nickname_taken' | null>
  archiveClubPlayer(clubId: string, playerId: string, at: Date): Promise<boolean>
  playerPhotos(clubId: string): Promise<StoredPlayerPhoto[]>
  setPlayerPhoto(photo: StoredPlayerPhoto): Promise<void>
  clearPlayerPhoto(clubId: string, playerId: string): Promise<boolean>
  createPlayerLinkToken(token: StoredPlayerLinkToken): Promise<void>
  /**
   * Использовать ссылку игрока: токен гасится, игрок клуба привязывается к Telegram (прежняя привязка
   * этого Telegram в том же клубе снимается). 'expired' — ссылка использована или истекла, null — нет такой.
   * `previousTgId` — другой Telegram, у которого игрок был привязан до этого (его стоит предупредить).
   */
  usePlayerLinkToken(tokenHash: string, tgId: number, at: Date): Promise<(StoredPlayerLink & { previousTgId: number | null }) | 'expired' | null>
  playerLinksByTg(tgId: number): Promise<StoredPlayerLink[]>

  // ─── Пул судей клуба ───────────────────────────────────────────────────────
  /** Судьи клуба GoMafia, которым президент дал вести игры, по времени выдачи. */
  clubHosts(clubId: number): Promise<StoredClubHost[]>
  isClubHost(clubId: number, gomafiaId: number): Promise<boolean>
  /** Добавить судью в пул. Повтор не меняет запись: кто и когда выдал доступ, остаётся. */
  addClubHost(host: StoredClubHost): Promise<void>
  /** false — такого судьи в пуле не было. */
  removeClubHost(clubId: number, gomafiaId: number): Promise<boolean>
  /** Пользователи MafBoard, привязавшие эти аккаунты GoMafia. */
  usersByGomafiaIds(gomafiaIds: number[]): Promise<MafboardUser[]>
  /** Пользователи, чей аккаунт GoMafia — президент их клуба, сначала давние. */
  clubPresidents(limit: number): Promise<MafboardUser[]>

  // ─── Заявки судей без пароля GoMafia ───────────────────────────────────────
  clubRequest(userId: string): Promise<StoredClubRequest | null>
  /** Оставить заявку (прежняя заменяется) или снять её — null. */
  setClubRequest(userId: string, request: { nickname: string; at: Date } | null): Promise<void>
  /** Заявки с этими никами без учёта регистра, сначала ранние. */
  clubRequestsByNicknames(nicknames: string[]): Promise<StoredClubRequest[]>

  // ─── Вход в АИМ (турниры GoMafia) ──────────────────────────────────────────
  /** Логин и пароль АИМ шифротекстом (aim.ts) или null — АИМ не подключён. */
  aimCredentials(userId: string): Promise<string | null>
  /** Сохранить (или стереть — null) вход в АИМ. */
  setAimCredentials(userId: string, sealed: string | null, at: Date): Promise<void>

  // ─── Вход в GoMafia (закрытые с 2026-11-17 страницы сайта) ─────────────────
  gomafiaCredentials(userId: string): Promise<string | null>
  setGomafiaCredentials(userId: string, sealed: string | null, at: Date): Promise<void>

  // ─── Протоколы судей на подтверждение ГС ───────────────────────────────────
  /** Отправить (или отправить заново) протокол стола: запись этого судьи снова ждёт ГС. */
  upsertProtocolSubmission(input: Omit<StoredProtocolSubmission, 'id' | 'status' | 'reason' | 'decidedBy' | 'createdAt' | 'updatedAt'> & { id: string; at: Date }): Promise<StoredProtocolSubmission>
  protocolSubmissions(tournamentId: number, filter: { status?: StoredProtocolSubmission['status']; refereeUserId?: string }): Promise<StoredProtocolSubmission[]>
  /** Атомарно: решение по протоколу, только пока он ждёт. null — уже решён другим или его нет. */
  decideProtocolSubmission(
    id: string,
    decision: { status: 'saved' | 'rejected'; reason: string | null; protocol: unknown; decidedBy: string; at: Date },
  ): Promise<StoredProtocolSubmission | null>
  protocolSubmissionById(id: string): Promise<StoredProtocolSubmission | null>

  // ─── Открытые ссылки на итоги игр ──────────────────────────────────────────
  /** Ссылка этого пользователя на эту игру: повторная выдача обновляет снимок и сохраняет адрес. */
  saveShare(input: StoredShare): Promise<StoredShare>
  shareByToken(token: string): Promise<StoredShare | null>

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
  /** Удалить билеты (обоих видов), сессии и refresh-токены, истёкшие раньше `before`. */
  purgeExpired(before: Date): Promise<{ tickets: number; sessions: number; refreshTokens: number }>

  // ─── Билеты входа в MBS по QR ──────────────────────────────────────────────
  createQrTicket(input: {
    scanCode: string
    confirmCode: string
    choiceCodes: number[]
    deviceSecretHash: string
    deviceName: string
    platform: string
    expiresAt: Date
  }): Promise<QrTicket>
  qrTicketById(id: string): Promise<QrTicket | null>
  qrTicketByScan(scanCode: string): Promise<QrTicket | null>
  /**
   * Атомарно: не истёкший билет в ожидании становится подтверждённым этим пользователем,
   * если код верный, и отклонённым, если нет. null — решать уже нечего.
   */
  decideQrTicket(scanCode: string, code: string, userId: string, now: Date): Promise<QrTicket | null>
  /** Атомарно: подтверждённый, не истёкший билет с этим секретом → claimed. Иначе null. */
  claimQrTicket(id: string, deviceSecretHash: string, now: Date): Promise<QrTicket | null>

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
  /** Та же игра того же ведущего — запись обновляется ('exists'), чужая с тем же id — 'conflict'. */
  insertGame(game: StoredGame): Promise<'inserted' | 'exists' | 'conflict'>
  gamesByHost(userId: string, since: Date | null, limit: number): Promise<StoredGame[]>

  // ─── Идущие игры ───────────────────────────────────────────────────────────
  /**
   * Сохранить снимок идущей игры. 'saved' — записан; 'stale' — на сервере снимок новее
   * или игра уже закончена; 'conflict' — игра с этим id принадлежит другому ведущему.
   */
  saveActiveGame(game: StoredActiveGame): Promise<'saved' | 'stale' | 'conflict'>
  activeGamesByHost(userId: string, limit: number): Promise<StoredActiveGame[]>
  deleteActiveGame(userId: string, id: string): Promise<void>

  // ─── Сопоставления Titan ↔ GoMafia ─────────────────────────────────────────
  /** Ручные сопоставления клуба Titan: общие для всех его ведущих. */
  titanMatches(apiBase: string): Promise<Map<string, number | null>>
  /** Записать сопоставление клиента; `match` null — снять его (вернуть номер из HUB). */
  setTitanMatch(apiBase: string, clientId: string, match: { goMafiaId: number | null; userId: string; at: Date } | null): Promise<void>

  // ─── Настройки MafBoard Studio ─────────────────────────────────────────────
  studioSettings(userId: string): Promise<StoredStudioSettings | null>
  /**
   * Атомарно: запись, если сохранённая ревизия равна `baseRevision` (или записи нет и он 0).
   * Иначе — текущая версия, чтобы MBS слил свои изменения с ней.
   */
  saveStudioSettings(input: {
    userId: string
    baseRevision: number
    document: Record<string, unknown>
    secrets: string | null
    updatedAt: Date
  }): Promise<{ saved: true; revision: number } | { saved: false; current: StoredStudioSettings | null }>
}
