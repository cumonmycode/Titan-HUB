// MARK: - Формат соревнования

/// Режим игры: определяет, как игра учитывается в рейтингах.
public enum CompetitionFormat: String, Codable, Sendable, CaseIterable {
    /// Фанка: результат только за игру, в рейтинги не идёт (но сохраняется в истории).
    case funky
    /// Внутренний рейтинг клуба: суммируется за серию (вечер) и за любой период.
    case rating
    /// Миникап: как рейтинг, но отдельная таблица — с рейтингом не смешивается.
    case miniCup
    /// Турнир: отдельное мероприятие со своей таблицей.
    case tournament

    public var displayName: String {
        switch self {
        case .funky: "Фанка"
        case .rating: "Рейтинг"
        case .miniCup: "Миникап"
        case .tournament: "Турнир"
        }
    }

    public var countsTowardStandings: Bool { self != .funky }
}

// MARK: - Система баллов

/// Сколько баллов за что. Снимок кладётся в `GameSetup`, поэтому смена правил не меняет прошлые игры.
public struct ScoringPolicy: Codable, Sendable, Equatable {
    public var win: Points
    public var draw: Points
    public var loss: Points
    /// Угадано чёрных в лучшем ходе → бонус. Для большего числа берётся ближайшее меньшее значение.
    public var bestMove: [Int: Points]
    public var bestMoveOnlyForRedTeam: Bool
    /// Удаление (4 фола, дисквалификация; техфолы — см. `penalizesTechFoulRemoval`).
    public var removalPenalty: Points
    /// Обычный техфол.
    public var techFoulPenalty: Points
    /// Большой техфол. `nil` — как обычный.
    public var bigTechFoulPenalty: Points?
    /// Удаление вторым техфолом штрафуется ещё и как удаление. По ФСМ — нет: штраф только за сами техфолы.
    public var penalizesTechFoulRemoval = true
    /// Удаление «на критике». `nil` — как обычное удаление.
    public var criticalRemovalPenalty: Points?
    /// ППК — нарушителю. `nil` — без штрафа.
    public var forfeitPenalty: Points?
    /// Стол поделился дважды и все остались — штраф каждому красному за столом (ФСМ 4.5.14).
    /// Не начисляется, если шериф убит в первую ночь.
    public var doubleSplitPenalty: Points?
    /// При ничьей положительные допбаллы (в том числе ЛХ и протокол) не начисляются, штрафы остаются (ФСМ 8.4.8).
    public var drawCancelsBonuses = false
    /// Баллы за протокол выбывшего. `nil` — протокол не оценивается.
    public var protocolScoring: ProtocolScoring?

    /// Значения из старой версии MafBoard. Отличия по форматам добавим, когда утвердим регламенты.
    public static let standard = ScoringPolicy(
        win: 1,
        draw: 0,
        loss: 0,
        bestMove: [1: 0.1, 2: 0.3, 3: 0.6],
        bestMoveOnlyForRedTeam: true,
        removalPenalty: 1,
        techFoulPenalty: 0.3
    )

    /// Официальные правила ФСМ (раздел 8) с поправками клуба: победа 1, ЛХ 0.1 / 0.3 / 0.6,
    /// удаление −0.6 (на критике −1), техфол −0.3 (большой −0.6) без удвоения и без штрафа за удаление,
    /// ППК −1.5, двойное деление −0.3 красным, протокол ПУ до +0.8, протокол остальных ±0.4.
    public static let fsm = ScoringPolicy(
        win: 1,
        draw: 0,
        loss: 0,
        bestMove: [1: 0.1, 2: 0.3, 3: 0.6],
        bestMoveOnlyForRedTeam: true,
        removalPenalty: 0.6,
        techFoulPenalty: 0.3,
        bigTechFoulPenalty: 0.6,
        penalizesTechFoulRemoval: false,
        criticalRemovalPenalty: 1,
        forfeitPenalty: 1.5,
        doubleSplitPenalty: 0.3,
        drawCancelsBonuses: true,
        protocolScoring: .fsm
    )

    public static func `default`(for format: CompetitionFormat) -> ScoringPolicy {
        switch format {
        case .funky, .rating, .miniCup, .tournament: .fsm
        }
    }

    public func points(for result: GameResult) -> Points {
        switch result {
        case .win: win
        case .draw: draw
        case .loss: loss
        }
    }

    public func bestMovePoints(guessed: Int) -> Points {
        guard guessed > 0 else { return .zero }
        if let exact = bestMove[guessed] { return exact }
        guard let nearest = bestMove.keys.filter({ $0 <= guessed }).max() else { return .zero }
        return bestMove[nearest] ?? .zero
    }

    /// Штраф за техфолы игрока: обычные и большие, без удвоения второго.
    public func techFoulPoints(ordinary: Int, big: Int) -> Points {
        techFoulPenalty * ordinary + (bigTechFoulPenalty ?? techFoulPenalty) * big
    }
}

extension ScoringPolicy {
    private enum CodingKeys: String, CodingKey {
        case win, draw, loss, bestMove, bestMoveOnlyForRedTeam, removalPenalty, techFoulPenalty, bigTechFoulPenalty,
             penalizesTechFoulRemoval, criticalRemovalPenalty, forfeitPenalty, doubleSplitPenalty, drawCancelsBonuses,
             protocolScoring
    }

    /// Правила, сохранённые до появления новых полей, читаются как раньше.
    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        win = try container.decode(Points.self, forKey: .win)
        draw = try container.decode(Points.self, forKey: .draw)
        loss = try container.decode(Points.self, forKey: .loss)
        bestMove = try container.decode([Int: Points].self, forKey: .bestMove)
        bestMoveOnlyForRedTeam = try container.decode(Bool.self, forKey: .bestMoveOnlyForRedTeam)
        removalPenalty = try container.decode(Points.self, forKey: .removalPenalty)
        techFoulPenalty = try container.decode(Points.self, forKey: .techFoulPenalty)
        bigTechFoulPenalty = try container.decodeIfPresent(Points.self, forKey: .bigTechFoulPenalty)
        penalizesTechFoulRemoval = try container.decodeIfPresent(Bool.self, forKey: .penalizesTechFoulRemoval) ?? true
        criticalRemovalPenalty = try container.decodeIfPresent(Points.self, forKey: .criticalRemovalPenalty)
        forfeitPenalty = try container.decodeIfPresent(Points.self, forKey: .forfeitPenalty)
        doubleSplitPenalty = try container.decodeIfPresent(Points.self, forKey: .doubleSplitPenalty)
        drawCancelsBonuses = try container.decodeIfPresent(Bool.self, forKey: .drawCancelsBonuses) ?? false
        protocolScoring = try container.decodeIfPresent(ProtocolScoring.self, forKey: .protocolScoring)
    }
}

/// Оценка протокола (ФСМ 8.3.8.12, 8.3.9).
public struct ProtocolScoring: Codable, Sendable, Equatable {
    /// Протокол первого убитого (ПУ): чёрные, красные и версия суммируются, но не больше этого.
    public var firstKilledCap: Points
    /// Протокол остальных: всё верно — столько в плюс, хоть одна ошибка — столько в минус.
    public var othersValue: Points

    public static let fsm = ProtocolScoring(firstKilledCap: 0.8, othersValue: 0.4)

    /// Чёрные: первый верный +0.2, второй и третий по +0.3; ошибки — так же в минус. Индекс — сколько.
    private static let blacks: [Points] = [0, 0.2, 0.5, 0.8]
    /// Красные: первый верный +0.1, каждый следующий +0.2, всего не больше +0.8.
    private static let redCap: Points = 0.8
    /// Ошибки в красных: одна −0.2, две и больше −0.4.
    private static let redMisses: [Points] = [0, 0.2, 0.4]

    /// - Parameters:
    ///   - actual: кто на самом деле чёрный.
    ///   - sheriff: место шерифа (для версии).
    ///   - unscoredReds: красные, за которых плюса нет — например, проверенные самим автором-шерифом (ФСМ 8.3.9.9).
    public func points(
        for proto: ColorProtocol,
        blacks actual: Set<Seat>,
        sheriff: Seat?,
        unscoredReds: Set<Seat> = [],
        isFirstKilled: Bool
    ) -> Points {
        let namedBlacks = Set(proto.blacks)
        let namedReds = Set(proto.reds)
        let blackHit = namedBlacks.intersection(actual).count
        let blackMiss = namedBlacks.count - blackHit
        let redMiss = namedReds.intersection(actual).count
        let redHit = namedReds.subtracting(actual).subtracting(unscoredReds).count

        guard isFirstKilled else {
            guard !namedBlacks.isEmpty || !namedReds.isEmpty else { return .zero }
            return blackMiss + redMiss == 0 ? othersValue : -othersValue
        }
        let redPlus = redHit == 0 ? Points.zero : min(Self.redCap, 0.1 + Points(hundredths: 20) * (redHit - 1))
        var total = Self.blacks[min(blackHit, 3)] - Self.blacks[min(blackMiss, 3)]
            + redPlus - Self.redMisses[min(redMiss, 2)]
        if let version = proto.version {
            total += version.sheriff == sheriff ? version.value : -version.value
        }
        return min(total, firstKilledCap)
    }
}

// MARK: - Баллы за игру

public struct ScoreComponent: Codable, Sendable, Equatable {
    public enum Kind: Codable, Sendable, Equatable {
        case result(GameResult)
        case bestMove(guessed: Int)
        case removal
        /// Удаление «на критике».
        case criticalRemoval
        case techFouls(count: Int)
        /// ППК.
        case forfeit
        /// Стол дважды поделился, и все остались (штраф красным).
        case doubleSplit
        case adjustment(note: String)
        /// Протокол выбывшего; `firstKilled` — протокол ПУ.
        case colorProtocol(firstKilled: Bool)
    }

    public let kind: Kind
    public let points: Points

    var isResult: Bool {
        if case .result = kind { true } else { false }
    }
}

/// Баллы одного игрока за одну игру с расшифровкой «за что».
public struct PlayerGameScore: Codable, Sendable, Equatable, Identifiable {
    public let seat: Seat
    public let playerID: PlayerID
    public let role: Role
    public let result: GameResult
    /// Первый убитый (ПУ) — для таблицы: смерти в первую ночь (ФСМ 8.7.5).
    public let isFirstKilled: Bool
    public let components: [ScoreComponent]

    public var id: Seat { seat }
    public var total: Points { components.map(\.points).sum() }
    /// Дополнительные баллы сверх результата.
    public var bonus: Points {
        components.filter { !$0.isResult && $0.points > .zero }.map(\.points).sum()
    }
    /// Штрафы (положительное число).
    public var penalty: Points {
        -components.filter { !$0.isResult && $0.points < .zero }.map(\.points).sum()
    }
}

public enum GameScorer {
    /// Баллы всех игроков за игру. `policy` — пересчёт по другим правилам; по умолчанию правила самой игры.
    public static func score(_ record: GameRecord, policy: ScoringPolicy? = nil) -> [PlayerGameScore] {
        let policy = policy ?? record.setup.scoring
        let splitPenalties = doubleSplitPenalties(in: record, policy: policy)
        return record.seats.map { seat in
            let result = record.outcome.winner.result(for: seat.team)
            var extras = bestMoveComponents(for: seat, in: record, policy: policy)
                + disciplineComponents(for: seat, in: record, policy: policy)
                + protocolComponents(for: seat, in: record, policy: policy)
                + (splitPenalties[seat.seat].map { [$0] } ?? [])
                + record.scoreAdjustments
                    .filter { $0.seat == seat.seat }
                    .map { ScoreComponent(kind: .adjustment(note: $0.note), points: $0.points) }
            if result == .draw, policy.drawCancelsBonuses {
                extras = withoutBonuses(extras)
            }
            return PlayerGameScore(
                seat: seat.seat, playerID: seat.playerID, role: seat.role, result: result,
                isFirstKilled: record.firstKilled == seat.seat,
                components: [ScoreComponent(kind: .result(result), points: policy.points(for: result))] + extras
            )
        }
    }

    /// Ничья: плюсы не начисляются. Лучший ход остаётся с нулём — он нужен для статистики игрока.
    private static func withoutBonuses(_ components: [ScoreComponent]) -> [ScoreComponent] {
        components.compactMap { component in
            guard component.points > .zero else { return component }
            if case .bestMove = component.kind { return ScoreComponent(kind: component.kind, points: .zero) }
            return nil
        }
    }

    private static func bestMoveComponents(
        for seat: SeatState,
        in record: GameRecord,
        policy: ScoringPolicy
    ) -> [ScoreComponent] {
        guard let move = record.bestMoves.first(where: { $0.author == seat.seat }),
              !policy.bestMoveOnlyForRedTeam || seat.team == .red
        else { return [] }
        let guessed = move.seats.filter { record.seat($0)?.team == .black }.count
        // Даже ноль баллов — это сделанный лучший ход: он нужен для статистики игрока.
        return [ScoreComponent(kind: .bestMove(guessed: guessed), points: policy.bestMovePoints(guessed: guessed))]
    }

    private static func protocolComponents(for seat: SeatState, in record: GameRecord, policy: ScoringPolicy) -> [ScoreComponent] {
        guard let scoring = policy.protocolScoring,
              let proto = record.protocols.first(where: { $0.author == seat.seat })
        else { return [] }
        let blacks = Set(record.seats.filter { $0.team == .black }.map(\.seat))
        let isFirstKilled = record.firstKilled == seat.seat
        // Шериф не получает плюс за красных, которых сам проверил (ФСМ 8.3.9.9).
        let checkedReds = seat.role == .sheriff
            ? Set(record.nights.flatMap(\.actions.checks).filter { $0.by == seat.seat && $0.checker == .sheriff && !$0.isPositive }.map(\.target))
            : []
        let points = scoring.points(
            for: proto, blacks: blacks, sheriff: record.seats.first { $0.role == .sheriff }?.seat,
            unscoredReds: checkedReds, isFirstKilled: isFirstKilled
        )
        return [ScoreComponent(kind: .colorProtocol(firstKilled: isFirstKilled), points: points)]
    }

    private static func disciplineComponents(for seat: SeatState, in record: GameRecord, policy: ScoringPolicy) -> [ScoreComponent] {
        var components: [ScoreComponent] = []
        if case let .removed(reason) = seat.elimination?.cause, reason != .techFouls || policy.penalizesTechFoulRemoval {
            if seat.isCriticalRemoval, let critical = policy.criticalRemovalPenalty {
                components.append(ScoreComponent(kind: .criticalRemoval, points: -critical))
            } else if policy.removalPenalty != .zero {
                components.append(ScoreComponent(kind: .removal, points: -policy.removalPenalty))
            }
        }
        let techFoulPoints = policy.techFoulPoints(ordinary: seat.techFouls - seat.bigTechFouls, big: seat.bigTechFouls)
        if seat.techFouls > 0, techFoulPoints != .zero {
            components.append(ScoreComponent(kind: .techFouls(count: seat.techFouls), points: -techFoulPoints))
        }
        if case let .forfeit(offender, _) = record.outcome.reason, offender == seat.seat, let penalty = policy.forfeitPenalty {
            components.append(ScoreComponent(kind: .forfeit, points: -penalty))
        }
        return components
    }

    /// Стол дважды поделился, а все остались: каждый красный за столом получает штраф (ФСМ 4.5.14).
    /// Если шериф убит в первую ночь, деление разрешено и не наказывается.
    private static func doubleSplitPenalties(in record: GameRecord, policy: ScoringPolicy) -> [Seat: ScoreComponent] {
        guard let penalty = policy.doubleSplitPenalty,
              record.firstKilled.flatMap({ record.seat($0)?.role }) != .sheriff
        else { return [:] }
        let splitDays = record.votings.filter { voting in
            voting.eliminated.isEmpty && voting.rounds.filter { $0.kind != .lift && $0.leaders.count > 1 }.count >= 2
        }.map(\.day)
        var result: [Seat: ScoreComponent] = [:]
        for seat in record.seats where seat.team == .red {
            let count = splitDays.filter { seat.wasAtTable(onDay: $0) }.count
            if count > 0 {
                result[seat.seat] = ScoreComponent(kind: .doubleSplit, points: -(penalty * count))
            }
        }
        return result
    }
}

private extension SeatState {
    /// Был за столом во время голосования дня `day`: не выбыл или выбыл позже.
    func wasAtTable(onDay day: Int) -> Bool {
        guard let moment = elimination?.moment else { return true }
        return switch moment {
        case .nightZero: false
        case let .day(number): number >= day
        case let .night(number): number >= day
        case .afterGame: true
        }
    }
}
