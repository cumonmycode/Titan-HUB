import Foundation

// MARK: - Итог игры

public enum Winner: String, Codable, Sendable {
    case red
    case black
    case draw

    public var displayName: String {
        switch self {
        case .red: "Победа мирных"
        case .black: "Победа мафии"
        case .draw: "Ничья"
        }
    }

    public func result(for team: Team) -> GameResult {
        switch self {
        case .draw: .draw
        case .red: team == .red ? .win : .loss
        case .black: team == .black ? .win : .loss
        }
    }
}

public enum GameResult: String, Codable, Sendable {
    case win
    case loss
    case draw
}

public struct GameOutcome: Codable, Sendable, Equatable {
    public enum Reason: Codable, Sendable, Equatable {
        case allBlackEliminated
        case blackReachedParity
        case declaredByHost(note: String?)
        /// Несколько ночей подряд никто не покидал стол (ФСМ 7.7).
        case quietNights(Int)
        /// ППК: нарушение игрока — поражение его команде (ФСМ 6.9).
        case forfeit(by: Seat, note: String?)
    }

    public let winner: Winner
    public let reason: Reason
}

// MARK: - Голосование и ночь

public struct Nomination: Codable, Sendable, Equatable {
    public let candidate: Seat
    public let by: Seat
}

public enum VotingRoundKind: String, Codable, Sendable {
    case main
    case revote
    case lift
}

public struct CandidateResult: Codable, Sendable, Equatable {
    public let candidate: Seat
    public let votes: Int
    /// Кто голосовал. `nil`, если голоса считали «по рукам».
    public let voters: [Seat]?
}

public struct VotingRound: Codable, Sendable, Equatable {
    public let kind: VotingRoundKind
    public let candidates: [Seat]
    public let results: [CandidateResult]
    /// Игроки, чьи голоса автоматически ушли последней кандидатуре.
    public let autoAssignedVoters: [Seat]
    public let liftVotes: Int?
    public let liftVoters: [Seat]?

    /// Кандидаты с наибольшим числом голосов (пусто, если голосов нет).
    public var leaders: [Seat] {
        let maxVotes = results.map(\.votes).max() ?? 0
        guard maxVotes > 0 else { return [] }
        return results.filter { $0.votes == maxVotes }.map(\.candidate)
    }
}

public enum VotingSkipReason: String, Codable, Sendable {
    case noCandidates
    case singleCandidateOnFirstDay
    case notHeldOnThisDay
    case cancelledByRemoval

    public var displayName: String {
        switch self {
        case .noCandidates: "Нет выставленных кандидатур"
        case .singleCandidateOnFirstDay: "Одна кандидатура в первый день — голосование не проводится"
        case .notHeldOnThisDay: "В этот день голосования нет"
        case .cancelledByRemoval: "Голосование отменено из-за удаления игрока"
        }
    }
}

public struct VotingRecord: Codable, Sendable, Equatable {
    public let day: Int
    public let nominees: [Seat]
    public let rounds: [VotingRound]
    public let eliminated: [Seat]
    public let skipReason: VotingSkipReason?
    /// Единственная кандидатура покинула стол без голосования.
    public let isAutomatic: Bool

    public var wasHeld: Bool { skipReason == nil && !isAutomatic }
}

public enum ShotTarget: Codable, Sendable, Equatable {
    case miss
    case seat(Seat)

    public var seat: Seat? {
        if case let .seat(seat) = self { seat } else { nil }
    }
}

public struct NightCheck: Codable, Sendable, Equatable {
    public let checker: Role
    public let by: Seat
    public let target: Seat
    /// Дон: найден шериф. Шериф: найден чёрный.
    public let isPositive: Bool
}

public struct NightActions: Codable, Sendable, Equatable {
    public internal(set) var mafiaShot: ShotTarget?
    public internal(set) var maniacShot: ShotTarget?
    public internal(set) var checks: [NightCheck] = []
    public internal(set) var heal: Seat?
}

public struct NightVictim: Codable, Sendable, Equatable {
    public let seat: Seat
    public let killer: Killer
}

public struct NightReport: Codable, Sendable, Equatable {
    public let number: Int
    public let actions: NightActions
    public let victims: [NightVictim]
    /// Цели выстрелов, которые выжили (вылечены или неуязвимы ночью).
    public let saved: [Seat]
}

public struct BestMove: Codable, Sendable, Equatable {
    public let author: Seat
    public let seats: [Seat]
}

// MARK: - Журнал событий

/// Факт, произошедший в игре. Из событий собирается «ход игры» для истории и экрана ведущего.
public struct GameEvent: Codable, Sendable, Equatable {
    public enum Kind: Codable, Sendable, Equatable {
        case gameStarted
        case stepStarted(TimedStepKind)
        case dayStarted(Int)
        case nightStarted(Int)
        case dayEnded(Int)
        case farewell(Seat)
        case speech(Seat)
        case speechSkipped(Seat)
        case nominated(candidate: Seat, by: Seat)
        case nominationWithdrawn(candidate: Seat, by: Seat)
        case votingStarted(candidates: [Seat])
        case tie(candidates: [Seat])
        case tieSpeech(Seat)
        case liftVoteStarted(candidates: [Seat])
        case votingRound(VotingRound)
        case votingFinished(VotingRecord)
        case nightStep(NightStep)
        case nightStepSkipped(NightStep)
        case shot(Killer, ShotTarget)
        case check(NightCheck)
        case heal(Seat)
        case nightResolved(NightReport)
        case eliminated(Seat, EliminationCause)
        case foul(Seat, total: Int)
        case foulCancelled(Seat, total: Int)
        case techFoul(Seat, total: Int)
        case bigTechFoul(Seat, total: Int)
        case techFoulCancelled(Seat, total: Int)
        case warning(Seat, total: Int)
        case silenced(Seat)
        /// 3-й фол: ближайшая речь вдвое короче.
        case speechHalved(Seat)
        case criticalRemovalMarked(Seat, Bool)
        case sheriffClaimMarked(Seat, Bool)
        case bestMoveAvailable(Seat)
        case bestMove(BestMove)
        case scoreAdjusted(ScoreAdjustment)
        case scoreAdjustmentsSet(Seat, [ScoreAdjustment])
        case protocolRecorded(ColorProtocol)
        case gameFinished(GameOutcome)
    }

    public let date: Date
    public let moment: GameMoment
    public let kind: Kind
}
