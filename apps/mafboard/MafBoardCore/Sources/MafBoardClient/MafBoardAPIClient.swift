import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import MafBoardCore

/// Транспорт HTTP. В приложении — `URLSession`, в тестах — заглушка.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPTransport {
    public func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

/// Источник access-токена (в приложении — хранилище сессии в Keychain).
public protocol AccessTokenProvider: Sendable {
    func accessToken() async -> String?
}

/// API сервера MafBoard. Протокол — чтобы экраны и превью работали с заглушкой.
public protocol MafBoardAPI: Sendable {
    // Вход через Telegram-бота
    func startTelegramLogin(deviceName: String, platform: String, secret: DeviceSecret) async throws(APIError) -> LoginTicket
    func telegramLoginStatus(ticketID: String) async throws(APIError) -> LoginTicketStatus
    func completeTelegramLogin(ticketID: String, secret: DeviceSecret) async throws(APIError) -> AuthSession
    func refreshTokens(_ refreshToken: String) async throws(APIError) -> AuthTokens
    func currentAccount() async throws(APIError) -> UserAccount

    // GoMafia
    func linkGoMafia(login: String, password: String) async throws(APIError) -> UserAccount
    func unlinkGoMafia() async throws(APIError) -> UserAccount
    func searchGoMafiaPlayers(_ query: String) async throws(APIError) -> [GoMafiaPlayer]
    func goMafiaPlayer(id: Int) async throws(APIError) -> GoMafiaPlayer
    func clubRoster(clubID: Int, page: Int) async throws(APIError) -> [GoMafiaPlayer]

    // История игр
    func uploadGame(_ record: GameRecord) async throws(APIError)
    func clubGames(clubID: Int, since: Date?) async throws(APIError) -> [GameRecord]
    func myGames(since: Date?) async throws(APIError) -> [GameRecord]
}

public struct MafBoardAPIClient: MafBoardAPI {
    public let baseURL: URL
    private let transport: any HTTPTransport
    private let tokens: (any AccessTokenProvider)?

    public init(baseURL: URL, transport: any HTTPTransport = URLSession.shared, tokens: (any AccessTokenProvider)? = nil) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokens = tokens
    }

    // MARK: Вход

    public func startTelegramLogin(deviceName: String, platform: String, secret: DeviceSecret) async throws(APIError) -> LoginTicket {
        let body = StartTelegramLoginRequest(deviceName: deviceName, platform: platform, deviceSecret: secret.value)
        return try await send(.post, "v1/auth/telegram/start", body: body, authorized: false)
    }

    public func telegramLoginStatus(ticketID: String) async throws(APIError) -> LoginTicketStatus {
        let response: LoginStatusResponse = try await send(
            .get, "v1/auth/telegram/status", query: [URLQueryItem(name: "ticket", value: ticketID)], authorized: false
        )
        guard let status = response.ticketStatus else {
            throw .decoding("неизвестный статус входа «\(response.status)»")
        }
        return status
    }

    public func completeTelegramLogin(ticketID: String, secret: DeviceSecret) async throws(APIError) -> AuthSession {
        let body = CompleteTelegramLoginRequest(ticket: ticketID, deviceSecret: secret.value)
        return try await send(.post, "v1/auth/telegram/complete", body: body, authorized: false)
    }

    public func refreshTokens(_ refreshToken: String) async throws(APIError) -> AuthTokens {
        try await send(.post, "v1/auth/refresh", body: RefreshTokensRequest(refreshToken: refreshToken), authorized: false)
    }

    public func currentAccount() async throws(APIError) -> UserAccount {
        try await send(.get, "v1/me")
    }

    // MARK: GoMafia

    public func linkGoMafia(login: String, password: String) async throws(APIError) -> UserAccount {
        try await send(.post, "v1/me/gomafia", body: LinkGoMafiaRequest(login: login, password: password))
    }

    public func unlinkGoMafia() async throws(APIError) -> UserAccount {
        try await send(.delete, "v1/me/gomafia")
    }

    public func searchGoMafiaPlayers(_ query: String) async throws(APIError) -> [GoMafiaPlayer] {
        let response: PlayersResponse = try await send(.get, "v1/gomafia/players", query: [URLQueryItem(name: "q", value: query)])
        return response.players
    }

    public func goMafiaPlayer(id: Int) async throws(APIError) -> GoMafiaPlayer {
        try await send(.get, "v1/gomafia/players/\(id)")
    }

    public func clubRoster(clubID: Int, page: Int) async throws(APIError) -> [GoMafiaPlayer] {
        let response: PlayersResponse = try await send(
            .get, "v1/gomafia/clubs/\(clubID)/players", query: [URLQueryItem(name: "page", value: String(page))]
        )
        return response.players
    }

    // MARK: История игр

    public func uploadGame(_ record: GameRecord) async throws(APIError) {
        let _: EmptyResponse = try await send(.post, "v1/games", body: record)
    }

    public func clubGames(clubID: Int, since: Date?) async throws(APIError) -> [GameRecord] {
        let response: GamesResponse = try await send(.get, "v1/clubs/\(clubID)/games", query: sinceQuery(since))
        return response.games
    }

    public func myGames(since: Date?) async throws(APIError) -> [GameRecord] {
        let response: GamesResponse = try await send(.get, "v1/me/games", query: sinceQuery(since))
        return response.games
    }

    // MARK: Транспорт

    private enum Method: String {
        case get = "GET"
        case post = "POST"
        case delete = "DELETE"
    }

    private func sinceQuery(_ since: Date?) -> [URLQueryItem] {
        since.map { [URLQueryItem(name: "since", value: $0.formatted(.iso8601WithMilliseconds))] } ?? []
    }

    private func send<Response: Decodable>(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (any Encodable)? = nil,
        authorized: Bool = true
    ) async throws(APIError) -> Response {
        let request = try await makeRequest(method, path, query: query, body: body, authorized: authorized)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.send(request)
        } catch {
            throw .transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw .transport("ответ не HTTP")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.error(status: http.statusCode, data: data)
        }
        if Response.self == EmptyResponse.self, let empty = EmptyResponse() as? Response {
            return empty
        }
        do {
            return try APICoding.makeDecoder().decode(Response.self, from: data)
        } catch {
            throw .decoding(String(describing: error))
        }
    }

    private func makeRequest(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem],
        body: (any Encodable)?,
        authorized: Bool
    ) async throws(APIError) -> URLRequest {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw .transport("некорректный адрес сервера")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw .transport("некорректный адрес запроса") }

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            do {
                request.httpBody = try APICoding.makeEncoder().encode(body)
            } catch {
                throw .decoding("не удалось подготовить запрос: \(error)")
            }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized, let token = await tokens?.accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private static func error(status: Int, data: Data) -> APIError {
        let message = (try? APICoding.makeDecoder().decode(APIErrorBody.self, from: data))?.message
        return switch status {
        case 401: .unauthorized
        case 403: .forbidden(message)
        case 404: .notFound
        case 409: .conflict(message)
        case 400, 422: .validation(message)
        case 429: .rateLimited
        default: .server(status: status, message: message)
        }
    }
}
