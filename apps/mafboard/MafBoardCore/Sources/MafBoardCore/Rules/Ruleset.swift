/// Вариант игры: общий движок, но разные правила.
public enum GameVariant: String, Codable, Sendable, CaseIterable {
    case sport
    case city

    public var displayName: String {
        switch self {
        case .sport: "Спортивная мафия"
        case .city: "Городская мафия"
        }
    }

    public var defaultRuleset: Ruleset {
        switch self {
        case .sport: .sport
        case .city: .city
        }
    }
}

/// Полный набор правил одной игры. Движок не знает про «спортивную» или «городскую» мафию —
/// всё поведение задаётся этими настройками. Пресеты `.sport` и `.city` можно копировать и менять
/// под регламент клуба: `var rules = Ruleset.sport; rules.timing.speechSeconds = 45`.
public struct Ruleset: Codable, Sendable, Equatable {
    public var variant: GameVariant
    public var allowedPlayerCounts: ClosedRange<Int>
    public var timing: TimingPolicy
    /// Шаги нулевой ночи (договорка, знакомство, свободная посадка).
    public var nightZero: [TimedStep]
    public var day: DayPolicy
    public var voting: VotingPolicy
    public var night: NightPolicy
    public var discipline: DisciplinePolicy
    public var bestMove: BestMovePolicy
}

extension Ruleset {
    /// Спортивная мафия (по мотивам регламента ФИИМ): 10 игроков, номинации, попил и подъём.
    public static let sport = Ruleset(
        variant: .sport,
        allowedPlayerCounts: 10...10,
        timing: TimingPolicy(speechSeconds: 60, tieSpeechSeconds: 30, farewellSeconds: 60),
        nightZero: [
            TimedStep(.mafiaMeeting, seconds: 60),
            TimedStep(.freeSeating, seconds: 40),
        ],
        day: DayPolicy(
            candidateSource: .nominations,
            firstVotingDay: 1,
            firstDayExtraSteps: [],
            laterDayExtraSteps: [],
            skipSingleCandidateOnFirstDay: true,
            singleCandidateLeavesWithoutVote: true,
            nominationsOnlyBySpeaker: true
        ),
        voting: VotingPolicy(
            ballotStyle: .perVoter,
            abstainersVoteForLastCandidate: true,
            onRepeatedTie: .liftVote,
            revoteWhenTieShrinks: true,
            cancelOnDayRemoval: true
        ),
        night: NightPolicy(
            steps: [.mafiaShot, .donCheck, .sheriffCheck],
            doctorMayRepeatTarget: false,
            immuneToNightKill: []
        ),
        discipline: DisciplinePolicy(
            foulsToSilence: 3,
            foulsToRemoval: 4,
            techFoulsToRemoval: 2,
            warningsPerFoul: nil
        ),
        bestMove: BestMovePolicy(
            isEnabled: true,
            eligibility: .firstNightVictim,
            defaultSeats: 3,
            seatsByPlayerCount: [:]
        )
    )

    /// Городская мафия: 8+ игроков, расширенные роли, голосование «по рукам» за всех живых.
    public static let city = Ruleset(
        variant: .city,
        allowedPlayerCounts: 8...20,
        timing: TimingPolicy(speechSeconds: 60, tieSpeechSeconds: 30, farewellSeconds: 60),
        nightZero: [
            TimedStep(.introduction, seconds: 60),
            TimedStep(.freeSeating, seconds: 20),
        ],
        day: DayPolicy(
            candidateSource: .allAlive,
            firstVotingDay: 2,
            firstDayExtraSteps: [TimedStep(.openerAddition, seconds: 30)],
            laterDayExtraSteps: [TimedStep(.commonMinute, seconds: 60)],
            skipSingleCandidateOnFirstDay: false,
            singleCandidateLeavesWithoutVote: false,
            nominationsOnlyBySpeaker: false
        ),
        voting: VotingPolicy(
            ballotStyle: .handCount,
            abstainersVoteForLastCandidate: false,
            onRepeatedTie: .nobodyLeaves,
            revoteWhenTieShrinks: false,
            cancelOnDayRemoval: false
        ),
        night: NightPolicy(
            steps: [.mafiaShot, .maniacShot, .donCheck, .sheriffCheck, .doctorHeal],
            doctorMayRepeatTarget: false,
            immuneToNightKill: [.immortal]
        ),
        discipline: DisciplinePolicy(
            foulsToSilence: 3,
            foulsToRemoval: 4,
            techFoulsToRemoval: 2,
            warningsPerFoul: nil
        ),
        bestMove: BestMovePolicy(
            isEnabled: true,
            eligibility: .firstNightVictim,
            defaultSeats: 5,
            seatsByPlayerCount: [8: 2, 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 4, 15: 5, 16: 5]
        )
    )
}

// MARK: - Состав ролей

extension Ruleset {
    /// Стандартный набор ролей для количества игроков (порядок не важен — раздаёт `RoleDealer`).
    /// Для городской мафии на 17+ игроков к базовому набору добавляются выбранные `optionalRoles`.
    public func standardRoles(playerCount: Int, optionalRoles: Set<Role> = []) throws(GameError) -> [Role] {
        guard allowedPlayerCounts.contains(playerCount) else {
            throw .invalidSetup(.playerCount(variant, allowed: allowedPlayerCounts))
        }
        let special: [Role] = switch variant {
        case .sport: [.don, .mafia, .mafia, .sheriff]
        case .city: CityComposition.special(playerCount: playerCount, optionalRoles: optionalRoles)
        }
        guard special.count <= playerCount else {
            throw .invalidSetup(.tooManySpecialRoles(special: special.count, players: playerCount))
        }
        return special + Array(repeating: .civilian, count: playerCount - special.count)
    }

    /// Проверяет, что набор ролей допустим для этих правил.
    public func validate(roles: [Role]) throws(GameError) {
        guard allowedPlayerCounts.contains(roles.count) else {
            throw .invalidSetup(.playerCount(variant, allowed: allowedPlayerCounts))
        }
        let counts = Self.counts(of: roles)
        if let duplicated = Role.allCases.first(where: { $0.isUnique && counts[$0, default: 0] > 1 }) {
            throw .invalidSetup(.duplicateUniqueRole(duplicated))
        }
        let blackCount = roles.filter { $0.team == .black }.count
        guard blackCount > 0 else { throw .invalidSetup(.noBlackRoles) }
        guard blackCount < roles.count - blackCount else { throw .invalidSetup(.tooManyBlackRoles) }
        if variant == .sport {
            let standard = try standardRoles(playerCount: roles.count)
            guard Self.counts(of: standard) == counts else { throw .invalidSetup(.sportComposition) }
        }
    }

    static func counts(of roles: [Role]) -> [Role: Int] {
        roles.reduce(into: [:]) { counts, role in counts[role, default: 0] += 1 }
    }
}

/// Составы городской мафии (перенесены из старой версии MafBoard).
enum CityComposition {
    static let fixed: [Int: [Role]] = [
        8: [.don, .mafia, .sheriff],
        9: [.don, .mafia, .mafia, .sheriff],
        10: [.don, .mafia, .mafia, .sheriff, .doctor],
        11: [.don, .mafia, .mafia, .sheriff, .doctor],
        12: [.don, .mafia, .mafia, .mafia, .sheriff, .doctor],
        13: [.don, .mafia, .mafia, .maniac, .sheriff, .doctor, .kamikaze],
        14: [.don, .mafia, .mafia, .maniac, .sheriff, .doctor, .kamikaze, .immortal],
        15: [.don, .mafia, .mafia, .mafia, .maniac, .sheriff, .doctor, .kamikaze, .immortal],
        16: [.don, .mafia, .mafia, .mafia, .maniac, .sheriff, .doctor, .kamikaze, .immortal, .beauty],
    ]

    /// Базовый набор для 17+ игроков.
    static let base: [Role] = [.don, .mafia, .mafia, .mafia, .maniac, .sheriff, .doctor, .kamikaze, .immortal, .beauty]

    /// Роли, которые ведущий может добавить к базовому набору на 17+ игроков.
    static let optional: [Role] = [
        .detective, .jailer, .prostitute, .bodyguard, .sleepwalker, .journalist, .priest, .judge,
        .oyabun, .yakuza, .ripper, .swindler, .thief, .snitch, .fangirl, .lawyer,
    ]

    static func special(playerCount: Int, optionalRoles: Set<Role>) -> [Role] {
        if let roles = fixed[playerCount] {
            return roles
        }
        return base + optional.filter(optionalRoles.contains)
    }
}
