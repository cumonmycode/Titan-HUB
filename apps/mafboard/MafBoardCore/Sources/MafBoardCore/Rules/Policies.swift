// MARK: - Таймеры и шаги

/// Шаг с таймером вне обычных речей.
public enum TimedStepKind: String, Codable, Sendable, CaseIterable {
    /// Договорка мафии в нулевую ночь (спортивная).
    case mafiaMeeting
    /// Знакомство в нулевую ночь (городская).
    case introduction
    /// Свободная посадка перед первым днём.
    case freeSeating
    /// Добор: дополнительное время игроку, открывавшему день (городская, день 1).
    case openerAddition
    /// Общая минута свободного обсуждения перед голосованием (городская, день 2+).
    case commonMinute

    public var displayName: String {
        switch self {
        case .mafiaMeeting: "Договорка"
        case .introduction: "Знакомство"
        case .freeSeating: "Свободная посадка"
        case .openerAddition: "Добор первого игрока"
        case .commonMinute: "Общая минута"
        }
    }

    /// Шаг — это речь игрока, открывавшего день.
    public var isOpenerSpeech: Bool { self == .openerAddition }
}

public struct TimedStep: Codable, Sendable, Equatable {
    public var kind: TimedStepKind
    public var seconds: Int

    public init(_ kind: TimedStepKind, seconds: Int) {
        self.kind = kind
        self.seconds = seconds
    }
}

public struct TimingPolicy: Codable, Sendable, Equatable {
    public var speechSeconds: Int
    /// Оправдательная речь в попиле. 0 — сразу переголосование.
    public var tieSpeechSeconds: Int
    /// Прощальная речь выбывшего. 0 — без прощальных речей.
    public var farewellSeconds: Int
}

// MARK: - День

public enum CandidateSource: String, Codable, Sendable {
    /// Кандидатов выставляют игроки во время речей.
    case nominations
    /// Кандидаты — все живые игроки (голосование «по рукам»).
    case allAlive
}

public struct DayPolicy: Codable, Sendable, Equatable {
    public var candidateSource: CandidateSource
    /// С какого дня проводится голосование (в городской мафии первый день — без голосования).
    public var firstVotingDay: Int
    public var firstDayExtraSteps: [TimedStep]
    public var laterDayExtraSteps: [TimedStep]
    /// В первый день единственная кандидатура не ставится на голосование.
    public var skipSingleCandidateOnFirstDay: Bool
    /// Единственная кандидатура покидает стол без голосования.
    public var singleCandidateLeavesWithoutVote: Bool
    /// Выставить кандидатуру может только игрок, который сейчас говорит.
    public var nominationsOnlyBySpeaker: Bool

    public func extraSteps(forDay day: Int) -> [TimedStep] {
        day <= 1 ? firstDayExtraSteps : laterDayExtraSteps
    }
}

// MARK: - Голосование

public enum BallotStyle: String, Codable, Sendable {
    /// Фиксируется, кто за кого голосовал.
    case perVoter
    /// Вводится только количество голосов за каждого кандидата.
    case handCount
}

public enum RepeatedTieResolution: String, Codable, Sendable {
    /// Голосование «поднять всех»: проходит, если «за» больше половины живых.
    case liftVote
    case nobodyLeaves
    case everybodyLeaves
}

public struct VotingPolicy: Codable, Sendable, Equatable {
    /// Предпочтительный способ ввода для интерфейса. Движок принимает оба.
    public var ballotStyle: BallotStyle
    /// Не проголосовавшие отдают голос последней кандидатуре.
    public var abstainersVoteForLastCandidate: Bool
    public var onRepeatedTie: RepeatedTieResolution
    /// Если в переголосовании лидеров стало меньше — ещё один круг попила только между ними.
    public var revoteWhenTieShrinks: Bool
    /// Удаление игрока днём отменяет голосование этого дня.
    public var cancelOnDayRemoval: Bool
}

// MARK: - Ночь

/// Кто убил игрока ночью.
public enum Killer: String, Codable, Sendable {
    case mafia
    case maniac
}

/// Шаг ночи. Шаг пропускается, если к началу ночи нет живого игрока с нужной ролью.
public enum NightStep: String, Codable, Sendable, CaseIterable {
    case mafiaShot
    case maniacShot
    case donCheck
    case sheriffCheck
    case doctorHeal

    public var displayName: String {
        switch self {
        case .mafiaShot: "Выстрел мафии"
        case .maniacShot: "Ход маньяка"
        case .donCheck: "Проверка дона"
        case .sheriffCheck: "Проверка шерифа"
        case .doctorHeal: "Лечение доктора"
        }
    }

    public func isPerformed(by role: Role) -> Bool {
        switch self {
        case .mafiaShot: role.joinsMafiaShot
        case .maniacShot: role == .maniac
        case .donCheck: role == .don
        case .sheriffCheck: role == .sheriff
        case .doctorHeal: role == .doctor
        }
    }

    public var killer: Killer? {
        switch self {
        case .mafiaShot: .mafia
        case .maniacShot: .maniac
        case .donCheck, .sheriffCheck, .doctorHeal: nil
        }
    }
}

public struct NightPolicy: Codable, Sendable, Equatable {
    public var steps: [NightStep]
    public var doctorMayRepeatTarget: Bool
    /// Массив, а не множество: так JSON правил получается одинаковым при каждом сохранении.
    public var immuneToNightKill: [Role]
}

// MARK: - Дисциплина

public struct DisciplinePolicy: Codable, Sendable, Equatable {
    /// На этом фоле игрок лишается ближайшей речи. `nil` — правило не используется.
    public var foulsToSilence: Int?
    /// На этом фоле игрок удаляется из игры.
    public var foulsToRemoval: Int?
    /// На этом техническом фоле игрок удаляется из игры.
    public var techFoulsToRemoval: Int?
    /// Каждые N предупреждений превращаются в фол. `nil` — предупреждения только фиксируются.
    public var warningsPerFoul: Int?
}

// MARK: - Лучший ход

public enum BestMoveEligibility: String, Codable, Sendable {
    /// Только игрок, убитый мафией в первую ночь.
    case firstNightVictim
    /// Первый убитый мафией игрок, в какую бы ночь это ни случилось.
    case firstNightKill
}

public struct BestMovePolicy: Codable, Sendable, Equatable {
    public var isEnabled: Bool
    public var eligibility: BestMoveEligibility
    public var defaultSeats: Int
    public var seatsByPlayerCount: [Int: Int]

    public func maxSeats(playerCount: Int) -> Int {
        seatsByPlayerCount[playerCount] ?? defaultSeats
    }
}
