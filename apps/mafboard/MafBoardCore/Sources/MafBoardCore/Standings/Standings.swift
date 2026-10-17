import Foundation

/// Какую таблицу строим: формат + серия или период.
public struct StandingsQuery: Sendable, Equatable {
    public enum Scope: Sendable, Equatable {
        /// Одна серия (вечер рейтинга, миникап, турнир).
        case series(SeriesID)
        /// Произвольный период: месяц, сезон и т.п.
        case period(DateInterval)
        case allTime
    }

    public var format: CompetitionFormat
    public var scope: Scope
    /// `nil` — спортивная и городская вместе.
    public var variant: GameVariant?

    public init(format: CompetitionFormat, scope: Scope, variant: GameVariant? = nil) {
        self.format = format
        self.scope = scope
        self.variant = variant
    }

    /// Фанка и игры других форматов в таблицу не попадают никогда.
    public func includes(_ record: GameRecord) -> Bool {
        guard format.countsTowardStandings, record.format == format else { return false }
        if let variant, record.variant != variant { return false }
        return switch scope {
        case let .series(id): record.seriesID == id
        // Полуинтервал [start, end): игра ровно на границе попадает только в один из соседних периодов.
        case let .period(interval): interval.start <= record.finishedAt && record.finishedAt < interval.end
        case .allTime: true
        }
    }
}

public struct RoleStatistics: Codable, Sendable, Equatable {
    public let role: Role
    public let games: Int
    public let wins: Int
}

/// Строка таблицы рейтинга.
public struct PlayerStanding: Codable, Sendable, Equatable, Identifiable {
    public let playerID: PlayerID
    /// Место. Игроки с полностью равными показателями делят место (1, 1, 3).
    public internal(set) var place: Int
    public let gamesPlayed: Int
    public let wins: Int
    public let draws: Int
    public let points: Points
    public let bonus: Points
    public let penalty: Points
    public let bestMoves: Int
    /// Сколько раз игрока убивали в первую ночь.
    public let firstNightDeaths: Int
    public let roles: [RoleStatistics]

    public var id: PlayerID { playerID }
    /// Допбаллы с учётом штрафов (ФСМ 8.7.2).
    public var extraPoints: Points { bonus - penalty }
    /// Победы доном или шерифом (ФСМ 8.7.4).
    public var keyRoleWins: Int {
        roles.filter { $0.role == .don || $0.role == .sheriff }.reduce(0) { $0 + $1.wins }
    }
    public var losses: Int { gamesPlayed - wins - draws }
    public var averagePoints: Double { gamesPlayed > 0 ? points.doubleValue / Double(gamesPlayed) : 0 }
    public var winRate: Double { gamesPlayed > 0 ? Double(wins) / Double(gamesPlayed) : 0 }
}

/// Критерии сортировки таблицы по порядку приоритета.
public enum StandingsTiebreaker: String, Codable, Sendable {
    case points
    case wins
    case bonus
    case fewerPenalties
    case fewerGames
    /// Допбаллы с учётом штрафов.
    case extraPoints
    /// Победы доном или шерифом.
    case keyRoleWins
    /// Больше смертей в первую ночь.
    case firstNightDeaths

    /// ФСМ 8.7: баллы → допбаллы со штрафами → победы → победы доном или шерифом → смерти в первую ночь.
    public static let defaultOrder: [StandingsTiebreaker] = [.points, .extraPoints, .wins, .keyRoleWins, .firstNightDeaths]
}

public enum StandingsCalculator {
    /// Суммирует баллы за игры, подходящие под запрос, и расставляет места.
    /// - Parameter scoringOverride: пересчитать все игры по другим правилам (иначе — правила каждой игры).
    public static func standings(
        _ query: StandingsQuery,
        from records: [GameRecord],
        scoringOverride: ScoringPolicy? = nil,
        tiebreakers: [StandingsTiebreaker] = StandingsTiebreaker.defaultOrder
    ) -> [PlayerStanding] {
        standings(of: records.filter(query.includes), scoringOverride: scoringOverride, tiebreakers: tiebreakers)
    }

    /// Таблица по любому набору игр — например, по вечеру, в том числе фанок.
    public static func standings(
        of records: [GameRecord],
        scoringOverride: ScoringPolicy? = nil,
        tiebreakers: [StandingsTiebreaker] = StandingsTiebreaker.defaultOrder
    ) -> [PlayerStanding] {
        let scores = records.flatMap { GameScorer.score($0, policy: scoringOverride) }
        let rows = Dictionary(grouping: scores, by: \.playerID).map { makeStanding($0.key, $0.value) }
        let sorted = rows.sorted { lhs, rhs in
            if ranksHigher(lhs, rhs, by: tiebreakers) { return true }
            if ranksHigher(rhs, lhs, by: tiebreakers) { return false }
            return lhs.playerID.description < rhs.playerID.description
        }
        return assignPlaces(sorted, tiebreakers: tiebreakers)
    }

    private static func makeStanding(_ playerID: PlayerID, _ scores: [PlayerGameScore]) -> PlayerStanding {
        let byRole = Dictionary(grouping: scores, by: \.role)
        let roles = Role.allCases.compactMap { role -> RoleStatistics? in
            guard let games = byRole[role] else { return nil }
            return RoleStatistics(role: role, games: games.count, wins: games.filter { $0.result == .win }.count)
        }
        let bestMoves = scores.filter { score in
            score.components.contains { component in
                if case .bestMove = component.kind { true } else { false }
            }
        }.count
        return PlayerStanding(
            playerID: playerID,
            place: 0,
            gamesPlayed: scores.count,
            wins: scores.filter { $0.result == .win }.count,
            draws: scores.filter { $0.result == .draw }.count,
            points: scores.map(\.total).sum(),
            bonus: scores.map(\.bonus).sum(),
            penalty: scores.map(\.penalty).sum(),
            bestMoves: bestMoves,
            firstNightDeaths: scores.filter(\.isFirstKilled).count,
            roles: roles
        )
    }

    private static func ranksHigher(
        _ lhs: PlayerStanding,
        _ rhs: PlayerStanding,
        by tiebreakers: [StandingsTiebreaker]
    ) -> Bool {
        for tiebreaker in tiebreakers {
            switch tiebreaker {
            case .points where lhs.points != rhs.points: return lhs.points > rhs.points
            case .wins where lhs.wins != rhs.wins: return lhs.wins > rhs.wins
            case .bonus where lhs.bonus != rhs.bonus: return lhs.bonus > rhs.bonus
            case .fewerPenalties where lhs.penalty != rhs.penalty: return lhs.penalty < rhs.penalty
            case .fewerGames where lhs.gamesPlayed != rhs.gamesPlayed: return lhs.gamesPlayed < rhs.gamesPlayed
            case .extraPoints where lhs.extraPoints != rhs.extraPoints: return lhs.extraPoints > rhs.extraPoints
            case .keyRoleWins where lhs.keyRoleWins != rhs.keyRoleWins: return lhs.keyRoleWins > rhs.keyRoleWins
            case .firstNightDeaths where lhs.firstNightDeaths != rhs.firstNightDeaths:
                return lhs.firstNightDeaths > rhs.firstNightDeaths
            default: continue
            }
        }
        return false
    }

    private static func assignPlaces(
        _ sorted: [PlayerStanding],
        tiebreakers: [StandingsTiebreaker]
    ) -> [PlayerStanding] {
        var result: [PlayerStanding] = []
        for (index, standing) in sorted.enumerated() {
            var row = standing
            if let previous = result.last, !ranksHigher(previous, standing, by: tiebreakers) {
                row.place = previous.place
            } else {
                row.place = index + 1
            }
            result.append(row)
        }
        return result
    }
}
