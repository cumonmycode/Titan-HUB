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
    public let bestMove: BestMove?
    public let scoreAdjustments: [ScoreAdjustment]
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
        bestMove = state.bestMove
        scoreAdjustments = state.scoreAdjustments
        nights = state.nights
        votings = state.votings
        events = state.events
    }

    public var id: GameID { setup.gameID }
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
