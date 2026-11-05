import Foundation

public enum RemoteChannel: Sendable, Equatable {
    case lan
    case cloud
}

/// Какой канал использовать. Предпочитаем сеть: 3 секунды без сигнала — переходим в облако,
/// а как только Bonjour снова видит ноутбук — возвращаемся. Чистая логика без сети и таймеров.
public struct RemoteChannelPolicy: Sendable {
    public static let silenceLimit: TimeInterval = 3
    /// Bonjour может видеть ноутбук, а соединение не проходить (например, клиенты сети изолированы).
    /// Тогда пробуем сеть снова только изредка, чтобы не прыгать между каналами.
    public static let lanRetryInterval: TimeInterval = 30
    /// Подключения к релею считаются лимитом по адресу, поэтому при его молчании паузы растут.
    public static let cloudRetryLimit: TimeInterval = 30

    public private(set) var channel: RemoteChannel?
    /// Растёт, когда нужно новое соединение, даже если канал тот же.
    public private(set) var connectionSerial = 0

    private let startedAt: Date
    private var lanVisible = false
    private var lastHeard: Date
    private var lanFailedAt: Date?
    private var cloudPause: TimeInterval = silenceLimit

    public init(now: Date) {
        startedAt = now
        lastHeard = now
    }

    public mutating func lanVisibilityChanged(_ visible: Bool, at now: Date) {
        let appeared = visible && !lanVisible
        lanVisible = visible
        if appeared, channel != .lan {
            lanFailedAt = nil
            switchTo(.lan, at: now)
        }
    }

    /// Пришли данные с этого канала: он жив.
    public mutating func heard(on source: RemoteChannel, at now: Date) {
        guard source == channel else { return }
        lastHeard = now
        switch source {
        case .lan: lanFailedAt = nil
        case .cloud: cloudPause = Self.silenceLimit
        }
    }

    public mutating func tick(at now: Date) {
        guard let channel else {
            if now.timeIntervalSince(startedAt) >= Self.silenceLimit { switchTo(.cloud, at: now) }
            return
        }
        let silence = now.timeIntervalSince(lastHeard)
        switch channel {
        case .lan:
            if silence >= Self.silenceLimit {
                lanFailedAt = now
                switchTo(.cloud, at: now)
            }
        case .cloud:
            if lanVisible, let failedAt = lanFailedAt, now.timeIntervalSince(failedAt) >= Self.lanRetryInterval {
                lanFailedAt = nil
                switchTo(.lan, at: now)
            } else if silence >= cloudPause {
                cloudPause = min(cloudPause * 2, Self.cloudRetryLimit)
                switchTo(.cloud, at: now)
            }
        }
    }

    private mutating func switchTo(_ next: RemoteChannel, at now: Date) {
        channel = next
        connectionSerial += 1
        lastHeard = now
    }
}

/// Команды в пути. При смене канала неподтверждённые отправляются снова: ноутбук узнает повтор по номеру.
/// Старше срока не отправляются: «Стоп» из прошлого хуже, чем сообщение, что команда не дошла.
public struct RemotePendingCommands: Sendable {
    public static let lifetime: TimeInterval = 5

    private struct Item: Sendable {
        let envelope: RemoteEnvelope
        let createdAt: Date
    }

    private var items: [Item] = []

    public init() {}

    public var isEmpty: Bool { items.isEmpty }
    public var count: Int { items.count }

    public mutating func add(_ envelope: RemoteEnvelope, at now: Date) {
        items.append(Item(envelope: envelope, createdAt: now))
    }

    /// Пришёл ответ. `false` — такой команды уже нет: например, это ответ на повтор.
    @discardableResult
    public mutating func acknowledge(id: String) -> Bool {
        guard let index = items.firstIndex(where: { $0.envelope.id == id }) else { return false }
        items.remove(at: index)
        return true
    }

    /// Что отправить заново по новому каналу.
    public func resendable(at now: Date) -> [RemoteEnvelope] {
        items.filter { now.timeIntervalSince($0.createdAt) < Self.lifetime }.map(\.envelope)
    }

    /// Убрать просроченные. Возвращает, сколько команд не дошло.
    public mutating func expire(at now: Date) -> Int {
        let before = items.count
        items.removeAll { now.timeIntervalSince($0.createdAt) >= Self.lifetime }
        return before - items.count
    }
}
