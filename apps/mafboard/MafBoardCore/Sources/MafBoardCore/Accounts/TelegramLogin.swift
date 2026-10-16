import Foundation

// Вход через бота MafBoard:
// приложение получает билет → открывает бота → пользователь принимает соглашение, делится номером
// и подтверждает вход → бот присылает кнопку «Вернуться в приложение» (Universal Link) →
// приложение обменивает билет + секрет устройства на сессию. Подробно — docs/API.md.

/// Билет входа, выданный сервером.
public struct LoginTicket: Codable, Sendable, Equatable {
    public let id: String
    /// `https://t.me/<бот>?start=login_<код>`
    public let deepLink: URL
    public let expiresAt: Date
    /// Двузначный код сверки. Приложение показывает его крупно, а в боте пользователь нажимает
    /// тот же код. Так чужая ссылка, присланная «на подтверждение», не даст войти в его аккаунт.
    public let confirmationCode: String?

    public init(id: String, deepLink: URL, expiresAt: Date, confirmationCode: String? = nil) {
        self.id = id
        self.deepLink = deepLink
        self.expiresAt = expiresAt
        self.confirmationCode = confirmationCode
    }
}

public enum LoginTicketStatus: Codable, Sendable, Equatable {
    /// Пользователь ещё в боте. `opened` — бот уже получил /start по этому билету.
    case pending(opened: Bool)
    case confirmed
    case rejected(note: String?)
    case expired
}

public struct AuthTokens: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let accessExpiresAt: Date

    public init(accessToken: String, refreshToken: String, accessExpiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessExpiresAt = accessExpiresAt
    }
}

public struct AuthSession: Codable, Sendable, Equatable {
    public let tokens: AuthTokens
    public let account: UserAccount

    public init(tokens: AuthTokens, account: UserAccount) {
        self.tokens = tokens
        self.account = account
    }
}

/// Секрет устройства. Создаётся при старте входа и уходит на сервер напрямую по TLS.
/// Без него подтверждённый билет не обменять на сессию — ссылка из Telegram сама по себе бесполезна.
public struct DeviceSecret: Codable, Sendable, Equatable, CustomStringConvertible {
    public let value: String

    public init(value: String) {
        self.value = value
    }

    public static func generate() -> DeviceSecret {
        var generator = SystemRandomNumberGenerator()
        return generate(using: &generator)
    }

    /// 32 случайных байта в base64url.
    public static func generate(using generator: inout some RandomNumberGenerator) -> DeviceSecret {
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
        let encoded = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return DeviceSecret(value: encoded)
    }

    /// Секрет не попадает в логи и отладочный вывод.
    public var description: String { "DeviceSecret(•••)" }
}

/// Ссылка, по которой бот возвращает пользователя в приложение.
/// Telegram разрешает в кнопках только http(s) и tg://, поэтому основная — Universal Link.
public enum LoginReturnLink {
    public static let path = "/auth/return"
    public static let appScheme = "mafboard"

    /// Номер билета из ссылки возврата, если ссылка наша.
    public static func ticketID(from url: URL, allowedHosts: Set<String>) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let isUniversalLink = components.scheme == "https"
            && components.host.map(allowedHosts.contains) == true
            && components.path == path
        let isAppLink = components.scheme == appScheme
            && "/\(components.host ?? "")\(components.path)" == path
        guard isUniversalLink || isAppLink else { return nil }
        guard let ticket = components.queryItems?.first(where: { $0.name == "ticket" })?.value,
              !ticket.isEmpty
        else { return nil }
        return ticket
    }
}

// MARK: - Процесс входа

public enum TelegramLoginFailure: Sendable, Equatable {
    case rejected(note: String?)
    case expired
    case network(String)
}

public enum TelegramLoginState: Sendable, Equatable {
    case idle
    case requestingTicket(DeviceSecret)
    /// Пользователь проходит шаги в боте. Приложение опрашивает статус при каждом возврате на экран.
    case waitingForTelegram(LoginTicket, DeviceSecret, opened: Bool)
    case completing(LoginTicket, DeviceSecret)
    case signedIn(AuthSession)
    case failed(TelegramLoginFailure)
}

public enum TelegramLoginEvent: Sendable, Equatable {
    case start(DeviceSecret)
    case ticketIssued(LoginTicket)
    /// Приложение открылось по ссылке возврата из бота.
    case returnedFromTelegram(ticketID: String)
    case statusReceived(LoginTicketStatus)
    case sessionReceived(AuthSession)
    /// Запрос не удался окончательно (билет не выдан, сервер отказал в обмене).
    case requestFailed(String)
    /// Обмен подтверждённого билета прервался (сеть, сбой сервера) — ждём и пробуем снова по опросу статуса.
    case completionInterrupted
    /// Продолжить вход после перезапуска приложения: билет и секрет сохранены на устройстве.
    case resume(LoginTicket, DeviceSecret)
    case clockTick(Date)
    case reset
}

/// Что сделать слою приложения после события.
public enum TelegramLoginCommand: Sendable, Equatable {
    case requestTicket(DeviceSecret)
    case openTelegram(URL)
    case completeLogin(ticketID: String, DeviceSecret)
}

/// Чистый конечный автомат входа: события на вход, команды на выход. Сеть, Keychain и открытие
/// ссылок делает приложение — поэтому весь сценарий проверяется тестами без сервера.
public struct TelegramLoginFlow: Sendable, Equatable {
    public private(set) var state: TelegramLoginState = .idle

    public init() {}

    /// Билет, статус которого стоит опрашивать (например, когда приложение вернулось на экран).
    public var pollingTicketID: String? {
        if case let .waitingForTelegram(ticket, _, _) = state { ticket.id } else { nil }
    }

    /// Незавершённый вход, который стоит сохранить на случай перезапуска приложения.
    public var pendingTicket: (LoginTicket, DeviceSecret)? {
        switch state {
        case let .waitingForTelegram(ticket, secret, _), let .completing(ticket, secret): (ticket, secret)
        default: nil
        }
    }

    public mutating func handle(_ event: TelegramLoginEvent) -> [TelegramLoginCommand] {
        switch (state, event) {
        case (_, .reset):
            state = .idle
            return []

        case let (.idle, .start(secret)), let (.failed, .start(secret)):
            state = .requestingTicket(secret)
            return [.requestTicket(secret)]

        case let (.idle, .resume(ticket, secret)):
            state = .waitingForTelegram(ticket, secret, opened: true)
            return []

        case let (.requestingTicket(secret), .ticketIssued(ticket)):
            state = .waitingForTelegram(ticket, secret, opened: false)
            return [.openTelegram(ticket.deepLink)]

        case let (.waitingForTelegram(ticket, secret, _), .returnedFromTelegram(ticketID)):
            guard ticketID == ticket.id else { return [] }
            state = .completing(ticket, secret)
            return [.completeLogin(ticketID: ticket.id, secret)]

        case let (.waitingForTelegram(ticket, secret, _), .statusReceived(.confirmed)):
            state = .completing(ticket, secret)
            return [.completeLogin(ticketID: ticket.id, secret)]

        case let (.waitingForTelegram(ticket, secret, _), .statusReceived(.pending(opened))):
            state = .waitingForTelegram(ticket, secret, opened: opened)
            return []

        case let (.waitingForTelegram, .statusReceived(.rejected(note))):
            state = .failed(.rejected(note: note))
            return []

        case (.waitingForTelegram, .statusReceived(.expired)):
            state = .failed(.expired)
            return []

        case let (.waitingForTelegram(ticket, _, _), .clockTick(now)) where now >= ticket.expiresAt,
             let (.completing(ticket, _), .clockTick(now)) where now >= ticket.expiresAt:
            state = .failed(.expired)
            return []

        case let (.completing(ticket, secret), .completionInterrupted):
            state = .waitingForTelegram(ticket, secret, opened: true)
            return []

        case let (.completing, .sessionReceived(session)):
            state = .signedIn(session)
            return []

        case let (.requestingTicket, .requestFailed(message)), let (.completing, .requestFailed(message)):
            state = .failed(.network(message))
            return []

        default:
            // Остальное — устаревшие или чужие события (повторная ссылка, сбой опроса): состояние не меняется.
            return []
        }
    }
}
