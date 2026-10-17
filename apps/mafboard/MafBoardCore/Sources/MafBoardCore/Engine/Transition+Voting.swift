/// Голосование: основной круг → деление (речи по 30 секунд + переголосование) → подъём.
extension Transition {
    mutating func startVoting(_ candidates: [Seat]) {
        let session = VotingSession(nominees: candidates, candidates: candidates, stage: .ballot(.main), rounds: [])
        state.phase = .day(.voting(session))
        emit(.votingStarted(candidates: candidates))
    }

    mutating func submit(_ ballot: Ballot) throws(GameError) {
        guard case let .day(.voting(session)) = state.phase else {
            throw .notAllowedNow(.notVoting)
        }
        let voters = state.aliveSeats
        switch session.stage {
        case .tieSpeeches:
            throw .notAllowedNow(.tieSpeechesFirst)
        case let .ballot(kind):
            let round = try VoteTally.tally(ballot, kind: kind, candidates: session.candidates, voters: voters, policy: rules.voting)
            resolve(round, in: session)
        case .liftBallot:
            let round = try VoteTally.tallyLift(ballot, candidates: session.candidates, voters: voters)
            var updated = session
            updated.rounds.append(round)
            emit(.votingRound(round))
            let passes = (round.liftVotes ?? 0) * 2 > voters.count
            finishVoting(updated, eliminated: passes ? session.candidates : [])
        }
    }

    mutating func advanceVoting(_ session: VotingSession) throws(GameError) {
        guard case let .tieSpeeches(index) = session.stage else {
            throw .notAllowedNow(.ballotRequired)
        }
        var updated = session
        let next = index + 1
        if next < updated.candidates.count {
            updated.stage = .tieSpeeches(index: next)
            state.phase = .day(.voting(updated))
            emit(.tieSpeech(updated.candidates[next]))
        } else {
            updated.stage = .ballot(.revote)
            state.phase = .day(.voting(updated))
        }
    }

    /// Итог голосования: выбывшие покидают стол, затем прощальные речи или сумерки.
    mutating func completeVoting(_ record: VotingRecord) {
        let isFullTable = state.aliveSeats.count == state.seats.count
        state.votings.append(record)
        emit(.votingFinished(record))
        for seat in record.eliminated {
            eliminate(seat, cause: .votedOut)
        }
        if concludeIfGameOver() { return }
        // «Слом» при десяти: выбывший получает лучший ход перед заключительной минутой (ФСМ 7.13).
        if isFullTable, rules.bestMove.isEnabled, rules.bestMove.grantsFullTableVoteOut == true,
           record.eliminated.count == 1, let seat = record.eliminated.first {
            grantBestMove(to: seat)
        }
        if record.eliminated.isEmpty {
            enterDusk()
        } else {
            startFarewell(record.eliminated, context: .afterVoting)
        }
    }

    /// Убирает выбывшего игрока из текущего голосования (если оно не отменяется).
    mutating func dropCandidate(_ seat: Seat, from session: VotingSession) {
        guard let position = session.candidates.firstIndex(of: seat) else { return }
        var updated = session
        updated.candidates.remove(at: position)
        guard !updated.candidates.isEmpty else {
            finishVoting(updated, eliminated: [])
            return
        }
        if case let .tieSpeeches(index) = updated.stage {
            let shifted = position < index ? index - 1 : index
            updated.stage = shifted < updated.candidates.count ? .tieSpeeches(index: shifted) : .ballot(.revote)
        }
        state.phase = .day(.voting(updated))
    }

    mutating func abortVoting(_ session: VotingSession) {
        completeVoting(VotingRecord(
            day: state.dayNumber, nominees: session.nominees, rounds: session.rounds,
            eliminated: [], skipReason: .cancelledByRemoval, isAutomatic: false
        ))
    }

    // MARK: Разбор круга

    private mutating func resolve(_ round: VotingRound, in session: VotingSession) {
        var updated = session
        updated.rounds.append(round)
        emit(.votingRound(round))

        let leaders = round.leaders
        guard leaders.count > 1 else {
            finishVoting(updated, eliminated: leaders)
            return
        }
        // В первый день деление на троих и больше не переголосовывается — сразу ночь (ФСМ 4.5.10).
        if round.kind == .main, state.dayNumber == 1, let maxTie = rules.voting.firstDayMaxTie, leaders.count > maxTie {
            emit(.tie(candidates: leaders))
            finishVoting(updated, eliminated: [])
            return
        }
        let tieShrank = leaders.count < session.candidates.count && rules.voting.revoteWhenTieShrinks
        if round.kind == .main || tieShrank {
            startTie(updated, leaders: leaders)
        } else {
            resolveRepeatedTie(updated, leaders: leaders)
        }
    }

    private mutating func startTie(_ session: VotingSession, leaders: [Seat]) {
        var updated = session
        updated.candidates = leaders
        emit(.tie(candidates: leaders))
        if rules.timing.tieSpeechSeconds > 0 {
            updated.stage = .tieSpeeches(index: 0)
            state.phase = .day(.voting(updated))
            emit(.tieSpeech(leaders[0]))
        } else {
            updated.stage = .ballot(.revote)
            state.phase = .day(.voting(updated))
        }
    }

    private mutating func resolveRepeatedTie(_ session: VotingSession, leaders: [Seat]) {
        switch rules.voting.onRepeatedTie {
        case .liftVote:
            let sheriffKilledFirst = state.firstKilled.flatMap { state.seat($0)?.role } == .sheriff
            guard rules.voting.allowsLift(tied: leaders.count, alive: state.aliveSeats.count, sheriffKilledFirst: sheriffKilledFirst) else {
                // Деление, при котором подъём запрещён: все остаются за столом.
                finishVoting(session, eliminated: [])
                return
            }
            var updated = session
            updated.candidates = leaders
            updated.stage = .liftBallot
            state.phase = .day(.voting(updated))
            emit(.liftVoteStarted(candidates: leaders))
        case .nobodyLeaves:
            finishVoting(session, eliminated: [])
        case .everybodyLeaves:
            finishVoting(session, eliminated: leaders)
        }
    }

    private mutating func finishVoting(_ session: VotingSession, eliminated: [Seat]) {
        completeVoting(VotingRecord(
            day: state.dayNumber, nominees: session.nominees, rounds: session.rounds,
            eliminated: eliminated, skipReason: nil, isAutomatic: false
        ))
    }
}

/// Подсчёт голосов одного круга. Только проверка и арифметика — без переходов фаз.
enum VoteTally {
    static func tally(
        _ ballot: Ballot,
        kind: VotingRoundKind,
        candidates: [Seat],
        voters: [Seat],
        policy: VotingPolicy
    ) throws(GameError) -> VotingRound {
        switch ballot {
        case let .perVoter(votes):
            return try tallyPerVoter(votes, kind: kind, candidates: candidates, voters: voters, policy: policy)
        case let .handCount(counts):
            return try tallyHandCount(counts, kind: kind, candidates: candidates, voters: voters)
        case .lift, .liftCount:
            throw .invalidBallot(.regularBallotExpected)
        }
    }

    static func tallyLift(_ ballot: Ballot, candidates: [Seat], voters: [Seat]) throws(GameError) -> VotingRound {
        switch ballot {
        case let .lift(liftVoters):
            try validate(voters: liftVoters, allowed: voters)
            return VotingRound(
                kind: .lift, candidates: candidates, results: [], autoAssignedVoters: [],
                liftVotes: liftVoters.count, liftVoters: liftVoters.sorted()
            )
        case let .liftCount(count):
            guard (0...voters.count).contains(count) else {
                throw .invalidBallot(.tooManyVotes)
            }
            return VotingRound(
                kind: .lift, candidates: candidates, results: [], autoAssignedVoters: [],
                liftVotes: count, liftVoters: nil
            )
        case .perVoter, .handCount:
            throw .invalidBallot(.liftBallotExpected)
        }
    }

    private static func tallyPerVoter(
        _ votes: [Vote],
        kind: VotingRoundKind,
        candidates: [Seat],
        voters: [Seat],
        policy: VotingPolicy
    ) throws(GameError) -> VotingRound {
        try validate(voters: votes.map(\.voter), allowed: voters)
        if let stranger = votes.first(where: { !candidates.contains($0.candidate) }) {
            throw .invalidBallot(.notCandidate(stranger.candidate))
        }

        let voted = Set(votes.map(\.voter))
        let abstainers = policy.abstainersVoteForLastCandidate ? voters.filter { !voted.contains($0) } : []
        let autoVotes = candidates.last.map { last in abstainers.map { Vote($0, for: last) } } ?? []
        let allVotes = votes + autoVotes

        let results = candidates.map { candidate in
            let candidateVoters = allVotes.filter { $0.candidate == candidate }.map(\.voter).sorted()
            return CandidateResult(candidate: candidate, votes: candidateVoters.count, voters: candidateVoters)
        }
        return VotingRound(
            kind: kind, candidates: candidates, results: results,
            autoAssignedVoters: autoVotes.map(\.voter), liftVotes: nil, liftVoters: nil
        )
    }

    private static func tallyHandCount(
        _ counts: [CandidateVotes],
        kind: VotingRoundKind,
        candidates: [Seat],
        voters: [Seat]
    ) throws(GameError) -> VotingRound {
        if let stranger = counts.first(where: { !candidates.contains($0.candidate) }) {
            throw .invalidBallot(.notCandidate(stranger.candidate))
        }
        if let duplicate = firstDuplicate(in: counts.map(\.candidate)) {
            throw .invalidBallot(.duplicateCandidate(duplicate))
        }
        guard counts.allSatisfy({ $0.votes >= 0 }) else {
            throw .invalidBallot(.negativeVotes)
        }
        guard counts.reduce(0, { $0 + $1.votes }) <= voters.count else {
            throw .invalidBallot(.tooManyVotes)
        }
        let results = candidates.map { candidate in
            CandidateResult(
                candidate: candidate,
                votes: counts.first { $0.candidate == candidate }?.votes ?? 0,
                voters: nil
            )
        }
        return VotingRound(
            kind: kind, candidates: candidates, results: results,
            autoAssignedVoters: [], liftVotes: nil, liftVoters: nil
        )
    }

    private static func validate(voters: [Seat], allowed: [Seat]) throws(GameError) {
        if let stranger = voters.first(where: { !allowed.contains($0) }) {
            throw .invalidBallot(.voterNotAllowed(stranger))
        }
        if let duplicate = firstDuplicate(in: voters) {
            throw .invalidBallot(.duplicateVoter(duplicate))
        }
    }

    private static func firstDuplicate(in seats: [Seat]) -> Seat? {
        var seen = Set<Seat>()
        return seats.first { !seen.insert($0).inserted }
    }
}
