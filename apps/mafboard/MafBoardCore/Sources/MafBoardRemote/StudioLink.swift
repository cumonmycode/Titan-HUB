import Foundation
import Network
import Observation

/// Связь телефона с ноутбуком: выбор канала, приветствие, команды и состояние эфира.
/// Экран пульта работает только с этим объектом и не знает, какой канал сейчас используется.
@MainActor @Observable
public final class StudioLink {
    public enum Connection: Sendable, Equatable {
        case searching
        case lan
        case cloud
        /// До сервера дошли, а ноутбука там нет: он выключен или без интернета.
        case laptopOffline
    }

    public private(set) var connection = Connection.searching
    public private(set) var state: RemoteState?
    public private(set) var stats: RemoteStats?
    public private(set) var peakDb: Double?
    public private(set) var engineOnline = true
    /// Последняя ошибка команды или подсказка для ведущего.
    public private(set) var notice: String?
    public private(set) var localNetworkDenied = false
    public var pendingCount: Int { pending.count }

    private enum Phase {
        case idle
        case connecting
        case relayAuth
        case waitingForLaptop
        case handshake(RemoteClientSession)
        case live(RemoteClientSession)
    }

    private static let tickEvery = Duration.milliseconds(250)
    private static let aliveEvery: TimeInterval = 1
    private static let closeUnauthorized: UInt16 = 4401

    private let pairingKey: Data
    private let studioID: String
    private let relayURL: URL
    private let useLAN: Bool
    private let relayToken: @Sendable (_ rejected: String?) async -> String?

    private var policy = RemoteChannelPolicy(now: .now)
    private var pending = RemotePendingCommands()
    private var browser: RemoteBrowser?
    private var lanEndpoint: NWEndpoint?
    private var socket: RemoteSocket?
    private var phase = Phase.idle
    private var connectedSerial = 0
    private var attempt = 0
    private var lastAlive = Date.distantPast
    private var rejectedToken: String?
    private var tasks: [Task<Void, Never>] = []

    public init(
        pairingKey: Data,
        studioID: String,
        relayURL: URL,
        useLAN: Bool = true,
        relayToken: @escaping @Sendable (_ rejected: String?) async -> String?
    ) {
        self.pairingKey = pairingKey
        self.studioID = studioID
        self.relayURL = relayURL
        self.useLAN = useLAN
        self.relayToken = relayToken
    }

    public func start() {
        guard tasks.isEmpty else { return }
        policy = RemoteChannelPolicy(now: .now)
        connectedSerial = 0
        if useLAN { startBrowsing() }
        tasks.append(Task { [weak self] in
            while !Task.isCancelled {
                self?.tick(now: .now)
                try? await Task.sleep(for: Self.tickEvery)
            }
        })
    }

    public func stop() {
        tasks.forEach { $0.cancel() }
        tasks = []
        browser?.cancel()
        browser = nil
        lanEndpoint = nil
        dropConnection()
        connection = .searching
    }

    public func send(_ command: RemoteCommand) {
        let now = Date.now
        let envelope = RemoteEnvelope(id: UUID().uuidString, sentAtMs: Self.milliseconds(now), command: command)
        pending.add(envelope, at: now)
        transmit(envelope)
    }

    public func dismissNotice() {
        notice = nil
    }

    // MARK: Канал

    private func startBrowsing() {
        let browser = RemoteBrowser(studioID: studioID)
        self.browser = browser
        browser.start()
        tasks.append(Task { [weak self] in
            for await event in browser.events {
                self?.handle(browserEvent: event)
            }
        })
    }

    private func handle(browserEvent event: RemoteBrowser.Event) {
        switch event {
        case let .endpoint(endpoint):
            localNetworkDenied = false
            lanEndpoint = endpoint
            policy.lanVisibilityChanged(endpoint != nil, at: .now)
        case .denied:
            localNetworkDenied = true
        }
    }

    private func tick(now: Date) {
        policy.tick(at: now)
        // Сервер на связи, просто ноутбука нет: это не молчание канала, переподключаться незачем.
        if case .waitingForLaptop = phase { policy.heard(on: .cloud, at: now) }
        if policy.connectionSerial != connectedSerial {
            connectedSerial = policy.connectionSerial
            connect(policy.channel)
        }
        if case .live = phase, now.timeIntervalSince(lastAlive) >= Self.aliveEvery {
            lastAlive = now
            sendAlive()
        }
        if pending.expire(at: now) > 0 {
            notice = "Команда не дошла до ноутбука"
        }
    }

    private func connect(_ channel: RemoteChannel?) {
        dropConnection()
        attempt += 1
        let current = attempt
        switch channel {
        case .lan:
            guard let lanEndpoint else { return }
            open(RemoteSocket(endpoint: lanEndpoint, useTLS: false), channel: .lan, attempt: current)
        case .cloud:
            let rejected = rejectedToken
            rejectedToken = nil
            tasks.append(Task { [weak self, relayToken] in
                guard let token = await relayToken(rejected), let self, self.attempt == current else { return }
                self.openRelay(token: token, attempt: current)
            })
        case nil:
            break
        }
    }

    private func openRelay(token: String, attempt current: Int) {
        pendingAuth = RelayAuthMessage(token: token, studioId: studioID)
        currentAuthToken = token
        let socket = RemoteSocket(endpoint: .url(relayURL), useTLS: relayURL.scheme == "wss")
        open(socket, channel: .cloud, attempt: current)
    }

    private struct RelayAuthMessage: Encodable {
        var type = "auth"
        let token: String
        let studioId: String
        var role = "phone"
    }

    private var pendingAuth: RelayAuthMessage?

    private func open(_ socket: RemoteSocket, channel: RemoteChannel, attempt current: Int) {
        self.socket = socket
        phase = .connecting
        socket.start()
        tasks.append(Task { [weak self] in
            for await event in socket.events {
                guard let self, self.attempt == current else { return }
                self.handle(event, channel: channel)
            }
        })
    }

    private func dropConnection() {
        socket?.cancel()
        socket = nil
        phase = .idle
        pendingAuth = nil
    }

    // MARK: Приветствие и кадры

    private func handle(_ event: RemoteSocket.Event, channel: RemoteChannel) {
        switch event {
        case .ready:
            if channel == .lan {
                sendHello()
            } else if let auth = pendingAuth, let data = try? JSONEncoder().encode(auth) {
                phase = .relayAuth
                pendingAuth = nil
                socket?.sendText(String(decoding: data, as: UTF8.self))
            }
        case let .text(text):
            // Служебные сообщения есть только у релея. В локальной сети соединение не защищено TLS,
            // и подделанный текст не должен рвать сессию.
            if channel == .cloud { handle(relayNotice: text) }
        case let .frame(frame):
            handle(frame: frame, channel: channel)
        case let .closed(code):
            if code == Self.closeUnauthorized, channel == .cloud { rejectedToken = currentAuthToken }
            dropConnection()
            connection = .searching
        }
    }

    /// Токен текущего подключения к релею. Если релей его отверг, следующий запрос попросит новый.
    private var currentAuthToken: String?

    private struct RelayNotice: Decodable {
        let type: String
        let peerOnline: Bool?
        let online: Bool?
    }

    private func handle(relayNotice text: String) {
        guard let notice = try? JSONDecoder().decode(RelayNotice.self, from: Data(text.utf8)) else { return }
        policy.heard(on: .cloud, at: .now)
        switch (notice.type, notice.peerOnline, notice.online) {
        case ("ready", true, _), ("peer", _, true):
            sendHello()
        case ("ready", _, _), ("peer", _, false):
            phase = .waitingForLaptop
            connection = .laptopOffline
        default:
            break
        }
    }

    private func sendHello() {
        let session = RemoteClientSession(pairingKey: pairingKey, studioID: studioID, clockMs: Self.milliseconds(.now))
        phase = .handshake(session)
        socket?.send(session.hello)
    }

    private func handle(frame: Data, channel: RemoteChannel) {
        switch phase {
        case var .handshake(session):
            do throws(RemoteClientSession.SessionError) {
                let ready = try session.acceptServerHello(frame)
                phase = .live(session)
                socket?.send(ready)
                lastAlive = .now
                resendPending()
            } catch {
                dropConnection()
            }
        case var .live(session):
            do throws(RemoteClientSession.SessionError) {
                let message = try session.open(frame)
                phase = .live(session)
                // «Подключено» только после расшифрованного кадра: ответ на приветствие ничего не доказывает.
                policy.heard(on: channel, at: .now)
                connection = channel == .lan ? .lan : .cloud
                apply(message)
            } catch {
                // Подмена или сбой: это соединение больше не доверяем. Канал выберет политика.
                dropConnection()
            }
        default:
            break
        }
    }

    private func apply(_ message: DesktopMessage) {
        switch message {
        case let .state(next):
            state = next
            engineOnline = true
        case let .stats(next):
            stats = next
        case let .level(value):
            peakDb = value
        case let .reply(id, error):
            if pending.acknowledge(id: id), let error { notice = error }
        case let .engine(online):
            engineOnline = online
        case .alive, .unknown:
            break
        }
    }

    // MARK: Отправка

    private func resendPending() {
        for envelope in pending.resendable(at: .now) {
            transmit(envelope)
        }
    }

    private func transmit(_ envelope: RemoteEnvelope) {
        guard case var .live(session) = phase else { return }
        do throws(RemoteClientSession.SessionError) {
            let frame = try session.seal(envelope)
            phase = .live(session)
            socket?.send(frame)
        } catch {
            dropConnection()
        }
    }

    private func sendAlive() {
        guard case var .live(session) = phase else { return }
        do throws(RemoteClientSession.SessionError) {
            let frame = try session.sealAlive()
            phase = .live(session)
            socket?.send(frame)
        } catch {
            dropConnection()
        }
    }

    private static func milliseconds(_ date: Date) -> UInt64 {
        UInt64(max(0, date.timeIntervalSince1970 * 1000))
    }
}
