import Foundation
import Testing
@testable import MafBoardCore

@Suite("Спортивная мафия: ход игры")
struct SportGameTests {
    @Test("Полная игра: голосование, ночи, лучший ход, победа мирных")
    func fullGameRedWins() throws {
        var session = try Fixture.session()
        #expect(session.step == .timed(TimedStep(.mafiaMeeting, seconds: 60), speaker: nil))
        try session.advance(times: 2)
        #expect(session.step == .speech(1))
        #expect(session.state.dayNumber == 1)

        // День 1: выставлены 3 и 8, уходит 3.
        try session.run(.nominate(candidate: 3, by: 1))
        try session.advance()
        try session.run(.nominate(candidate: 8, by: 2))
        try session.advance(times: 9)
        #expect(session.step == .ballot(candidates: [3, 8], kind: .main))
        try session.run(.submitBallot(.perVoter([
            Vote(1, for: 3), Vote(2, for: 3), Vote(4, for: 3), Vote(5, for: 3), Vote(7, for: 3), Vote(9, for: 3),
        ])))
        #expect(session.step == .farewell(3))
        #expect(!session.state.isAlive(3))
        try session.advance()
        #expect(session.step == .dusk)

        // Ночь 1: убит 1, дон нашёл шерифа, шериф нашёл дона.
        try session.advance()
        #expect(session.step == .night(.mafiaShot))
        try session.run(.night(.shot(1)), .night(.check(4)), .night(.check(6)))
        let night = try #require(session.state.nights.first)
        #expect(night.victims == [NightVictim(seat: 1, killer: .mafia)])
        #expect(night.actions.checks.map(\.isPositive) == [true, true])
        #expect(session.state.bestMoveAuthor == 1)
        #expect(session.step == .farewell(1))
        try session.run(.recordBestMove([8, 6, 2]))
        #expect(session.state.bestMove == BestMove(author: 1, seats: [2, 6, 8]))

        // День 2 открывает следующий живой после 1. Одна кандидатура уходит без голосования.
        try session.advance()
        #expect(session.step == .speech(2))
        try session.advance()
        try session.run(.nominate(candidate: 6, by: 4))
        try session.advance(times: 7)
        #expect(session.step == .farewell(6))
        #expect(session.state.votings.last?.isAutomatic == true)

        // Ночь 2: дон выбыл — его проверки нет.
        try session.advance(times: 2)
        #expect(session.state.nightSteps == [.mafiaShot, .sheriffCheck])
        try session.run(.night(.shot(4)), .night(.check(8)))
        #expect(session.step == .farewell(4))
        try session.advance()
        #expect(session.step == .speech(5))

        // День 3: уходит последний чёрный.
        try session.run(.nominate(candidate: 8, by: 5))
        try session.advance(times: 6)
        #expect(session.state.outcome == GameOutcome(winner: .red, reason: .allBlackEliminated))
        #expect(session.state.isFinished)
        #expect(throws: GameError.gameFinished) { try session.perform(.advance) }
    }

    @Test("Мафия побеждает, когда чёрных не меньше, чем красных")
    func blackWinsAtParity() throws {
        var session = try Fixture.session()
        try session.run(
            .eliminateByHost(1, note: nil),
            .eliminateByHost(2, note: nil),
            .eliminateByHost(4, note: nil)
        )
        #expect(session.state.outcome == nil)
        try session.run(.eliminateByHost(5, note: nil))
        #expect(session.state.outcome == GameOutcome(winner: .black, reason: .blackReachedParity))
    }

    @Test("Нет кандидатур — день заканчивается без голосования")
    func noCandidatesSkipsVoting() throws {
        var session = try Fixture.session()
        try session.advance(times: 12)
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.skipReason == .noCandidates)
    }

    @Test("Промах: утром нет прощальных речей, день открывает следующий номер")
    func missedShotStartsSpeechesImmediately() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        #expect(session.state.nights.last?.victims.isEmpty == true)
        #expect(session.state.dayNumber == 2)
        #expect(session.step == .speech(2))
    }

    @Test("Лучший ход — только у убитого в первую ночь")
    func bestMoveOnlyAfterFirstNight() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(5)), .night(.skip), .night(.skip))
        #expect(!session.state.isAlive(5))
        #expect(session.state.bestMoveAuthor == nil)
        #expect(throws: GameError.bestMoveNotAvailable) { try session.perform(.recordBestMove([3])) }
    }

    @Test("Лучший ход проверяется: не себя и не больше трёх номеров")
    func bestMoveValidation() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(throws: GameError.invalidBestMove(.includesAuthor)) {
            try session.perform(.recordBestMove([1, 2]))
        }
        #expect(throws: GameError.invalidBestMove(.seatCount(max: 3))) {
            try session.perform(.recordBestMove([2, 3, 5, 6]))
        }
    }

    @Test("Ночной ввод должен соответствовать текущему шагу")
    func nightInputMustMatchStep() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        #expect(throws: GameError.unexpectedNightInput(.mafiaShot)) {
            try session.perform(.night(.check(4)))
        }
        try session.run(.night(.shot(2)))
        #expect(throws: GameError.cannotTargetSelf(6)) {
            try session.perform(.night(.check(6)))
        }
    }

    @Test("Экран ведущего получает шаг и длительность таймера")
    func currentStepProjection() throws {
        var session = try Fixture.session()
        #expect(session.state.timerSeconds == 60)
        try session.advance()
        #expect(session.state.timerSeconds == 40)
        try session.advance()
        #expect(session.state.currentSpeaker == 1)
        #expect(session.state.timerSeconds == 60)
        try session.advance(until: \.isNight)
        #expect(session.state.timerSeconds == nil)
    }
}
