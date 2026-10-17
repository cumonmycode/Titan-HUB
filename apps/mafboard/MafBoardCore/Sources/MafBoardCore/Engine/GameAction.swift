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
    /// Обычный технический фол (ФСМ 6.7: −0.3).
    case techFoul(Seat)
    /// Большой технический фол (ФСМ 6.7: −0.6).
    case bigTechFoul(Seat)
    /// Отменяет последний техфол игрока, какого бы вида он ни был.
    case cancelTechFoul(Seat)
    case warning(Seat)
    case disqualify(Seat, note: String?)
    /// Ручное выбывание по решению ведущего — без штрафа (способности ролей, которые движок не ведёт).
    case eliminateByHost(Seat, note: String?)
    /// Удаление было «на критике» — штраф −1 вместо −0.6 (ФСМ 8.2.4). Можно отметить и после игры.
    case markCriticalRemoval(Seat, Bool)
    /// Отметка «вскрылся шерифом» — для судьи: баллы за вскрытие он ставит сам через допбаллы.
    case markSheriffClaim(Seat, Bool)
    /// ППК: нарушение игрока — поражение его команде и штраф −1.5 (ФСМ 6.9, 8.2.5).
    case forfeit(Seat, note: String?)

    // Итоги
    /// Лучший ход последнего игрока, получившего на него право (записи до нескольких ЛХ за игру).
    case recordBestMove([Seat])
    /// Лучший ход конкретного игрока: ПУ или выбывшего при полном столе.
    case recordBestMoveBy(author: Seat, seats: [Seat])
    /// Протокол выбывшего игрока после его последней речи: кого считает чёрными, кого красными.
    case recordProtocol(ColorProtocol)
    /// Ручное объявление результата (ППК, ничья по регламенту и т.п.).
    case declareOutcome(Winner, note: String?)
    case adjustScore(ScoreAdjustment)
    /// Допбаллы игрока целиком: заменяют все прежние корректировки этого игрока (правка итогов после игры).
    case setScoreAdjustments(Seat, [ScoreAdjustment])
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

/// Протокол выбывшего игрока после заключительной речи: только цвета и роли (ФСМ 4.8.7).
public struct ColorProtocol: Codable, Sendable, Equatable {
    public let author: Seat
    public let blacks: [Seat]
    public let reds: [Seat]
    /// Версия ПУ на шерифа: кого из вскрывшихся он считает настоящим шерифом.
    public let version: SheriffVersion?

    public init(author: Seat, blacks: [Seat], reds: [Seat], version: SheriffVersion? = nil) {
        self.author = author
        self.blacks = blacks
        self.reds = reds
        self.version = version
    }
}

/// Версия на шерифа (ФСМ 8.3.9.5, 8.3.9.10). Цена зависит от ситуации за столом:
/// «шериф / дон» и «шериф или дон / красный» — 0.4, «красный / красный» и «чёрный / чёрный» — 0.2,
/// одно вскрытие или версия на недостоверной информации шерифа — 0.
public struct SheriffVersion: Codable, Sendable, Equatable {
    public let sheriff: Seat
    public let value: Points

    public init(sheriff: Seat, value: Points) {
        self.sheriff = sheriff
        self.value = value
    }
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
