import Foundation
import Network

/// WebSocket на Network.framework: один и тот же для ноутбука в сети и для релея.
public final class RemoteSocket: @unchecked Sendable {
    public enum Event: Sendable, Equatable {
        case ready
        case frame(Data)
        case text(String)
        /// Код закрытия WebSocket, если сервер его сообщил.
        case closed(code: UInt16?)
    }

    public static let maxFrameBytes = 64 * 1024

    public let events: AsyncStream<Event>

    private let continuation: AsyncStream<Event>.Continuation
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "ru.titan.mafboard.remote-socket")

    public init(endpoint: NWEndpoint, useTLS: Bool) {
        let options = NWProtocolWebSocket.Options()
        options.autoReplyPing = true
        options.maximumMessageSize = Self.maxFrameBytes
        let parameters: NWParameters = useTLS ? .tls : .tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(options, at: 0)
        connection = NWConnection(to: endpoint, using: parameters)
        (events, continuation) = AsyncStream.makeStream(of: Event.self)
    }

    public func start() {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.continuation.yield(.ready)
                self.receive()
            case .failed, .cancelled:
                self.finish(code: nil)
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    public func send(_ frame: Data) {
        send(frame, opcode: .binary)
    }

    public func sendText(_ text: String) {
        send(Data(text.utf8), opcode: .text)
    }

    public func cancel() {
        connection.cancel()
    }

    private func send(_ data: Data, opcode: NWProtocolWebSocket.Opcode) {
        let metadata = NWProtocolWebSocket.Metadata(opcode: opcode)
        let context = NWConnection.ContentContext(identifier: "mbs-remote", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { [weak self] error in
            if error != nil { self?.connection.cancel() }
        })
    }

    private func receive() {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self else { return }
            if error != nil {
                self.connection.cancel()
                return
            }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            switch metadata?.opcode {
            case .binary:
                if let data { self.continuation.yield(.frame(data)) }
            case .text:
                if let data, let text = String(data: data, encoding: .utf8) { self.continuation.yield(.text(text)) }
            case .close:
                self.finish(code: metadata?.closeCode.rawCode)
                self.connection.cancel()
                return
            default:
                break
            }
            self.receive()
        }
    }

    private func finish(code: UInt16?) {
        continuation.yield(.closed(code: code))
        continuation.finish()
    }
}

extension NWProtocolWebSocket.CloseCode {
    fileprivate var rawCode: UInt16? {
        switch self {
        case let .protocolCode(code): code.rawValue
        case let .applicationCode(code): code
        case let .privateCode(code): code
        @unknown default: nil
        }
    }
}

/// Поиск ноутбука в локальной сети через Bonjour по номеру студии.
public final class RemoteBrowser: @unchecked Sendable {
    public enum Event: Sendable {
        /// `nil` — ноутбука сейчас не видно.
        case endpoint(NWEndpoint?)
        /// iOS не разрешает поиск в локальной сети: это решает пользователь в настройках.
        case denied
    }

    public static let serviceType = "_mbs-remote._tcp"

    public let events: AsyncStream<Event>

    private let continuation: AsyncStream<Event>.Continuation
    private let browser: NWBrowser
    private let studioID: String
    private let queue = DispatchQueue(label: "ru.titan.mafboard.remote-browser")

    public init(studioID: String) {
        self.studioID = studioID
        browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: .tcp)
        (events, continuation) = AsyncStream.makeStream(of: Event.self)
    }

    public func start() {
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self else { return }
            let match = results.first { result in
                if case let .bonjour(record) = result.metadata { return record["id"] == self.studioID }
                return false
            }
            self.continuation.yield(.endpoint(match?.endpoint))
        }
        browser.stateUpdateHandler = { [weak self] state in
            if case let .waiting(error) = state, case let .dns(code) = error, code == kDNSServiceErr_PolicyDenied {
                self?.continuation.yield(.denied)
            }
        }
        browser.start(queue: queue)
    }

    public func cancel() {
        browser.cancel()
        continuation.finish()
    }
}
