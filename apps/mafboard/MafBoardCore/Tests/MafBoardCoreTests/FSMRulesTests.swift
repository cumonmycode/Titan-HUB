import Foundation
import Testing
@testable import MafBoardCore

/// Правила спортивной мафии из официальной редакции ФСМ (п. 4–8) поверх общего движка.
@Suite("Правила ФСМ")
struct FSMRulesTests {
    // Стол из `Fixture`: мафия — 3 и 8, дон — 6, шериф — 4.

    @Test("Подъём только при разрешённых делениях (7.11.5), всех за столом не поднимают (7.8)")
    func liftSplits() {
        let voting = Ruleset.sport.voting
        #expect(voting.allowsLift(tied: 2, alive: 10, sheriffKilledFirst: false))
        #expect(!voting.allowsLift(tied: 5, alive: 10, sheriffKilledFirst: false))
        #expect(!voting.allowsLift(tied: 3, alive: 9, sheriffKilledFirst: false))
        #expect(voting.allowsLift(tied: 3, alive: 9, sheriffKilledFirst: true))
        #expect(voting.allowsLift(tied: 2, alive: 8, sheriffKilledFirst: false))
        #expect(voting.allowsLift(tied: 4, alive: 8, sheriffKilledFirst: false))
        #expect(voting.allowsLift(tied: 3, alive: 6, sheriffKilledFirst: false))
        #expect(voting.allowsLift(tied: 2, alive: 4, sheriffKilledFirst: false))
        #expect(!voting.allowsLift(tied: 3, alive: 3, sheriffKilledFirst: true))
        #expect(Ruleset.city.voting.allowsLift(tied: 3, alive: 9, sheriffKilledFirst: false))
    }

    @Test("Стол дважды поделился и все остались — каждому красному −0.3 (4.5.14)")
    func doubleSplitPenalizesReds() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.speak(nominating: [(3, 1), (8, 2)])
        let split = Ballot.handCount([CandidateVotes(3, votes: 5), CandidateVotes(8, votes: 5)])
        try session.run(.submitBallot(split), .advance, .advance, .submitBallot(split), .submitBallot(.liftCount(4)))
        #expect(session.state.isDusk)
        try session.run(.declareOutcome(.red, note: nil))

        let scores = try scoresBySeat(session)
        #expect(scores[1]?.total == 0.7)
        #expect(scores[4]?.components.map(\.kind) == [.result(.win), .doubleSplit])
        #expect(scores[3]?.total == 0)
    }

    @Test("Голосование после двух делений прервано удалением — штрафа нет")
    func abortedDoubleSplitIsNotPenalized() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.speak(nominating: [(3, 1), (8, 2)])
        let split = Ballot.handCount([CandidateVotes(3, votes: 5), CandidateVotes(8, votes: 5)])
        try session.run(.submitBallot(split), .advance, .advance, .submitBallot(split), .disqualify(9, note: nil))
        #expect(session.state.votings.last?.skipReason == .cancelledByRemoval)
        try session.run(.declareOutcome(.red, note: nil))
        #expect(try scoresBySeat(session)[1]?.total == 1)
    }

    @Test("Деление троих при девяти: подъёма нет и красным −0.3, а после убитого шерифа — подъём без штрафа")
    func threeWaySplitAtNine() throws {
        for (victim, sheriffKilled) in [(1 as Seat, false), (4 as Seat, true)] {
            var session = try Fixture.session()
            try session.advance(until: \.isNight)
            try session.run(.night(.shot(victim)), .night(.skip), .night(.skip))
            try session.speak(nominating: [(3, 2), (8, 5), (9, 7)])
            let split = Ballot.handCount([CandidateVotes(3, votes: 3), CandidateVotes(8, votes: 3), CandidateVotes(9, votes: 3)])
            try session.run(.submitBallot(split), .advance, .advance, .advance, .submitBallot(split))

            if sheriffKilled {
                #expect(session.step == .liftBallot(candidates: [3, 8, 9]))
                try session.run(.submitBallot(.liftCount(4)))
            }
            #expect(session.state.isDusk)
            try session.run(.declareOutcome(.red, note: nil))
            let penalty = try scoresBySeat(session)[2]?.components.contains { $0.kind == .doubleSplit }
            #expect(penalty == !sheriffKilled)
        }
    }

    @Test("Три ночи подряд никто не уходит — ничья (7.7)")
    func drawAfterThreeQuietNights() throws {
        var session = try Fixture.session()
        for night in 1...3 {
            try session.advance(until: \.isNight)
            try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
            #expect(session.state.isFinished == (night == 3))
        }
        #expect(session.state.outcome == GameOutcome(winner: .draw, reason: .quietNights(3)))
    }

    @Test("Ничьей нет, если за три ночи кто-то покинул стол")
    func noDrawWhenSomeoneLeft() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        try session.run(.disqualify(9, note: nil))
        for _ in 2...3 {
            try session.advance(until: \.isNight)
            try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        }
        #expect(!session.state.isFinished)
    }

    @Test("В первую ночь отстрела дон не проверяет того, в кого стреляли (4.6.9)")
    func donCannotCheckFirstShotTarget() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(5)))
        #expect(throws: GameError.donCannotCheckShotTarget(5)) { try session.perform(.night(.check(5))) }
        try session.run(.night(.check(4)))
    }

    @Test("Если в первый день ушли двое, у ПУ нет лучшего хода (7.10)")
    func noBestMoveAfterDoubleLeave() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.speak(nominating: [(3, 1), (8, 2)])
        let split = Ballot.handCount([CandidateVotes(3, votes: 5), CandidateVotes(8, votes: 5)])
        try session.run(.submitBallot(split), .advance, .advance, .submitBallot(split), .submitBallot(.liftCount(6)))
        #expect(session.state.votings.last?.eliminated == [3, 8])
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.state.firstKilled == 1)
        #expect(session.state.bestMoveAuthors.isEmpty)
    }

    @Test("«Слом» при десяти: лучший ход у выбывшего, и у ПУ — тоже (7.13)")
    func bestMoveForFullTableVoteOut() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.speak(nominating: [(3, 1), (5, 2)])
        try session.run(.submitBallot(.handCount([CandidateVotes(3, votes: 3), CandidateVotes(5, votes: 7)])))
        #expect(session.step == .farewell(5))
        #expect(session.state.awaitsBestMove(from: 5))
        try session.run(.recordBestMoveBy(author: 5, seats: [3, 6, 8]))

        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.state.bestMoveAuthors == [5, 1])
        try session.run(.recordBestMoveBy(author: 1, seats: [3, 2]))
        #expect(throws: GameError.bestMoveNotAvailable) { try session.perform(.recordBestMoveBy(author: 2, seats: [3])) }
        try session.run(.declareOutcome(.red, note: nil))

        let record = try GameRecord(session: session)
        #expect(record.bestMoves.map(\.author) == [5, 1])
        let scores = try scoresBySeat(session)
        #expect(scores[5]?.total == 1.6)
        #expect(scores[1]?.total == 1.1)
    }

    @Test("Удаление ночью отменяет голосование следующего дня (7.1)")
    func nightRemovalCancelsNextVoting() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.disqualify(9, note: nil), .night(.shot(nil)), .night(.skip), .night(.skip))
        try session.speak(nominating: [(3, 2), (8, 5)])
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.skipReason == .cancelledByRemoval)
    }

    @Test("Удаление после итогов голосования отменяет голосование следующего дня (7.2)")
    func duskRemovalCancelsNextVoting() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.speak(nominating: [])
        #expect(session.state.isDusk)
        try session.run(.disqualify(9, note: nil), .advance, .night(.shot(nil)), .night(.skip), .night(.skip))
        try session.speak(nominating: [(3, 2), (8, 5)])
        #expect(session.state.votings.last?.skipReason == .cancelledByRemoval)
        // Через день голосование снова проводится.
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.speak(nominating: [(3, 4), (8, 5)])
        #expect(session.state.votingSession != nil)
    }

    @Test("Старые записи читаются: число техфолов и один лучший ход")
    func decodesLegacyRecord() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.run(.recordBestMove([3, 6]), .techFoul(5), .declareOutcome(.red, note: nil))
        let record = try GameRecord(session: session)

        var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as? [String: Any])
        json["bestMoves"] = nil
        json["seats"] = (json["seats"] as? [[String: Any]])?.map { seat in
            var legacy = seat
            legacy["techFoulKinds"] = nil
            legacy["halvesNextSpeech"] = nil
            legacy["isCriticalRemoval"] = nil
            return legacy
        }
        let decoded = try JSONDecoder().decode(GameRecord.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(decoded.bestMoves == record.bestMoves)
        #expect(decoded.seat(5)?.techFoulKinds == [.ordinary])
    }

    private func scoresBySeat(_ session: GameSession) throws -> [Seat: PlayerGameScore] {
        let record = try GameRecord(session: session)
        return Dictionary(uniqueKeysWithValues: GameScorer.score(record).map { ($0.seat, $0) })
    }
}

extension GameSession {
    /// Доводит до речей дня, выставляет кандидатуры, когда говорит выставляющий,
    /// и жмёт «Далее», пока речи не кончатся.
    mutating func speak(nominating nominations: [(candidate: Seat, by: Seat)]) throws {
        try advance { state in
            if case .day(.speeches) = state.phase { true } else { false }
        }
        while case .day(.speeches) = state.phase {
            if let nomination = nominations.first(where: { $0.by == state.currentSpeaker }) {
                try perform(.nominate(candidate: nomination.candidate, by: nomination.by))
            }
            try perform(.advance)
        }
    }
}
