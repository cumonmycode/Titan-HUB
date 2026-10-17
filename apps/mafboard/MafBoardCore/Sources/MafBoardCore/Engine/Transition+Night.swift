/// Ночь: шаги по очереди из `NightPolicy.steps`, в конце — разбор выстрелов и лечения.
extension Transition {
    mutating func beginNight() {
        state.nightNumber += 1
        state.nominations = []
        let steps = rules.night.steps.filter(isStepAvailable)
        let progress = NightProgress(number: state.nightNumber, steps: steps, index: 0, actions: NightActions())
        state.phase = .night(progress)
        emit(.nightStarted(state.nightNumber))
        if let first = steps.first {
            emit(.nightStep(first))
        } else {
            resolveNight(progress)
        }
    }

    private func isStepAvailable(_ step: NightStep) -> Bool {
        state.seats.contains { $0.isAlive && step.isPerformed(by: $0.role) }
    }

    mutating func handleNight(_ input: NightInput) throws(GameError) {
        guard case let .night(progress) = state.phase, let step = progress.currentStep else {
            throw .notAllowedNow(.notNight)
        }
        var updated = progress

        switch (step, input) {
        case (_, .skip):
            emit(.nightStepSkipped(step))
        case let (.mafiaShot, .shot(target)), let (.maniacShot, .shot(target)):
            let shot = try shotTarget(target)
            if step == .mafiaShot {
                updated.actions.mafiaShot = shot
            } else {
                updated.actions.maniacShot = shot
            }
            emit(.shot(step.killer ?? .mafia, shot))
        case let (.donCheck, .check(target)), let (.sheriffCheck, .check(target)):
            if step == .donCheck, progress.number == 1, rules.night.donCannotCheckFirstShotTarget == true,
               progress.actions.mafiaShot?.seat == target {
                throw .donCannotCheckShotTarget(target)
            }
            let check = try performCheck(step, target: target)
            updated.actions.checks.append(check)
            emit(.check(check))
        case let (.doctorHeal, .heal(target)):
            try validateHeal(target)
            updated.actions.heal = target
            emit(.heal(target))
        default:
            throw .unexpectedNightInput(step)
        }

        updated.index += 1
        moveToAvailableStep(updated, isNewStep: true)
    }

    /// Переходит к ближайшему шагу, у которого остался живой исполнитель
    /// (исполнителя могли удалить посреди ночи). Если шагов не осталось — разбор ночи.
    /// - Parameter isNewStep: текущий шаг только что начался и о нём нужно объявить.
    mutating func moveToAvailableStep(_ progress: NightProgress, isNewStep: Bool) {
        var updated = progress
        var announces = isNewStep
        while let step = updated.currentStep, !isStepAvailable(step) {
            emit(.nightStepSkipped(step))
            updated.index += 1
            announces = true
        }
        guard let next = updated.currentStep else {
            resolveNight(updated)
            return
        }
        state.phase = .night(updated)
        if announces { emit(.nightStep(next)) }
    }

    // MARK: Проверки ввода

    private func shotTarget(_ target: Seat?) throws(GameError) -> ShotTarget {
        guard let target else { return .miss }
        _ = try aliveIndex(of: target)
        return .seat(target)
    }

    private func performCheck(_ step: NightStep, target: Seat) throws(GameError) -> NightCheck {
        let checkerRole: Role = step == .donCheck ? .don : .sheriff
        guard let checker = state.seats.first(where: { $0.isAlive && $0.role == checkerRole }) else {
            throw .unexpectedNightInput(step)
        }
        let targetIndex = try aliveIndex(of: target)
        guard target != checker.seat else { throw .cannotTargetSelf(target) }

        let targetRole = state.seats[targetIndex].role
        let isPositive = step == .donCheck ? targetRole == .sheriff : targetRole.team == .black
        return NightCheck(checker: checkerRole, by: checker.seat, target: target, isPositive: isPositive)
    }

    private func validateHeal(_ target: Seat) throws(GameError) {
        _ = try aliveIndex(of: target)
        if !rules.night.doctorMayRepeatTarget, target == state.doctorLastTarget {
            throw .doctorCannotRepeatTarget(target)
        }
    }

    // MARK: Итог ночи

    private mutating func resolveNight(_ progress: NightProgress) {
        let actions = progress.actions
        let shots: [(Killer, Seat)] = [
            actions.mafiaShot?.seat.map { (Killer.mafia, $0) },
            actions.maniacShot?.seat.map { (Killer.maniac, $0) },
        ].compactMap { $0 }

        var victims: [NightVictim] = []
        var saved: [Seat] = []
        // Цель могла выбыть посреди ночи (удаление) — такой выстрел уже ни на что не влияет.
        let liveShots = shots.filter { state.isAlive($0.1) }
        for (killer, target) in liveShots where !saved.contains(target) && !victims.contains(where: { $0.seat == target }) {
            if actions.heal == target || isImmuneAtNight(target) {
                saved.append(target)
            } else {
                victims.append(NightVictim(seat: target, killer: killer))
            }
        }

        state.doctorLastTarget = actions.heal
        let report = NightReport(number: progress.number, actions: actions, victims: victims, saved: saved)
        state.nights.append(report)
        emit(.nightResolved(report))
        for victim in victims {
            eliminate(victim.seat, cause: .killed(by: victim.killer))
        }
        grantBestMoveIfEligible(report)

        if concludeIfGameOver() { return }
        if let quiet = rules.night.drawAfterQuietNights, isTableUnchanged(sinceNight: progress.number - quiet + 1) {
            finish(with: GameOutcome(winner: .draw, reason: .quietNights(quiet)))
            return
        }
        beginDay(afterNightVictims: victims.map(\.seat))
    }

    /// С начала ночи `first` по сей момент никто не покинул стол.
    private func isTableUnchanged(sinceNight first: Int) -> Bool {
        guard first >= 1,
              let start = state.events.lastIndex(where: { $0.kind == .nightStarted(first) })
        else { return false }
        return !state.events[start...].contains { event in
            if case .eliminated = event.kind { true } else { false }
        }
    }

    private func isImmuneAtNight(_ seat: Seat) -> Bool {
        guard let role = state.seat(seat)?.role else { return false }
        return rules.night.immuneToNightKill.contains(role)
    }

    private mutating func grantBestMoveIfEligible(_ report: NightReport) {
        let policy = rules.bestMove
        guard policy.isEnabled, let victim = report.victims.first(where: { $0.killer == .mafia }) else { return }

        switch policy.eligibility {
        case .firstNightVictim:
            guard report.number == 1 else { return }
            // Если в первый день ушли двое и больше (подъём), у ПУ лучшего хода нет (ФСМ 7.10).
            if let limit = policy.firstDayLeaversCancellingBestMove {
                let leavers = state.votings.filter { $0.day == 1 }.reduce(0) { $0 + $1.eliminated.count }
                guard leavers < limit else { return }
            }
        case .firstNightKill:
            let earlierKills = state.nights.dropLast().contains { night in
                night.victims.contains { $0.killer == .mafia }
            }
            guard !earlierKills else { return }
        }
        grantBestMove(to: victim.seat)
    }
}
