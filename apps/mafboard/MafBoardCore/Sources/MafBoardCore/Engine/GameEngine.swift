import Foundation

/// Игровой движок: чистая функция `(состояние, действие) -> новое состояние`.
/// Не хранит данных, не работает с таймерами и сетью — только правила.
public enum GameEngine {
    /// Начало игры: нулевая ночь (или сразу первый день, если шагов нулевой ночи нет).
    public static func start(_ setup: GameSetup) -> GameState {
        var transition = Transition(state: GameState(setup: setup), date: setup.createdAt)
        transition.begin()
        return transition.state
    }

    /// Применяет действие ведущего. При ошибке исходное состояние остаётся прежним.
    /// Дата обязательна: движок не читает часы сам, иначе переигрывание журнала не было бы детерминированным.
    public static func apply(_ action: GameAction, to state: GameState, at date: Date) throws(GameError) -> GameState {
        var transition = Transition(state: state, date: date)
        try transition.perform(action)
        return transition.state
    }
}

/// Изменяемый контекст одного перехода. Живёт только внутри `GameEngine`,
/// наружу всегда уходит новое значение `GameState`.
struct Transition {
    var state: GameState
    let date: Date

    var rules: Ruleset { state.setup.ruleset }

    mutating func emit(_ kind: GameEvent.Kind, moment: GameMoment? = nil) {
        state.events.append(GameEvent(date: date, moment: moment ?? state.moment, kind: kind))
    }

    // MARK: Проверки

    func index(of seat: Seat) throws(GameError) -> Int {
        guard let index = state.seats.firstIndex(where: { $0.seat == seat }) else {
            throw .unknownSeat(seat)
        }
        return index
    }

    func aliveIndex(of seat: Seat) throws(GameError) -> Int {
        let index = try index(of: seat)
        guard state.seats[index].isAlive else { throw .seatNotAlive(seat) }
        return index
    }

    func requireInProgress() throws(GameError) {
        if state.isFinished { throw .gameFinished }
    }

    // MARK: Диспетчер

    mutating func begin() {
        emit(.gameStarted)
        if let first = rules.nightZero.first {
            state.phase = .nightZero(step: 0)
            emit(.stepStarted(first.kind))
        } else {
            beginDay(afterNightVictims: [])
        }
    }

    mutating func perform(_ action: GameAction) throws(GameError) {
        let step = state.currentStep
        try dispatch(action)
        // Время, взятое за фолы, относится только к той речи, на которой его взяли.
        if state.currentStep != step { state.extraSeconds = nil }
    }

    private mutating func dispatch(_ action: GameAction) throws(GameError) {
        switch action {
        case .advance: try advance()
        case let .nominate(candidate, by): try nominate(candidate, by: by)
        case let .withdrawNomination(by): try withdrawNomination(by: by)
        case let .submitBallot(ballot): try submit(ballot)
        case let .night(input): try handleNight(input)
        case let .extraTime(seat): try takeExtraTime(seat)
        case let .foul(seat): try addFoul(seat)
        case let .cancelFoul(seat): try cancelFoul(seat)
        case let .techFoul(seat): try addTechFoul(seat, kind: .ordinary)
        case let .bigTechFoul(seat): try addTechFoul(seat, kind: .big)
        case let .cancelTechFoul(seat): try cancelTechFoul(seat)
        case let .warning(seat): try addWarning(seat)
        case let .disqualify(seat, note): try remove(seat, reason: .disqualified(note: note))
        case let .eliminateByHost(seat, note): try eliminateByHost(seat, note: note)
        case let .markCriticalRemoval(seat, isCritical): try markCriticalRemoval(seat, isCritical)
        case let .markSheriffClaim(seat, claimed): try markSheriffClaim(seat, claimed)
        case let .forfeit(seat, note): try forfeit(seat, note: note)
        case let .recordBestMove(seats):
            guard let author = state.bestMoveAuthor else { throw .bestMoveNotAvailable }
            try recordBestMove(seats, by: author)
        case let .recordBestMoveBy(author, seats): try recordBestMove(seats, by: author)
        case let .declareOutcome(winner, note): try declareOutcome(winner, note: note)
        case let .adjustScore(adjustment): try adjustScore(adjustment)
        case let .setScoreAdjustments(seat, adjustments): try setScoreAdjustments(adjustments, for: seat)
        case let .recordProtocol(proto): try recordProtocol(proto)
        }
    }

    mutating func advance() throws(GameError) {
        switch state.phase {
        case .finished:
            throw .gameFinished
        case let .nightZero(step):
            advanceNightZero(from: step)
        case .night:
            try handleNight(.skip)
        case let .day(stage):
            try advanceDay(stage)
        }
    }

    // MARK: Выбывание и конец игры

    mutating func eliminate(_ seat: Seat, cause: EliminationCause) {
        guard let index = state.seats.firstIndex(where: { $0.seat == seat }), state.seats[index].isAlive else {
            return
        }
        state.seats[index].elimination = Elimination(cause: cause, moment: state.moment)
        state.seats[index].missesNextSpeech = false
        emit(.eliminated(seat, cause))
    }

    /// Проверяет условия победы. Возвращает `true`, если игра закончилась.
    mutating func concludeIfGameOver() -> Bool {
        guard let outcome = WinEvaluator.evaluate(state.seats) else { return false }
        finish(with: outcome)
        return true
    }

    mutating func finish(with outcome: GameOutcome) {
        state.outcome = outcome
        emit(.gameFinished(outcome))
        state.phase = .finished
    }

    /// Ручной итог (ничья по регламенту и т.п.). Исправить уже объявленный итог можно только отменой (`GameSession.undo`).
    mutating func declareOutcome(_ winner: Winner, note: String?) throws(GameError) {
        try requireInProgress()
        finish(with: GameOutcome(winner: winner, reason: .declaredByHost(note: note)))
    }

    // MARK: Итоги

    mutating func recordProtocol(_ proto: ColorProtocol) throws(GameError) {
        let author = try index(of: proto.author)
        switch state.seats[author].elimination?.cause {
        case nil: throw .invalidProtocol(.authorInGame)
        case .removed: throw .invalidProtocol(.authorRemoved)
        default: break
        }
        let named = proto.blacks + proto.reds + (proto.version.map { [$0.sheriff] } ?? [])
        guard !named.isEmpty else { throw .invalidProtocol(.empty) }
        guard !named.contains(proto.author) else { throw .invalidProtocol(.includesAuthor) }
        guard Set(named).count == named.count else { throw .invalidProtocol(.duplicateSeats) }
        for seat in named {
            _ = try index(of: seat)
        }
        state.protocols.removeAll { $0.author == proto.author }
        state.protocols.append(proto)
        emit(.protocolRecorded(proto))
        // Протокол оставлен — игрок покидает стол, слово следующему.
        if case let .day(.farewell(queue)) = state.phase, queue.stage == .colorProtocol, queue.current == proto.author {
            moveToNextFarewell(queue)
        }
    }

    mutating func recordBestMove(_ seats: [Seat], by author: Seat) throws(GameError) {
        guard state.bestMoveAuthors.contains(author) else { throw .bestMoveNotAvailable }
        let maxSeats = rules.bestMove.maxSeats(playerCount: state.seats.count)
        guard (1...max(1, maxSeats)).contains(seats.count) else {
            throw .invalidBestMove(.seatCount(max: maxSeats))
        }
        guard Set(seats).count == seats.count else { throw .invalidBestMove(.duplicateSeats) }
        for seat in seats {
            _ = try index(of: seat)
        }
        let move = BestMove(author: author, seats: seats.sorted())
        state.bestMoves.removeAll { $0.author == author }
        state.bestMoves.append(move)
        emit(.bestMove(move))
        // Лучший ход назван — начинается заключительная речь.
        if case let .day(.farewell(queue)) = state.phase, queue.stage == .bestMove, queue.current == author {
            startFarewellSpeech(queue)
        }
    }

    /// Право лучшего хода: ведущий запишет его перед заключительной речью игрока.
    mutating func grantBestMove(to seat: Seat) {
        guard !state.bestMoveAuthors.contains(seat) else { return }
        state.bestMoveAuthors.append(seat)
        emit(.bestMoveAvailable(seat))
    }

    mutating func adjustScore(_ adjustment: ScoreAdjustment) throws(GameError) {
        _ = try index(of: adjustment.seat)
        state.scoreAdjustments.append(adjustment)
        emit(.scoreAdjusted(adjustment))
    }

    mutating func setScoreAdjustments(_ adjustments: [ScoreAdjustment], for seat: Seat) throws(GameError) {
        _ = try index(of: seat)
        if let stranger = adjustments.first(where: { $0.seat != seat }) { throw .unknownSeat(stranger.seat) }
        state.scoreAdjustments.removeAll { $0.seat == seat }
        state.scoreAdjustments.append(contentsOf: adjustments.filter { $0.points != .zero })
        emit(.scoreAdjustmentsSet(seat, adjustments))
    }
}

/// Условия победы: мирные — когда не осталось чёрных; мафия — когда чёрных не меньше, чем красных.
enum WinEvaluator {
    static func evaluate(_ seats: [SeatState]) -> GameOutcome? {
        let alive = seats.filter(\.isAlive)
        let black = alive.filter { $0.team == .black }.count
        let red = alive.count - black
        if black == 0 {
            return GameOutcome(winner: .red, reason: .allBlackEliminated)
        }
        if black >= red {
            return GameOutcome(winner: .black, reason: .blackReachedParity)
        }
        return nil
    }
}
