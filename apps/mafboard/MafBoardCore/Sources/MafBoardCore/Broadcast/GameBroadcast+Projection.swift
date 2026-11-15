import Foundation

/// Что про игру знает экран ведущего, но не движок: таймер, название, номер в серии, следующий состав.
public struct GameBroadcastContext: Sendable, Equatable {
    public var countdown: Countdown?
    public var title: String?
    public var gameNumber: Int?
    public var gamesTotal: Int?
    /// Баллы окончательные — показывать таблицу итогов.
    public var scoresFinal: Bool
    public var nextLineup: [GameBroadcast.LineupEntry]

    public init(
        countdown: Countdown? = nil, title: String? = nil, gameNumber: Int? = nil, gamesTotal: Int? = nil,
        scoresFinal: Bool = true, nextLineup: [GameBroadcast.LineupEntry] = []
    ) {
        self.countdown = countdown
        self.title = title
        self.gameNumber = gameNumber
        self.gamesTotal = gamesTotal
        self.scoresFinal = scoresFinal
        self.nextLineup = nextLineup
    }
}

extension GameBroadcast {
    /// Лимиты ноутбука: длиннее он не примет весь снимок, поэтому обрезаем здесь.
    static let maxTextLength = 80
    static let maxURLLength = 512
    static let maxTimerSeconds = 60 * 60

    /// Снимок игры для зрителей на момент `date`.
    public init(
        session: GameSession,
        players profiles: [PlayerProfile],
        context: GameBroadcastContext = GameBroadcastContext(),
        revision: UInt64,
        at date: Date
    ) {
        let state = session.state
        let scores = state.isFinished ? (try? GameRecord(session: session)).map { GameScorer.score($0) } : nil
        self.init(
            gameId: session.setup.gameID.description,
            revision: revision,
            title: context.title.map(Self.clipped),
            gameNumber: context.gameNumber,
            gamesTotal: context.gamesTotal,
            phase: Self.phase(of: state),
            players: state.seats.map { Self.player($0, profiles: profiles) },
            speech: Self.speech(in: state, countdown: context.countdown, at: date),
            nominations: state.nominations.map { Nomination(candidate: $0.candidate.number, by: $0.by.number) },
            voting: Self.voting(in: state),
            nights: Self.nights(in: state),
            days: Self.days(in: state),
            bestMove: Self.bestMove(in: state, scores: scores),
            outcome: Self.outcome(in: state, scores: scores, isFinal: context.scoresFinal),
            nextLineup: context.nextLineup
        )
    }

    // MARK: Игроки

    static func player(_ seat: SeatState, profiles: [PlayerProfile]) -> Player {
        let profile = profiles.first { $0.id == seat.playerID }
        return Player(
            seat: seat.seat.number,
            nickname: clipped(profile?.nickname ?? "Игрок \(seat.seat)"),
            avatarUrl: avatar(profile?.avatarURL),
            role: seat.role.rawValue,
            roleName: seat.role.displayName,
            team: seat.team,
            status: status(of: seat),
            fouls: seat.fouls,
            techFouls: seat.techFouls,
            bigTechFouls: seat.bigTechFouls,
            silenced: seat.missesNextSpeech
        )
    }

    static func status(of seat: SeatState) -> PlayerStatus {
        switch seat.elimination?.cause {
        case nil: .alive
        case .killed: .killed
        case .votedOut: .votedOut
        case .removed, .hostDecision: .removed
        }
    }

    /// Ноутбук берёт фото только по https и не длиннее 512 знаков: иначе без фото, но снимок проходит.
    static func avatar(_ url: URL?) -> String? {
        guard let url, url.scheme == "https" else { return nil }
        let text = url.absoluteString
        return text.count <= maxURLLength ? text : nil
    }

    static func clipped(_ text: String) -> String {
        String(text.prefix(maxTextLength))
    }

    // MARK: Фаза и речь

    static func phase(of state: GameState) -> Phase {
        switch state.phase {
        case .nightZero: Phase(kind: .nightZero, number: 0)
        case .day(.voting): Phase(kind: .voting, number: state.dayNumber)
        case .day: Phase(kind: .day, number: state.dayNumber)
        case .night: Phase(kind: .night, number: state.nightNumber)
        case .finished: Phase(kind: .finished, number: state.dayNumber)
        }
    }

    static func speech(in state: GameState, countdown: Countdown?, at date: Date) -> Speech? {
        let seat: Seat?
        let kind: SpeechKind
        switch state.currentStep {
        case let .speech(speaker):
            (seat, kind) = (speaker, .speech)
        case let .farewell(speaker), let .farewellBestMove(speaker), let .farewellProtocol(speaker):
            (seat, kind) = (speaker, .farewell)
        case let .tieSpeech(speaker):
            (seat, kind) = (speaker, .defense)
        case let .timed(_, speaker):
            (seat, kind) = (speaker, speaker == nil ? .common : .speech)
        case .ballot, .liftBallot, .dusk, .night, .finished:
            return nil
        }
        return Speech(seat: seat?.number, kind: kind, timer: countdown.map { timer($0, at: date) })
    }

    static func timer(_ countdown: Countdown, at date: Date) -> Timer {
        let total = min(maxTimerSeconds, max(0, Int(countdown.duration.rounded(.up))))
        let remaining = min(total * 1000, max(0, Int(countdown.remaining(at: date) * 1000)))
        return Timer(totalSeconds: total, remainingMs: remaining, running: countdown.isRunning && remaining > 0)
    }

    // MARK: Голосование

    static func voting(in state: GameState) -> Voting? {
        if case let .day(.voting(session)) = state.phase {
            return voting(in: session)
        }
        // Голосование дня закончилось — пока идёт день, показываем, чем оно кончилось.
        guard case .day = state.phase, let record = state.votings.last, record.day == state.dayNumber,
              record.wasHeld, let last = record.rounds.last
        else { return nil }
        let counted = record.rounds.last { $0.kind != .lift }
        return Voting(
            round: last.kind,
            candidates: last.candidates.map(\.number),
            tallies: tallies(of: counted),
            tie: tie(of: counted),
            eliminated: record.eliminated.map(\.number),
            liftVotes: last.kind == .lift ? last.liftVotes : nil
        )
    }

    private static func voting(in session: VotingSession) -> Voting {
        let candidates = session.candidates.map(\.number)
        let previous = session.rounds.last { $0.kind != .lift }
        switch session.stage {
        case let .ballot(kind):
            // Голоса вводятся одним кругом: пока круг не подсчитан, голосов нет. В переголосовании виден попил.
            return Voting(round: kind, candidates: candidates, tie: kind == .revote ? candidates : [])
        case .tieSpeeches:
            return Voting(round: previous?.kind ?? .main, candidates: candidates, tallies: tallies(of: previous), tie: candidates)
        case .liftBallot:
            return Voting(round: .lift, candidates: candidates, tallies: tallies(of: previous), tie: candidates)
        }
    }

    private static func tallies(of round: VotingRound?) -> [VoteTally] {
        (round?.results ?? []).map { result in
            VoteTally(candidate: result.candidate.number, votes: result.votes, voters: (result.voters ?? []).map(\.number))
        }
    }

    private static func tie(of round: VotingRound?) -> [Int] {
        guard let leaders = round?.leaders, leaders.count > 1 else { return [] }
        return leaders.map(\.number)
    }

    // MARK: Ночи и дни

    static func nights(in state: GameState) -> [Night] {
        var nights = state.nights.map { night(number: $0.number, actions: $0.actions, resolved: true) }
        if case let .night(progress) = state.phase, !nights.contains(where: { $0.number == progress.number }) {
            nights.append(night(number: progress.number, actions: progress.actions, resolved: false))
        }
        return nights
    }

    private static func night(number: Int, actions: NightActions, resolved: Bool) -> Night {
        func check(by role: Role) -> Check? {
            actions.checks.first { $0.checker == role }.map { Check(target: $0.target.number, positive: $0.isPositive) }
        }
        return Night(
            number: number, resolved: resolved, shot: actions.mafiaShot?.seat?.number,
            donCheck: check(by: .don), sheriffCheck: check(by: .sheriff)
        )
    }

    static func days(in state: GameState) -> [Day] {
        guard state.dayNumber > 0 else { return [] }
        let todayIsOver: Bool = switch state.phase {
        case .day(.dusk), .night, .finished, .nightZero: true
        case .day: false
        }
        return (1...state.dayNumber).map { number in
            let eliminated = state.votings.filter { $0.day == number }.flatMap(\.eliminated).map(\.number)
            return Day(number: number, eliminated: eliminated, finished: number < state.dayNumber || todayIsOver)
        }
    }

    // MARK: Итоги

    static func bestMove(in state: GameState, scores: [PlayerGameScore]?) -> BestMove? {
        guard let move = state.bestMove else { return nil }
        let points = scores?.first { $0.seat == move.author }?.components.first { component in
            if case .bestMove = component.kind { true } else { false }
        }?.points.doubleValue
        return BestMove(author: move.author.number, seats: move.seats.map(\.number), points: points)
    }

    static func outcome(in state: GameState, scores: [PlayerGameScore]?, isFinal: Bool) -> Outcome? {
        guard let outcome = state.outcome else { return nil }
        let table = (scores ?? []).map { score in
            let main = score.components.first { $0.isResult }?.points ?? .zero
            return PlayerScore(
                seat: score.seat.number, main: main.doubleValue, extra: score.bonus.doubleValue,
                // Через `Points`: у `Double` минус ноль ушёл бы в JSON как `-0`.
                penalty: (.zero - score.penalty).doubleValue, total: score.total.doubleValue
            )
        }
        return Outcome(winner: outcome.winner, scoresFinal: isFinal && !table.isEmpty, scores: table)
    }
}
