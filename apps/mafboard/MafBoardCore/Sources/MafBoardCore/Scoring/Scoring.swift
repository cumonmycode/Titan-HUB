// MARK: - Формат соревнования

/// Режим игры: определяет, как игра учитывается в рейтингах.
public enum CompetitionFormat: String, Codable, Sendable, CaseIterable {
    /// Фанка: результат только за игру, в рейтинги не идёт (но сохраняется в истории).
    case funky
    /// Внутренний рейтинг клуба: суммируется за серию (вечер) и за любой период.
    case rating
    /// Миникап: как рейтинг, но отдельная таблица — с рейтингом не смешивается.
    case miniCup
    /// Турнир: отдельное мероприятие со своей таблицей.
    case tournament

    public var displayName: String {
        switch self {
        case .funky: "Фанка"
        case .rating: "Рейтинг"
        case .miniCup: "Миникап"
        case .tournament: "Турнир"
        }
    }

    public var countsTowardStandings: Bool { self != .funky }
}

// MARK: - Система баллов

/// Сколько баллов за что. Снимок кладётся в `GameSetup`, поэтому смена правил не меняет прошлые игры.
public struct ScoringPolicy: Codable, Sendable, Equatable {
    public var win: Points
    public var draw: Points
    public var loss: Points
    /// Угадано чёрных в лучшем ходе → бонус. Для большего числа берётся ближайшее меньшее значение.
    public var bestMove: [Int: Points]
    public var bestMoveOnlyForRedTeam: Bool
    /// Удаление (4 фола, техфолы, дисквалификация).
    public var removalPenalty: Points
    public var techFoulPenalty: Points

    /// Значения из старой версии MafBoard. Отличия по форматам добавим, когда утвердим регламенты.
    public static let standard = ScoringPolicy(
        win: 1,
        draw: 0,
        loss: 0,
        bestMove: [1: 0.1, 2: 0.3, 3: 0.6],
        bestMoveOnlyForRedTeam: true,
        removalPenalty: 1,
        techFoulPenalty: 0.3
    )

    public static func `default`(for format: CompetitionFormat) -> ScoringPolicy {
        switch format {
        case .funky, .rating, .miniCup, .tournament: .standard
        }
    }

    public func points(for result: GameResult) -> Points {
        switch result {
        case .win: win
        case .draw: draw
        case .loss: loss
        }
    }

    public func bestMovePoints(guessed: Int) -> Points {
        guard guessed > 0 else { return .zero }
        if let exact = bestMove[guessed] { return exact }
        guard let nearest = bestMove.keys.filter({ $0 <= guessed }).max() else { return .zero }
        return bestMove[nearest] ?? .zero
    }
}

// MARK: - Баллы за игру

public struct ScoreComponent: Codable, Sendable, Equatable {
    public enum Kind: Codable, Sendable, Equatable {
        case result(GameResult)
        case bestMove(guessed: Int)
        case removal
        case techFouls(count: Int)
        case adjustment(note: String)
    }

    public let kind: Kind
    public let points: Points

    var isResult: Bool {
        if case .result = kind { true } else { false }
    }
}

/// Баллы одного игрока за одну игру с расшифровкой «за что».
public struct PlayerGameScore: Codable, Sendable, Equatable, Identifiable {
    public let seat: Seat
    public let playerID: PlayerID
    public let role: Role
    public let result: GameResult
    public let components: [ScoreComponent]

    public var id: Seat { seat }
    public var total: Points { components.map(\.points).sum() }
    /// Дополнительные баллы сверх результата.
    public var bonus: Points {
        components.filter { !$0.isResult && $0.points > .zero }.map(\.points).sum()
    }
    /// Штрафы (положительное число).
    public var penalty: Points {
        -components.filter { !$0.isResult && $0.points < .zero }.map(\.points).sum()
    }
}

public enum GameScorer {
    /// Баллы всех игроков за игру. `policy` — пересчёт по другим правилам; по умолчанию правила самой игры.
    public static func score(_ record: GameRecord, policy: ScoringPolicy? = nil) -> [PlayerGameScore] {
        let policy = policy ?? record.setup.scoring
        return record.seats.map { seat in
            let result = record.outcome.winner.result(for: seat.team)
            let components = [ScoreComponent(kind: .result(result), points: policy.points(for: result))]
                + bestMoveComponents(for: seat, in: record, policy: policy)
                + disciplineComponents(for: seat, policy: policy)
                + record.scoreAdjustments
                    .filter { $0.seat == seat.seat }
                    .map { ScoreComponent(kind: .adjustment(note: $0.note), points: $0.points) }
            return PlayerGameScore(
                seat: seat.seat, playerID: seat.playerID, role: seat.role,
                result: result, components: components
            )
        }
    }

    private static func bestMoveComponents(
        for seat: SeatState,
        in record: GameRecord,
        policy: ScoringPolicy
    ) -> [ScoreComponent] {
        guard let move = record.bestMove, move.author == seat.seat,
              !policy.bestMoveOnlyForRedTeam || seat.team == .red
        else { return [] }
        let guessed = move.seats.filter { record.seat($0)?.team == .black }.count
        // Даже ноль баллов — это сделанный лучший ход: он нужен для статистики игрока.
        return [ScoreComponent(kind: .bestMove(guessed: guessed), points: policy.bestMovePoints(guessed: guessed))]
    }

    private static func disciplineComponents(for seat: SeatState, policy: ScoringPolicy) -> [ScoreComponent] {
        var components: [ScoreComponent] = []
        if case .removed = seat.elimination?.cause, policy.removalPenalty != .zero {
            components.append(ScoreComponent(kind: .removal, points: -policy.removalPenalty))
        }
        if seat.techFouls > 0, policy.techFoulPenalty != .zero {
            components.append(ScoreComponent(
                kind: .techFouls(count: seat.techFouls),
                points: -(policy.techFoulPenalty * seat.techFouls)
            ))
        }
        return components
    }
}
