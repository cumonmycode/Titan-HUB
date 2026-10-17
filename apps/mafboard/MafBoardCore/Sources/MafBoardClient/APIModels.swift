import Foundation
import MafBoardCore

// Тела запросов и ответов API MafBoard. Контракт описан в docs/API.md.

struct StartTelegramLoginRequest: Encodable {
    let deviceName: String
    let platform: String
    let deviceSecret: String
}

struct CompleteTelegramLoginRequest: Encodable {
    let ticket: String
    let deviceSecret: String
}

struct RefreshTokensRequest: Encodable {
    let refreshToken: String
}

/// Пароль уходит только в теле запроса по TLS. Сервер проверяет его входом в GoMafia и не хранит.
struct LinkGoMafiaRequest: Encodable {
    let login: String
    let password: String
}

struct LoginStatusResponse: Decodable {
    let status: String
    let opened: Bool?
    let note: String?

    var ticketStatus: LoginTicketStatus? {
        switch status {
        case "pending": .pending(opened: opened ?? false)
        case "confirmed": .confirmed
        case "rejected": .rejected(note: note)
        case "expired": .expired
        default: nil
        }
    }
}

struct PlayersResponse: Decodable {
    let players: [GoMafiaPlayer]
}

struct GamesResponse: Decodable {
    let games: [HostedGame]
}

/// Законченная игра для истории на сервере: запись движка и игроки (имена, аватары).
/// В JSON игроки лежат рядом с полями записи — сервер хранит тело целиком и отдаёт его обратно.
/// Записи, загруженные до появления игроков, читаются с пустым списком.
public struct HostedGame: Codable, Sendable, Equatable {
    public let record: GameRecord
    public let players: [PlayerProfile]

    public init(record: GameRecord, players: [PlayerProfile]) {
        self.record = record
        self.players = players
    }

    private enum CodingKeys: String, CodingKey {
        case players
    }

    public init(from decoder: any Decoder) throws {
        record = try GameRecord(from: decoder)
        players = try decoder.container(keyedBy: CodingKeys.self).decodeIfPresent([PlayerProfile].self, forKey: .players) ?? []
    }

    public func encode(to encoder: any Encoder) throws {
        try record.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(players, forKey: .players)
    }
}

struct SessionsResponse: Decodable {
    let sessions: [DeviceSession]
}

struct EmptyResponse: Decodable {}

struct StoredResponse: Decodable {
    let stored: Bool
}

struct ActiveGamesResponse: Decodable {
    let games: [ActiveGameEnvelope]
}

/// Снимок идущей игры: журнал движка и игроки (имена, аватары).
public struct ActiveGameSnapshot: Codable, Sendable, Equatable {
    public let session: GameSession
    public let players: [PlayerProfile]

    public init(session: GameSession, players: [PlayerProfile]) {
        self.session = session
        self.players = players
    }
}

/// Идущая игра на сервере. `revision` растёт с каждым изменением на телефоне —
/// сервер не перезаписывает более новый снимок более старым.
public struct ActiveGameEnvelope: Codable, Sendable, Equatable {
    public let id: GameID
    public let revision: Int
    public let updatedAt: Date
    public let snapshot: ActiveGameSnapshot

    public init(id: GameID, revision: Int, updatedAt: Date, snapshot: ActiveGameSnapshot) {
        self.id = id
        self.revision = revision
        self.updatedAt = updatedAt
        self.snapshot = snapshot
    }
}

/// Тело ошибки. Ручки MafBoard отвечают `{"error": {"code", "message"}}`, а общие ответы
/// Titan HUB (404 вне модуля, 500) — `{"error": "текст"}`. Понимаем оба.
struct APIErrorBody: Decodable {
    let code: String?
    let message: String?

    private enum CodingKeys: String, CodingKey {
        case error
    }

    private struct Detail: Decodable {
        let code: String
        let message: String?
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let detail = try? container.decode(Detail.self, forKey: .error) {
            code = detail.code
            message = detail.message
        } else {
            code = nil
            message = try container.decode(String.self, forKey: .error)
        }
    }
}

/// Ошибка обращения к серверу MafBoard.
public enum APIError: Error, Sendable, Equatable {
    /// Токен отсутствует, истёк или отозван — нужно обновить токен или войти заново.
    case unauthorized
    case forbidden(String?)
    case notFound
    /// Например, аккаунт GoMafia уже привязан к другому пользователю.
    case conflict(String?)
    /// Неверные данные (в том числе неверный логин или пароль GoMafia).
    case validation(String?)
    case rateLimited
    case server(status: Int, message: String?)
    case transport(String)
    case decoding(String)

    public var message: String {
        switch self {
        case .unauthorized: "Сессия истекла — войдите снова"
        case let .forbidden(text): text ?? "Недостаточно прав"
        case .notFound: "Не найдено"
        case let .conflict(text): text ?? "Конфликт данных"
        case let .validation(text): text ?? "Проверьте введённые данные"
        case .rateLimited: "Слишком много попыток, подождите немного"
        case let .server(status, text): text ?? "Ошибка сервера (\(status))"
        case let .transport(text): "Нет связи с сервером: \(text)"
        case let .decoding(text): "Неожиданный ответ сервера: \(text)"
        }
    }
}

extension APIError: LocalizedError {
    public var errorDescription: String? { message }
}

// MARK: - JSON

enum APICoding {
    /// ISO 8601 с миллисекундами; при чтении принимаем и без дробной части.
    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.formatted(.iso8601WithMilliseconds))
        }
        return encoder
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text) { return date }
            if let date = try? Date.ISO8601FormatStyle().parse(text) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Дата не в формате ISO 8601: \(text)")
        }
        return decoder
    }
}

extension FormatStyle where Self == Date.ISO8601FormatStyle {
    static var iso8601WithMilliseconds: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    }
}
