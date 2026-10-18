import Foundation
import Testing
@testable import MafBoardCore

@Suite("Баллы")
struct ScoringTests {
    @Test("Баллы складываются без ошибок округления и печатаются без лишних нулей")
    func pointsArithmetic() {
        #expect((0.1 as Points) + 0.2 == 0.3)
        #expect((1 as Points).description == "1")
        #expect((0.3 as Points).description == "0.3")
        #expect((-0.25 as Points).description == "-0.25")
        #expect((1.05 as Points).description == "1.05")
        // Значения из ввода/JSON — через Double, иначе `Points(литерал)` превращается в литерал.
        let typed: (Double, Double, Double, Double) = (0.125, .nan, .infinity, 1e30)
        #expect(Points(typed.0) == Points(hundredths: 13))
        #expect(Points(typed.1) == nil)
        #expect(Points(typed.2) == nil)
        #expect(Points(typed.3) == nil)
    }

    @Test("Победа, лучший ход, техфол и ручная корректировка")
    func gameScoreComponents() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.run(
            .recordBestMove([3, 6, 2]),
            .techFoul(9),
            .declareOutcome(.red, note: nil),
            .adjustScore(ScoreAdjustment(seat: 5, points: 0.2, note: "Лучший игрок"))
        )
        let scores = try scoresBySeat(session)

        #expect(scores[1]?.total == 1.3)
        #expect(scores[1]?.bonus == 0.3)
        #expect(scores[3]?.total == 0)
        #expect(scores[9]?.total == 0.7)
        #expect(scores[9]?.penalty == 0.3)
        #expect(scores[5]?.total == 1.2)
    }

    @Test("Удаление −0.6, на критике −1")
    func removalPenalty() throws {
        var session = try Fixture.session()
        try session.run(.disqualify(7, note: nil), .foul(9), .foul(9), .foul(9), .foul(9))
        try session.run(.markCriticalRemoval(9, true), .declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[7]?.total == 0.4)
        #expect(scores[7]?.components.map(\.kind) == [.result(.win), .removal])
        #expect(scores[9]?.total == 0)
        #expect(scores[9]?.components.map(\.kind) == [.result(.win), .criticalRemoval])
        #expect(throws: GameError.notRemoved(1)) { try session.perform(.markCriticalRemoval(1, true)) }
    }

    @Test("Удалённого «на критике» можно вернуть: отметка уходит вместе с удалением")
    func reinstateCriticalRemoval() throws {
        var session = try Fixture.session()
        try session.run(.disqualify(9, note: nil), .markCriticalRemoval(9, true))
        try session.reinstate(9)
        #expect(session.state.isAlive(9))
        #expect(session.state.seat(9)?.isCriticalRemoval == false)
    }

    @Test("Отметка «вскрылся шерифом» ставится и после игры и не меняет баллы")
    func sheriffClaimMark() throws {
        var session = try Fixture.session()
        try session.run(.declareOutcome(.red, note: nil), .markSheriffClaim(5, true), .markSheriffClaim(4, true), .markSheriffClaim(4, false))
        let record = try GameRecord(session: session)
        #expect(record.seat(5)?.claimedSheriff == true)
        #expect(record.seat(4)?.claimedSheriff == false)
        #expect(try scoresBySeat(session)[5]?.total == 1)
    }

    @Test("Городская мафия считается по прежним баллам, без штрафа за деление")
    func cityKeepsStandardScoring() throws {
        let session = try Fixture.session(ruleset: .city, roles: Fixture.cityRoles)
        #expect(session.setup.scoring == .standard)
    }

    @Test("МТФ −0.3, БТФ −0.6; удаляющий второй техфол — вдвое, отдельного штрафа за удаление нет")
    func techFoulPenalties() throws {
        var session = try Fixture.session()
        try session.run(
            .techFoul(1), .techFoul(1),        // МТФ + МТФ = −0.9
            .bigTechFoul(2), .techFoul(2),     // БТФ + МТФ = −1.2
            .techFoul(5), .bigTechFoul(5),     // МТФ + БТФ = −1.5
            .bigTechFoul(3), .bigTechFoul(3),  // БТФ + БТФ = −1.8 (чёрный)
            .bigTechFoul(9)                    // один БТФ = −0.6
        )
        #expect(session.state.seat(2)?.elimination?.cause == .removed(.techFouls))
        try session.run(.declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[1]?.total == 0.1)
        #expect(scores[2]?.total == -0.2)
        #expect(scores[5]?.total == -0.5)
        #expect(scores[3]?.total == -1.8)
        #expect(scores[9]?.total == 0.4)
        #expect(scores[5]?.components.map(\.kind) == [.result(.win), .techFoul(.ordinary, doubled: false), .techFoul(.big, doubled: true)])
    }

    @Test("Сохранённые правила ФСМ без новой настройки удваивают удаляющий техфол, городские — нет")
    func legacyScoringDecodesTechFoulDoubling() throws {
        func decodedWithoutDoubling(_ policy: ScoringPolicy) throws -> ScoringPolicy {
            var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(policy)) as? [String: Any])
            json["doublesRemovingTechFoul"] = nil
            return try JSONDecoder().decode(ScoringPolicy.self, from: JSONSerialization.data(withJSONObject: json))
        }
        #expect(try decodedWithoutDoubling(.fsm).doublesRemovingTechFoul)
        #expect(try !decodedWithoutDoubling(.standard).doublesRemovingTechFoul)
    }

    @Test("Отмена техфола снимает последний, какого бы вида он ни был")
    func cancelLastTechFoul() throws {
        var session = try Fixture.session()
        try session.run(.techFoul(5), .bigTechFoul(9), .cancelTechFoul(9))
        #expect(session.state.seat(9)?.techFouls == 0)
        #expect(session.state.seat(5)?.techFoulKinds == [.ordinary])
    }

    @Test("ППК: команда нарушителя проигрывает, нарушитель −1.5")
    func forfeit() throws {
        var session = try Fixture.session()
        try session.run(.forfeit(5, note: "Клятва"))
        #expect(session.state.outcome?.winner == .black)
        let scores = try scoresBySeat(session)
        #expect(scores[5]?.total == -1.5)
        #expect(scores[1]?.total == 0)
        #expect(scores[3]?.total == 1)
    }

    @Test("Допбаллы игрока можно задать заново после игры — прежние заменяются")
    func setAdjustmentsReplaces() throws {
        var session = try Fixture.session()
        try session.run(
            .declareOutcome(.red, note: nil),
            .adjustScore(ScoreAdjustment(seat: 5, points: 0.2, note: "Доп. балл")),
            .adjustScore(ScoreAdjustment(seat: 5, points: -0.3, note: "Минус")),
            .adjustScore(ScoreAdjustment(seat: 7, points: 0.4, note: "Доп. балл")),
            .setScoreAdjustments(5, [ScoreAdjustment(seat: 5, points: 0.6, note: "Доп. балл"), ScoreAdjustment(seat: 5, points: 0, note: "Минус")])
        )
        let scores = try scoresBySeat(session)
        #expect(scores[5]?.total == 1.6)
        #expect(scores[7]?.total == 1.4)
        #expect(throws: GameError.unknownSeat(7)) {
            try session.perform(.setScoreAdjustments(5, [ScoreAdjustment(seat: 7, points: 0.2, note: "")]))
        }
    }

    @Test("Ничья: плюсы не начисляются, штрафы остаются")
    func drawCancelsBonuses() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.run(
            .recordBestMove([3, 6, 8]),
            .techFoul(9),
            .adjustScore(ScoreAdjustment(seat: 5, points: 0.5, note: "Лучший игрок")),
            .declareOutcome(.draw, note: nil)
        )
        let scores = try scoresBySeat(session)
        #expect(scores[1]?.total == 0)
        #expect(scores[1]?.components.map(\.kind) == [.result(.draw), .bestMove(guessed: 3)])
        #expect(scores[5]?.total == 0)
        #expect(scores[9]?.total == -0.3)
    }

    @Test("Протокол ПУ: чёрные, красные и версия суммируются, не больше 0.8")
    func firstKilledProtocol() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.state.firstKilled == 1)
        // Чёрные — 3, 6, 8; шериф — 4. Все чёрные верно (+0.8) и два красных (+0.3) — потолок 0.8.
        try session.run(.recordProtocol(ColorProtocol(author: 1, blacks: [3, 6, 8], reds: [2, 5])))
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try protocolPoints(session, seat: 1) == 0.8)

        // Чёрные 2 верно и 1 ошибка (0.5 − 0.2), красный с ошибкой (−0.2), неверная версия (−0.4).
        try session.undo()
        try session.run(.recordProtocol(ColorProtocol(
            author: 1, blacks: [3, 6, 9], reds: [8], version: SheriffVersion(sheriff: 10, value: 0.4)
        )))
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try protocolPoints(session, seat: 1) == -0.3)

        // Красные суммируются: 3 верно (+0.5) и 1 ошибка (−0.2); верная версия за 0.2.
        try session.undo()
        try session.run(.recordProtocol(ColorProtocol(
            author: 1, blacks: [], reds: [2, 5, 7, 8], version: SheriffVersion(sheriff: 4, value: 0.2)
        )))
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try protocolPoints(session, seat: 1) == 0.5)

        // Пять верных красных: 0.1 + 0.2 × 4 = 0.9, но не больше 0.8.
        try session.undo()
        try session.run(.recordProtocol(ColorProtocol(author: 1, blacks: [], reds: [2, 4, 5, 7, 9])))
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try protocolPoints(session, seat: 1) == 0.8)
    }

    @Test("Шериф-ПУ не получает плюс за красных, которых проверил сам")
    func sheriffCheckedRedsUnscored() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(4)), .night(.skip), .night(.check(2)))
        try session.run(.recordProtocol(ColorProtocol(author: 4, blacks: [], reds: [2, 5])))
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try protocolPoints(session, seat: 4) == 0.1)
    }

    @Test("ПУ — только убитый в первую ночь: после промаха протокол оценивается как обычный")
    func firstKilledOnlyOnFirstNight() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.state.firstKilled == nil)
        try session.run(.recordProtocol(ColorProtocol(author: 1, blacks: [3, 6, 8], reds: [])))
        try session.run(.declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[1]?.components.first { $0.kind == .colorProtocol(firstKilled: false) }?.points == 0.4)
    }

    @Test("Протокол не ПУ: всё верно +0.4, хоть одна ошибка −0.4; удалённый протокол не оставляет")
    func othersProtocol() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.run(.eliminateByHost(5, note: nil), .disqualify(9, note: nil))
        try session.run(.recordProtocol(ColorProtocol(author: 5, blacks: [8], reds: [2])))
        #expect(throws: GameError.invalidProtocol(.authorRemoved)) {
            try session.run(.recordProtocol(ColorProtocol(author: 9, blacks: [3], reds: [])))
        }
        #expect(throws: GameError.invalidProtocol(.authorInGame)) {
            try session.run(.recordProtocol(ColorProtocol(author: 4, blacks: [3], reds: [])))
        }
        #expect(throws: GameError.invalidProtocol(.duplicateSeats)) {
            try session.run(.recordProtocol(ColorProtocol(
                author: 5, blacks: [8], reds: [2], version: SheriffVersion(sheriff: 2, value: 0.4)
            )))
        }
        try session.run(.declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[5]?.components.first { $0.kind == .colorProtocol(firstKilled: false) }?.points == 0.4)
    }

    @Test("Лучший ход чёрного игрока не даёт бонуса")
    func bestMoveIgnoredForBlackAuthor() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(3)), .night(.skip), .night(.skip))
        try session.run(.recordBestMove([6, 8]), .declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[3]?.bonus == 0)
    }

    private func protocolPoints(_ session: GameSession, seat: Seat) throws -> Points? {
        try scoresBySeat(session)[seat]?.components.first { component in
            if case .colorProtocol = component.kind { true } else { false }
        }?.points
    }

    private func scoresBySeat(_ session: GameSession) throws -> [Seat: PlayerGameScore] {
        let record = try GameRecord(session: session)
        return Dictionary(uniqueKeysWithValues: GameScorer.score(record).map { ($0.seat, $0) })
    }
}

@Suite("Рейтинги")
struct StandingsTests {
    private let players = Fixture.players(10)
    private let evening = Date(timeIntervalSince1970: 1_800_000_000)

    private func record(
        _ format: CompetitionFormat,
        winner: Winner,
        series: SeriesID? = nil,
        hoursLater: Double = 0,
        adjustments: [ScoreAdjustment] = []
    ) throws -> GameRecord {
        let start = evening.addingTimeInterval(hoursLater * 3600)
        var session = try Fixture.session(format: format, players: players, seriesID: series, createdAt: start)
        try session.perform(.declareOutcome(winner, note: nil), at: start.addingTimeInterval(1800))
        for adjustment in adjustments {
            try session.perform(.adjustScore(adjustment), at: start.addingTimeInterval(1900))
        }
        return try GameRecord(session: session)
    }

    @Test("Рейтинг вечера: сумма за серию, фанка и миникап не смешиваются")
    func ratingSeriesStandings() throws {
        let series = Series(title: "Рейтинг, 16 октября", format: .rating, variant: .sport)
        let records = [
            try record(.rating, winner: .red, series: series.id,
                       adjustments: [ScoreAdjustment(seat: 1, points: 0.5, note: "Лучший игрок")]),
            try record(.rating, winner: .black, series: series.id, hoursLater: 1),
            try record(.funky, winner: .red, hoursLater: 2),
            try record(.miniCup, winner: .black, hoursLater: 3),
        ]

        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .series(series.id)), from: records)
        #expect(table.count == 10)
        #expect(table[0].playerID == players[0])
        #expect(table[0].points == 1.5)
        #expect(table[0].place == 1)
        #expect(table.dropFirst().allSatisfy { $0.points == 1 })
        // При равных баллах выше победы доном или шерифом (ФСМ 8.7.4): шериф выиграл первую игру, дон — вторую.
        let secondPlace = Set(table.filter { $0.place == 2 }.map(\.playerID))
        #expect(secondPlace == [players[3], players[5]])
        #expect(table.dropFirst(3).allSatisfy { $0.place == 4 })
        #expect(table.allSatisfy { $0.gamesPlayed == 2 })

        let miniCup = StandingsCalculator.standings(StandingsQuery(format: .miniCup, scope: .allTime), from: records)
        #expect(miniCup.allSatisfy { $0.gamesPlayed == 1 })
        #expect(miniCup.first { $0.playerID == players[2] }?.points == 1)
        #expect(miniCup.first { $0.playerID == players[0] }?.points == 0)
    }

    @Test("Таблица за период и пустая таблица для фанки")
    func periodAndFunky() throws {
        let records = [
            try record(.rating, winner: .red),
            try record(.rating, winner: .red, hoursLater: 48),
            try record(.funky, winner: .red),
        ]
        let firstDay = DateInterval(start: evening, duration: 24 * 3600)
        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .period(firstDay)), from: records)
        #expect(table.allSatisfy { $0.gamesPlayed == 1 })

        let funky = StandingsCalculator.standings(StandingsQuery(format: .funky, scope: .allTime), from: records)
        #expect(funky.isEmpty)
    }

    @Test("Равные баллы: выше тот, у кого больше допбаллов, даже при меньшем числе побед (ФСМ 8.7.2)")
    func tiebreakByExtraPoints() throws {
        let bonus = ScoreAdjustment(seat: 3, points: 0.5, note: "Лучший игрок")
        let records = [
            try record(.rating, winner: .red, adjustments: [bonus]),
            try record(.rating, winner: .red, hoursLater: 1, adjustments: [bonus]),
            try record(.rating, winner: .black, hoursLater: 2),
        ]
        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .allTime), from: records)
        let red = try #require(table.first { $0.playerID == players[0] })
        let black = try #require(table.first { $0.playerID == players[2] })
        #expect(red.points == 2)
        #expect(black.points == 2)
        #expect(red.wins == 2)
        #expect(black.extraPoints == 1)
        #expect(black.place < red.place)
    }

    @Test("Статистика по ролям")
    func roleStatistics() throws {
        let records = [try record(.rating, winner: .black), try record(.rating, winner: .black, hoursLater: 1)]
        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .allTime), from: records)
        let don = try #require(table.first { $0.playerID == players[5] })
        #expect(don.roles == [RoleStatistics(role: .don, games: 2, wins: 2)])
        #expect(don.winRate == 1)
    }
}
