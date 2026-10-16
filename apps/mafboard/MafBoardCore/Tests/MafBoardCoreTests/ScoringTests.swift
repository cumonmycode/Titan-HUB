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

    @Test("Удаление штрафуется")
    func removalPenalty() throws {
        var session = try Fixture.session()
        try session.run(.disqualify(7, note: nil), .declareOutcome(.red, note: nil))
        let scores = try scoresBySeat(session)
        #expect(scores[7]?.total == 0)
        #expect(scores[7]?.components.map(\.kind) == [.result(.win), .removal])
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
        #expect(table.dropFirst().allSatisfy { $0.place == 2 && $0.points == 1 })
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

    @Test("Статистика по ролям")
    func roleStatistics() throws {
        let records = [try record(.rating, winner: .black), try record(.rating, winner: .black, hoursLater: 1)]
        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .allTime), from: records)
        let don = try #require(table.first { $0.playerID == players[5] })
        #expect(don.roles == [RoleStatistics(role: .don, games: 2, wins: 2)])
        #expect(don.winRate == 1)
    }
}
