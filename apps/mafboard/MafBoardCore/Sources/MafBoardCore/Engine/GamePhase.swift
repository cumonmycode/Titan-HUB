/// Фаза игры. Переходы между фазами выполняет только движок.
public enum GamePhase: Codable, Sendable, Equatable {
    /// Нулевая ночь: шаги из `Ruleset.nightZero`.
    case nightZero(step: Int)
    case day(DayStage)
    case night(NightProgress)
    case finished
}

/// Стадия дня.
public enum DayStage: Codable, Sendable, Equatable {
    /// Прощальные речи: убитых ночью (утро) или выбывших по голосованию.
    case farewell(FarewellQueue)
    case speeches(SpeechRound)
    /// Дополнительные шаги дня (добор, общая минута).
    case extra(step: Int)
    case voting(VotingSession)
    /// День окончен — следующий шаг: ночь.
    case dusk
}

public enum FarewellContext: String, Codable, Sendable {
    case afterNight
    case afterVoting
}

public struct FarewellQueue: Codable, Sendable, Equatable {
    public let seats: [Seat]
    public internal(set) var index: Int
    public let context: FarewellContext

    public var current: Seat? {
        seats.indices.contains(index) ? seats[index] : nil
    }
}

/// Очередь речей дня. Выбывшие и лишённые слова игроки пропускаются при переходе.
public struct SpeechRound: Codable, Sendable, Equatable {
    public let order: [Seat]
    public internal(set) var index: Int

    public var current: Seat? {
        order.indices.contains(index) ? order[index] : nil
    }
}

public enum VotingStage: Codable, Sendable, Equatable {
    case ballot(VotingRoundKind)
    /// Оправдательные речи игроков в попиле.
    case tieSpeeches(index: Int)
    /// Голосование «поднять всех».
    case liftBallot
}

public struct VotingSession: Codable, Sendable, Equatable {
    /// Все выставленные кандидатуры дня.
    public let nominees: [Seat]
    /// Кандидаты текущего круга (после попила — только лидеры).
    public internal(set) var candidates: [Seat]
    public internal(set) var stage: VotingStage
    public internal(set) var rounds: [VotingRound]
}

public struct NightProgress: Codable, Sendable, Equatable {
    public let number: Int
    /// Шаги этой ночи (уже без шагов, для которых нет живого игрока).
    public let steps: [NightStep]
    public internal(set) var index: Int
    public internal(set) var actions: NightActions

    public var currentStep: NightStep? {
        steps.indices.contains(index) ? steps[index] : nil
    }
}
