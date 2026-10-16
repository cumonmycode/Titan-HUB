import Foundation

/// Воспроизводимый генератор (SplitMix64): одинаковое зерно — одинаковая рассадка и раздача.
/// Нужен для тестов и для повторного показа жеребьёвки.
public struct SeededRandomNumberGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64

    public init(seed: UInt64) {
        state = seed
    }

    public mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58_476D_1CE4_E5B9
        value = (value ^ (value >> 27)) &* 0x94D0_49BB_1331_11EB
        return value ^ (value >> 31)
    }
}

/// Случайная рассадка выбранных игроков.
public enum SeatingPlanner {
    /// Возвращает игроков в порядке мест (первый — место 1).
    public static func randomSeating(
        _ players: [PlayerID],
        using generator: inout some RandomNumberGenerator
    ) -> [PlayerID] {
        players.shuffled(using: &generator)
    }
}

/// Раздача ролей по местам.
public enum RoleDealer {
    /// Возвращает роли в порядке мест.
    public static func deal(_ roles: [Role], using generator: inout some RandomNumberGenerator) -> [Role] {
        roles.shuffled(using: &generator)
    }
}

extension GameSetup {
    /// Готовая игра со случайной рассадкой (по желанию) и случайной раздачей стандартного состава.
    public static func dealt(
        format: CompetitionFormat,
        ruleset: Ruleset,
        players: [PlayerID],
        optionalRoles: Set<Role> = [],
        shufflesSeating: Bool = true,
        scoring: ScoringPolicy? = nil,
        seriesID: SeriesID? = nil,
        using generator: inout some RandomNumberGenerator,
        createdAt: Date = .now
    ) throws(GameError) -> GameSetup {
        let seated = shufflesSeating ? SeatingPlanner.randomSeating(players, using: &generator) : players
        let composition = try ruleset.standardRoles(playerCount: players.count, optionalRoles: optionalRoles)
        return try GameSetup(
            format: format,
            ruleset: ruleset,
            players: seated,
            roles: RoleDealer.deal(composition, using: &generator),
            scoring: scoring,
            seriesID: seriesID,
            createdAt: createdAt
        )
    }
}
