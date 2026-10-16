/// День: нулевая ночь → прощальные речи → речи → доп. шаги → решение о голосовании → сумерки.
extension Transition {
    mutating func advanceNightZero(from step: Int) {
        let next = step + 1
        if next < rules.nightZero.count {
            state.phase = .nightZero(step: next)
            emit(.stepStarted(rules.nightZero[next].kind))
        } else {
            beginDay(afterNightVictims: [])
        }
    }

    mutating func advanceDay(_ stage: DayStage) throws(GameError) {
        switch stage {
        case let .farewell(queue):
            advanceFarewell(queue)
        case let .speeches(round):
            moveToSpeaker(in: round, from: round.index + 1)
        case let .extra(step):
            enterExtraStep(from: step + 1)
        case let .voting(session):
            try advanceVoting(session)
        case .dusk:
            beginNight()
        }
    }

    mutating func beginDay(afterNightVictims victims: [Seat]) {
        state.dayNumber += 1
        state.nominations = []
        state.isVotingCancelledToday = false
        emit(.dayStarted(state.dayNumber), moment: .day(state.dayNumber))
        startFarewell(victims, context: .afterNight)
    }

    // MARK: Прощальные речи

    mutating func startFarewell(_ seats: [Seat], context: FarewellContext) {
        guard rules.timing.farewellSeconds > 0, let first = seats.first else {
            finishFarewell(context)
            return
        }
        state.phase = .day(.farewell(FarewellQueue(seats: seats, index: 0, context: context)))
        emit(.farewell(first))
    }

    private mutating func advanceFarewell(_ queue: FarewellQueue) {
        var updated = queue
        updated.index += 1
        guard let next = updated.current else {
            finishFarewell(queue.context)
            return
        }
        state.phase = .day(.farewell(updated))
        emit(.farewell(next))
    }

    private mutating func finishFarewell(_ context: FarewellContext) {
        switch context {
        case .afterNight: startSpeeches()
        case .afterVoting: enterDusk()
        }
    }

    mutating func enterDusk() {
        state.phase = .day(.dusk)
        emit(.dayEnded(state.dayNumber))
    }

    // MARK: Речи

    /// Первый день открывает первый живой номер, каждый следующий — следующий живой после открывавшего вчера.
    private func nextOpener() -> Seat? {
        let alive = state.aliveSeats
        guard let previous = state.dayOpener else { return alive.first }
        return alive.first { $0 > previous } ?? alive.first
    }

    private mutating func startSpeeches() {
        guard let opener = nextOpener() else { return }
        state.dayOpener = opener
        state.isOpenerSilencedToday = false
        let round = SpeechRound(order: state.aliveSeats(rotatedFrom: opener), index: 0)
        moveToSpeaker(in: round, from: 0)
    }

    /// Переходит к следующему игроку, который может говорить. Лишённые слова пропускают речь.
    mutating func moveToSpeaker(in round: SpeechRound, from start: Int) {
        for index in start..<max(start, round.order.count) {
            let seat = round.order[index]
            guard let seatIndex = state.seats.firstIndex(where: { $0.seat == seat }),
                  state.seats[seatIndex].isAlive
            else { continue }

            if state.seats[seatIndex].missesNextSpeech {
                state.seats[seatIndex].missesNextSpeech = false
                if seat == state.dayOpener { state.isOpenerSilencedToday = true }
                emit(.speechSkipped(seat))
                continue
            }
            var updated = round
            updated.index = index
            state.phase = .day(.speeches(updated))
            emit(.speech(seat))
            return
        }
        enterExtraStep(from: 0)
    }

    // MARK: Дополнительные шаги (добор, общая минута)

    mutating func enterExtraStep(from start: Int) {
        let steps = rules.day.extraSteps(forDay: state.dayNumber)
        for index in start..<max(start, steps.count) where isSpeakerAvailable(for: steps[index]) {
            state.phase = .day(.extra(step: index))
            emit(.stepStarted(steps[index].kind))
            return
        }
        concludeDiscussion()
    }

    /// Добор положен открывавшему день, только если он жив и не был лишён слова.
    private func isSpeakerAvailable(for step: TimedStep) -> Bool {
        guard step.kind.isOpenerSpeech else { return true }
        guard let opener = state.dayOpener else { return false }
        return state.isAlive(opener) && !state.isOpenerSilencedToday
    }

    // MARK: Номинации

    mutating func nominate(_ candidate: Seat, by nominator: Seat) throws(GameError) {
        guard rules.day.candidateSource == .nominations else {
            throw .notAllowedNow(.nominationsNotUsed)
        }
        guard case let .day(.speeches(round)) = state.phase else {
            throw .notAllowedNow(.nominationsOnlyDuringSpeeches)
        }
        if rules.day.nominationsOnlyBySpeaker, round.current != nominator {
            throw .notAllowedNow(.nominationOnlyBySpeaker(current: round.current))
        }
        _ = try aliveIndex(of: nominator)
        _ = try aliveIndex(of: candidate)
        guard !state.nominations.contains(where: { $0.by == nominator }) else {
            throw .alreadyNominated(by: nominator)
        }
        guard !state.nominations.contains(where: { $0.candidate == candidate }) else {
            throw .candidateAlreadyNominated(candidate)
        }
        state.nominations.append(Nomination(candidate: candidate, by: nominator))
        emit(.nominated(candidate: candidate, by: nominator))
    }

    /// Исправление ошибки ведущего: снять кандидатуру, выставленную игроком.
    mutating func withdrawNomination(by nominator: Seat) throws(GameError) {
        guard case .day(.speeches) = state.phase else {
            throw .notAllowedNow(.nominationsOnlyDuringSpeeches)
        }
        guard let index = state.nominations.firstIndex(where: { $0.by == nominator }) else {
            throw .noNomination(by: nominator)
        }
        let nomination = state.nominations.remove(at: index)
        emit(.nominationWithdrawn(candidate: nomination.candidate, by: nominator))
    }

    // MARK: Решение о голосовании

    private mutating func concludeDiscussion() {
        let day = rules.day
        if state.isVotingCancelledToday {
            skipVoting(.cancelledByRemoval)
            return
        }
        guard state.dayNumber >= day.firstVotingDay else {
            skipVoting(.notHeldOnThisDay)
            return
        }

        let candidates = switch day.candidateSource {
        case .nominations: state.nominations.map(\.candidate).filter { state.isAlive($0) }
        case .allAlive: state.aliveSeats
        }

        switch candidates.count {
        case 0:
            skipVoting(.noCandidates)
        case 1 where state.dayNumber == 1 && day.skipSingleCandidateOnFirstDay:
            skipVoting(.singleCandidateOnFirstDay, nominees: candidates)
        case 1 where day.singleCandidateLeavesWithoutVote:
            completeVoting(VotingRecord(
                day: state.dayNumber, nominees: candidates, rounds: [],
                eliminated: candidates, skipReason: nil, isAutomatic: true
            ))
        default:
            startVoting(candidates)
        }
    }

    private mutating func skipVoting(_ reason: VotingSkipReason, nominees: [Seat] = []) {
        completeVoting(VotingRecord(
            day: state.dayNumber, nominees: nominees, rounds: [],
            eliminated: [], skipReason: reason, isAutomatic: false
        ))
    }
}
