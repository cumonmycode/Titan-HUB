import Foundation
import Testing
@testable import MafBoardCore

enum AccountFixture {
    static let club = GoMafiaClub(id: 77, title: "TITAN", city: "Москва")
    static let host = GoMafiaPlayer(id: 4242, nickname: "Ведущий")

    static func account(linked: Bool, club: GoMafiaClub? = club) -> UserAccount {
        let link = linked
            ? GoMafiaLink(player: host, club: club, linkedAt: Fixture.createdAt, syncedAt: Fixture.createdAt)
            : nil
        return UserAccount(
            id: UserID(),
            telegram: TelegramIdentity(id: 1001, username: "host", firstName: "Ведущий"),
            goMafia: link
        )
    }

    static func goMafiaPlayers(_ count: Int = 10) -> [PlayerProfile] {
        (1...count).map { PlayerProfile(goMafia: GoMafiaPlayer(id: 1000 + $0, nickname: "Игрок \($0)")) }
    }
}

@Suite("Аккаунты и права ведущего")
struct HostingAccessTests {
    @Test("Игрок GoMafia получает одинаковый PlayerID на любом устройстве")
    func stableGoMafiaPlayerID() {
        #expect(PlayerID.goMafia(12345) == PlayerID.goMafia(12345))
        #expect(PlayerID.goMafia(12345) != PlayerID.goMafia(12346))
        #expect(PlayerID.goMafia(12345).goMafiaPlayerID == 12345)
        #expect(PlayerID().goMafiaPlayerID == nil)
        #expect(PlayerProfile(goMafia: GoMafiaPlayer(id: 7, nickname: "Seven")).id == .goMafia(7))
    }

    @Test("Без GoMafia — только фанки в личную историю")
    func withoutGoMafiaOnlyFunky() throws {
        let access = AccountFixture.account(linked: false).hostingAccess
        #expect(access.allowedFormats == [.funky])
        #expect(access.history == .personal)
        #expect(throws: GameError.accessDenied(.formatRequiresGoMafia(.rating))) {
            try access.authorize(format: .rating, players: AccountFixture.goMafiaPlayers())
        }
        try access.authorize(format: .funky, players: [PlayerProfile(nickname: "Гость")])
    }

    @Test("GoMafia без клуба — режимы клуба недоступны")
    func linkedWithoutClub() {
        let access = AccountFixture.account(linked: true, club: nil).hostingAccess
        #expect(throws: GameError.accessDenied(.formatRequiresClub(.miniCup))) {
            try access.authorize(format: .miniCup, players: AccountFixture.goMafiaPlayers())
        }
    }

    @Test("Ведущий клуба проводит все режимы, но в рейтинг — только игроки GoMafia")
    func clubHostAllFormats() throws {
        let access = AccountFixture.account(linked: true).hostingAccess
        #expect(access.allowedFormats == CompetitionFormat.allCases)
        #expect(access.history == .club(AccountFixture.club))
        try access.authorize(format: .rating, players: AccountFixture.goMafiaPlayers())

        var players = AccountFixture.goMafiaPlayers()
        players[3] = PlayerProfile(nickname: "Гость")
        #expect(throws: GameError.accessDenied(.goMafiaPlayersRequired(nicknames: ["Гость"]))) {
            try access.authorize(format: .rating, players: players)
        }
    }

    @Test("Игра ведущего клуба помечается клубом и попадает в его историю")
    func hostedGameCarriesClub() throws {
        let account = AccountFixture.account(linked: true)
        let setup = try GameSetup.hosted(
            by: account, format: .rating, ruleset: .sport,
            players: AccountFixture.goMafiaPlayers(), roles: Fixture.sportRoles, createdAt: Fixture.createdAt
        )
        var session = GameSession(setup: setup)
        try session.run(.declareOutcome(.red, note: nil))
        let record = try GameRecord(session: session)
        #expect(record.clubID == 77)
        #expect(record.host?.userID == account.id)
        #expect(record.host?.goMafiaPlayerID == 4242)
    }
}

@Suite("Вход через Telegram-бота")
struct TelegramLoginTests {
    private let secret = DeviceSecret(value: "device-secret")
    private let ticket = LoginTicket(
        id: "t-1",
        deepLink: URL(string: "https://t.me/mafboard_bot?start=login_abc")!,
        expiresAt: Fixture.createdAt.addingTimeInterval(600)
    )
    private var session: AuthSession {
        AuthSession(
            tokens: AuthTokens(accessToken: "a", refreshToken: "r", accessExpiresAt: Fixture.createdAt),
            account: AccountFixture.account(linked: false)
        )
    }

    @Test("Счастливый путь: билет → бот → ссылка возврата → сессия")
    func happyPath() {
        var flow = TelegramLoginFlow()
        #expect(flow.handle(.start(secret)) == [.requestTicket(secret)])
        #expect(flow.handle(.ticketIssued(ticket)) == [.openTelegram(ticket.deepLink)])
        #expect(flow.pollingTicketID == "t-1")
        #expect(flow.handle(.statusReceived(.pending(opened: true))).isEmpty)
        #expect(flow.state == .waitingForTelegram(ticket, secret, opened: true))
        #expect(flow.handle(.returnedFromTelegram(ticketID: "t-1")) == [.completeLogin(ticketID: "t-1", secret)])
        let received = session
        _ = flow.handle(.sessionReceived(received))
        #expect(flow.state == .signedIn(received))
    }

    @Test("Подтверждение пришло опросом — приложение тоже завершает вход")
    func confirmedByPolling() {
        var flow = TelegramLoginFlow()
        _ = flow.handle(.start(secret))
        _ = flow.handle(.ticketIssued(ticket))
        #expect(flow.handle(.statusReceived(.confirmed)) == [.completeLogin(ticketID: "t-1", secret)])
    }

    @Test("Сбой сети при обмене билета не теряет вход: снова ждём и повторяем по опросу")
    func interruptedCompletionRetries() {
        var flow = TelegramLoginFlow()
        _ = flow.handle(.start(secret))
        _ = flow.handle(.ticketIssued(ticket))
        _ = flow.handle(.returnedFromTelegram(ticketID: "t-1"))
        #expect(flow.pendingTicket?.0 == ticket)
        #expect(flow.handle(.completionInterrupted).isEmpty)
        #expect(flow.state == .waitingForTelegram(ticket, secret, opened: true))
        #expect(flow.handle(.statusReceived(.confirmed)) == [.completeLogin(ticketID: "t-1", secret)])
        _ = flow.handle(.requestFailed("Билет уже использован"))
        #expect(flow.state == .failed(.network("Билет уже использован")))
        #expect(flow.pendingTicket == nil)
    }

    @Test("После перезапуска приложения вход продолжается с сохранённым билетом")
    func resumeAfterRelaunch() {
        var flow = TelegramLoginFlow()
        #expect(flow.handle(.resume(ticket, secret)).isEmpty)
        #expect(flow.pollingTicketID == "t-1")
        #expect(flow.handle(.returnedFromTelegram(ticketID: "t-1")) == [.completeLogin(ticketID: "t-1", secret)])

        var busy = TelegramLoginFlow()
        _ = busy.handle(.start(secret))
        #expect(busy.handle(.resume(ticket, secret)).isEmpty)
        #expect(busy.state == .requestingTicket(secret))
    }

    @Test("Чужая ссылка возврата игнорируется, отказ и истечение завершают вход")
    func failures() {
        var flow = TelegramLoginFlow()
        _ = flow.handle(.start(secret))
        _ = flow.handle(.ticketIssued(ticket))
        #expect(flow.handle(.returnedFromTelegram(ticketID: "чужой")).isEmpty)
        #expect(flow.pollingTicketID == "t-1")

        _ = flow.handle(.statusReceived(.rejected(note: "Это не я")))
        #expect(flow.state == .failed(.rejected(note: "Это не я")))

        var expiring = TelegramLoginFlow()
        _ = expiring.handle(.start(secret))
        _ = expiring.handle(.ticketIssued(ticket))
        _ = expiring.handle(.clockTick(ticket.expiresAt))
        #expect(expiring.state == .failed(.expired))
        #expect(expiring.handle(.start(secret)) == [.requestTicket(secret)])
    }

    @Test("Ссылка возврата: Universal Link и схема приложения")
    func returnLinkParsing() {
        let hosts: Set<String> = ["mafboard.app"]
        #expect(LoginReturnLink.ticketID(from: URL(string: "https://mafboard.app/auth/return?ticket=t-1")!, allowedHosts: hosts) == "t-1")
        #expect(LoginReturnLink.ticketID(from: URL(string: "mafboard://auth/return?ticket=t-2")!, allowedHosts: hosts) == "t-2")
        #expect(LoginReturnLink.ticketID(from: URL(string: "https://evil.example/auth/return?ticket=t-1")!, allowedHosts: hosts) == nil)
        #expect(LoginReturnLink.ticketID(from: URL(string: "https://mafboard.app/other?ticket=t-1")!, allowedHosts: hosts) == nil)
        #expect(LoginReturnLink.ticketID(from: URL(string: "https://mafboard.app/auth/return")!, allowedHosts: hosts) == nil)
    }

    @Test("Секрет устройства случайный, URL-безопасный и не печатается")
    func deviceSecret() {
        let first = DeviceSecret.generate()
        let second = DeviceSecret.generate()
        #expect(first != second)
        #expect(first.value.count == 43)
        #expect(first.value.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(!String(describing: first).contains(first.value))
    }
}

@Suite("Регрессии по ревью движка")
struct ReviewRegressionTests {
    @Test("Цель выстрела удалена ночью — она не жертва и не получает лучший ход")
    func removedShotTargetIsNotVictim() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(5)), .disqualify(5, note: nil), .night(.skip), .night(.skip))
        #expect(session.state.nights.first?.victims.isEmpty == true)
        #expect(session.state.bestMoveAuthor == nil)
        #expect(session.state.seat(5)?.elimination?.cause == .removed(.disqualified(note: nil)))
        #expect(session.step == .speech(2))
    }

    @Test("Удалённый говорящий сразу передаёт слово следующему")
    func removedSpeakerIsReplaced() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.disqualify(1, note: nil))
        #expect(session.step == .speech(2))
        #expect(session.state.isVotingCancelledToday)
    }

    @Test("Итог законченной игры нельзя перезаписать")
    func declareOutcomeAfterFinishFails() throws {
        var session = try Fixture.session()
        try session.run(.declareOutcome(.black, note: nil))
        #expect(throws: GameError.gameFinished) { try session.perform(.declareOutcome(.red, note: nil)) }
        let finishes = session.state.events.filter { if case .gameFinished = $0.kind { true } else { false } }
        #expect(finishes.count == 1)
    }

    @Test("Дон удалён посреди ночи — его проверка пропускается")
    func removedNightActorSkipsStep() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)))
        #expect(session.step == .night(.donCheck))
        try session.run(.disqualify(6, note: nil))
        #expect(session.step == .night(.sheriffCheck))
        #expect(session.state.events.contains { $0.kind == .nightStepSkipped(.donCheck) })
    }

    @Test("Лишённый слова открывающий не получает добор")
    func silencedOpenerGetsNoAddition() throws {
        var session = try Fixture.session(ruleset: .city, roles: Fixture.cityRoles)
        try session.run(.foul(1), .foul(1), .foul(1))
        try session.advance(times: 2)
        #expect(session.step == .speech(2))
        try session.advance(times: 9)
        #expect(session.state.isDusk)
    }

    @Test("«Далее» недоступно во время ввода голосов")
    func canAdvanceProjection() throws {
        var session = try Fixture.session()
        #expect(session.state.canAdvance)
        try session.advance(times: 2)
        try session.run(.nominate(candidate: 3, by: 1), .advance, .nominate(candidate: 8, by: 2))
        try session.advance(times: 9)
        #expect(!session.state.canAdvance)
        try session.run(.submitBallot(.handCount([CandidateVotes(3, votes: 5), CandidateVotes(8, votes: 5)])))
        #expect(session.state.canAdvance)
    }

    @Test("Повреждённая рассадка не загружается")
    func corruptedSetupIsRejected() throws {
        let session = try Fixture.session()
        let data = try JSONEncoder().encode(session)
        var json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        var setup = try #require(json["setup"] as? [String: Any])
        let seats = try #require(setup["seats"] as? [[String: Any]])
        setup["seats"] = seats.map { seat in seat.merging(["role": "don"]) { _, new in new } }
        json["setup"] = setup
        let corrupted = try JSONSerialization.data(withJSONObject: json)
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(GameSession.self, from: corrupted) }
    }

    @Test("Лучший ход без угаданных чёрных всё равно засчитывается в статистику")
    func zeroPointBestMoveCounts() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.run(.recordBestMove([2, 4]), .declareOutcome(.red, note: nil))
        let record = try GameRecord(session: session)
        let table = StandingsCalculator.standings(StandingsQuery(format: .rating, scope: .allTime), from: [record])
        let author = try #require(table.first { $0.playerID == record.seat(1)?.playerID })
        #expect(author.bestMoves == 1)
        #expect(author.bonus == 0)
    }
}
