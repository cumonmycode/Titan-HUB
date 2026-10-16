/// Фолы, техфолы, предупреждения, дисквалификация и ручное выбывание.
extension Transition {
    mutating func addFoul(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        state.seats[index].fouls += 1
        let total = state.seats[index].fouls
        emit(.foul(seat, total: total))

        let policy = rules.discipline
        if let limit = policy.foulsToRemoval, total >= limit {
            try remove(seat, reason: .fouls)
        } else if let silence = policy.foulsToSilence, total == silence {
            state.seats[index].missesNextSpeech = true
            emit(.silenced(seat))
        }
    }

    /// Отмена ошибочного фола. Удаление этим не отменяется — для этого есть `GameSession.undo()`.
    mutating func cancelFoul(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        guard state.seats[index].fouls > 0 else { throw .nothingToCancel(seat) }
        state.seats[index].fouls -= 1
        if let silence = rules.discipline.foulsToSilence, state.seats[index].fouls < silence {
            state.seats[index].missesNextSpeech = false
        }
        emit(.foulCancelled(seat, total: state.seats[index].fouls))
    }

    mutating func addTechFoul(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        state.seats[index].techFouls += 1
        let total = state.seats[index].techFouls
        emit(.techFoul(seat, total: total))
        if let limit = rules.discipline.techFoulsToRemoval, total >= limit {
            try remove(seat, reason: .techFouls)
        }
    }

    mutating func cancelTechFoul(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        guard state.seats[index].techFouls > 0 else { throw .nothingToCancel(seat) }
        state.seats[index].techFouls -= 1
        emit(.techFoulCancelled(seat, total: state.seats[index].techFouls))
    }

    mutating func addWarning(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        state.seats[index].warnings += 1
        let total = state.seats[index].warnings
        emit(.warning(seat, total: total))
        if let perFoul = rules.discipline.warningsPerFoul, perFoul > 0, total.isMultiple(of: perFoul) {
            try addFoul(seat)
        }
    }

    /// Удаление за нарушения: игрок выбывает, днём голосование может отмениться.
    mutating func remove(_ seat: Seat, reason: RemovalReason) throws(GameError) {
        try requireInProgress()
        _ = try aliveIndex(of: seat)
        eliminate(seat, cause: .removed(reason))
        if concludeIfGameOver() { return }
        applyConsequences(ofLeaving: seat, cancelsVoting: rules.voting.cancelOnDayRemoval)
    }

    mutating func eliminateByHost(_ seat: Seat, note: String?) throws(GameError) {
        try requireInProgress()
        _ = try aliveIndex(of: seat)
        eliminate(seat, cause: .hostDecision(note: note))
        if concludeIfGameOver() { return }
        applyConsequences(ofLeaving: seat, cancelsVoting: false)
    }

    /// Игрок выбыл посреди фазы: убираем его из кандидатур, передаём слово дальше,
    /// пропускаем его ночной шаг и при необходимости отменяем голосование дня.
    private mutating func applyConsequences(ofLeaving seat: Seat, cancelsVoting: Bool) {
        state.nominations.removeAll { $0.candidate == seat }

        switch state.phase {
        case .nightZero, .finished:
            return
        case let .night(progress):
            moveToAvailableStep(progress, isNewStep: false)
            return
        case .day:
            break
        }
        guard case let .day(stage) = state.phase else { return }

        switch stage {
        case let .speeches(round):
            if cancelsVoting { state.isVotingCancelledToday = true }
            if round.current == seat {
                moveToSpeaker(in: round, from: round.index + 1)
            }
        case let .extra(step):
            if cancelsVoting { state.isVotingCancelledToday = true }
            let steps = rules.day.extraSteps(forDay: state.dayNumber)
            if steps.indices.contains(step), steps[step].kind.isOpenerSpeech, state.dayOpener == seat {
                enterExtraStep(from: step + 1)
            }
        case let .farewell(queue) where queue.context == .afterNight:
            if cancelsVoting { state.isVotingCancelledToday = true }
        case let .voting(session):
            if cancelsVoting {
                state.isVotingCancelledToday = true
                abortVoting(session)
            } else {
                dropCandidate(seat, from: session)
            }
        case .farewell, .dusk:
            break
        }
    }
}
