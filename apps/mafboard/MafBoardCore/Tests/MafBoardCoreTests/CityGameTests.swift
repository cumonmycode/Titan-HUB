import Foundation
import Testing
@testable import MafBoardCore

@Suite("Городская мафия")
struct CityGameTests {
    private func citySession(_ roles: [Role] = Fixture.cityRoles) throws -> GameSession {
        try Fixture.session(ruleset: .city, roles: roles)
    }

    @Test("Первый день: речи, добор первого игрока, без голосования")
    func firstDayHasNoVoting() throws {
        var session = try citySession()
        #expect(session.step == .timed(TimedStep(.introduction, seconds: 60), speaker: nil))
        try session.advance(times: 2)
        #expect(session.step == .speech(1))
        #expect(throws: GameError.notAllowedNow(.nominationsNotUsed)) {
            try session.perform(.nominate(candidate: 3, by: 1))
        }

        try session.advance(times: 10)
        #expect(session.step == .timed(TimedStep(.openerAddition, seconds: 30), speaker: 1))
        #expect(session.state.currentSpeaker == 1)
        try session.advance()
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.skipReason == .notHeldOnThisDay)
    }

    @Test("Доктор спасает, общая минута, голосование за всех, повторный попил — никто не уходит")
    func doctorSavesAndRepeatedTieKeepsEveryone() throws {
        var session = try citySession()
        try session.advance(until: \.isNight)
        #expect(session.state.nightSteps == [.mafiaShot, .donCheck, .sheriffCheck, .doctorHeal])
        try session.run(.night(.shot(4)), .night(.check(4)), .night(.check(3)), .night(.heal(4)))

        let report = try #require(session.state.nights.last)
        #expect(report.victims.isEmpty)
        #expect(report.saved == [4])
        #expect(session.state.isAlive(4))
        #expect(session.state.bestMoveAuthor == nil)
        #expect(session.step == .speech(2))

        try session.advance(times: 10)
        #expect(session.step == .timed(TimedStep(.commonMinute, seconds: 60), speaker: nil))
        try session.advance()
        #expect(session.step == .ballot(candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], kind: .main))

        let split = Ballot.handCount([CandidateVotes(3, votes: 5), CandidateVotes(6, votes: 5)])
        try session.run(.submitBallot(split))
        #expect(session.step == .tieSpeech(3))
        try session.advance(times: 2)
        try session.run(.submitBallot(split))
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.eliminated == [])

        try session.advance()
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        #expect(throws: GameError.doctorCannotRepeatTarget(4)) {
            try session.perform(.night(.heal(4)))
        }
    }

    @Test("Маньяк и мафия убивают разных игроков за одну ночь")
    func maniacAndMafiaKillTogether() throws {
        let roles: [Role] = [
            .civilian, .doctor, .mafia, .sheriff, .civilian, .don, .civilian,
            .mafia, .maniac, .kamikaze, .civilian, .civilian, .civilian,
        ]
        var session = try citySession(roles)
        try session.advance(until: \.isNight)
        #expect(session.state.nightSteps == [.mafiaShot, .maniacShot, .donCheck, .sheriffCheck, .doctorHeal])

        try session.run(.night(.shot(1)), .night(.shot(5)), .night(.check(4)), .night(.check(9)), .night(.heal(7)))
        let report = try #require(session.state.nights.last)
        #expect(report.victims == [NightVictim(seat: 1, killer: .mafia), NightVictim(seat: 5, killer: .maniac)])
        #expect(report.actions.checks.last?.isPositive == true)
        #expect(session.state.bestMoveAuthor == 1)
        #expect(session.step == .farewellBestMove(1))
        try session.advance(times: 2)
        // В городской протокол отдельным шагом не оставляют — сразу следующий убитый.
        #expect(session.step == .farewell(5))
    }

    @Test("Бессмертного нельзя убить ночью")
    func immortalSurvivesNight() throws {
        let roles: [Role] = [
            .civilian, .doctor, .mafia, .sheriff, .civilian, .don, .civilian,
            .mafia, .maniac, .kamikaze, .civilian, .civilian, .civilian, .immortal,
        ]
        var session = try citySession(roles)
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(14)), .night(.shot(nil)), .night(.skip), .night(.skip), .night(.skip))
        #expect(session.state.isAlive(14))
        #expect(session.state.nights.last?.saved == [14])
    }
}
