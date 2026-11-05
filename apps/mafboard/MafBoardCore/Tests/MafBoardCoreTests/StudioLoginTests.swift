import Foundation
import Testing
@testable import MafBoardCore

@Suite("Вход в MafBoard Studio: ссылка из QR-кода")
struct StudioLoginLinkTests {
    private let hosts: Set<String> = ["mafboard.titanpos.ru"]
    private let scan = "AbCdEfGhIjKlMnOpQrStUvWx"
    /// 32 байта от 0 до 31 в base64url.
    private let key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"
    private let studio = "6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b"

    private func parse(_ text: String) -> StudioLoginLink? {
        StudioLoginLink(url: URL(string: text)!, allowedHosts: hosts)
    }

    @Test("Universal Link: код билета, ключ и номер студии")
    func universalLink() throws {
        let link = try #require(parse("https://mafboard.titanpos.ru/studio/login?scan=\(scan)#k=\(key)&s=\(studio)"))
        #expect(link.scanCode == scan)
        #expect(link.studioID == studio)
        #expect(link.pairingKey.count == 32)
        #expect(Array(link.pairingKey) == Array(UInt8(0)...UInt8(31)))
    }

    @Test("Схема приложения: кнопка на странице-заглушке передаёт то же самое")
    func appScheme() {
        let link = parse("mafboard://studio/login?scan=\(scan)#k=\(key)&s=\(studio)")
        #expect(link?.scanCode == scan)
        #expect(link?.studioID == studio)
    }

    @Test("Порядок частей после # не важен")
    func fragmentOrder() {
        #expect(parse("https://mafboard.titanpos.ru/studio/login?scan=\(scan)#s=\(studio)&k=\(key)")?.studioID == studio)
    }

    @Test("Чужие и неполные ссылки не принимаются", arguments: [
        "https://evil.example/studio/login?scan=AbCdEfGhIjKlMnOpQrStUvWx#k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b",
        "http://mafboard.titanpos.ru/studio/login?scan=AbCdEfGhIjKlMnOpQrStUvWx#k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b",
        "https://mafboard.titanpos.ru/other?scan=AbCdEfGhIjKlMnOpQrStUvWx#k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b",
        "https://mafboard.titanpos.ru/studio/login#k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b",
        "https://mafboard.titanpos.ru/studio/login?scan=AbCdEfGhIjKlMnOpQrStUvWx",
        "https://mafboard.titanpos.ru/studio/login?scan=AbCdEfGhIjKlMnOpQrStUvWx#s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b",
        "https://mafboard.titanpos.ru/studio/login?scan=AbCdEfGhIjKlMnOpQrStUvWx#k=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        "mafboard://auth/return?ticket=t-1",
        "https://mafboard.titanpos.ru/auth/return?ticket=t-1",
    ])
    func rejected(text: String) {
        #expect(parse(text) == nil)
    }

    @Test("Ключ сопряжения только из 32 байт", arguments: [
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg",     // 31 байт
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gIQ", // 34 байта
        "не base64",
        "",
    ])
    func badKey(key: String) {
        let escaped = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        #expect(parse("https://mafboard.titanpos.ru/studio/login?scan=\(scan)#k=\(escaped)&s=\(studio)") == nil)
    }

    @Test("Код билета и номер студии проверяются по формату", arguments: [
        ("scan=abc", "s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b"),
        ("scan=AbCdEfGhIjKlMnOp%20rStUvWx", "s=6f1c2a9e-5b7d-4e21-9a10-3c4d5e6f7a8b"),
        ("scan=AbCdEfGhIjKlMnOpQrStUvWx", "s=short"),
        ("scan=AbCdEfGhIjKlMnOpQrStUvWx", "s=6f1c2a9e%2F5b7d%2F4e21"),
    ])
    func badFormat(scanPart: String, studioPart: String) {
        #expect(parse("https://mafboard.titanpos.ru/studio/login?\(scanPart)#k=\(key)&\(studioPart)") == nil)
    }

    @Test("Ключ не попадает в журналы и отладочный вывод")
    func keyIsNotPrinted() throws {
        let link = try #require(parse("https://mafboard.titanpos.ru/studio/login?scan=\(scan)#k=\(key)&s=\(studio)"))
        #expect(!String(describing: link).contains(key))
        #expect(!String(reflecting: link).contains(key))
        #expect(!String(describing: link).contains("0, 1, 2"))
    }

    private func flow() -> StudioLoginFlow {
        StudioLoginFlow(link: parse("https://mafboard.titanpos.ru/studio/login?scan=\(scan)#k=\(key)&s=\(studio)")!)
    }

    private func ticket(expiresAt: Date = .distantFuture) -> StudioLoginTicket {
        StudioLoginTicket(deviceName: "MacBook", platform: "macos", codes: [17, 42, 88], expiresAt: expiresAt)
    }

    @Test("Подтверждение: билет, выбор кода, готово")
    func flowHappyPath() {
        var flow = flow()
        #expect(flow.state == .loading)
        flow.ticketLoaded(ticket())
        #expect(flow.state == .choosing(ticket()))
        let accepted = flow.choose(code: 42)
        #expect(accepted)
        #expect(flow.state == .approving(ticket(), code: 42))
        flow.approved(deviceName: "MacBook")
        #expect(flow.state == .done(deviceName: "MacBook"))
    }

    @Test("Выбрать можно только показанный код и только один раз")
    func flowChoosesOnce() {
        var flow = flow()
        let tooEarly = flow.choose(code: 42)
        #expect(!tooEarly)
        flow.ticketLoaded(ticket())
        let unknown = flow.choose(code: 99)
        #expect(!unknown)
        #expect(flow.state == .choosing(ticket()))
        let first = flow.choose(code: 42)
        let second = flow.choose(code: 17)
        #expect(first)
        #expect(!second)
        #expect(flow.state == .approving(ticket(), code: 42))
    }

    @Test("Срок истёк, пока ведущий выбирал")
    func flowExpires() {
        let moment = Date(timeIntervalSince1970: 1000)
        var flow = flow()
        flow.ticketLoaded(ticket(expiresAt: moment))
        flow.clockTick(moment.addingTimeInterval(-1))
        #expect(flow.state == .choosing(ticket(expiresAt: moment)))
        flow.clockTick(moment)
        #expect(flow.state == .failed(.expired))
        let late = flow.choose(code: 42)
        #expect(!late)
    }

    @Test("Завершённый вход не портится поздней ошибкой, а идущий запрос не истекает по часам")
    func flowEdges() {
        var flow = flow()
        flow.ticketLoaded(ticket(expiresAt: Date(timeIntervalSince1970: 1000)))
        _ = flow.choose(code: 42)
        flow.clockTick(Date(timeIntervalSince1970: 2000))
        #expect(flow.state == .approving(ticket(expiresAt: Date(timeIntervalSince1970: 1000)), code: 42))
        flow.approved(deviceName: "MacBook")
        flow.failed(.wrongCode)
        #expect(flow.state == .done(deviceName: "MacBook"))
    }

    @Test("Сопряжение: ключ не печатается и переживает сохранение")
    func pairing() throws {
        let pairing = StudioPairing(studioID: studio, pairingKey: Data(repeating: 7, count: 32), deviceName: "MacBook", pairedAt: Date(timeIntervalSince1970: 5))
        #expect(!String(describing: pairing).contains(Data(repeating: 7, count: 32).base64EncodedString()))
        let decoded = try JSONDecoder().decode(StudioPairing.self, from: JSONEncoder().encode(pairing))
        #expect(decoded == pairing)
    }

    @Test("Сессии настольного приложения узнаются по платформе")
    func studioSessions() {
        let now = Date(timeIntervalSince1970: 0)
        #expect(DeviceSession(id: "a", platform: "macos", createdAt: now, lastUsedAt: now).isStudio)
        #expect(DeviceSession(id: "a", platform: "windows", createdAt: now, lastUsedAt: now).isStudio)
        #expect(!DeviceSession(id: "a", platform: "ios", createdAt: now, lastUsedAt: now).isStudio)
        #expect(DeviceSession(id: "a", platform: "macos", createdAt: now, lastUsedAt: now).displayName == "Mac")
    }

    @Test("Ссылка возврата из бота и ссылка студии не путаются")
    func linksDoNotMix() {
        let studioURL = URL(string: "https://mafboard.titanpos.ru/studio/login?scan=\(scan)#k=\(key)&s=\(studio)")!
        #expect(LoginReturnLink.ticketID(from: studioURL, allowedHosts: hosts) == nil)
    }
}
