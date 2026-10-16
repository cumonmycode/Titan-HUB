import Foundation

public typealias UserID = Identifier<UserAccount>

/// Пользователь Telegram, прошедший вход через бота MafBoard.
public struct TelegramIdentity: Codable, Sendable, Equatable {
    public let id: Int64
    public var username: String?
    public var firstName: String
    public var lastName: String?

    public init(id: Int64, username: String? = nil, firstName: String, lastName: String? = nil) {
        self.id = id
        self.username = username
        self.firstName = firstName
        self.lastName = lastName
    }

    public var displayName: String {
        [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }
}

public struct GoMafiaClub: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public var title: String
    public var city: String?

    public init(id: Int, title: String, city: String? = nil) {
        self.id = id
        self.title = title
        self.city = city
    }
}

/// Игрок GoMafia: результат поиска, участник клуба или профиль пользователя.
/// Поля — те, что GoMafia отдаёт стабильно (см. docs/API.md).
public struct GoMafiaPlayer: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public var nickname: String
    public var fullName: String?
    public var avatarURL: URL?
    public var elo: Double?
    public var clubID: Int?
    public var clubTitle: String?
    public var city: String?
    public var tournamentsPlayed: Int?
    /// Состоит в клубе ведущего — в поиске такие игроки показываются первыми.
    public var isInHostClub: Bool

    public init(
        id: Int,
        nickname: String,
        fullName: String? = nil,
        avatarURL: URL? = nil,
        elo: Double? = nil,
        clubID: Int? = nil,
        clubTitle: String? = nil,
        city: String? = nil,
        tournamentsPlayed: Int? = nil,
        isInHostClub: Bool = false
    ) {
        self.id = id
        self.nickname = nickname
        self.fullName = fullName
        self.avatarURL = avatarURL
        self.elo = elo
        self.clubID = clubID
        self.clubTitle = clubTitle
        self.city = city
        self.tournamentsPlayed = tournamentsPlayed
        self.isInHostClub = isInHostClub
    }
}

/// Привязанный аккаунт GoMafia. Владение подтверждено входом в GoMafia на сервере MafBoard.
public struct GoMafiaLink: Codable, Sendable, Equatable {
    public var player: GoMafiaPlayer
    public var club: GoMafiaClub?
    public let linkedAt: Date
    public var syncedAt: Date

    public init(player: GoMafiaPlayer, club: GoMafiaClub?, linkedAt: Date, syncedAt: Date) {
        self.player = player
        self.club = club
        self.linkedAt = linkedAt
        self.syncedAt = syncedAt
    }
}

/// Пользователь приложения (ведущий). Вход — только через Telegram, GoMafia — по желанию.
public struct UserAccount: Codable, Sendable, Equatable, Identifiable {
    public let id: UserID
    public var telegram: TelegramIdentity
    /// Номер в маске («+7 *** ***-12-34»). Полный номер хранится только на сервере.
    public var maskedPhone: String?
    public var acceptedTermsVersion: String?
    public var goMafia: GoMafiaLink?

    public init(
        id: UserID,
        telegram: TelegramIdentity,
        maskedPhone: String? = nil,
        acceptedTermsVersion: String? = nil,
        goMafia: GoMafiaLink? = nil
    ) {
        self.id = id
        self.telegram = telegram
        self.maskedPhone = maskedPhone
        self.acceptedTermsVersion = acceptedTermsVersion
        self.goMafia = goMafia
    }

    public var hostingAccess: HostingAccess { HostingAccess(account: self) }
}

// MARK: - Постоянный идентификатор игрока GoMafia

extension Identifier where Entity == PlayerProfile {
    /// Префикс UUID для игроков GoMafia («mafbgm» + версия/вариант UUIDv8).
    private static var goMafiaPrefix: [UInt8] { [0x6D, 0x61, 0x66, 0x62, 0x67, 0x6D, 0x80, 0x00, 0x80, 0x00] }

    /// Один и тот же игрок GoMafia получает один и тот же `PlayerID` на любом устройстве и на сервере,
    /// поэтому рейтинги клуба, собранные с разных ведущих, сходятся.
    public static func goMafia(_ goMafiaID: Int) -> PlayerID {
        let value = UInt64(clamping: goMafiaID) & 0xFFFF_FFFF_FFFF
        let tail = (0..<6).reversed().map { UInt8(truncatingIfNeeded: value >> (UInt64($0) * 8)) }
        let bytes = goMafiaPrefix + tail
        let uuid = UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
        return PlayerID(uuid)
    }

    /// Номер игрока в GoMafia, если идентификатор получен из `goMafia(_:)`.
    public var goMafiaPlayerID: Int? {
        let bytes = withUnsafeBytes(of: rawValue.uuid) { Array($0) }
        guard Array(bytes.prefix(10)) == Self.goMafiaPrefix else { return nil }
        let value = bytes.suffix(6).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        return Int(value)
    }
}
