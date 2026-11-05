import CryptoKit
import Foundation

// Шифрование пульта MafBoard Studio. Те же байты получаются на ноутбуке (Rust):
// проверка — общие векторы `remote-test-vectors.json`, их генератор в репозитории MafBoard Studio.
// Сеть и облако шифруются одинаково, поэтому сервер в облаке содержимого не видит.

public enum RemoteCryptoError: Error, Equatable, Sendable {
    /// Кадр не того вида или слишком короткий.
    case malformed
    /// Счётчик не вырос: повтор старого кадра.
    case stale
    /// Не сошлась метка: чужой ключ или подмена.
    case tampered
    /// Счётчик исчерпан, нужно новое соединение.
    case exhausted
}

public enum RemoteFrameKind {
    public static let clientHello: UInt8 = 1
    public static let serverHello: UInt8 = 2
    public static let sealed: UInt8 = 3
}

/// Ключи одного соединения: у каждого направления свой, у каждого соединения новый.
public struct RemoteSessionKeys: Sendable {
    public let clientToServer: SymmetricKey
    public let serverToClient: SymmetricKey

    public init(pairingKey: Data, saltC: Data, saltS: Data) {
        let master = SymmetricKey(data: pairingKey)
        let salt = saltC + saltS
        clientToServer = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: master, salt: salt, info: Data("mbs-remote-v1 c2s".utf8), outputByteCount: 32
        )
        serverToClient = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: master, salt: salt, info: Data("mbs-remote-v1 s2c".utf8), outputByteCount: 32
        )
    }
}

/// Сводка приветствия. Входит в проверку каждого кадра: подменить в пути часы или номер студии нельзя,
/// хотя приветствие идёт открыто.
public enum RemoteTranscript {
    public static func hash(studioID: String, saltC: Data, saltS: Data, clockMs: UInt64) -> Data {
        let studio = Data(studioID.utf8)
        var hasher = SHA256()
        hasher.update(data: Data("mbs-remote-v1 transcript".utf8))
        hasher.update(data: Data([UInt8(clamping: studio.count)]))
        hasher.update(data: studio)
        hasher.update(data: saltC)
        hasher.update(data: saltS)
        hasher.update(data: withUnsafeBytes(of: clockMs.bigEndian) { Data($0) })
        return Data(hasher.finalize())
    }
}

/// Заголовок кадра: вид (1 байт) и счётчик (8 байт).
private let headerLength = 9
private let tagLength = 16

private func nonce(for counter: UInt64) throws(RemoteCryptoError) -> ChaChaPoly.Nonce {
    var bytes = Data(count: 4)
    bytes.append(withUnsafeBytes(of: counter.bigEndian) { Data($0) })
    do {
        return try ChaChaPoly.Nonce(data: bytes)
    } catch {
        throw .malformed
    }
}

public struct RemoteSealer: Sendable {
    private let key: SymmetricKey
    private let aad: Data
    private var next: UInt64?

    public init(key: SymmetricKey, aad: Data) {
        self.key = key
        self.aad = aad
        next = 0
    }

    public mutating func seal(_ plaintext: Data) throws(RemoteCryptoError) -> Data {
        guard let counter = next else { throw .exhausted }
        let frame = try Self.frame(key: key, aad: aad, counter: counter, plaintext: plaintext)
        next = counter == .max ? nil : counter + 1
        return frame
    }

    static func frame(key: SymmetricKey, aad: Data, counter: UInt64, plaintext: Data) throws(RemoteCryptoError) -> Data {
        let box: ChaChaPoly.SealedBox
        let currentNonce = try nonce(for: counter)
        do {
            box = try ChaChaPoly.seal(plaintext, using: key, nonce: currentNonce, authenticating: aad)
        } catch {
            throw .exhausted
        }
        var frame = Data([RemoteFrameKind.sealed])
        frame.append(withUnsafeBytes(of: counter.bigEndian) { Data($0) })
        frame.append(box.ciphertext)
        frame.append(box.tag)
        return frame
    }
}

public struct RemoteOpener: Sendable {
    private let key: SymmetricKey
    private let aad: Data
    private var last: UInt64?

    public init(key: SymmetricKey, aad: Data) {
        self.key = key
        self.aad = aad
    }

    public mutating func open(_ frame: Data) throws(RemoteCryptoError) -> Data {
        let bytes = [UInt8](frame)
        guard bytes.count >= headerLength + tagLength, bytes[0] == RemoteFrameKind.sealed else { throw .malformed }
        let counter = bytes[1..<headerLength].reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
        if let last, counter <= last { throw .stale }

        let currentNonce = try nonce(for: counter)
        let ciphertext = Data(bytes[headerLength..<(bytes.count - tagLength)])
        let tag = Data(bytes[(bytes.count - tagLength)...])
        let plaintext: Data
        do {
            let box = try ChaChaPoly.SealedBox(nonce: currentNonce, ciphertext: ciphertext, tag: tag)
            plaintext = try ChaChaPoly.open(box, using: key, authenticating: aad)
        } catch {
            throw .tampered
        }
        last = counter
        return plaintext
    }
}
