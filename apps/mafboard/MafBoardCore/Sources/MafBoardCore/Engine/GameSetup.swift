import Foundation

/// Игрок на конкретном месте с конкретной ролью.
public struct SeatAssignment: Codable, Sendable, Equatable {
    public let seat: Seat
    public let playerID: PlayerID
    public let role: Role
}

/// Неизменяемые исходные данные игры: правила, формат, рассадка, роли и ведущий.
/// Вместе с журналом действий полностью определяет игру (см. `GameSession`).
public struct GameSetup: Sendable, Equatable {
    public let gameID: GameID
    public let format: CompetitionFormat
    public let ruleset: Ruleset
    /// Снимок системы баллов на момент игры: изменение правил позже не переписывает историю.
    public let scoring: ScoringPolicy
    public let seriesID: SeriesID?
    /// Ведущий и клуб. `nil` — игра без входа (тесты, демо).
    public let host: HostContext?
    public let seats: [SeatAssignment]
    public let createdAt: Date

    /// - Parameters:
    ///   - players: игроки в порядке мест (первый — место 1).
    ///   - roles: роли в том же порядке.
    public init(
        format: CompetitionFormat,
        ruleset: Ruleset,
        players: [PlayerID],
        roles: [Role],
        scoring: ScoringPolicy? = nil,
        seriesID: SeriesID? = nil,
        host: HostContext? = nil,
        gameID: GameID = GameID(),
        createdAt: Date = .now
    ) throws(GameError) {
        guard players.count == roles.count else {
            throw .invalidSetup(.playersAndRolesMismatch(players: players.count, roles: roles.count))
        }
        guard Set(players).count == players.count else {
            throw .invalidSetup(.duplicatePlayer)
        }
        try ruleset.validate(roles: roles)

        self.gameID = gameID
        self.format = format
        self.ruleset = ruleset
        self.scoring = scoring ?? .default(for: format, variant: ruleset.variant)
        self.seriesID = seriesID
        self.host = host
        self.seats = zip(players, roles).enumerated().map { index, pair in
            SeatAssignment(seat: Seat(index + 1), playerID: pair.0, role: pair.1)
        }
        self.createdAt = createdAt
    }

    /// Игра в рамках серии: формат, правила и система баллов берутся из неё.
    public init(
        series: Series,
        players: [PlayerID],
        roles: [Role],
        host: HostContext? = nil,
        gameID: GameID = GameID(),
        createdAt: Date = .now
    ) throws(GameError) {
        try self.init(
            format: series.format,
            ruleset: series.ruleset,
            players: players,
            roles: roles,
            scoring: series.scoring,
            seriesID: series.id,
            host: host,
            gameID: gameID,
            createdAt: createdAt
        )
    }

    /// Игра ведущего с проверкой прав: без GoMafia — только фанка, в рейтинг — только игроки GoMafia.
    public static func hosted(
        by account: UserAccount,
        format: CompetitionFormat,
        ruleset: Ruleset,
        players: [PlayerProfile],
        roles: [Role],
        scoring: ScoringPolicy? = nil,
        seriesID: SeriesID? = nil,
        createdAt: Date = .now
    ) throws(GameError) -> GameSetup {
        let access = account.hostingAccess
        try access.authorize(format: format, players: players)
        return try GameSetup(
            format: format,
            ruleset: ruleset,
            players: players.map(\.id),
            roles: roles,
            scoring: scoring,
            seriesID: seriesID,
            host: access.host,
            createdAt: createdAt
        )
    }

    public var variant: GameVariant { ruleset.variant }
}

/// Декодирование проходит те же проверки, что и создание: битый файл не превратится в «игру» из десяти донов.
extension GameSetup: Codable {
    private enum CodingKeys: String, CodingKey {
        case gameID, format, ruleset, scoring, seriesID, host, seats, createdAt
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let seats = try container.decode([SeatAssignment].self, forKey: .seats).sorted { $0.seat < $1.seat }
        guard seats.enumerated().allSatisfy({ $0.element.seat.number == $0.offset + 1 }) else {
            throw DecodingError.dataCorruptedError(forKey: .seats, in: container, debugDescription: "Места должны идти подряд с 1")
        }
        do {
            try self.init(
                format: container.decode(CompetitionFormat.self, forKey: .format),
                ruleset: container.decode(Ruleset.self, forKey: .ruleset),
                players: seats.map(\.playerID),
                roles: seats.map(\.role),
                scoring: container.decode(ScoringPolicy.self, forKey: .scoring),
                seriesID: container.decodeIfPresent(SeriesID.self, forKey: .seriesID),
                host: container.decodeIfPresent(HostContext.self, forKey: .host),
                gameID: container.decode(GameID.self, forKey: .gameID),
                createdAt: container.decode(Date.self, forKey: .createdAt)
            )
        } catch let error as GameError {
            throw DecodingError.dataCorruptedError(forKey: .seats, in: container, debugDescription: error.message)
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(gameID, forKey: .gameID)
        try container.encode(format, forKey: .format)
        try container.encode(ruleset, forKey: .ruleset)
        try container.encode(scoring, forKey: .scoring)
        try container.encodeIfPresent(seriesID, forKey: .seriesID)
        try container.encodeIfPresent(host, forKey: .host)
        try container.encode(seats, forKey: .seats)
        try container.encode(createdAt, forKey: .createdAt)
    }
}
