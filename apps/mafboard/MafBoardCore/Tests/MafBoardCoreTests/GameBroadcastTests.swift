import Foundation
import Testing
@testable import MafBoardCore

/// Снимок для инфографики MafBoard Studio. Полную проверку контракта делает Rust: с переменной
/// `MAFBOARD_BROADCAST_DUMP=<папка>` тесты кладут туда JSON каждого этапа, а MBS прогоняет его через `validate`.
@Suite("Снимок игры для MafBoard Studio")
struct GameBroadcastTests {
    static let start = Date(timeIntervalSince1970: 1_800_000_100)

    static func profiles(for session: GameSession) -> [PlayerProfile] {
        session.setup.seats.map { seat in
            PlayerProfile(
                nickname: "Игрок \(seat.seat)", id: seat.playerID,
                avatarURL: URL(string: seat.seat.number == 2 ? "http://insecure.example/2.jpg" : "https://img.example/\(seat.seat).jpg")
            )
        }
    }

    static func snapshot(_ session: GameSession, countdown: Countdown? = nil, revision: UInt64 = 1, at date: Date = start) -> GameBroadcast {
        GameBroadcast(session: session, players: profiles(for: session), context: GameBroadcastContext(countdown: countdown), revision: revision, at: date)
    }

    static func json(_ broadcast: GameBroadcast) throws -> [String: Any] {
        let data = try JSONEncoder().encode(broadcast)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// Копия снимка для проверки на стороне MBS.
    static func dump(_ broadcast: GameBroadcast, as name: String) throws {
        guard let folder = ProcessInfo.processInfo.environment["MAFBOARD_BROADCAST_DUMP"] else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let url = URL(fileURLWithPath: folder).appending(path: "\(name).json")
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(broadcast).write(to: url)
    }

    @Test("Нулевая ночь: игроки с ролями и командами, общий таймер договорки")
    func nightZero() throws {
        let session = try Fixture.session()
        var countdown = Countdown(seconds: 60)
        countdown.start(at: Self.start)
        let broadcast = Self.snapshot(session, countdown: countdown, at: Self.start.addingTimeInterval(19.5))
        try Self.dump(broadcast, as: "01-night-zero")

        #expect(broadcast.version == 1)
        #expect(broadcast.gameId == session.setup.gameID.description)
        #expect(broadcast.phase == .init(kind: .nightZero, number: 0))
        #expect(broadcast.players.count == 10)
        let don = try #require(broadcast.players.first { $0.seat == 6 })
        #expect(don.role == "don")
        #expect(don.team == .black)
        #expect(don.status == .alive)
        #expect(don.avatarUrl == "https://img.example/6.jpg")
        // Не https — ноутбук отклонил бы весь снимок, поэтому фото просто нет.
        #expect(broadcast.players.first { $0.seat == 2 }?.avatarUrl == nil)
        #expect(broadcast.speech == .init(seat: nil, kind: .common, timer: .init(totalSeconds: 60, remainingMs: 40_500, running: true)))

        let object = try Self.json(broadcast)
        #expect(object["gameId"] is String)
        #expect((object["phase"] as? [String: Any])?["kind"] as? String == "nightZero")
        #expect(object["voting"] == nil)
        #expect(object["outcome"] == nil)
        let player = try #require((object["players"] as? [[String: Any]])?.first)
        #expect(Set(player.keys) == ["seat", "nickname", "avatarUrl", "role", "roleName", "team", "status", "fouls", "techFouls", "bigTechFouls", "silenced"])
    }

    @Test("Речь дня: говорящий, таймер на паузе, выставления, фолы и пропуск речи")
    func daySpeech() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1), .foul(5), .foul(5), .foul(5), .techFoul(7), .bigTechFoul(8))
        var countdown = Countdown(seconds: 60)
        countdown.start(at: Self.start)
        countdown.pause(at: Self.start.addingTimeInterval(12))
        let broadcast = Self.snapshot(session, countdown: countdown, at: Self.start.addingTimeInterval(30))
        try Self.dump(broadcast, as: "02-day-speech")

        #expect(broadcast.phase == .init(kind: .day, number: 1))
        #expect(broadcast.speech == .init(seat: 1, kind: .speech, timer: .init(totalSeconds: 60, remainingMs: 48_000, running: false)))
        #expect(broadcast.nominations == [.init(candidate: 3, by: 1)])
        let five = try #require(broadcast.players.first { $0.seat == 5 })
        #expect(five.fouls == 3)
        #expect(five.silenced == session.state.seat(5)?.missesNextSpeech)
        #expect(broadcast.players.first { $0.seat == 7 }?.techFouls == 1)
        #expect(broadcast.players.first { $0.seat == 7 }?.bigTechFouls == 0)
        #expect(broadcast.players.first { $0.seat == 8 }?.techFouls == 1)
        #expect(broadcast.players.first { $0.seat == 8 }?.bigTechFouls == 1)
        #expect(broadcast.days == [.init(number: 1, eliminated: [], finished: false)])
    }

    @Test("Голосование: кандидаты, подсчитанный круг с голосовавшими, ушедший и итог дня")
    func voting() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1))
        try session.advance()
        try session.run(.nominate(candidate: 8, by: 2))
        try session.advance(times: 9)

        let ballot = Self.snapshot(session, revision: 5)
        try Self.dump(ballot, as: "03-voting")
        #expect(ballot.phase == .init(kind: .voting, number: 1))
        #expect(ballot.voting == .init(round: .main, candidates: [3, 8]))
        #expect(ballot.speech == nil)

        try session.run(.submitBallot(.perVoter([
            Vote(1, for: 3), Vote(2, for: 3), Vote(4, for: 3), Vote(5, for: 3), Vote(7, for: 3), Vote(9, for: 3),
        ])))
        let result = Self.snapshot(session, revision: 6)
        try Self.dump(result, as: "04-voted-out")
        let voting = try #require(result.voting)
        #expect(voting.eliminated == [3])
        let tally = try #require(voting.tallies.first { $0.candidate == 3 })
        #expect(tally.votes == session.state.votings.last?.rounds.last?.results.first { $0.candidate == 3 }?.votes)
        #expect(tally.voters.contains(1))
        #expect(result.players.first { $0.seat == 3 }?.status == .votedOut)
        #expect(result.speech?.seat == 3)
        #expect(result.speech?.kind == .farewell)
        #expect(result.days == [.init(number: 1, eliminated: [3], finished: false)])
    }

    @Test("Попил: оправдания и переголосование показывают лидеров")
    func tie() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1))
        try session.advance()
        try session.run(.nominate(candidate: 8, by: 2))
        try session.advance(times: 9)
        try session.run(.submitBallot(.perVoter([
            Vote(1, for: 3), Vote(2, for: 3), Vote(4, for: 3), Vote(5, for: 3), Vote(6, for: 3),
            Vote(3, for: 8), Vote(7, for: 8), Vote(8, for: 8), Vote(9, for: 8), Vote(10, for: 8),
        ])))
        let defense = Self.snapshot(session)
        try Self.dump(defense, as: "05-tie")
        #expect(defense.speech?.kind == .defense)
        #expect(defense.voting?.tie == [3, 8])
        #expect(defense.voting?.tallies.map(\.votes) == [5, 5])
    }

    @Test("Ночь: выстрел и проверки по ходу ночи, затем ночь закрыта")
    func night() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.advance(until: { $0.isNight })
        try session.run(.night(.shot(1)))
        let during = Self.snapshot(session)
        try Self.dump(during, as: "06-night")
        #expect(during.phase == .init(kind: .night, number: 1))
        #expect(during.nights == [.init(number: 1, resolved: false, shot: 1)])

        try session.run(.night(.check(4)), .night(.check(6)))
        let morning = Self.snapshot(session)
        try Self.dump(morning, as: "07-morning")
        #expect(morning.nights == [.init(
            number: 1, resolved: true, shot: 1,
            donCheck: .init(target: 4, positive: true), sheriffCheck: .init(target: 6, positive: true)
        )])
        #expect(morning.players.first { $0.seat == 1 }?.status == .killed)
        #expect(morning.days.first?.finished == true)
    }

    @Test("Итог: победитель, баллы с допбаллами и лучший ход с баллами")
    func outcome() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.advance(until: { $0.isNight })
        try session.run(.night(.shot(1)), .night(.check(4)), .night(.check(6)))
        try session.advance(until: { $0.awaitsBestMove(from: 1) || $0.currentStep == .farewell(1) })
        if session.state.awaitsBestMove(from: 1) { try session.run(.recordBestMove([3, 6, 8])) }
        try session.run(.declareOutcome(.red, note: nil), .adjustScore(ScoreAdjustment(seat: 4, points: 0.5, note: "вскрылся")))

        let broadcast = Self.snapshot(session, revision: 42)
        try Self.dump(broadcast, as: "08-finished")
        #expect(broadcast.phase.kind == .finished)
        let outcome = try #require(broadcast.outcome)
        #expect(outcome.winner == .red)
        #expect(outcome.scoresFinal)
        #expect(outcome.scores.count == 10)
        let sheriff = try #require(outcome.scores.first { $0.seat == 4 })
        #expect(sheriff.extra >= 0.5)
        #expect(abs(sheriff.total - (sheriff.main + sheriff.extra + sheriff.penalty)) < 0.001)
        let mafia = try #require(outcome.scores.first { $0.seat == 3 })
        #expect(mafia.main < sheriff.main)
        if let move = broadcast.bestMove {
            #expect(move.author == 1)
            #expect(move.points != nil)
        }
        #expect(broadcast.speech == nil)
    }

    @Test("Удалённый за фолы — removed, лишние длинные ники обрезаны")
    func removalAndLimits() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.disqualify(9, note: nil))
        var profiles = Self.profiles(for: session)
        profiles[0].nickname = String(repeating: "я", count: 120)
        let broadcast = GameBroadcast(session: session, players: profiles, revision: 1, at: Self.start)
        #expect(broadcast.players.first { $0.seat == 9 }?.status == .removed)
        #expect(broadcast.players[0].nickname.count == 80)
    }

    @Test("Досылка после переподключения: идущий таймер отсчитан, на паузе — нет")
    func aging() {
        let running = GameBroadcast(
            gameId: "g", revision: 1, phase: .init(kind: .day, number: 1), players: [.init(seat: 1, nickname: "A")],
            speech: .init(seat: 1, kind: .speech, timer: .init(totalSeconds: 60, remainingMs: 10_000, running: true))
        )
        #expect(running.aged(by: 4).speech?.timer == .init(totalSeconds: 60, remainingMs: 6_000, running: true))
        #expect(running.aged(by: 30).speech?.timer == .init(totalSeconds: 60, remainingMs: 0, running: false))
        var paused = running
        paused.speech?.timer?.running = false
        #expect(paused.aged(by: 4) == paused)
    }
}
