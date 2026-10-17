import Foundation
import Testing
@testable import MafBoardCore

@Suite("Фолы и удаления")
struct DisciplineTests {
    @Test("Спортивная: третий фол — ближайшая речь вдвое короче (ФСМ 6.4)")
    func thirdFoulHalvesNextSpeech() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.foul(5), .foul(5), .foul(5))
        #expect(session.state.seat(5)?.halvesNextSpeech == true)
        #expect(session.state.events.contains { $0.kind == .speechHalved(5) })

        try session.advance(times: 4)
        #expect(session.step == .speech(5))
        #expect(session.state.timerSeconds == 30)
        try session.advance()
        #expect(session.step == .speech(6))
        #expect(session.state.timerSeconds == 60)
        #expect(session.state.seat(5)?.halvesNextSpeech == false)
    }

    @Test("Городская: третий фол — игрок пропускает ближайшую речь")
    func thirdFoulSkipsNextSpeech() throws {
        var session = try Fixture.session(ruleset: .city, roles: Fixture.cityRoles)
        try session.advance(times: 2)
        try session.run(.foul(5), .foul(5), .foul(5))
        #expect(session.state.seat(5)?.missesNextSpeech == true)

        try session.advance(times: 3)
        #expect(session.step == .speech(4))
        try session.advance()
        #expect(session.step == .speech(6))
        #expect(session.state.events.contains { $0.kind == .speechSkipped(5) })
        #expect(session.state.seat(5)?.missesNextSpeech == false)
    }

    @Test("Четвёртый фол удаляет игрока и отменяет голосование дня")
    func fourthFoulRemovesAndCancelsVoting() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1), .advance, .nominate(candidate: 8, by: 2))
        try session.run(.foul(7), .foul(7), .foul(7), .foul(7))
        #expect(session.state.seat(7)?.elimination?.cause == .removed(.fouls))
        #expect(session.state.isVotingCancelledToday)

        try session.advance(until: \.isDusk)
        #expect(session.state.votings.last?.skipReason == .cancelledByRemoval)
        #expect(session.state.isAlive(3))
    }

    @Test("Дисквалификация во время голосования прерывает его")
    func removalDuringVotingAbortsIt() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1), .advance, .nominate(candidate: 8, by: 2))
        try session.advance(times: 9)
        #expect(session.state.votingSession != nil)

        try session.run(.disqualify(5, note: "Неэтичное поведение"))
        #expect(session.state.isDusk)
        #expect(session.state.votings.last?.skipReason == .cancelledByRemoval)
    }

    @Test("Дисквалифицированного можно вернуть: удаление уходит из журнала вместе с последствиями")
    func reinstateDisqualified() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1), .disqualify(5, note: nil), .foul(2))
        #expect(session.state.isVotingCancelledToday)

        let removed = try session.reinstate(5)
        #expect(removed == .disqualify(5, note: nil))
        #expect(session.state.isAlive(5))
        #expect(!session.state.isVotingCancelledToday)
        #expect(session.state.seat(2)?.fouls == 1)
        #expect(session.log.count == 4)
    }

    @Test("Удалённого за фолы и техфолы возвращаем с фолами на шаг меньше")
    func reinstateAfterFouls() throws {
        var session = try Fixture.session()
        try session.run(.foul(7), .foul(7), .foul(7), .foul(7), .techFoul(2), .techFoul(2), .eliminateByHost(9, note: nil))
        try session.reinstate(7)
        #expect(session.state.isAlive(7))
        #expect(session.state.seat(7)?.fouls == 3)
        try session.reinstate(2)
        #expect(session.state.seat(2)?.techFouls == 1)
        try session.reinstate(9)
        #expect(session.state.isAlive(9))
    }

    @Test("Живого или не удалённого игрока вернуть нельзя")
    func reinstateRequiresRemoval() throws {
        var session = try Fixture.session()
        #expect(throws: GameError.nothingToCancel(4)) { try session.reinstate(4) }
    }

    @Test("Два техфола — удаление")
    func twoTechFoulsRemove() throws {
        var session = try Fixture.session()
        try session.run(.techFoul(2), .techFoul(2))
        #expect(session.state.seat(2)?.elimination?.cause == .removed(.techFouls))
    }

    @Test("Фол можно отменить, но не ниже нуля")
    func cancelFoul() throws {
        var session = try Fixture.session()
        try session.run(.foul(3), .cancelFoul(3))
        #expect(session.state.seat(3)?.fouls == 0)
        #expect(throws: GameError.nothingToCancel(3)) { try session.perform(.cancelFoul(3)) }
    }

    @Test("Предупреждения превращаются в фол, если так настроено")
    func warningsConvertToFoul() throws {
        var rules = Ruleset.sport
        rules.discipline.warningsPerFoul = 2
        var session = try Fixture.session(ruleset: rules)
        try session.run(.warning(4))
        #expect(session.state.seat(4)?.fouls == 0)
        try session.run(.warning(4))
        #expect(session.state.seat(4)?.fouls == 1)
        #expect(session.state.seat(4)?.warnings == 2)
    }

    @Test("Выбывшему игроку фол не ставится")
    func noFoulForEliminatedPlayer() throws {
        var session = try Fixture.session()
        try session.run(.eliminateByHost(2, note: nil))
        #expect(throws: GameError.seatNotAlive(2)) { try session.perform(.foul(2)) }
    }
}
