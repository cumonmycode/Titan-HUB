import Foundation

/// Запись журнала: действие ведущего и время, когда оно сделано.
public struct LogEntry: Codable, Sendable, Equatable {
    public let action: GameAction
    public let date: Date
}

/// Идущая игра: исходные данные + журнал действий. Состояние всегда выводится из журнала,
/// поэтому отмена шага — это просто переигрывание журнала без последней записи,
/// а сохранение/восстановление после падения приложения не может «разъехаться».
public struct GameSession: Sendable, Equatable {
    public let setup: GameSetup
    public private(set) var log: [LogEntry]
    public private(set) var state: GameState

    public init(setup: GameSetup) {
        self.setup = setup
        log = []
        state = GameEngine.start(setup)
    }

    /// Сыгранная игра из истории — чтобы поправить итоги (допбаллы, протокол, ЛХ).
    public init(record: GameRecord) throws(GameError) {
        setup = record.setup
        log = record.log
        state = try Self.replay(setup: record.setup, log: record.log)
    }

    public var canUndo: Bool { !log.isEmpty }

    public mutating func perform(_ action: GameAction, at date: Date = .now) throws(GameError) {
        state = try GameEngine.apply(action, to: state, at: date)
        log.append(LogEntry(action: action, date: date))
    }

    /// Отменяет последнее действие ведущего и возвращает его.
    @discardableResult
    public mutating func undo() throws(GameError) -> GameAction {
        guard let last = log.last else { throw .nothingToUndo }
        let remaining = Array(log.dropLast())
        state = try Self.replay(setup: setup, log: remaining)
        log = remaining
        return last.action
    }

    /// Вернуть удалённого игрока (дисквалификация, выбывание по решению ведущего, фолы, техфолы):
    /// из журнала убирается действие, которым он был удалён, остальные переигрываются.
    /// Если без этого действия журнал не сходится — ошибка, состояние не меняется. Возвращает убранное действие.
    @discardableResult
    public mutating func reinstate(_ seat: Seat) throws(GameError) -> GameAction {
        guard let cause = state.seat(seat)?.elimination?.cause, let index = removalIndex(of: seat, cause: cause) else {
            throw .nothingToCancel(seat)
        }
        var remaining = log
        let removed = remaining.remove(at: index)
        // Отметка «на критике» относится к этому удалению и без него не имеет смысла.
        remaining = remaining.enumerated().filter { offset, entry in
            guard offset >= index, case let .markCriticalRemoval(target, _) = entry.action else { return true }
            return target != seat
        }.map(\.element)
        let replayed: GameState
        do {
            replayed = try Self.replay(setup: setup, log: remaining)
        } catch {
            throw .cannotReinstate(seat)
        }
        guard replayed.isAlive(seat) else { throw .cannotReinstate(seat) }
        state = replayed
        log = remaining
        return removed.action
    }

    /// Последнее действие, которым игрок удалён этой причиной.
    private func removalIndex(of seat: Seat, cause: EliminationCause) -> Int? {
        log.lastIndex { entry in
            switch (cause, entry.action) {
            case let (.removed(.fouls), .foul(target)): target == seat
            case let (.removed(.techFouls), .techFoul(target)), let (.removed(.techFouls), .bigTechFoul(target)): target == seat
            case let (.removed(.disqualified), .disqualify(target, _)): target == seat
            case let (.hostDecision, .eliminateByHost(target, _)): target == seat
            default: false
            }
        }
    }

    public static func replay(setup: GameSetup, log: [LogEntry]) throws(GameError) -> GameState {
        var state = GameEngine.start(setup)
        for entry in log {
            state = try GameEngine.apply(entry.action, to: state, at: entry.date)
        }
        return state
    }
}

/// Сохраняются только исходные данные и журнал. Правило совместимости: новая версия движка обязана
/// воспроизводить журналы старых версий; если это невозможно — поднимаем `currentSchemaVersion` и пишем миграцию.
extension GameSession: Codable {
    public static let currentSchemaVersion = 1

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case setup
        case log
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard version <= Self.currentSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion, in: container,
                debugDescription: "Игра сохранена более новой версией приложения (\(version))"
            )
        }
        setup = try container.decode(GameSetup.self, forKey: .setup)
        log = try container.decode([LogEntry].self, forKey: .log)
        do {
            state = try Self.replay(setup: setup, log: log)
        } catch {
            throw DecodingError.dataCorrupted(DecodingError.Context(
                codingPath: container.codingPath,
                debugDescription: "Журнал игры не воспроизводится: \(error.localizedDescription)"
            ))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.currentSchemaVersion, forKey: .schemaVersion)
        try container.encode(setup, forKey: .setup)
        try container.encode(log, forKey: .log)
    }
}
