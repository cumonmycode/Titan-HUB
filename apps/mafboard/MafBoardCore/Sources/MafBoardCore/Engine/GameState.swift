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

/// Вид технического фола (ФСМ 6.7.1): обычный −0.3 или большой −0.6.
public enum TechFoulKind: String, Codable, Sendable {
    case ordinary
    case big
}

public struct SeatState: Codable, Sendable, Equatable, Identifiable {
    public let seat: Seat
    public let playerID: PlayerID
    public let role: Role
    public internal(set) var elimination: Elimination?
    public internal(set) var fouls = 0
    /// Техфолы по порядку получения.
    public internal(set) var techFoulKinds: [TechFoulKind] = []
    public internal(set) var warnings = 0
    /// Игрок пропустит ближайшую речь (3-й фол в городской мафии).
    public internal(set) var missesNextSpeech = false
    /// Ближайшая речь игрока — вдвое короче (3-й фол в спортивной мафии).
    public internal(set) var halvesNextSpeech = false
    /// Удалён «на критике» — штраф больше обычного (ФСМ 8.2.4).
    public internal(set) var isCriticalRemoval = false
    /// Вскрылся шерифом (отметка судьи).
    public internal(set) var claimedSheriff = false

    init(_ assignment: SeatAssignment) {
        seat = assignment.seat
        playerID = assignment.playerID
        role = assignment.role
    }

    public var id: Seat { seat }
    public var team: Team { role.team }
    public var isAlive: Bool { elimination == nil }
    public var techFouls: Int { techFoulKinds.count }
    public var bigTechFouls: Int { techFoulKinds.filter { $0 == .big }.count }
    /// Удалён за нарушения (фолы, техфолы, дисквалификация).
    public var isRemoved: Bool {
        if case .removed = elimination?.cause { true } else { false }
    }
}

extension SeatState {
    private enum CodingKeys: String, CodingKey {
        case seat, playerID, role, elimination, fouls, techFouls, techFoulKinds, warnings,
             missesNextSpeech, halvesNextSpeech, isCriticalRemoval, claimedSheriff
    }

    /// Записи до видов техфолов хранили только их число — все такие техфолы обычные.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seat = try container.decode(Seat.self, forKey: .seat)
        playerID = try container.decode(PlayerID.self, forKey: .playerID)
        role = try container.decode(Role.self, forKey: .role)
        elimination = try container.decodeIfPresent(Elimination.self, forKey: .elimination)
        fouls = try container.decode(Int.self, forKey: .fouls)
        if let kinds = try container.decodeIfPresent([TechFoulKind].self, forKey: .techFoulKinds) {
            techFoulKinds = kinds
        } else {
            techFoulKinds = Array(repeating: .ordinary, count: try container.decode(Int.self, forKey: .techFouls))
        }
        warnings = try container.decode(Int.self, forKey: .warnings)
        missesNextSpeech = try container.decode(Bool.self, forKey: .missesNextSpeech)
        halvesNextSpeech = try container.decodeIfPresent(Bool.self, forKey: .halvesNextSpeech) ?? false
        isCriticalRemoval = try container.decodeIfPresent(Bool.self, forKey: .isCriticalRemoval) ?? false
        claimedSheriff = try container.decodeIfPresent(Bool.self, forKey: .claimedSheriff) ?? false
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seat, forKey: .seat)
        try container.encode(playerID, forKey: .playerID)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(elimination, forKey: .elimination)
        try container.encode(fouls, forKey: .fouls)
        // Число — для старых версий приложения, которые читают записи с сервера.
        try container.encode(techFouls, forKey: .techFouls)
        try container.encode(techFoulKinds, forKey: .techFoulKinds)
        try container.encode(warnings, forKey: .warnings)
        try container.encode(missesNextSpeech, forKey: .missesNextSpeech)
        try container.encode(halvesNextSpeech, forKey: .halvesNextSpeech)
        try container.encode(isCriticalRemoval, forKey: .isCriticalRemoval)
        try container.encode(claimedSheriff, forKey: .claimedSheriff)
    }
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
    /// Игрока удалили ночью или после итогов голосования — завтра голосования нет (ФСМ 7.1–7.2).
    public internal(set) var isNextDayVotingCancelled = false
    /// Игрок, открывавший текущий (последний) день. От него считается очередь следующего дня.
    public internal(set) var dayOpener: Seat?
    /// Открывавший день пропустил речь из-за фолов — добора ему не положено.
    public internal(set) var isOpenerSilencedToday = false
    public internal(set) var nights: [NightReport] = []
    public internal(set) var votings: [VotingRecord] = []
    /// Игроки, получившие право лучшего хода, по порядку: «слом» при десяти, затем ПУ.
    public internal(set) var bestMoveAuthors: [Seat] = []
    public internal(set) var bestMoves: [BestMove] = []
    /// Чья речь сейчас идёт вдвое короче (3-й фол).
    public internal(set) var halvedSpeaker: Seat?
    /// Дополнительное время текущей речи, взятое за фолы. Сбрасывается со сменой шага.
    public internal(set) var extraSeconds: Int?
    public internal(set) var doctorLastTarget: Seat?
    public internal(set) var scoreAdjustments: [ScoreAdjustment] = []
    /// Протоколы выбывших игроков (по одному на игрока, последний заменяет прежний).
    public internal(set) var protocols: [ColorProtocol] = []
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
    /// Первый убитый (ПУ) — убитый в первую ночь после договорки (ФСМ 1.5).
    public var firstKilled: Seat? { nights.firstKilled }
    /// Последний игрок, получивший право лучшего хода.
    public var bestMoveAuthor: Seat? { bestMoveAuthors.last }
    /// Последний записанный лучший ход.
    public var bestMove: BestMove? { bestMoves.last }

    public func bestMove(by author: Seat) -> BestMove? {
        bestMoves.first { $0.author == author }
    }

    /// Право лучшего хода есть, а ход ещё не записан.
    public func awaitsBestMove(from seat: Seat) -> Bool {
        bestMoveAuthors.contains(seat) && bestMove(by: seat) == nil
    }
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
    /// Выбывший называет лучший ход — перед заключительной речью.
    case farewellBestMove(Seat)
    case farewell(Seat)
    /// Убитый после заключительной речи оставляет протокол.
    case farewellProtocol(Seat)
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

    /// Длительность таймера текущего шага в секундах (с взятым за фолы временем), если у шага есть таймер.
    public var timerSeconds: Int? {
        baseTimerSeconds.map { $0 + (extraSeconds ?? 0) }
    }

    private var baseTimerSeconds: Int? {
        let timing = ruleset.timing
        return switch currentStep {
        case let .timed(step, _): step.seconds
        case let .farewell(seat): seat == halvedSpeaker ? timing.farewellSeconds / 2 : timing.farewellSeconds
        case let .speech(seat): seat == halvedSpeaker ? timing.speechSeconds / 2 : timing.speechSeconds
        case .tieSpeech: timing.tieSpeechSeconds
        case .farewellBestMove, .farewellProtocol, .ballot, .liftBallot, .dusk, .night, .finished: nil
        }
    }

    /// Чей сейчас ход днём: речь, заключительная минута (с ЛХ и протоколом), оправдание, добор.
    public var currentSpeaker: Seat? {
        switch currentStep {
        case let .speech(seat), let .farewell(seat), let .tieSpeech(seat),
             let .farewellBestMove(seat), let .farewellProtocol(seat): seat
        case let .timed(_, speaker): speaker
        case .ballot, .liftBallot, .dusk, .night, .finished: nil
        }
    }

    /// Может ли говорящий взять дополнительное время: идёт его речь с таймером и фолов после этого не станет больше лимита.
    public func canTakeExtraTime(_ seat: Seat) -> Bool {
        let policy = ruleset.discipline.extraTimeRule
        guard !isFinished, baseTimerSeconds != nil, currentSpeaker == seat, let fouls = self.seat(seat)?.fouls else {
            return false
        }
        return fouls + policy.fouls <= policy.maxFouls
    }

    private func currentStep(in stage: DayStage) -> CurrentStep {
        switch stage {
        case let .farewell(queue):
            guard let seat = queue.current else { return .dusk }
            return switch queue.stage {
            case .bestMove: .farewellBestMove(seat)
            case .colorProtocol: .farewellProtocol(seat)
            case .speech, nil: .farewell(seat)
            }
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

extension [NightReport] {
    /// Первый убитый (ПУ): жертва первой ночи после договорки. Если в ту ночь был промах, ПУ нет.
    public var firstKilled: Seat? {
        first { $0.number == 1 }?.victims.first?.seat
    }
}
