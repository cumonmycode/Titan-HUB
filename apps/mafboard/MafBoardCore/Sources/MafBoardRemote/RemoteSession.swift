import Foundation

/// Сторона телефона в одном соединении: приветствие, подтверждение ключа, команды.
/// Транспорта здесь нет, поэтому локальная сеть и облако работают одинаково.
public struct RemoteClientSession: Sendable {
    public enum SessionError: Error, Equatable, Sendable {
        case badServerHello
        case notReady
        case crypto(RemoteCryptoError)
        case badMessage
    }

    private struct ClientHello: Encodable {
        let studioId: String
        let saltC: String
        let clockMs: UInt64
    }

    private struct ServerHello: Decodable {
        let saltS: String
    }

    private let pairingKey: Data
    private let studioID: String
    private let saltC: Data
    private let clockMs: UInt64
    private var sealer: RemoteSealer?
    private var opener: RemoteOpener?

    /// Первый кадр соединения. Идёт открыто, секретов в нём нет.
    public let hello: Data

    /// `clockMs` — часы телефона. По разнице с ними ноутбук считает срок команд.
    public init(pairingKey: Data, studioID: String, clockMs: UInt64, saltC: Data? = nil) {
        let salt = saltC ?? Data((0..<16).map { _ in UInt8.random(in: .min ... .max) })
        self.pairingKey = pairingKey
        self.studioID = studioID
        self.clockMs = clockMs
        self.saltC = salt
        var frame = Data([RemoteFrameKind.clientHello])
        let body = ClientHello(studioId: studioID, saltC: RemoteBase64URL.encode(salt), clockMs: clockMs)
        // Кодирование строк и чисел не падает.
        frame.append((try? JSONEncoder().encode(body)) ?? Data())
        hello = frame
    }

    public var isReady: Bool { sealer != nil }

    /// Ответ ноутбука на приветствие. Возвращает кадр, который доказывает, что мы знаем ключ.
    public mutating func acceptServerHello(_ frame: Data) throws(SessionError) -> Data {
        // Второй ответ заново завёл бы счётчики при тех же ключах, если соль совпадёт.
        guard sealer == nil else { throw .badServerHello }
        let bytes = Data(frame)
        guard bytes.first == RemoteFrameKind.serverHello,
              let reply = try? JSONDecoder().decode(ServerHello.self, from: bytes.dropFirst()),
              let saltS = RemoteBase64URL.decode(reply.saltS), saltS.count == 16
        else { throw .badServerHello }

        let keys = RemoteSessionKeys(pairingKey: pairingKey, saltC: saltC, saltS: saltS)
        let aad = RemoteTranscript.hash(studioID: studioID, saltC: saltC, saltS: saltS, clockMs: clockMs)
        sealer = RemoteSealer(key: keys.clientToServer, aad: aad)
        opener = RemoteOpener(key: keys.serverToClient, aad: aad)
        return try sealSignal("ready")
    }

    /// Сигнал «телефон на связи»: по его пропаже ноутбук закрывает соединение.
    public mutating func sealAlive() throws(SessionError) -> Data {
        try sealSignal("alive")
    }

    public mutating func seal(_ envelope: RemoteEnvelope) throws(SessionError) -> Data {
        guard let plaintext = try? JSONEncoder().encode(envelope) else { throw .badMessage }
        return try seal(plaintext)
    }

    public mutating func open(_ frame: Data) throws(SessionError) -> DesktopMessage {
        guard var current = opener else { throw .notReady }
        let plaintext: Data
        do {
            plaintext = try current.open(frame)
        } catch {
            throw .crypto(error)
        }
        opener = current
        guard let message = try? JSONDecoder().decode(DesktopMessage.self, from: plaintext) else { throw .badMessage }
        return message
    }

    private mutating func sealSignal(_ type: String) throws(SessionError) -> Data {
        try seal(Data(#"{"type":"\#(type)"}"#.utf8))
    }

    private mutating func seal(_ plaintext: Data) throws(SessionError) -> Data {
        guard var current = sealer else { throw .notReady }
        let frame: Data
        do {
            frame = try current.seal(plaintext)
        } catch {
            throw .crypto(error)
        }
        sealer = current
        return frame
    }
}

public enum RemoteBase64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) -> Data? {
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        return Data(base64Encoded: base64)
    }
}
