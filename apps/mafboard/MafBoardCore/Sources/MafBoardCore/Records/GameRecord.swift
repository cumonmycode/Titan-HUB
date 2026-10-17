import Foundation

/// Завершённая игра в истории. Хранит и журнал (чтобы переиграть ход игры),
/// и готовые итоги (чтобы история не менялась при развитии движка).
public struct GameRecord: Identifiable, Codable, Sendable, Equatable {
    /// Версия формата записи: при изменении структуры старые записи мигрируются, а не теряются.
    public static let currentSchemaVersion = 1

    public let schemaVersion: Int
    public let setup: GameSetup
    public let log: [LogEntry]
    public let finishedAt: Date
    public let seats: [SeatState]
    public let outcome: GameOutcome
    /// Лучшие ходы: у ПУ и у игрока, выбывшего при полном столе (ФСМ 7.13).
    public let bestMoves: [BestMove]
    public let scoreAdjustments: [ScoreAdjustment]
    /// Протоколы выбывших. В записях до появления протоколов — пусто.
    public let protocols: [ColorProtocol]
    public let nights: [NightReport]
    public let votings: [VotingRecord]
    public let events: [GameEvent]

    public init(session: GameSession) throws(GameError) {
        let state = session.state
        guard let outcome = state.outcome else { throw .gameNotFinished }
        schemaVersion = Self.currentSchemaVersion
        setup = session.setup
        log = session.log
        finishedAt = state.events.last { event in
            if case .gameFinished = event.kind { true } else { false }
        }?.date ?? session.setup.createdAt
        seats = state.seats
        self.outcome = outcome
        bestMoves = state.bestMoves
        scoreAdjustments = state.scoreAdjustments
        protocols = state.protocols
        nights = state.nights
        votings = state.votings
        events = state.events
    }

    public var id: GameID { setup.gameID }
    /// Первый убитый (ПУ) — в первую ночь после договорки.
    public var firstKilled: Seat? { nights.firstKilled }
    public var format: CompetitionFormat { setup.format }
    public var variant: GameVariant { setup.variant }
    public var seriesID: SeriesID? { setup.seriesID }
    public var startedAt: Date { setup.createdAt }
    /// Ведущий игры.
    public var host: HostContext? { setup.host }
    /// Клуб GoMafia, в историю которого идёт игра.
    public var clubID: Int? { setup.host?.clubID }

    public func seat(_ seat: Seat) -> SeatState? {
        seats.first { $0.seat == seat }
    }

    public func seat(of player: PlayerID) -> SeatState? {
        seats.first { $0.playerID == player }
    }
}

/// Серия игр: вечер рейтинга, миникап, турнир или фанки-вечер.
/// Игры серии получают её формат, правила и систему баллов.
extension GameRecord {
    private enum CodingKeys: String, CodingKey {
        case schemaVersion, setup, log, finishedAt, seats, outcome, bestMove, bestMoves, scoreAdjustments, protocols, nights, votings, events
    }

    /// Записи, сохранённые до протоколов и нескольких лучших ходов, читаются как раньше.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        setup = try container.decode(GameSetup.self, forKey: .setup)
        log = try container.decode([LogEntry].self, forKey: .log)
        finishedAt = try container.decode(Date.self, forKey: .finishedAt)
        seats = try container.decode([SeatState].self, forKey: .seats)
        outcome = try container.decode(GameOutcome.self, forKey: .outcome)
        if let moves = try container.decodeIfPresent([BestMove].self, forKey: .bestMoves) {
            bestMoves = moves
        } else {
            bestMoves = try container.decodeIfPresent(BestMove.self, forKey: .bestMove).map { [$0] } ?? []
        }
        scoreAdjustments = try container.decode([ScoreAdjustment].self, forKey: .scoreAdjustments)
        protocols = try container.decodeIfPresent([ColorProtocol].self, forKey: .protocols) ?? []
        nights = try container.decode([NightReport].self, forKey: .nights)
        votings = try container.decode([VotingRecord].self, forKey: .votings)
        events = try container.decode([GameEvent].self, forKey: .events)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(setup, forKey: .setup)
        try container.encode(log, forKey: .log)
        try container.encode(finishedAt, forKey: .finishedAt)
        try container.encode(seats, forKey: .seats)
        try container.encode(outcome, forKey: .outcome)
        // Первый ход отдельно — для старых версий приложения.
        try container.encodeIfPresent(bestMoves.first, forKey: .bestMove)
        try container.encode(bestMoves, forKey: .bestMoves)
        try container.encode(scoreAdjustments, forKey: .scoreAdjustments)
        try container.encode(protocols, forKey: .protocols)
        try container.encode(nights, forKey: .nights)
        try container.encode(votings, forKey: .votings)
        try container.encode(events, forKey: .events)
    }
}

public struct Series: Identifiable, Codable, Sendable, Equatable {
    public let id: SeriesID
    public var title: String
    public let format: CompetitionFormat
    public var ruleset: Ruleset
    public var scoring: ScoringPolicy
    public let createdAt: Date
    public var closedAt: Date?

    public init(
        title: String,
        format: CompetitionFormat,
        variant: GameVariant,
        ruleset: Ruleset? = nil,
        scoring: ScoringPolicy? = nil,
        id: SeriesID = SeriesID(),
        createdAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.format = format
        self.ruleset = ruleset ?? variant.defaultRuleset
        self.scoring = scoring ?? .default(for: format)
        self.createdAt = createdAt
        closedAt = nil
    }

    public var variant: GameVariant { ruleset.variant }
    public var isClosed: Bool { closedAt != nil }

    /// Закрытая серия: все игры сыграны, таблица серии окончательная.
    public func closed(at date: Date = .now) -> Series {
        var copy = self
        copy.closedAt = date
        return copy
    }
}
