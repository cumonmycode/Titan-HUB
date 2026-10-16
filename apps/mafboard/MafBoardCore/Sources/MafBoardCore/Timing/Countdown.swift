import Foundation

/// Таймер обратного отсчёта, вычисляемый от дат, а не от тиков: не сбивается при сворачивании
/// приложения, блокировке экрана и восстановлении после перезапуска.
public struct Countdown: Codable, Sendable, Equatable {
    public private(set) var duration: TimeInterval
    private var elapsedBeforeRun: TimeInterval = 0
    private var runningSince: Date?

    public init(seconds: Int) {
        duration = TimeInterval(seconds)
    }

    public var isRunning: Bool { runningSince != nil }

    public func elapsed(at date: Date) -> TimeInterval {
        let current = runningSince.map { max(0, date.timeIntervalSince($0)) } ?? 0
        return elapsedBeforeRun + current
    }

    public func remaining(at date: Date) -> TimeInterval {
        max(0, duration - elapsed(at: date))
    }

    public func isExpired(at date: Date) -> Bool {
        remaining(at: date) <= 0
    }

    public mutating func start(at date: Date) {
        guard runningSince == nil else { return }
        runningSince = date
    }

    public mutating func pause(at date: Date) {
        guard let since = runningSince else { return }
        elapsedBeforeRun += max(0, date.timeIntervalSince(since))
        runningSince = nil
    }

    public mutating func reset() {
        elapsedBeforeRun = 0
        runningSince = nil
    }

    /// «+30 секунд» к текущей речи.
    public mutating func extend(bySeconds seconds: Int) {
        duration += TimeInterval(seconds)
    }
}
