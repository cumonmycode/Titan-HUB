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

        let transport = StubTransport(status: 201, json: "")
        try await client(transport).uploadGame(record)

        let request = await transport.lastRequest
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.path == "/v1/games")
        let decoded = try APICoding.makeDecoder().decode(GameRecord.self, from: try #require(request?.httpBody))
        #expect(decoded.id == record.id)
        #expect(decoded.outcome == record.outcome)
    }
}
