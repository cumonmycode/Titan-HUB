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

    /// Когда выйдет время, если таймер идёт. На паузе — `nil`: момент конца ещё неизвестен.
    /// По нему Live Activity сама показывает обратный отсчёт, без обновлений из приложения.
    public var endDate: Date? {
        runningSince.map { $0.addingTimeInterval(duration - elapsedBeforeRun) }
    }

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

    /// Сколько прошло сверх отведённого времени (0, пока время не вышло) — ведущий видит перебор.
    public func overtime(at date: Date) -> TimeInterval {
        max(0, elapsed(at: date) - duration)
    }

    /// Доля оставшегося времени: 1 — только начали, 0 — время вышло.
    public func fraction(at date: Date) -> Double {
        duration > 0 ? remaining(at: date) / duration : 0
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

    /// Время вышло — таймер останавливается ровно на нуле, а не идёт дальше.
    public mutating func finish() {
        elapsedBeforeRun = duration
        runningSince = nil
    }

    public mutating func reset() {
        elapsedBeforeRun = 0
        runningSince = nil
    }

    /// «+30 секунд» к текущей речи (отрицательное — снять их обратно).
    public mutating func extend(bySeconds seconds: Int) {
        duration += TimeInterval(seconds)
    }
}
