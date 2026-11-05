import Foundation

// Вход в MafBoard Studio (MBS, настольное приложение для трансляций):
// MBS показывает QR-код и двузначный код → камера iPhone открывает приложение → телефон показывает
// имя устройства и три кода → ведущий выбирает код с экрана ноутбука → MBS получает свою сессию.
// Подробно — docs/API.md. Ключ сопряжения идёт после `#`: он нужен только телефону и ноутбуку.

/// Ссылка из QR-кода MBS: `https://<домен>/studio/login?scan=<код>#k=<ключ сопряжения>&s=<номер студии>`.
public struct StudioLoginLink: Sendable, Equatable, CustomStringConvertible, CustomReflectable {
    public static let path = "/studio/login"
    public static let pairingKeyLength = 32

    public let scanCode: String
    /// Секрет шифрования пульта. На сервер не передаётся и в журналы не попадает.
    public let pairingKey: Data
    public let studioID: String

    public init?(url: URL, allowedHosts: Set<String>) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let isUniversalLink = components.scheme == "https"
            && components.host.map(allowedHosts.contains) == true
            && components.path == Self.path
        let isAppLink = components.scheme == LoginReturnLink.appScheme
            && "/\(components.host ?? "")\(components.path)" == Self.path
        guard isUniversalLink || isAppLink,
              let scan = components.queryItems?.first(where: { $0.name == "scan" })?.value,
              Self.isToken(scan, length: 16...64),
              let fragment = components.percentEncodedFragment
        else { return nil }

        var parts = URLComponents()
        parts.percentEncodedQuery = fragment
        let items = parts.queryItems ?? []
        guard let key = items.first(where: { $0.name == "k" })?.value.flatMap(Self.decodeBase64URL),
              key.count == Self.pairingKeyLength,
              let studio = items.first(where: { $0.name == "s" })?.value,
              Self.isToken(studio, length: 8...64)
        else { return nil }

        scanCode = scan
        pairingKey = key
        studioID = studio
    }

    /// Ключ не попадает в журналы и отладочный вывод.
    public var description: String { "StudioLoginLink(studio: \(studioID), ключ: •••)" }

    public var customMirror: Mirror {
        Mirror(self, children: ["studioID": studioID], displayStyle: .struct)
    }

    private static func isToken(_ value: String, length: ClosedRange<Int>) -> Bool {
        length.contains(value.count) && value.utf8.allSatisfy {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x41 && $0 <= 0x5A) || ($0 >= 0x61 && $0 <= 0x7A) || $0 == 0x2D || $0 == 0x5F
        }
    }

    private static func decodeBase64URL(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}

/// Этот телефон управляет этим ноутбуком. Хранится только в Keychain телефона.
public struct StudioPairing: Codable, Sendable, Equatable, CustomStringConvertible {
    public let studioID: String
    public let pairingKey: Data
    public let deviceName: String
    public let pairedAt: Date

    public init(studioID: String, pairingKey: Data, deviceName: String, pairedAt: Date) {
        self.studioID = studioID
        self.pairingKey = pairingKey
        self.deviceName = deviceName
        self.pairedAt = pairedAt
    }

    /// Ключ не попадает в журналы и отладочный вывод.
    public var description: String { "StudioPairing(studio: \(studioID), устройство: \(deviceName), ключ: •••)" }
}

public enum StudioLoginFailure: Sendable, Equatable {
    /// QR-код истёк или уже использован, нужен новый.
    case expired
    case wrongCode
    case network(String)
}

public enum StudioLoginState: Sendable, Equatable {
    case loading
    case choosing(StudioLoginTicket)
    case approving(StudioLoginTicket, code: Int)
    case done(deviceName: String)
    case failed(StudioLoginFailure)
}

/// Подтверждение входа на телефоне. Сеть и экран снаружи, поэтому правила проверяются тестами без сервера.
public struct StudioLoginFlow: Sendable, Equatable {
    public let link: StudioLoginLink
    public private(set) var state = StudioLoginState.loading

    public init(link: StudioLoginLink) {
        self.link = link
    }

    public mutating func ticketLoaded(_ ticket: StudioLoginTicket) {
        if case .loading = state { state = .choosing(ticket) }
    }

    /// `true` — можно отправлять на сервер. Выбрать можно один раз и только из показанных кодов.
    public mutating func choose(code: Int) -> Bool {
        guard case let .choosing(ticket) = state, ticket.codes.contains(code) else { return false }
        state = .approving(ticket, code: code)
        return true
    }

    public mutating func approved(deviceName: String) {
        if case .approving = state { state = .done(deviceName: deviceName) }
    }

    public mutating func failed(_ failure: StudioLoginFailure) {
        if case .done = state { return }
        state = .failed(failure)
    }

    public mutating func clockTick(_ now: Date) {
        if case let .choosing(ticket) = state, now >= ticket.expiresAt { state = .failed(.expired) }
    }
}

/// Запрос входа с ноутбука: что показать ведущему перед подтверждением.
public struct StudioLoginTicket: Codable, Sendable, Equatable {
    public let deviceName: String
    /// `macos` или `windows`.
    public let platform: String
    /// Настоящий код среди двух ложных, настоящий виден только на экране ноутбука.
    public let codes: [Int]
    public let expiresAt: Date

    public init(deviceName: String, platform: String, codes: [Int], expiresAt: Date) {
        self.deviceName = deviceName
        self.platform = platform
        self.codes = codes
        self.expiresAt = expiresAt
    }
}
