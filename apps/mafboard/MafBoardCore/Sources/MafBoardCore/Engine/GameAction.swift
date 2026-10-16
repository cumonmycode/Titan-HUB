/// Действие ведущего. Всё, что происходит в игре, выражается последовательностью действий —
/// поэтому игру можно сохранить, восстановить, переиграть и отменить последний шаг.
public enum GameAction: Codable, Sendable, Equatable {
    /// «Далее»: закончить текущий шаг (речь, таймер, прощальную речь, день) и перейти к следующему.
    /// Ночью — пропустить текущий шаг без действия.
    case advance

    // День
    case nominate(candidate: Seat, by: Seat)
    case withdrawNomination(by: Seat)
    case submitBallot(Ballot)

    // Ночь
    case night(NightInput)

    // Дисциплина
    case foul(Seat)
    case cancelFoul(Seat)
    case techFoul(Seat)
    case cancelTechFoul(Seat)
    case warning(Seat)
    case disqualify(Seat, note: String?)
    /// Ручное выбывание по решению ведущего — без штрафа (способности ролей, которые движок не ведёт).
    case eliminateByHost(Seat, note: String?)

    // Итоги
    case recordBestMove([Seat])
    /// Ручное объявление результата (ППК, ничья по регламенту и т.п.).
    case declareOutcome(Winner, note: String?)
    case adjustScore(ScoreAdjustment)
}

/// Голоса одного круга голосования.
public enum Ballot: Codable, Sendable, Equatable {
    /// Кто за кого голосовал. Не указанные живые игроки — по `VotingPolicy.abstainersVoteForLastCandidate`.
    case perVoter([Vote])
    /// Только количество голосов за каждого кандидата.
    case handCount([CandidateVotes])
    /// Голосование «поднять всех»: кто проголосовал «за».
    case lift(voters: [Seat])
    /// Голосование «поднять всех»: только количество голосов «за».
    case liftCount(Int)
}

public struct Vote: Codable, Sendable, Hashable {
    public let voter: Seat
    public let candidate: Seat

    public init(_ voter: Seat, for candidate: Seat) {
        self.voter = voter
        self.candidate = candidate
    }
}

public struct CandidateVotes: Codable, Sendable, Equatable {
    public let candidate: Seat
    public let votes: Int

    public init(_ candidate: Seat, votes: Int) {
        self.candidate = candidate
        self.votes = votes
    }
}

/// Ввод ведущего для текущего шага ночи.
public enum NightInput: Codable, Sendable, Equatable {
    /// Выстрел мафии или ход маньяка. `nil` — промах.
    case shot(Seat?)
    case check(Seat)
    case heal(Seat)
    case skip
}

/// Ручная корректировка баллов игрока (доп. баллы, штраф ведущего).
public struct ScoreAdjustment: Codable, Sendable, Equatable {
    public let seat: Seat
    public let points: Points
    public let note: String

    public init(seat: Seat, points: Points, note: String) {
        self.seat = seat
        self.points = points
        self.note = note
    }
}
