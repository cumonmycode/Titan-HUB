import Foundation
import Testing
@testable import MafBoardClient
import MafBoardCore

/// Заглушка транспорта: запоминает запросы и отвечает заготовленным ответом.
actor StubTransport: HTTPTransport {
    private(set) var requests: [URLRequest] = []
    private let status: Int
    private let body: Data

    init(status: Int = 200, json: String = "{}") {
        self.status = status
        body = Data(json.utf8)
    }

    func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (body, response)
    }

    var lastRequest: URLRequest? { requests.last }
}

struct StaticToken: AccessTokenProvider {
    let token: String?
    func accessToken() async -> String? { token }
}

@Suite("API-клиент MafBoard")
struct APIClientTests {
    private let baseURL = URL(string: "https://api.mafboard.test")!

    private func client(_ transport: StubTransport, token: String? = "access-1") -> MafBoardAPIClient {
        MafBoardAPIClient(baseURL: baseURL, transport: transport, tokens: StaticToken(token: token))
    }

    private func jsonBody(_ request: URLRequest?) throws -> [String: Any] {
        let data = try #require(request?.httpBody)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("Старт входа: POST без токена, секрет устройства в теле, билет из ответа")
    func startLogin() async throws {
        let transport = StubTransport(json: """
        {"id":"t-1","deepLink":"https://t.me/mafboard_bot?start=login_abc","expiresAt":"2026-10-16T21:00:00.000Z","confirmationCode":"47"}
        """)
        let ticket = try await client(transport).startTelegramLogin(
            deviceName: "iPhone", platform: "ios", secret: DeviceSecret(value: "s3cret")
        )
        #expect(ticket.id == "t-1")
        #expect(ticket.confirmationCode == "47")
        #expect(ticket.deepLink.absoluteString == "https://t.me/mafboard_bot?start=login_abc")

        let request = await transport.lastRequest
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.path == "/v1/auth/telegram/start")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(try jsonBody(request)["deviceSecret"] as? String == "s3cret")
    }

    @Test("Статусы билета", arguments: [
        (#"{"status":"pending","opened":true}"#, LoginTicketStatus.pending(opened: true)),
        (#"{"status":"confirmed"}"#, .confirmed),
        (#"{"status":"rejected","note":"Это не я"}"#, .rejected(note: "Это не я")),
        (#"{"status":"expired"}"#, .expired),
    ])
    func loginStatus(json: String, expected: LoginTicketStatus) async throws {
        let transport = StubTransport(json: json)
        let status = try await client(transport).telegramLoginStatus(ticketID: "t-1")
        #expect(status == expected)
        #expect(await transport.lastRequest?.url?.query == "ticket=t-1")
    }

    @Test("Завершение входа возвращает токены и аккаунт")
    func completeLogin() async throws {
        let transport = StubTransport(json: """
        {"tokens":{"accessToken":"a","refreshToken":"r","accessExpiresAt":"2026-10-17T12:00:00Z"},
         "account":{"id":"8F3A1C2E-0000-4000-8000-000000000001",
                    "telegram":{"id":1001,"username":"host","firstName":"Кай"},
                    "maskedPhone":"+7 *** ***-12-34"}}
        """)
        let session = try await client(transport).completeTelegramLogin(ticketID: "t-1", secret: DeviceSecret(value: "s"))
        #expect(session.tokens.accessToken == "a")
        #expect(session.account.telegram.firstName == "Кай")
        #expect(session.account.goMafia == nil)
        #expect(session.account.hostingAccess.allowedFormats == [.funky])
    }

    @Test("Выход отзывает refresh-токен: POST без Bearer, токен в теле")
    func logout() async throws {
        let transport = StubTransport(json: #"{"ok":true}"#)
        try await client(transport).logout(refreshToken: "refresh-1")
        let request = await transport.lastRequest
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.path == "/v1/auth/logout")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(try jsonBody(request)["refreshToken"] as? String == "refresh-1")
    }

    @Test("Сессии: GET с Bearer, текущее устройство помечено, у старых сессий имени может не быть")
    func sessions() async throws {
        let transport = StubTransport(json: """
        {"sessions":[
          {"id":"0f3c2a10-0000-4000-8000-000000000001","deviceName":"iPhone","platform":"ios",
           "createdAt":"2026-10-10T10:00:00.000Z","lastUsedAt":"2026-10-16T21:00:00.000Z","isCurrent":true},
          {"id":"0f3c2a10-0000-4000-8000-000000000002","deviceName":null,"platform":"android",
           "createdAt":"2026-10-12T09:00:00.000Z","lastUsedAt":"2026-10-16T18:00:00Z","isCurrent":false}
        ]}
        """)
        let sessions = try await client(transport).sessions()
        #expect(sessions.map(\.isCurrent) == [true, false])
        #expect(sessions[0].displayName == "iPhone")
        #expect(sessions[1].displayName == "Android")
        #expect(sessions[1].lastUsedAt == Date(timeIntervalSince1970: 1_792_173_600))

        let request = await transport.lastRequest
        #expect(request?.httpMethod == "GET")
        #expect(request?.url?.path == "/v1/me/sessions")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    @Test("Отзыв сессии: DELETE по id с Bearer")
    func revokeSession() async throws {
        let transport = StubTransport(json: #"{"ok":true}"#)
        try await client(transport).revokeSession(id: "0f3c2a10-0000-4000-8000-000000000002")
        let request = await transport.lastRequest
        #expect(request?.httpMethod == "DELETE")
        #expect(request?.url?.path == "/v1/me/sessions/0f3c2a10-0000-4000-8000-000000000002")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    @Test("Вход проверяющего App Store: POST без Bearer, логин и пароль только в теле")
    func reviewLogin() async throws {
        let transport = StubTransport(json: """
        {"tokens":{"accessToken":"a","refreshToken":"r","accessExpiresAt":"2026-10-17T12:00:00Z"},
         "account":{"id":"8F3A1C2E-0000-4000-8000-000000000002",
                    "telegram":{"id":-1,"firstName":"App Review"}}}
        """)
        let session = try await client(transport).reviewLogin(login: "appreview", password: "secret-1", deviceName: "iPad", platform: "ios")
        let request = await transport.lastRequest
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.path == "/v1/auth/review")
        #expect(request?.url?.query == nil)
        #expect(request?.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try #require(request?.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: String] })
        #expect(body == ["login": "appreview", "password": "secret-1", "deviceName": "iPad", "platform": "ios"])
        #expect(session.account.telegram.firstName == "App Review")
    }

    @Test("Удаление аккаунта: DELETE /v1/me с Bearer")
    func deleteAccount() async throws {
        let transport = StubTransport(json: #"{"ok":true}"#)
        try await client(transport).deleteAccount()
        let request = await transport.lastRequest
        #expect(request?.httpMethod == "DELETE")
        #expect(request?.url?.path == "/v1/me")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
    }

    @Test("Своё устройство так не завершить — конфликт с текстом сервера")
    func revokeCurrentSession() async {
        let transport = StubTransport(status: 409, json: #"{"error":{"code":"current_session","message":"Это текущее устройство"}}"#)
        await #expect(throws: APIError.conflict("Это текущее устройство")) {
            try await client(transport).revokeSession(id: "0f3c2a10-0000-4000-8000-000000000001")
        }
    }

    @Test("Снимок идущей игры: PUT с номером игры в адресе, ответ — сохранён ли")
    func saveActiveGame() async throws {
        let transport = StubTransport(json: #"{"stored":true}"#)
        let setup = try GameSetup(
            format: .funky, ruleset: .sport,
            players: (1...10).map { _ in PlayerID() },
            roles: try Ruleset.sport.standardRoles(playerCount: 10)
        )
        let game = ActiveGameEnvelope(
            id: setup.gameID, revision: 4, updatedAt: Date(timeIntervalSince1970: 1_792_000_000),
            snapshot: ActiveGameSnapshot(session: GameSession(setup: setup), players: [PlayerProfile(nickname: "Шерлок")])
        )
        #expect(try await client(transport).saveActiveGame(game))
        let request = await transport.lastRequest
        #expect(request?.httpMethod == "PUT")
        #expect(request?.url?.path == "/v1/games/active/\(setup.gameID)")
        let body = try jsonBody(request)
        #expect(body["revision"] as? Int == 4)
        let snapshot = try #require(body["snapshot"] as? [String: Any])
        let session = try #require(snapshot["session"] as? [String: Any])
        let sentSetup = try #require(session["setup"] as? [String: Any])
        #expect(sentSetup["gameID"] as? String == setup.gameID.description)
    }

    @Test("Идущие игры с сервера читаются обратно в сессию движка")
    func activeGamesRoundTrip() async throws {
        // Даты по API — с точностью до миллисекунд, поэтому берём ровные.
        let start = Date(timeIntervalSince1970: 1_792_000_000)
        let setup = try GameSetup(
            format: .funky, ruleset: .sport,
            players: (1...10).map { _ in PlayerID() },
            roles: try Ruleset.sport.standardRoles(playerCount: 10),
            createdAt: start
        )
        var session = GameSession(setup: setup)
        try session.perform(.advance, at: start.addingTimeInterval(60))
        let envelope = ActiveGameEnvelope(
            id: setup.gameID, revision: 2, updatedAt: Date(timeIntervalSince1970: 1_792_000_000),
            snapshot: ActiveGameSnapshot(session: session, players: [])
        )
        let encoded = try APICoding.makeEncoder().encode(envelope)
        let json = #"{"games":["# + String(decoding: encoded, as: UTF8.self) + "]}"
        let games = try await client(StubTransport(json: json)).activeGames()
        #expect(games.first?.snapshot.session == session)
        #expect(games.first?.revision == 2)
    }

    @Test("Запросы от имени пользователя несут Bearer-токен, поиск кодирует кириллицу")
    func authorizedSearch() async throws {
        let transport = StubTransport(json: #"{"players":[{"id":5,"nickname":"Шерлок","isInHostClub":true}]}"#)
        let players = try await client(transport).searchGoMafiaPlayers("Шерл")
        #expect(players == [GoMafiaPlayer(id: 5, nickname: "Шерлок", isInHostClub: true)])

        let request = await transport.lastRequest
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer access-1")
        #expect(request?.url?.absoluteString == "https://api.mafboard.test/v1/gomafia/players?q=%D0%A8%D0%B5%D1%80%D0%BB")
    }

    @Test("Пароль GoMafia — только в теле запроса, не в адресе")
    func linkGoMafiaKeepsPasswordInBody() async throws {
        let transport = StubTransport(json: """
        {"id":"8F3A1C2E-0000-4000-8000-000000000001","telegram":{"id":1001,"firstName":"Кай"},
         "goMafia":{"player":{"id":4242,"nickname":"Kai","isInHostClub":false},
                    "club":{"id":77,"title":"TITAN"},
                    "linkedAt":"2026-10-16T20:00:00Z","syncedAt":"2026-10-16T20:00:00Z"}}
        """)
        let account = try await client(transport).linkGoMafia(login: "kai", password: "p@ss")
        #expect(account.hostingAccess.history == .club(GoMafiaClub(id: 77, title: "TITAN")))

        let request = await transport.lastRequest
        #expect(request?.url?.absoluteString.contains("p@ss") == false)
        #expect(try jsonBody(request)["password"] as? String == "p@ss")
    }

    @Test("Ошибки сервера превращаются в понятные APIError", arguments: [
        (401, "{}", APIError.unauthorized),
        (409, #"{"error":{"code":"gomafia_taken","message":"Аккаунт уже привязан"}}"#, .conflict("Аккаунт уже привязан")),
        (422, #"{"error":{"code":"bad_credentials","message":"Неверный логин или пароль GoMafia"}}"#,
         .validation("Неверный логин или пароль GoMafia")),
        (429, "{}", .rateLimited),
        (502, "oops", .server(status: 502, message: nil)),
        // Общий ответ Titan HUB вне модуля: ошибка строкой.
        (500, #"{"error":"Internal error"}"#, .server(status: 500, message: "Internal error")),
    ])
    func errorMapping(status: Int, json: String, expected: APIError) async {
        let transport = StubTransport(status: status, json: json)
        await #expect(throws: expected) {
            _ = try await client(transport).currentAccount()
        }
    }

    @Test("Завершённая игра уходит на сервер целиком")
    func uploadGame() async throws {
        var session = try GameSession(setup: GameSetup(
            format: .funky, ruleset: .sport,
            players: (1...10).map { PlayerID.goMafia($0) },
            roles: [.civilian, .civilian, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian]
        ))
        try session.perform(.declareOutcome(.red, note: nil))
        let record = try GameRecord(session: session)

        let players = [PlayerProfile(nickname: "Шерлок")]
        let transport = StubTransport(status: 201, json: "")
        try await client(transport).uploadGame(HostedGame(record: record, players: players))

        let request = await transport.lastRequest
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.path == "/v1/games")
        let body = try #require(request?.httpBody)
        // Сервер видит обычную запись игры (игроки — рядом с её полями) и хранит тело целиком.
        let decoded = try APICoding.makeDecoder().decode(GameRecord.self, from: body)
        #expect(decoded.id == record.id)
        #expect(decoded.outcome == record.outcome)
        let hosted = try APICoding.makeDecoder().decode(HostedGame.self, from: body)
        #expect(hosted.players == players)
    }

    @Test("История с сервера: игроки читаются, старые записи без игроков — тоже")
    func myGamesWithPlayers() async throws {
        var session = try GameSession(setup: GameSetup(
            format: .funky, ruleset: .sport,
            players: (1...10).map { PlayerID.goMafia($0) },
            roles: [.civilian, .civilian, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian]
        ))
        try session.perform(.declareOutcome(.black, note: nil))
        let record = try GameRecord(session: session)
        let withPlayers = try APICoding.makeEncoder().encode(HostedGame(record: record, players: [PlayerProfile(nickname: "Ватсон")]))
        let bare = try APICoding.makeEncoder().encode(record)
        let json = #"{"games":["# + String(decoding: withPlayers, as: UTF8.self) + "," + String(decoding: bare, as: UTF8.self) + "]}"

        let games = try await client(StubTransport(json: json)).myGames(since: nil)
        #expect(games.count == 2)
        #expect(games[0].players.first?.nickname == "Ватсон")
        #expect(games[1].players.isEmpty)
        #expect(games[1].record.outcome.winner == .black)
    }
}
