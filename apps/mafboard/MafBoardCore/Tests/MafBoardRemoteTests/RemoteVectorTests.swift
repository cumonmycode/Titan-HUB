import CryptoKit
import Foundation
import Testing
@testable import MafBoardRemote

/// Общие векторы: те же файлы проверяет Rust на ноутбуке, а создаёт независимая реализация на Python.
private struct Vectors: Decodable {
    struct KeyCase: Decodable {
        let pairingKey, saltC, saltS, c2sKey, s2cKey: String
    }

    struct TranscriptCase: Decodable {
        let studioId, saltC, saltS, clockMs, hash: String
    }

    struct FrameCase: Decodable {
        let name, key, aad, counter, plaintext, frame: String
    }

    struct RejectCase: Decodable {
        let name, key, aad, frame: String
    }

    let keyDerivation: [KeyCase]
    let transcript: [TranscriptCase]
    let frames: [FrameCase]
    let rejects: [RejectCase]

    static func load() throws -> Vectors {
        try JSONDecoder().decode(Vectors.self, from: rawData())
    }

    static func rawData() throws -> Data {
        let url = try #require(Bundle.module.url(forResource: "remote-test-vectors", withExtension: "json"))
        return try Data(contentsOf: url)
    }
}

private func hex(_ text: String) -> Data {
    var data = Data(capacity: text.count / 2)
    var index = text.startIndex
    while index < text.endIndex {
        let next = text.index(index, offsetBy: 2)
        data.append(UInt8(text[index..<next], radix: 16)!)
        index = next
    }
    return data
}

private func keyBytes(_ key: SymmetricKey) -> Data {
    key.withUnsafeBytes { Data($0) }
}

@Suite("Пульт: общие векторы шифрования")
struct RemoteVectorTests {
    @Test("Вывод ключей совпадает с Rust и Python")
    func keyDerivation() throws {
        let cases = try Vectors.load().keyDerivation
        #expect(cases.count >= 3)
        for item in cases {
            let keys = RemoteSessionKeys(pairingKey: hex(item.pairingKey), saltC: hex(item.saltC), saltS: hex(item.saltS))
            #expect(keyBytes(keys.clientToServer) == hex(item.c2sKey))
            #expect(keyBytes(keys.serverToClient) == hex(item.s2cKey))
        }
    }

    @Test("Сводка приветствия совпадает")
    func transcript() throws {
        for item in try Vectors.load().transcript {
            let hash = RemoteTranscript.hash(
                studioID: item.studioId, saltC: hex(item.saltC), saltS: hex(item.saltS), clockMs: try #require(UInt64(item.clockMs))
            )
            #expect(hash == hex(item.hash))
        }
    }

    @Test("Кадры совпадают байт в байт и открываются")
    func frames() throws {
        let cases = try Vectors.load().frames
        #expect(cases.count >= 7)
        for item in cases {
            let key = SymmetricKey(data: hex(item.key))
            let aad = hex(item.aad)
            let counter = try #require(UInt64(item.counter))
            let sealed = try RemoteSealer.frame(key: key, aad: aad, counter: counter, plaintext: hex(item.plaintext))
            #expect(sealed == hex(item.frame), "\(item.name)")

            var opener = RemoteOpener(key: key, aad: aad)
            #expect(try opener.open(hex(item.frame)) == hex(item.plaintext), "\(item.name)")
        }
    }

    @Test("Испорченные кадры отклоняются")
    func rejects() throws {
        let cases = try Vectors.load().rejects
        #expect(cases.count >= 7)
        for item in cases {
            var opener = RemoteOpener(key: SymmetricKey(data: hex(item.key)), aad: hex(item.aad))
            #expect(throws: RemoteCryptoError.self, "\(item.name)") {
                _ = try opener.open(hex(item.frame))
            }
        }
    }

    @Test("Повтор и старые кадры отклоняются, ошибка не двигает счётчик")
    func replay() throws {
        let key = SymmetricKey(size: .bits256)
        let aad = Data(repeating: 9, count: 32)
        var sealer = RemoteSealer(key: key, aad: aad)
        var opener = RemoteOpener(key: key, aad: aad)
        let first = try sealer.seal(Data("a".utf8))
        let second = try sealer.seal(Data("b".utf8))

        var broken = second
        broken[broken.endIndex - 1] ^= 1
        #expect(throws: RemoteCryptoError.tampered) { _ = try opener.open(broken) }
        #expect(try opener.open(second) == Data("b".utf8))
        #expect(throws: RemoteCryptoError.stale) { _ = try opener.open(second) }
        #expect(throws: RemoteCryptoError.stale) { _ = try opener.open(first) }
    }

    @Test("Срез Data с ненулевым началом разбирается верно")
    func dataSlice() throws {
        let key = SymmetricKey(size: .bits256)
        let aad = Data(repeating: 1, count: 32)
        var sealer = RemoteSealer(key: key, aad: aad)
        var opener = RemoteOpener(key: key, aad: aad)
        let frame = try sealer.seal(Data("срез".utf8))
        let shifted = (Data([0, 0, 0]) + frame).dropFirst(3)
        #expect(try opener.open(shifted) == Data("срез".utf8))
    }
}

@Suite("Пульт: сообщения")
struct RemoteMessageTests {
    private func json(_ value: some Encodable) throws -> NSDictionary {
        try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? NSDictionary)
    }

    private func document() throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: Vectors.rawData()) as? [String: Any])
    }

    @Test("Команды кодируются так же, как образцы в векторах")
    func commands() throws {
        let frames = try #require(try document()["phoneFrames"] as? [NSDictionary])
        let commands: [RemoteCommand] = [
            .switchScene("break"), .setMicMuted(true), .setLanEnabled(false),
            .selectCamera("6C707041-05AC-0011"), .startRecording, .stopRecording,
        ]
        let samples = frames.filter { $0["id"] != nil }
        #expect(samples.count == commands.count)
        for (sample, command) in zip(samples, commands) {
            let envelope = RemoteEnvelope(
                id: try #require(sample["id"] as? String),
                sentAtMs: try #require((sample["sentAtMs"] as? NSNumber)?.uint64Value),
                command: command
            )
            #expect(try json(envelope) == sample, "\(command)")
        }
    }

    @Test("Все сообщения ноутбука из векторов разбираются")
    func desktopMessages() throws {
        let samples = try #require(try document()["desktopMessages"] as? [Any])
        let decoded = try samples.map { sample -> DesktopMessage in
            let data = try JSONSerialization.data(withJSONObject: sample)
            return try JSONDecoder().decode(DesktopMessage.self, from: data)
        }
        guard case let .state(state) = decoded[0] else {
            Issue.record("первое сообщение — состояние")
            return
        }
        #expect(state.activeScene == "break")
        #expect(state.scenes.map(\.name) == ["Игра", "Перерыв"])
        #expect(state.micMuted)
        #expect(state.recording)
        #expect(state.video == RemoteVideo(width: 1920, height: 1080, fps: 30))
        guard case let .state(second) = decoded[1] else {
            Issue.record("второе сообщение — состояние")
            return
        }
        #expect(second.cameraUid == nil)
        #expect(second.lanUrls == ["http://192.168.1.41:8889/lan"])
        guard case let .stats(stats) = decoded[2] else {
            Issue.record("третье сообщение — статистика")
            return
        }
        #expect(stats.recordingSeconds == 13)
        #expect(decoded[3] == .stats(RemoteStats(uptimeSeconds: 1, recordingSeconds: nil, recordingBytes: 0, framesSkipped: 0, lanActive: false)))
        #expect(decoded[4] == .level(peakDb: -12.5))
        #expect(decoded[5] == .reply(id: "c-1", error: nil))
        #expect(decoded[6] == .reply(id: "c-2", error: "Команда устарела"))
        #expect(decoded[7] == .engine(online: false))
        #expect(decoded[8] == .alive)
    }

    @Test("Незнакомое сообщение не ломает разбор: ноутбук может быть новее")
    func unknownMessage() throws {
        let message = try JSONDecoder().decode(DesktopMessage.self, from: Data(#"{"type":"future","x":1}"#.utf8))
        #expect(message == .unknown("future"))
    }

    @Test("Тишина: уровень может прийти без числа")
    func silentLevel() throws {
        let message = try JSONDecoder().decode(DesktopMessage.self, from: Data(#"{"type":"level","peakDb":null}"#.utf8))
        #expect(message == .level(peakDb: nil))
    }
}

@Suite("Пульт: соединение со стороны телефона")
struct RemoteSessionTests {
    private let pairingKey = Data(repeating: 42, count: 32)
    private let studio = "studio-1"
    private let clock: UInt64 = 1_793_883_600_123
    private let saltC = Data(repeating: 7, count: 16)
    private let saltS = Data(repeating: 8, count: 16)

    /// Ноутбук в тесте: те же примитивы с другой стороны.
    private func serverHello() -> Data {
        var frame = Data([RemoteFrameKind.serverHello])
        frame.append(Data(#"{"saltS":"\#(RemoteBase64URL.encode(saltS))"}"#.utf8))
        return frame
    }

    private func serverEnds() -> (sealer: RemoteSealer, opener: RemoteOpener) {
        let keys = RemoteSessionKeys(pairingKey: pairingKey, saltC: saltC, saltS: saltS)
        let aad = RemoteTranscript.hash(studioID: studio, saltC: saltC, saltS: saltS, clockMs: clock)
        return (RemoteSealer(key: keys.serverToClient, aad: aad), RemoteOpener(key: keys.clientToServer, aad: aad))
    }

    private func session() -> RemoteClientSession {
        RemoteClientSession(pairingKey: pairingKey, studioID: studio, clockMs: clock, saltC: saltC)
    }

    @Test("Приветствие в формате контракта, ключа в нём нет")
    func hello() throws {
        let hello = session().hello
        #expect(hello.first == RemoteFrameKind.clientHello)
        let body = try #require(try JSONSerialization.jsonObject(with: hello.dropFirst()) as? [String: Any])
        #expect(body["studioId"] as? String == studio)
        #expect(body["saltC"] as? String == RemoteBase64URL.encode(saltC))
        #expect((body["clockMs"] as? NSNumber)?.uint64Value == clock)
        #expect(!hello.contains(pairingKey))
    }

    @Test("Соль каждый раз новая")
    func freshSalt() {
        let first = RemoteClientSession(pairingKey: pairingKey, studioID: studio, clockMs: clock)
        let second = RemoteClientSession(pairingKey: pairingKey, studioID: studio, clockMs: clock)
        #expect(first.hello != second.hello)
    }

    @Test("Полный обмен: подтверждение ключа, команда, ответ")
    func fullExchange() throws {
        var phone = session()
        var server = serverEnds()
        #expect(!phone.isReady)

        let ready = try phone.acceptServerHello(serverHello())
        #expect(phone.isReady)
        #expect(try server.opener.open(ready) == Data(#"{"type":"ready"}"#.utf8))

        let frame = try phone.seal(RemoteEnvelope(id: "c-1", sentAtMs: clock, command: .switchScene("break")))
        let body = try #require(try JSONSerialization.jsonObject(with: server.opener.open(frame)) as? [String: Any])
        #expect(body["id"] as? String == "c-1")
        #expect((body["command"] as? [String: Any])?["scene"] as? String == "break")

        let answer = try server.sealer.seal(Data(#"{"type":"reply","id":"c-1","error":null}"#.utf8))
        #expect(try phone.open(answer) == .reply(id: "c-1", error: nil))
    }

    @Test("Сигнал «на связи» шифруется")
    func alive() throws {
        var phone = session()
        var server = serverEnds()
        _ = try server.opener.open(phone.acceptServerHello(serverHello()))
        #expect(try server.opener.open(phone.sealAlive()) == Data(#"{"type":"alive"}"#.utf8))
    }

    @Test("До ответа ноутбука ничего зашифровать нельзя")
    func notReady() {
        var phone = session()
        #expect(throws: RemoteClientSession.SessionError.notReady) {
            _ = try phone.seal(RemoteEnvelope(id: "a", sentAtMs: 1, command: .stopRecording))
        }
    }

    @Test("Испорченный ответ на приветствие", arguments: [
        Data(),
        Data([RemoteFrameKind.serverHello]),
        Data([RemoteFrameKind.clientHello]) + Data(#"{"saltS":"AAAA"}"#.utf8),
        Data([RemoteFrameKind.serverHello]) + Data(#"{"saltS":"AAAA"}"#.utf8),
        Data([RemoteFrameKind.serverHello]) + Data("not json".utf8),
    ])
    func badServerHello(frame: Data) {
        var phone = session()
        #expect(throws: RemoteClientSession.SessionError.badServerHello) {
            _ = try phone.acceptServerHello(frame)
        }
    }

    @Test("Подмена кадра ноутбука замечается")
    func tamperedFromServer() throws {
        var phone = session()
        var server = serverEnds()
        _ = try phone.acceptServerHello(serverHello())
        var frame = try server.sealer.seal(Data(#"{"type":"alive"}"#.utf8))
        frame[frame.endIndex - 1] ^= 1
        #expect(throws: RemoteClientSession.SessionError.crypto(.tampered)) {
            _ = try phone.open(frame)
        }
    }

    @Test("Base64URL без заполнения в обе стороны")
    func base64URL() {
        let data = Data([0xFB, 0xFF, 0xFE])
        #expect(RemoteBase64URL.encode(data) == "-__-")
        #expect(RemoteBase64URL.decode("-__-") == data)
        #expect(RemoteBase64URL.decode("не base64") == nil)
    }
}
