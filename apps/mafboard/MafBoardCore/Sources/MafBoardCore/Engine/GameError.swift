import Foundation

/// Ошибка применения действия. Состояние игры при ошибке не меняется.
/// Причины типизированы: интерфейс может реагировать на конкретный случай, а текст — локализовать.
public enum GameError: Error, Sendable, Equatable {
    case invalidSetup(SetupProblem)
    case accessDenied(AccessProblem)
    case unknownSeat(Seat)
    case seatNotAlive(Seat)
    case gameFinished
    case gameNotFinished
    case notAllowedNow(Restriction)
    case alreadyNominated(by: Seat)
    case candidateAlreadyNominated(Seat)
    case noNomination(by: Seat)
    case invalidBallot(BallotProblem)
    case unexpectedNightInput(NightStep)
    case cannotTargetSelf(Seat)
    case doctorCannotRepeatTarget(Seat)
    /// В первую ночь отстрела дон не проверяет того, в кого стреляли (ФСМ 4.6.9).
    case donCannotCheckShotTarget(Seat)
    /// Отметить «на критике» можно только удаление за фолы или дисквалификацию.
    case notRemoved(Seat)
    case bestMoveNotAvailable
    case invalidBestMove(BestMoveProblem)
    case invalidProtocol(ProtocolProblem)
    case nothingToCancel(Seat)
    case nothingToUndo
    /// Удалённого игрока не вернуть: без его удаления журнал игры не сходится.
    case cannotReinstate(Seat)
}

public enum SetupProblem: Sendable, Equatable {
    case playerCount(GameVariant, allowed: ClosedRange<Int>)
    case playersAndRolesMismatch(players: Int, roles: Int)
    case duplicatePlayer
    case duplicateUniqueRole(Role)
    case tooManySpecialRoles(special: Int, players: Int)
    case noBlackRoles
    case tooManyBlackRoles
    case sportComposition
}

public enum AccessProblem: Sendable, Equatable {
    /// Режим доступен только с привязанным аккаунтом GoMafia.
    case formatRequiresGoMafia(CompetitionFormat)
    /// Режим доступен только ведущему, состоящему в клубе GoMafia.
    case formatRequiresClub(CompetitionFormat)
    /// В режиме с рейтингом все игроки должны быть из GoMafia.
    case goMafiaPlayersRequired(nicknames: [String])
}

public enum Restriction: Sendable, Equatable {
    case nominationsNotUsed
    case nominationsOnlyDuringSpeeches
    case nominationOnlyBySpeaker(current: Seat?)
    case notVoting
    case tieSpeechesFirst
    case ballotRequired
    case notNight
}

public enum BallotProblem: Sendable, Equatable {
    case voterNotAllowed(Seat)
    case notCandidate(Seat)
    case duplicateVoter(Seat)
    case duplicateCandidate(Seat)
    case negativeVotes
    case tooManyVotes
    case liftBallotExpected
    case regularBallotExpected
}

public enum BestMoveProblem: Sendable, Equatable {
    case seatCount(max: Int)
    case duplicateSeats
    case includesAuthor
}

// MARK: - Тексты для ведущего

extension GameError: LocalizedError {
    public var errorDescription: String? { message }

    public var message: String {
        switch self {
        case let .invalidSetup(problem): problem.message
        case let .accessDenied(problem): problem.message
        case let .notAllowedNow(restriction): restriction.message
        case let .invalidBallot(problem): "Голосование: \(problem.message)"
        case let .invalidBestMove(problem): "Лучший ход: \(problem.message)"
        case let .invalidProtocol(problem): "Протокол: \(problem.message)"
        case let .unknownSeat(seat): "За столом нет игрока №\(seat)"
        case let .seatNotAlive(seat): "Игрок №\(seat) уже выбыл"
        case .gameFinished: "Игра уже завершена"
        case .gameNotFinished: "Игра ещё не завершена"
        case let .alreadyNominated(seat): "Игрок №\(seat) уже выставил кандидатуру"
        case let .candidateAlreadyNominated(seat): "Игрок №\(seat) уже выставлен"
        case let .noNomination(seat): "Игрок №\(seat) никого не выставлял"
        case let .unexpectedNightInput(step): "Сейчас шаг «\(step.displayName)»"
        case let .cannotTargetSelf(seat): "Игрок №\(seat) не может выбрать себя"
        case let .doctorCannotRepeatTarget(seat): "Доктор не может лечить игрока №\(seat) две ночи подряд"
        case let .donCannotCheckShotTarget(seat): "В первую ночь отстрела дон не проверяет игрока №\(seat), в которого стреляли"
        case let .notRemoved(seat): "Игрок №\(seat) не удалён за фолы или дисквалификацию"
        case .bestMoveNotAvailable: "У этого игрока нет права на лучший ход"
        case let .nothingToCancel(seat): "У игрока №\(seat) нечего отменять"
        case .nothingToUndo: "Нечего отменять"
        case let .cannotReinstate(seat): "Игрока №\(seat) не вернуть: после удаления игра ушла дальше. Отмените шаги кнопкой «Назад»"
        }
    }
}

extension SetupProblem {
    public var message: String {
        switch self {
        case let .playerCount(variant, allowed):
            let count = allowed.lowerBound == allowed.upperBound
                ? "\(allowed.lowerBound)"
                : "от \(allowed.lowerBound) до \(allowed.upperBound)"
            return "\(variant.displayName): нужно \(count) игроков"
        case let .playersAndRolesMismatch(players, roles):
            return "Игроков (\(players)) и ролей (\(roles)) должно быть поровну"
        case .duplicatePlayer:
            return "Один игрок не может занимать два места"
        case let .duplicateUniqueRole(role):
            return "Роль «\(role.displayName)» может быть только у одного игрока"
        case let .tooManySpecialRoles(special, players):
            return "Особых ролей (\(special)) больше, чем игроков (\(players))"
        case .noBlackRoles:
            return "За столом должна быть хотя бы одна чёрная роль"
        case .tooManyBlackRoles:
            return "Чёрных ролей должно быть меньше, чем красных"
        case .sportComposition:
            return "В спортивной мафии: 1 дон, 2 мафии, 1 шериф, остальные — мирные"
        }
    }
}

extension AccessProblem {
    public var message: String {
        switch self {
        case let .formatRequiresGoMafia(format):
            "«\(format.displayName)» доступен после привязки аккаунта GoMafia. Без него — только фанки"
        case let .formatRequiresClub(format):
            "«\(format.displayName)» проводится от имени клуба: вступите в клуб в GoMafia"
        case let .goMafiaPlayersRequired(nicknames):
            "Игроки без аккаунта GoMafia: \(nicknames.joined(separator: ", ")). Их можно посадить только в фанку"
        }
    }
}

extension Restriction {
    public var message: String {
        switch self {
        case .nominationsNotUsed:
            "В этих правилах кандидатуры не выставляются — голосуют за всех живых"
        case .nominationsOnlyDuringSpeeches:
            "Кандидатуры выставляются только во время речей"
        case let .nominationOnlyBySpeaker(current):
            current.map { "Сейчас выставлять может только говорящий — игрок №\($0)" }
                ?? "Сейчас никто не говорит"
        case .notVoting:
            "Сейчас не идёт голосование"
        case .tieSpeechesFirst:
            "Сначала речи игроков, поделивших голоса"
        case .ballotRequired:
            "Сначала введите результаты голосования"
        case .notNight:
            "Ночные действия доступны только ночью"
        }
    }
}

extension BallotProblem {
    public var message: String {
        switch self {
        case let .voterNotAllowed(seat): "игрок №\(seat) не может голосовать"
        case let .notCandidate(seat): "игрок №\(seat) не кандидат"
        case let .duplicateVoter(seat): "игрок №\(seat) проголосовал дважды"
        case let .duplicateCandidate(seat): "кандидат №\(seat) указан дважды"
        case .negativeVotes: "количество голосов не может быть отрицательным"
        case .tooManyVotes: "голосов больше, чем живых игроков"
        case .liftBallotExpected: "сейчас голосование «поднять всех»"
        case .regularBallotExpected: "сейчас обычное голосование, а не «поднять всех»"
        }
    }
}

public enum ProtocolProblem: Sendable, Equatable {
    /// Протокол оставляет только выбывший игрок (убитый или заголосованный).
    case authorInGame
    case authorRemoved
    case includesAuthor
    case duplicateSeats
    case empty

    public var message: String {
        switch self {
        case .authorInGame: "его оставляет выбывший игрок после последней речи"
        case .authorRemoved: "удалённый игрок протокол не оставляет"
        case .includesAuthor: "себя назвать нельзя"
        case .duplicateSeats: "один номер назван дважды"
        case .empty: "не назван ни один игрок"
        }
    }
}

extension BestMoveProblem {
    public var message: String {
        switch self {
        case let .seatCount(max): "нужно от 1 до \(max) номеров"
        case .duplicateSeats: "номера не должны повторяться"
        case .includesAuthor: "нельзя указать свой номер"
        }
    }
}
