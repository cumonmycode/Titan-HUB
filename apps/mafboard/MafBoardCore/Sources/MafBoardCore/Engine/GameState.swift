import Foundation

// MARK: - Место за столом

public enum RemovalReason: Codable, Sendable, Equatable {
    case fouls
    case techFouls
    case disqualified(note: String?)
}

public enum EliminationCause: Codable, Sendable, Equatable {
    case killed(by: Killer)
    case votedOut
    /// Удаление за нарушения — штрафуется в подсчёте баллов.
    case removed(RemovalReason)
    /// Ручное выбывание по решению ведущего (например, способность роли, которую движок не ведёт).
    case hostDecision(note: String?)
}

/// Момент игры — для журнала событий и истории.
public enum GameMoment: Codable, Sendable, Hashable {
    case nightZero
    case day(Int)
    case night(Int)
    case afterGame

    public var displayName: String {
        switch self {
        case .nightZero: "Нулевая ночь"
        case let .day(number): "День \(number)"
        case let .night(number): "Ночь \(number)"
        case .afterGame: "После игры"
        }
    }
}

public struct Elimination: Codable, Sendable, Equatable {
    public let cause: EliminationCause
    public let moment: GameMoment
}

public struct SeatState: Codable, Sendable, Equatable, Identifiable {
    public let seat: Seat
    public let playerID: PlayerID
    public let role: Role
    public internal(set) var elimination: Elimination?
    public internal(set) var fouls = 0
    public internal(set) var techFouls = 0
    public internal(set) var warnings = 0
    /// Игрок пропустит ближайшую речь (3-й фол).
    public internal(set) var missesNextSpeech = false

    init(_ assignment: SeatAssignment) {
        seat = assignment.seat
        playerID = assignment.playerID
        role = assignment.role
    }

    public var id: Seat { seat }
    public var team: Team { role.team }
    public var isAlive: Bool { elimination == nil }
}

// MARK: - Состояние игры

/// Полное состояние игры в один момент времени. Значение неизменяемо снаружи:
/// новое состояние получается только через `GameEngine.apply`.
public struct GameState: Codable, Sendable, Equatable {
    public let setup: GameSetup
    public internal(set) var seats: [SeatState]
    public internal(set) var phase: GamePhase
    public internal(set) var dayNumber = 0
    public internal(set) var nightNumber = 0
    /// Выставленные кандидатуры текущего дня в порядке выставления.
    public internal(set) var nominations: [Nomination] = []
    public internal(set) var isVotingCancelledToday = false
    /// Игрок, открывавший текущий (последний) день. От него считается очередь следующего дня.
    public internal(set) var dayOpener: Seat?
    /// Открывавший день пропустил речь из-за фолов — добора ему не положено.
    public internal(set) var isOpenerSilencedToday = false
    public internal(set) var nights: [NightReport] = []
    public internal(set) var votings: [VotingRecord] = []
    /// Игрок, получивший право лучшего хода.
    public internal(set) var bestMoveAuthor: Seat?
    public internal(set) var bestMove: BestMove?
    public internal(set) var doctorLastTarget: Seat?
    public internal(set) var scoreAdjustments: [ScoreAdjustment] = []
    public internal(set) var outcome: GameOutcome?
    public internal(set) var events: [GameEvent] = []

    init(setup: GameSetup) {
        self.setup = setup
        seats = setup.seats.map(SeatState.init)
        phase = .nightZero(step: 0)
    }
}

extension GameState {
    public var ruleset: Ruleset { setup.ruleset }
    public var isFinished: Bool { phase == .finished }

    /// Можно ли нажать «Далее». Нельзя во время ввода голосов и после конца игры.
    public var canAdvance: Bool {
        switch phase {
        case .finished:
            false
        case let .day(.voting(session)):
            if case .tieSpeeches = session.stage { true } else { false }
        case .nightZero, .night, .day:
            true
        }
    }

    public var moment: GameMoment {
        switch phase {
        case .nightZero: .nightZero
        case .day: .day(dayNumber)
        case .night: .night(nightNumber)
        case .finished: .afterGame
        }
    }

    public func seat(_ seat: Seat) -> SeatState? {
        seats.first { $0.seat == seat }
    }

    public func isAlive(_ seat: Seat) -> Bool {
        self.seat(seat)?.isAlive ?? false
    }

    /// Живые игроки по порядку номеров.
    public var aliveSeats: [Seat] {
        seats.filter(\.isAlive).map(\.seat)
    }

    public func aliveCount(of team: Team) -> Int {
        seats.filter { $0.isAlive && $0.team == team }.count
    }

    /// Живые игроки по кругу, начиная с `opener`.
    func aliveSeats(rotatedFrom opener: Seat) -> [Seat] {
        let alive = aliveSeats
        let head = alive.filter { $0 >= opener }
        let tail = alive.filter { $0 < opener }
        return head + tail
    }
}

// MARK: - Текущий шаг для интерфейса

/// Что сейчас происходит за столом — удобная проекция фазы для экрана ведущего.
public enum CurrentStep: Equatable, Sendable {
    case timed(TimedStep, speaker: Seat?)
    case farewell(Seat)
    case speech(Seat)
    case ballot(candidates: [Seat], kind: VotingRoundKind)
    case tieSpeech(Seat)
    case liftBallot(candidates: [Seat])
    case dusk
    case night(NightStep)
    case finished
}

extension GameState {
    public var currentStep: CurrentStep {
        switch phase {
        case let .nightZero(step):
            guard ruleset.nightZero.indices.contains(step) else { return .dusk }
            return .timed(ruleset.nightZero[step], speaker: nil)
        case let .night(progress):
            return progress.currentStep.map(CurrentStep.night) ?? .dusk
        case .finished:
            return .finished
        case let .day(stage):
            return currentStep(in: stage)
        }
    }

    /// Длительность таймера текущего шага в секундах, если у шага есть таймер.
    public var timerSeconds: Int? {
        let timing = ruleset.timing
        return switch currentStep {
        case let .timed(step, _): step.seconds
        case .farewell: timing.farewellSeconds
        case .speech: timing.speechSeconds
        case .tieSpeech: timing.tieSpeechSeconds
        case .ballot, .liftBallot, .dusk, .night, .finished: nil
        }
    }

    /// Кто сейчас говорит (речь, прощальная речь, оправдание, добор).
    public var currentSpeaker: Seat? {
        switch currentStep {
        case let .speech(seat), let .farewell(seat), let .tieSpeech(seat): seat
        case let .timed(_, speaker): speaker
        case .ballot, .liftBallot, .dusk, .night, .finished: nil
        }
    }

    private func currentStep(in stage: DayStage) -> CurrentStep {
        switch stage {
        case let .farewell(queue):
            return queue.current.map(CurrentStep.farewell) ?? .dusk
        case let .speeches(round):
            return round.current.map(CurrentStep.speech) ?? .dusk
        case let .extra(index):
            let steps = ruleset.day.extraSteps(forDay: dayNumber)
            guard steps.indices.contains(index) else { return .dusk }
            let step = steps[index]
            return .timed(step, speaker: step.kind.isOpenerSpeech ? dayOpener : nil)
        case let .voting(session):
            switch session.stage {
            case let .ballot(kind):
                return .ballot(candidates: session.candidates, kind: kind)
            case let .tieSpeeches(index):
                guard session.candidates.indices.contains(index) else { return .dusk }
                return .tieSpeech(session.candidates[index])
            case .liftBallot:
                return .liftBallot(candidates: session.candidates)
            }
        case .dusk:
            return .dusk
        }
    }
}
