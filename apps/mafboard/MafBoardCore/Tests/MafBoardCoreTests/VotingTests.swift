import Foundation
import Testing
@testable import MafBoardCore

@Suite("Голосование")
struct VotingTests {
    /// Первый день спортивной игры: кандидатуры выставлены, речи закончились.
    private func sessionAtVoting(_ nominations: [(candidate: Seat, by: Seat)]) throws -> GameSession {
        var session = try Fixture.session()
        try session.advance(times: 2)
        for _ in 0..<10 {
            if let nomination = nominations.first(where: { $0.by == session.state.currentSpeaker }) {
                try session.perform(.nominate(candidate: nomination.candidate, by: nomination.by))
            }
            try session.advance()
        }
        return session
    }

    private let split = Ballot.handCount([CandidateVotes(3, votes: 5), CandidateVotes(8, votes: 5)])

    @Test("Не проголосовавшие отдают голос последней кандидатуре")
    func abstainersVoteForLast() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2)])
        try session.run(.submitBallot(.perVoter([Vote(1, for: 3), Vote(2, for: 3)])))
        let round = try #require(session.state.votings.last?.rounds.first)
        #expect(round.results.map(\.votes) == [2, 8])
        #expect(round.autoAssignedVoters == [3, 4, 5, 6, 7, 8, 9, 10])
        #expect(session.state.votings.last?.eliminated == [8])
    }

    @Test("Попил → оправдания → переголосование → подъём проходит")
    func repeatedTieLiftPasses() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2)])
        try session.run(.submitBallot(split))
        #expect(session.step == .tieSpeech(3))
        #expect(session.state.timerSeconds == 30)
        try session.advance()
        #expect(session.step == .tieSpeech(8))
        try session.advance()
        #expect(session.step == .ballot(candidates: [3, 8], kind: .revote))

        try session.run(.submitBallot(split))
        #expect(session.step == .liftBallot(candidates: [3, 8]))
        try session.run(.submitBallot(.lift(voters: [1, 2, 4, 5, 6, 7])))
        #expect(session.state.votings.last?.eliminated == [3, 8])
        #expect(session.step == .farewell(3))
        try session.advance()
        #expect(session.step == .farewell(8))
    }

    @Test("Подъём не проходит, если «за» ровно половина")
    func liftFailsAtHalf() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2)])
        try session.run(.submitBallot(split))
        try session.advance(times: 2)
        try session.run(.submitBallot(split), .submitBallot(.liftCount(5)))
        #expect(session.state.votings.last?.eliminated == [])
        #expect(session.state.isDusk)
        #expect(session.state.aliveSeats.count == 10)
    }

    @Test("Лидеров в переголосовании стало меньше — ещё один попил только между ними")
    func shrinkingTieRevotesAgain() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2), (5, 4)])
        try session.run(.submitBallot(.handCount([
            CandidateVotes(3, votes: 3), CandidateVotes(8, votes: 3), CandidateVotes(5, votes: 3),
        ])))
        try session.advance(times: 3)
        try session.run(.submitBallot(.handCount([
            CandidateVotes(3, votes: 4), CandidateVotes(8, votes: 4), CandidateVotes(5, votes: 2),
        ])))
        #expect(session.step == .tieSpeech(3))
        #expect(session.state.votingSession?.candidates == [3, 8])
        try session.advance(times: 2)
        try session.run(.submitBallot(split))
        #expect(session.step == .liftBallot(candidates: [3, 8]))
    }

    @Test("Одна кандидатура в первый день — голосования нет")
    func singleCandidateOnFirstDay() throws {
        let session = try sessionAtVoting([(3, 1)])
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.skipReason == .singleCandidateOnFirstDay)
        #expect(session.state.isAlive(3))
    }

    @Test("Ошибочные голоса отклоняются")
    func invalidBallotsRejected() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2)])
        #expect(throws: GameError.invalidBallot(.voterNotAllowed(11))) {
            try session.perform(.submitBallot(.perVoter([Vote(11, for: 3)])))
        }
        #expect(throws: GameError.invalidBallot(.notCandidate(5))) {
            try session.perform(.submitBallot(.perVoter([Vote(1, for: 5)])))
        }
        #expect(throws: GameError.invalidBallot(.duplicateVoter(1))) {
            try session.perform(.submitBallot(.perVoter([Vote(1, for: 3), Vote(1, for: 8)])))
        }
        #expect(throws: GameError.invalidBallot(.tooManyVotes)) {
            try session.perform(.submitBallot(.handCount([CandidateVotes(3, votes: 6), CandidateVotes(8, votes: 5)])))
        }
        #expect(throws: GameError.invalidBallot(.regularBallotExpected)) {
            try session.perform(.submitBallot(.liftCount(6)))
        }
    }

    @Test("Во время оправдательных речей голоса не принимаются")
    func noBallotDuringTieSpeeches() throws {
        var session = try sessionAtVoting([(3, 1), (8, 2)])
        try session.run(.submitBallot(split))
        #expect(throws: GameError.notAllowedNow(.tieSpeechesFirst)) {
            try session.perform(.submitBallot(split))
        }
    }

    @Test("Правила выставления кандидатур")
    func nominationRules() throws {
        var session = try Fixture.session()
        #expect(throws: GameError.notAllowedNow(.nominationsOnlyDuringSpeeches)) {
            try session.perform(.nominate(candidate: 3, by: 1))
        }
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1))
        #expect(throws: GameError.alreadyNominated(by: 1)) {
            try session.perform(.nominate(candidate: 5, by: 1))
        }
        #expect(throws: GameError.notAllowedNow(.nominationOnlyBySpeaker(current: 1))) {
            try session.perform(.nominate(candidate: 5, by: 2))
        }
        try session.advance()
        #expect(throws: GameError.candidateAlreadyNominated(3)) {
            try session.perform(.nominate(candidate: 3, by: 2))
        }
        try session.run(.withdrawNomination(by: 1), .nominate(candidate: 3, by: 2))
        #expect(session.state.nominations == [Nomination(candidate: 3, by: 2)])
    }
}
