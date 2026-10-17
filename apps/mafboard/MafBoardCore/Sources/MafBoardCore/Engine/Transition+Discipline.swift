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
            return
        }
        if let silence = policy.foulsToSilence, total == silence {
            state.seats[index].missesNextSpeech = true
            emit(.silenced(seat))
        }
        if let halve = policy.foulsToHalveSpeech, total == halve {
            state.seats[index].halvesNextSpeech = true
            emit(.speechHalved(seat))
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
        if let halve = rules.discipline.foulsToHalveSpeech, state.seats[index].fouls < halve {
            state.seats[index].halvesNextSpeech = false
        }
        emit(.foulCancelled(seat, total: state.seats[index].fouls))
    }

    mutating func addTechFoul(_ seat: Seat, kind: TechFoulKind) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        state.seats[index].techFoulKinds.append(kind)
        let total = state.seats[index].techFouls
        switch kind {
        case .ordinary: emit(.techFoul(seat, total: total))
        case .big: emit(.bigTechFoul(seat, total: total))
        }
        if let limit = rules.discipline.techFoulsToRemoval, total >= limit {
            try remove(seat, reason: .techFouls)
        }
    }

    mutating func cancelTechFoul(_ seat: Seat) throws(GameError) {
        try requireInProgress()
        let index = try aliveIndex(of: seat)
        guard state.seats[index].techFouls > 0 else { throw .nothingToCancel(seat) }
        state.seats[index].techFoulKinds.removeLast()
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

    /// Удаление «на критике» отмечается и после игры: судья решает это, когда видит весь расклад.
    mutating func markCriticalRemoval(_ seat: Seat, _ isCritical: Bool) throws(GameError) {
        let index = try index(of: seat)
        switch state.seats[index].elimination?.cause {
        case .removed(.fouls), .removed(.disqualified): break
        default: throw .notRemoved(seat)
        }
        state.seats[index].isCriticalRemoval = isCritical
        emit(.criticalRemovalMarked(seat, isCritical))
    }

    /// Вскрытие шерифом отмечается в любой момент, и во время игры, и после неё.
    mutating func markSheriffClaim(_ seat: Seat, _ claimed: Bool) throws(GameError) {
        let index = try index(of: seat)
        state.seats[index].claimedSheriff = claimed
        emit(.sheriffClaimMarked(seat, claimed))
    }

    /// ППК: команда нарушителя проигрывает. Нарушение возможно и в заключительную минуту (ФСМ 6.9.5).
    mutating func forfeit(_ seat: Seat, note: String?) throws(GameError) {
        try requireInProgress()
        let index = try index(of: seat)
        let winner: Winner = state.seats[index].team == .red ? .black : .red
        finish(with: GameOutcome(winner: winner, reason: .forfeit(by: seat, note: note)))
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
        // Удаление ночью или после итогов голосования отменяет ближайшее голосование — завтрашнее.
        let cancelsTomorrow = cancelsVoting && rules.voting.removalCancelsNextDayVoting == true

        switch state.phase {
        case .finished:
            return
        case .nightZero:
            if cancelsTomorrow { state.isNextDayVotingCancelled = true }
            return
        case let .night(progress):
            if cancelsTomorrow { state.isNextDayVotingCancelled = true }
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
            if cancelsTomorrow { state.isNextDayVotingCancelled = true }
        }
    }
}
