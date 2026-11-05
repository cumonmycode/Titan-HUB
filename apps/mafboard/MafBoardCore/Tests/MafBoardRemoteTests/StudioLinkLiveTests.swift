import Foundation
import Testing
@testable import MafBoardRemote

// Проверка на настоящем MafBoard Studio: Swift на этом Mac управляет настоящим движком.
// Запускается только с окружением, обычный прогон её пропускает:
//   MBS_LIVE_KEY=<ключ base64url> MBS_LIVE_STUDIO=<номер> swift test --filter StudioLinkLiveTests
// Через облако ещё MBS_LIVE_RELAY_URL и MBS_LIVE_PHONE_TOKEN.
private let environment = ProcessInfo.processInfo.environment

@MainActor
@Suite("Пульт: настоящий ноутбук", .enabled(if: environment["MBS_LIVE_KEY"] != nil))
struct StudioLinkLiveTests {
    private func makeLink() throws -> StudioLink {
        let keyText = try #require(environment["MBS_LIVE_KEY"])
        let key = try #require(RemoteBase64URL.decode(keyText))
        let studio = try #require(environment["MBS_LIVE_STUDIO"])
        let relay = URL(string: environment["MBS_LIVE_RELAY_URL"] ?? "ws://127.0.0.1:9/none")!
        let token = environment["MBS_LIVE_PHONE_TOKEN"]
        return StudioLink(pairingKey: key, studioID: studio, relayURL: relay, useLAN: token == nil, relayToken: { _ in token })
    }

    private func wait(_ what: String, seconds: Double = 12, until check: () -> Bool) async throws {
        let deadline = Date.now.addingTimeInterval(seconds)
        while Date.now < deadline {
            if check() { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        Issue.record("не дождались: \(what)")
        throw CancellationError()
    }

    @Test("Сцены, микрофон, запись, камера и вывод в сеть")
    func controlsEverything() async throws {
        let link = try makeLink()
        link.start()
        defer { link.stop() }
        let expected: StudioLink.Connection = environment["MBS_LIVE_PHONE_TOKEN"] == nil ? .lan : .cloud
        try await wait("соединение \(expected)") { link.connection == expected }
        try await wait("состояние эфира") { link.state != nil }
        let first = try #require(link.state)
        #expect(first.scenes.count >= 2)

        for scene in first.scenes {
            link.send(.switchScene(scene.id))
            try await wait("сцена \(scene.name)") { link.state?.activeScene == scene.id }
        }

        link.send(.setMicMuted(!first.micMuted))
        try await wait("микрофон") { link.state?.micMuted == !first.micMuted }
        link.send(.setMicMuted(first.micMuted))
        try await wait("микрофон назад") { link.state?.micMuted == first.micMuted }
        try await wait("уровень микрофона") { link.peakDb != nil }

        link.send(.startRecording)
        try await wait("запись идёт") { link.state?.recording == true }
        try await wait("статистика записи") { (link.stats?.recordingBytes ?? 0) > 0 }
        link.send(.stopRecording)
        try await wait("запись остановлена") { link.state?.recording == false }

        link.send(.setLanEnabled(true))
        try await wait("вывод в сеть") { link.state?.lanEnabled == true }
        link.send(.setLanEnabled(false))
        try await wait("вывод выключен") { link.state?.lanEnabled == false }

        if let camera = first.cameraUid {
            link.send(.selectCamera(camera))
        }
        link.send(.switchScene(first.activeScene))
        try await wait("все команды подтверждены") { link.pendingCount == 0 }
        #expect(link.notice == nil, "\(link.notice ?? "")")
    }

    @Test("Соединение держится дольше, чем ждёт ноутбук от молчащего телефона")
    func staysConnected() async throws {
        let link = try makeLink()
        link.start()
        defer { link.stop() }
        try await wait("состояние") { link.state != nil }
        let started = link.connection
        try await Task.sleep(for: .seconds(14))
        #expect(link.connection == started)
        link.send(.switchScene(try #require(link.state?.activeScene)))
        try await wait("команда после долгой паузы") { link.pendingCount == 0 }
        #expect(link.notice == nil, "\(link.notice ?? "")")
    }
}
