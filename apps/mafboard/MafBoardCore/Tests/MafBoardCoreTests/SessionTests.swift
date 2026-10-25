import Foundation
import Testing
@testable import MafBoardCore

@Suite("Журнал, отмена и сохранение")
struct SessionTests {
    @Test("Отмена возвращает состояние до последнего действия")
    func undoRestoresPreviousState() throws {
        var session = try Fixture.session()
        let initial = session.state
        try session.run(.foul(3))
        #expect(session.state.seat(3)?.fouls == 1)

        let undone = try session.undo()
        #expect(undone == .foul(3))
        #expect(session.state == initial)
        #expect(session.log.isEmpty)
        #expect(throws: GameError.nothingToUndo) { try session.undo() }
    }

    @Test("Отмена удаления по фолам возвращает игрока в игру")
    func undoRemoval() throws {
        var session = try Fixture.session()
        try session.run(.foul(7), .foul(7), .foul(7), .foul(7))
        #expect(!session.state.isAlive(7))
        try session.undo()
        #expect(session.state.isAlive(7))
        #expect(session.state.seat(7)?.fouls == 3)
    }

    @Test("Ошибочное действие не меняет игру и не попадает в журнал")
    func failedActionLeavesStateIntact() throws {
        var session = try Fixture.session()
        let before = session.state
        #expect(throws: GameError.unknownSeat(42)) { try session.perform(.foul(42)) }
        #expect(session.state == before)
        #expect(session.log.isEmpty)
    }

    @Test("Сохранение и восстановление идущей игры через JSON")
    func codableRoundTrip() throws {
        var session = try Fixture.session()
        let start = Fixture.createdAt
        try session.perform(.advance, at: start.addingTimeInterval(60))
        try session.perform(.advance, at: start.addingTimeInterval(100))
        try session.perform(.nominate(candidate: 3, by: 1), at: start.addingTimeInterval(110))
        try session.perform(.foul(5), at: start.addingTimeInterval(120))

        let data = try JSONEncoder().encode(session)
        let restored = try JSONDecoder().decode(GameSession.self, from: data)
        #expect(restored == session)
        #expect(restored.step == .speech(1))
    }

    @Test("В историю попадает только завершённая игра")
    func recordRequiresFinishedGame() throws {
        var session = try Fixture.session()
        #expect(throws: GameError.gameNotFinished) { try GameRecord(session: session) }
        try session.run(.declareOutcome(.draw, note: "По регламенту"))
        let record = try GameRecord(session: session)
        #expect(record.outcome.winner == .draw)
        #expect(record.log == session.log)
    }

    @Test("Хранилище в памяти возвращает историю игрока, включая фанку")
    func inMemoryStoreHistory() async throws {
        let players = Fixture.players(10)
        var session = try Fixture.session(format: .funky, players: players)
        try session.run(.declareOutcome(.red, note: nil))
        let record = try GameRecord(session: session)
        let store = InMemoryStore()
        await store.save(record)

        let history = await store.records(of: players[0])
        #expect(history.count == 1)
        let rating = await store.records(matching: StandingsQuery(format: .funky, scope: .allTime))
        #expect(rating.isEmpty)
    }
}

@Suite("Сообщения ведущему")
struct ErrorMessageTests {
    @Test("У каждой ошибки есть понятный текст", arguments: [
        GameError.invalidSetup(.playerCount(.city, allowed: 8...20)), .invalidSetup(.duplicatePlayer),
        .invalidSetup(.playersAndRolesMismatch(players: 9, roles: 10)), .invalidSetup(.duplicateUniqueRole(.don)),
        .invalidSetup(.tooManySpecialRoles(special: 11, players: 10)), .invalidSetup(.noBlackRoles),
        .invalidSetup(.tooManyBlackRoles), .invalidSetup(.sportComposition),
        .accessDenied(.formatRequiresGoMafia(.rating)), .accessDenied(.formatRequiresClub(.miniCup)),
        .accessDenied(.goMafiaPlayersRequired(nicknames: ["Гость"])),
        .unknownSeat(1), .seatNotAlive(1), .gameFinished, .gameNotFinished,
        .notAllowedNow(.nominationsNotUsed), .notAllowedNow(.nominationsOnlyDuringSpeeches),
        .notAllowedNow(.nominationOnlyBySpeaker(current: 2)), .notAllowedNow(.nominationOnlyBySpeaker(current: nil)),
        .notAllowedNow(.notVoting), .notAllowedNow(.tieSpeechesFirst), .notAllowedNow(.ballotRequired),
        .notAllowedNow(.notNight), .alreadyNominated(by: 1), .candidateAlreadyNominated(1), .noNomination(by: 1),
        .invalidBallot(.voterNotAllowed(1)), .invalidBallot(.notCandidate(1)), .invalidBallot(.duplicateVoter(1)),
        .invalidBallot(.duplicateCandidate(1)), .invalidBallot(.negativeVotes), .invalidBallot(.tooManyVotes),
        .invalidBallot(.liftBallotExpected), .invalidBallot(.regularBallotExpected),
        .unexpectedNightInput(.donCheck), .cannotTargetSelf(1), .doctorCannotRepeatTarget(1),
        .bestMoveNotAvailable, .invalidBestMove(.seatCount(max: 3)), .invalidBestMove(.duplicateSeats),
        .nothingToCancel(1), .nothingToUndo,
        .extraTimeFoulsLocked(1), .notAllowedNow(.extraTimeOnlyForSpeaker(current: 1)),
        .notAllowedNow(.extraTimeOnlyForSpeaker(current: nil)), .tooManyFoulsForExtraTime(1, max: 3),
        .invalidMiss(.notShooter(1)), .invalidMiss(.duplicateShooter(3)), .invalidMiss(.sameTarget(5)),
    ])
    func everyErrorHasMessage(error: GameError) {
        #expect(!error.message.isEmpty)
        #expect(error.localizedDescription == error.message)
    }
}

@Suite("Таймер")
struct CountdownTests {
    @Test("Пауза, продолжение и «+30 секунд»")
    func pauseResumeExtend() {
        let start = Date(timeIntervalSince1970: 0)
        var countdown = Countdown(seconds: 60)
        countdown.start(at: start)
        #expect(countdown.remaining(at: start + 20) == 40)
        countdown.pause(at: start + 20)
        #expect(countdown.remaining(at: start + 100) == 40)
        countdown.extend(bySeconds: 30)
        countdown.start(at: start + 100)
        #expect(countdown.remaining(at: start + 150) == 20)
        #expect(countdown.isExpired(at: start + 170))
    }

    @Test("Перебор после конца времени и доля оставшегося")
    func overtimeAndFraction() {
        let start = Date(timeIntervalSince1970: 0)
        var countdown = Countdown(seconds: 60)
        countdown.start(at: start)
        #expect(countdown.fraction(at: start + 15) == 0.75)
        #expect(countdown.overtime(at: start + 30) == 0)
        #expect(countdown.overtime(at: start + 65) == 5)
        #expect(countdown.fraction(at: start + 65) == 0)
    }

    @Test("Время вышло — таймер стоит на нуле, а +30 снова даёт время")
    func finishStopsAtZero() {
        let start = Date(timeIntervalSince1970: 0)
        var countdown = Countdown(seconds: 60)
        countdown.start(at: start)
        countdown.finish()
        #expect(!countdown.isRunning)
        #expect(countdown.isExpired(at: start + 500))
        #expect(countdown.overtime(at: start + 500) == 0)
        countdown.extend(bySeconds: 30)
        #expect(countdown.remaining(at: start + 500) == 30)
    }
}
